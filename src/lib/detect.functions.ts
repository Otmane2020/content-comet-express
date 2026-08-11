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
  /** Canonical business profile built from the site. */
  business_profile?: import("./relevance.server").CanonicalBusinessProfile | null;
};

/** Step 1: scrape the site and let the AI fill business, industry, tone and language. */
export const detectBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => urlInput.parse(input))
  .handler(async ({ data }): Promise<BusinessDetection> => {
    const { scrapeSite } = await import("./scrape.server");
    const { callOpenRouter, parseJsonLoose } = await import("./ai.server");
    const { ALL_INDUSTRIES, LANGUAGES } = await import("./industries");
    const { buildCanonicalProfile } = await import("./relevance.server");

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

    // Build the canonical profile from the same scraped content. This is the
    // single source of truth for all subsequent keyword research.
    const business_profile = await buildCanonicalProfile(site, {
      name: p.name?.toString() ?? site.title,
      industry: p.industry ?? null,
      website_url: data.website,
    }).catch(() => null);

    return {
      name: p.name?.toString().slice(0, 120) ?? site.title,
      industry: ALL_INDUSTRIES.includes(p.industry ?? "") ? (p.industry as string) : null,
      audience: p.audience?.toString().slice(0, 300) ?? null,
      tone,
      locale: LANGUAGES.some((l) => l.code === locale) ? locale : "en",
      keywords: (p.keywords ?? []).filter((k) => typeof k === "string" && k.trim()).slice(0, 10),
      summary: p.summary?.toString().slice(0, 400) ?? site.description,
      business_profile,
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
    const { keywordSuggestions, keywordsForSite } = await import("./dataforseo.server");
    const { QUOTA, dedupeKeywords } = await import("./quotas");
    const { scoreRelevance, compositeScore, MIN_RELEVANCE, productSeeds, buildCanonicalProfile } = await import(
      "./relevance.server"
    );
    const { scrapeSite } = await import("./scrape.server");

    const website = normalizeUrl(data.website);
    const domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const opts = localeOpts(data.locale ?? null);
    await requireLiveDataForSeo();

    // 1. Build canonical profile FIRST — before any keyword research.
    // Old projects created before business_profile existed must backfill it.
    let site: Awaited<ReturnType<typeof scrapeSite>>;
    try {
      site = await scrapeSite(data.website);
    } catch {
      site = { url: website, title: data.name ?? null, description: null, lang: null, headings: [], text: "" };
    }
    const canonical = await buildCanonicalProfile(site, {
      name: data.name ?? null,
      industry: data.industry ?? null,
      website_url: website,
    }).catch(() => null);

    // If the profile is not reliable, refuse to continue — generic seeds like
    // "meuble" or "fabricant" produce off-topic results (menuisier, tapissier…).
    if (!canonical?.reliable) {
      return {
        live: true,
        source: "dataforseo" as const,
        competitors: [],
        keywords: [],
        business_profile: canonical,
        error:
          "Could not build a reliable business profile from the website. The site content does not clearly describe what is sold. Add more detail to the website or provide a business description manually.",
      };
    }

    const biz = canonical;

    // 2. Discover competitors using the canonical profile.
    const competitorRows = await discoverCompetitorsFromSerp(biz, data.locale ?? null, null, null, QUOTA.competitors);

    // 3. Site keywords from DataForSEO — what the domain actually ranks for.
    let siteRows: Awaited<ReturnType<typeof keywordsForSite>> = [];
    try {
      siteRows = await keywordsForSite(domain, opts, QUOTA.keywords);
    } catch {
      /* fall back to seeds only */
    }

    // 4. Generate seeds from the canonical profile — NOT from generic terms.
    const categorySeeds = await productSeeds(biz, QUOTA.seeds);
    const usedSeeds = Array.from(
      new Set([
        ...categorySeeds,
        ...siteRows.slice(0, 5).map((r) => r.keyword),
        ...(data.seeds ?? []).filter(Boolean),
      ]),
    ).slice(0, QUOTA.seeds);

    // 5. Phrase-match suggestions per seed: every result contains the seed,
    //    so the list can never drift to high-volume off-topic terms.
    //    This replaces keywordIdeas (broad semantic expansion) which is what
    //    produced "menuisier ébéniste" for a furniture wholesaler.
    const perSeed = Math.max(15, Math.ceil((QUOTA.keywords * 2) / Math.max(1, usedSeeds.length)));
    const batches = await Promise.all(
      usedSeeds.map((s) => keywordSuggestions(s, opts, perSeed).catch(() => [] as Awaited<ReturnType<typeof keywordSuggestions>>)),
    );
    const ideas = batches.flat();

    const merged = dedupeKeywords([...siteRows, ...ideas].filter((k) => k?.keyword), QUOTA.keywords * 3);
    const scores = await scoreRelevance(biz, merged.map((k) => k.keyword));

    // Fail-closed: only keep keywords with a positive relevance score.
    const ranked = merged
      .map((k) => ({ k, rel: scores[k.keyword.toLowerCase()] ?? 0 }))
      .filter((x) => x.rel >= MIN_RELEVANCE)
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
      business_profile: canonical,
    };
  });
