import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const urlInput = z.object({ website: z.string().min(3).max(300) });

function localeFromDomain(website: string) {
  const host = website.replace(/^https?:\/\//i, "").split(/[/?#]/)[0]?.toLowerCase() ?? "";
  if (host.endsWith(".fr")) return "fr";
  if (host.endsWith(".es")) return "es";
  if (host.endsWith(".de")) return "de";
  if (host.endsWith(".it")) return "it";
  if (host.endsWith(".nl")) return "nl";
  if (host.endsWith(".pt")) return "pt";
  return null;
}

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
    const locale = localeFromDomain(data.website) ?? (LANGUAGES.some((l) => l.code === p.locale)
      ? (p.locale as string)
      : (site.lang ?? "en").slice(0, 2).toLowerCase());

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
        audience: z.string().max(300).optional(),
        profile: z.record(z.unknown()).optional(),
        locale: z.string().max(8).optional(),
        seeds: z.array(z.string().min(1).max(120)).max(20).optional(),
        retry: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { normalizeUrl } = await import("./scrape.server");
    const { localeOpts, requireLiveDataForSeo, discoverCompetitorsFromSerp } = await import("./research.server");
    const { competitorDomains, keywordSuggestions, keywordsForSite, searchVolumeFor } = await import("./dataforseo.server");
    const { QUOTA, dedupeKeywords, dedupeDomains, isRealCompetitor, matchesRequestedLanguage } = await import("./quotas");
    const { scoreRelevance, compositeScore, MIN_RELEVANCE, MIN_COMPETITOR_RELEVANCE, productSeeds, candidateKeywords, buildCanonicalProfile, scoreCompetitorDomains } = await import(
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
    // Reuse step 1's profile when it is already reliable: rebuilding it here
    // meant a second, independent classification of the same site — and the
    // one that decides wholesale vs retail, which sets the entire audience.
    const supplied = data.profile as import("./relevance.server").CanonicalBusinessProfile | undefined;
    const bare = (u: string | null | undefined) =>
      (u ?? "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
    // Only reuse step 1's profile when it describes THIS site. Correcting the
    // website URL — the usual fix when a Shopify install landed on the
    // myshopify.com address instead of the real shop — must recompute
    // everything downstream, not silently keep the profile of the old URL.
    const canonical =
      supplied?.reliable && bare(supplied.website_url) === bare(website)
        ? supplied
        : await buildCanonicalProfile(site, {
          name: data.name ?? null,
          industry: data.industry ?? null,
          website_url: website,
          // "Professional furniture resellers in France" is the difference
          // between seeding "canapé" and seeding "fournisseur canapé".
          audience: data.audience ?? null,
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

    // 2. Real Google SERPs are the source of truth. The domain-overlap graph
    // can return broad retail sites for a wholesale business merely because
    // both rank for a generic term. It must not suppress buyer-query SERPs.
    // discoverCompetitorsFromSerp uses DataForSEO Google and SerpApi fallback.
    let competitorRows: { domain: string }[] = await discoverCompetitorsFromSerp(
      biz,
      data.locale ?? null,
      null,
      null,
      Math.max(8, QUOTA.competitors),
    ).catch(() => []);
    if (competitorRows.length < 5) {
      // Only supplement real SERPs when they returned too few viable domains.
      const graphRows = await competitorDomains(domain, opts, Math.max(12, QUOTA.competitors * 2)).catch(() => []);
      const graphScores = await scoreCompetitorDomains(biz, graphRows.map((row) => row.domain));
      const serpRows = graphRows.filter(
        (row) =>
          isRealCompetitor(row.domain, domain) &&
          (graphScores[row.domain.toLowerCase()] ?? 0) >= MIN_COMPETITOR_RELEVANCE,
      );
      const known = new Set(competitorRows.map((row) => row.domain.toLowerCase()));
      competitorRows = [...competitorRows, ...serpRows.filter((row) => !known.has(row.domain.toLowerCase()) && isRealCompetitor(row.domain, domain))].slice(0, Math.max(8, QUOTA.competitors));
    }

    // 3. Site keywords from DataForSEO — what the domain actually ranks for.
    let siteRows: Awaited<ReturnType<typeof keywordsForSite>> = [];
    try {
      siteRows = await keywordsForSite(domain, opts, QUOTA.keywords);
    } catch {
      /* fall back to seeds only */
    }

    // 4. Generate seeds from the canonical profile — NOT from generic terms.
    //    Seeds are phrase-matched below, so every child keyword inherits the
    //    seed's exact form: a plural seed returns a whole page of plural
    //    variants. Fold the spelling variants onto one seed per query.
    const categorySeeds = await productSeeds(biz, QUOTA.seeds);
    // What the domain already ranks for is a poor seed for a business selling
    // to other businesses: a wholesaler with a public catalogue ranks for
    // consumer product queries, and phrase-match would expand those into more
    // of the same. Its own sourcing terms come from productSeeds instead.
    const sellsToBusinesses = ["wholesale", "manufacturer"].includes(
      (biz.sales_model ?? "").trim().toLowerCase(),
    );
    const usedSeeds = dedupeKeywords(
      [
        ...categorySeeds,
        ...(sellsToBusinesses ? [] : siteRows.slice(0, 5).map((r) => r.keyword)),
        ...(data.seeds ?? []).filter(Boolean),
      ].map((keyword) => ({ keyword })),
      QUOTA.seeds,
    ).map((s) => s.keyword);

    // 5. Phrase-match suggestions per seed: every result contains the seed,
    //    so the list can never drift to high-volume off-topic terms.
    //    This replaces keywordIdeas (broad semantic expansion) which is what
    //    produced "menuisier ébéniste" for a furniture wholesaler.
    const perSeed = Math.max(15, Math.ceil((QUOTA.keywords * 2) / Math.max(1, usedSeeds.length)));
    const batches = await Promise.all(
      usedSeeds.map((s) => keywordSuggestions(s, opts, perSeed).catch(() => [] as Awaited<ReturnType<typeof keywordSuggestions>>)),
    );
    const ideas = batches.flat();

    // 6. The AI proposes the candidates from the landing page, DataForSEO
    //    measures them. Anything it cannot measure never existed as a query
    //    and is dropped — one batched request for the whole list.
    const proposed = await candidateKeywords(biz, site.landing ?? null, QUOTA.keywords * 4);
    const measured = proposed.length
      ? await searchVolumeFor(proposed, opts).catch((e) => {
          // Loud on purpose: a silent [] here looks identical to "the AI
          // proposed nothing", and the scan would quietly fall back to the
          // phrase-match sources this step exists to replace.
          console.error("[detectMarket] search_volume lookup failed", e);
          return [];
        })
      : [];
    console.info("[detectMarket] AI candidates measured", {
      proposed: proposed.length,
      withVolume: measured.length,
    });

    const merged = dedupeKeywords(
      [...measured, ...siteRows, ...ideas].filter(
        (k) => k?.keyword && matchesRequestedLanguage(k.keyword, opts.languageCode ?? "fr"),
      ),
      QUOTA.keywords * 3,
    );
    const scores = await scoreRelevance(biz, merged.map((k) => k.keyword));

    // Fail-closed: only keep keywords with a positive relevance score.
    const ranked = merged
      .map((k) => ({ k, rel: scores[k.keyword.toLowerCase()] ?? 0 }))
      .filter((x) => x.rel >= MIN_RELEVANCE)
      .sort((a, b) => compositeScore(b.k, b.rel) - compositeScore(a.k, a.rel))
      .slice(0, QUOTA.keywords);

    const result = {
      live: true,
      source: "dataforseo" as const,
      // Final normalisation: strips www/scheme, drops any late duplicate and
      // re-applies the self/blocklist guard to whatever the fallback added.
      competitors: dedupeDomains(competitorRows.map((c) => c.domain), domain, Math.max(8, QUOTA.competitors)),
      keywords: ranked.map(({ k }) => ({
        keyword: k.keyword,
        volume: k.search_volume ?? null,
        difficulty: k.difficulty ?? null,
      })),
      business_profile: canonical,
    };
    // A zero/zero result is not useful market research. The client performs
    // one fresh live retry; only then turn it into an explicit, actionable
    // outcome instead of pretending the scan completed successfully.
    if (data.retry && !result.competitors.length && !result.keywords.length) {
      return {
        ...result,
        error:
          "DataForSEO returned no usable rankings for this site and market. This usually means the domain is new or not indexed in the selected country yet. Try again later or add your first competitors and keywords manually.",
      };
    }
    return result;
  });
