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
        `"locale" MUST be one of: ${LANGUAGES.map((l) => l.code).join(", ")}. ` +
        `"keywords": 8 realistic search keywords this business should rank for. "audience": one short sentence.`,
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

/** Step 2: auto-detect competitors + keywords with DataForSEO (AI fallback). */
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
    const { localeOpts, hasDataForSeo, aiCompetitors, aiKeywords } = await import("./research.server");
    const { competitorDomains, keywordIdeas } = await import("./dataforseo.server");

    const website = normalizeUrl(data.website);
    const domain = website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    const ctx = { name: data.name ?? null, industry: data.industry ?? null, locale: data.locale ?? null, domain };
    const opts = localeOpts(data.locale ?? null);
    const live = hasDataForSeo();

    let competitors: { domain: string }[] = [];
    try {
      if (!live) throw new Error("no-dfs");
      competitors = await competitorDomains(domain, opts);
    } catch {
      competitors = await aiCompetitors(domain, ctx);
    }

    const seeds = (data.seeds ?? []).filter(Boolean).slice(0, 10);
    const usedSeeds = seeds.length ? seeds : [data.industry ?? data.name ?? domain];
    let keywords: { keyword: string; search_volume: number | null; difficulty: number | null }[] = [];
    try {
      if (!live) throw new Error("no-dfs");
      keywords = await keywordIdeas(usedSeeds, opts);
    } catch {
      keywords = await aiKeywords(usedSeeds, ctx);
    }

    return {
      live,
      source: live ? ("dataforseo" as const) : ("ai" as const),
      competitors: competitors
        .map((c) => c.domain)
        .filter((d) => d && d !== domain)
        .slice(0, 8),
      keywords: keywords
        .filter((k) => k?.keyword)
        .slice(0, 20)
        .map((k) => ({ keyword: k.keyword, volume: k.search_volume ?? null, difficulty: k.difficulty ?? null })),
    };
  });