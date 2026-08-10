import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const urlInput = z.object({ website: z.string().min(3).max(300) });

export type BusinessDetection = {
  name: string | null;
  industry: string | null;
  audience: string | null;
  tone: "expert" | "friendly" | "premium" | "direct";
  locale: string;
  keywords: string[];
  summary: string | null;
};

/** Step 1: scrape the site and let the AI fill business, industry, tone and language. */
export const detectBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => urlInput.parse(input))
  .handler(async ({ data }): Promise<BusinessDetection> => {
    const { scrapeSite } = await import("./scrape.server");
    const { callOpenRouter, parseJsonLoose } = await import("./ai.server");
    const { ALL_INDUSTRIES, LANGUAGES } = await import("./industries");

    const site = await scrapeSite(data.website);
    const raw = await callOpenRouter({
      system:
        `You analyse a company website. Return ONLY JSON: {"name":string,"industry":string,"audience":string,"tone":"expert"|"friendly"|"premium"|"direct","locale":string,"keywords":string[],"summary":string}. ` +
        `"industry" MUST be picked from this list: ${ALL_INDUSTRIES.join(", ")}. ` +
        `Classify by WHAT THE COMPANY SELLS, never by the industries of its customers: a software company selling tools to retailers is software, not retail. ` +
        `"keywords": commercial search terms for the company's own product category (what a buyer would type to find this product), never terms about its customers' industries. ` +
        `"locale" MUST be one of: ${LANGUAGES.map((l) => l.code).join(", ")}. ` +
        `Return 8 keywords. "audience": one short sentence naming who buys the product.`,
      user: JSON.stringify(site),
      json: true,
      maxTokens: 900,
    });
    const p = parseJsonLoose<Partial<BusinessDetection>>(raw);
    const tone = (["expert", "friendly", "premium", "direct"] as const).includes(p.tone as never)
      ? (p.tone as BusinessDetection["tone"])
      : "expert";
    const locale = LANGUAGES.some((l) => l.code === p.locale)
      ? (p.locale as string)
      : (site.lang ?? "en").slice(0, 2).toLowerCase();
    return {
      name: p.name?.toString().slice(0, 120) ?? site.title,
      industry: ALL_INDUSTRIES.includes(p.industry ?? "") ? (p.industry as string) : null,
      audience: p.audience?.toString().slice(0, 300) ?? null,
      tone,
      locale: LANGUAGES.some((l) => l.code === locale) ? locale : "en",
      keywords: (p.keywords ?? []).filter((k) => typeof k === "string" && k.trim()).slice(0, 10),
      summary: p.summary?.toString().slice(0, 400) ?? site.description,
    };
  });

/** Step 2: auto-detect competitors + keywords with live DataForSEO data only. */
export const detectMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    urlInput
      .extend({
        name: z.string().max(160).optional(),
        industry: z.string().max(160).optional(),
        locale: z.string().max(8).optional(),
        seeds: z.array(z.string().min(1).max(120)).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { normalizeUrl } = await import("./scrape.server");
    const { localeOpts, requireLiveDataForSeo, discoverCompetitorsFromSerp } = await import("./research.server");
    const { keywordIdeas, keywordsForSite } = await import("./dataforseo.server");
    const { QUOTA, dedupeKeywords } = await import("./quotas");
    const { scoreRelevance, compositeScore, MIN_RELEVANCE } = await import("./relevance.server");

    const website = normalizeUrl(data.website);
    const domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const opts = localeOpts(data.locale ?? null);
    await requireLiveDataForSeo();

    // Real Google SERP results only — no AI-invented rivals.
    const competitorRows = await discoverCompetitorsFromSerp(
      { name: data.name ?? null, website_url: website, industry: data.industry ?? null },
      data.locale ?? null,
      null,
      null,
      QUOTA.competitors,
    );

    // Site first: DataForSEO tells us what the domain actually ranks for,
    // before any AI-guessed seed can steer the scan into the wrong industry.
    let siteRows: Awaited<ReturnType<typeof keywordsForSite>> = [];
    try {
      siteRows = await keywordsForSite(domain, opts, QUOTA.keywords);
    } catch {
      /* fall back to seeds only */
    }
    const usedSeeds = Array.from(
      new Set([
        ...siteRows.slice(0, QUOTA.seeds).map((r) => r.keyword),
        ...(data.seeds ?? []).filter(Boolean),
      ]),
    ).slice(0, QUOTA.seeds);
    const ideas = usedSeeds.length
      ? await keywordIdeas(usedSeeds, opts, QUOTA.keywords)
      : await keywordIdeas([data.industry ?? data.name ?? domain], opts, QUOTA.keywords);

    const merged = dedupeKeywords([...siteRows, ...ideas].filter((k) => k?.keyword), QUOTA.keywords * 3);
    const scores = await scoreRelevance(
      { name: data.name ?? null, website_url: website, industry: data.industry ?? null },
      merged.map((k) => k.keyword),
    );
    const ranked = merged
      .map((k) => ({ k, rel: scores[k.keyword.toLowerCase()] ?? 60 }))
      .filter((x) => (Object.keys(scores).length ? x.rel >= MIN_RELEVANCE : true))
      .sort((a, b) => compositeScore(b.k, b.rel) - compositeScore(a.k, a.rel))
      .slice(0, QUOTA.keywords);

    return {
      live: true,
      source: "dataforseo" as const,
      competitors: competitorRows.map((c) => c.domain),
      keywords: ranked.map(({ k }) => ({
        keyword: k.keyword,
        volume: k.search_volume ?? null,
        difficulty: k.difficulty ?? null,
      })),
    };
  });