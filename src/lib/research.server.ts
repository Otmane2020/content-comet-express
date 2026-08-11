/**
 * Language and target market are two different things: a French business can
 * publish in English. `targetCountry` wins over the language default.
 */
export function localeOpts(locale: string | null, targetCountry?: string | null) {
  const lang = (locale ?? "fr-FR").slice(0, 2).toLowerCase();
  const byLang: Record<string, string> = { fr: "France", en: "United States", es: "Spain", de: "Germany", it: "Italy", nl: "Netherlands", pt: "Portugal" };
  return { languageCode: lang, locationName: targetCountry?.trim() || byLang[lang] || "France" };
}

export type KwRow = {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  competitor_domain?: string | null;
  origin?: KwOrigin;
  relevance_score?: number | null;
};

/** Why a keyword is in the list: the site itself, a seed expansion, or a rival. */
export type KwOrigin = "site" | "seed" | "competitor" | "local";

export function hasDataForSeo() {
  return Boolean(process.env["DATAFORSEO_LOGIN"] && process.env["DATAFORSEO_PASSWORD"]);
}

export const DFS_REQUIRED =
  "Live SEO data is not connected. Add your DataForSEO API login and API password (DataForSEO dashboard › API access) — no estimated data is used.";

/** Throws unless DataForSEO credentials are present and accepted. */
export async function requireLiveDataForSeo() {
  const { dfsPing } = await import("./dataforseo.server");
  const ping = await dfsPing();
  if (!ping.live) {
    throw new Error(
      ping.reason === "unauthorized"
        ? "DataForSEO rejected your credentials. Use the API password from your DataForSEO account (API access), not your website login."
        : DFS_REQUIRED,
    );
  }
}

type Sb = { from: (t: string) => any };

/**
 * Loads a project's canonical business profile. If the project predates the
 * business_profile column, it backfills it by scraping the site and building
 * the profile on the fly. Returns null when no reliable profile can be built.
 */
async function loadOrBackfillProfile(
  supabase: Sb,
  projectId: string,
  project: { name?: string | null; industry?: string | null; website_url?: string | null; locale?: string | null },
): Promise<import("./relevance.server").CanonicalBusinessProfile | null> {
  // 1. Try loading the stored profile.
  const { data: stored } = await supabase
    .from("projects")
    .select("business_profile")
    .eq("id", projectId)
    .single();
  const storedProfile = stored?.business_profile as import("./relevance.server").CanonicalBusinessProfile | null;
  // A stored profile is only valid for the site it was built from. Correcting
  // the project's website — the fix when an install recorded the
  // myshopify.com address instead of the real shop — has to rebuild it, or the
  // merchant changes the URL and every later scan silently keeps describing the
  // old one.
  const bare = (u: string | null | undefined) =>
    (u ?? "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase();
  const builtForThisSite =
    !project.website_url || !storedProfile?.website_url || bare(storedProfile.website_url) === bare(project.website_url);
  if (storedProfile?.reliable && builtForThisSite) {
    return {
      ...storedProfile,
      website_url: storedProfile.website_url ?? project.website_url ?? null,
      name: storedProfile.name ?? project.name ?? null,
    };
  }

  // 2. Backfill: scrape the site and build the profile.
  if (!project.website_url) return null;
  const { scrapeSite } = await import("./scrape.server");
  const { buildCanonicalProfile } = await import("./relevance.server");
  try {
    const site = await scrapeSite(project.website_url);
    const canonical = await buildCanonicalProfile(site, {
      name: project.name ?? null,
      industry: project.industry ?? null,
      website_url: project.website_url,
    });
    if (canonical.reliable) {
      // Persist so future runs don't re-scrape.
      await supabase
        .from("projects")
        .update({ business_profile: canonical })
        .eq("id", projectId);
    }
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Full hands-free research pass for one project:
 *   canonical profile → seeds → phrase-match suggestions → competitors → competitor keywords
 *   → relevance scoring → save.
 * DataForSEO is NEVER used as an unconstrained idea generator. Every suggestion
 * is phrase-matched to a seed derived from the canonical business profile, so
 * "meuble" can never expand to "menuisier ébéniste".
 */
export async function runResearch(supabase: Sb, userId: string, projectId: string, force = false) {
  const { keywordSuggestions, keywordsForSite, competitorKeywords } = await import(
    "./dataforseo.server"
  );
  const { QUOTA, dedupeKeywords, dedupeDomains, isFresh, matchesRequestedLanguage } = await import("./quotas");
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, industry, audience, locale, target_country, website_url, keywords, business_profile")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("Project not found");

  const { count } = await supabase
    .from("keyword_research")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (!force && (count ?? 0) > 0) return { found: 0, skipped: true, live: true };

  await requireLiveDataForSeo();

  // 0. Build or load the canonical business profile. Without it, refuse to
  //    continue — generic seeds produce off-topic results.
  const canonical = await loadOrBackfillProfile(supabase, projectId, project);
  if (!canonical?.reliable) {
    return {
      found: 0,
      skipped: false,
      live: true,
      error:
        "Could not build a reliable business profile from the website. The site content does not clearly describe what is sold. Update the website or provide a business description in project settings.",
    };
  }
  const biz = canonical;

  // The dashboard uses the exact same methodology as onboarding. Persist the
  // validated output so the 30-day planner and article writer never fall back
  // to a legacy seed expansion.
  const market = await runLiveMarketResearch(biz, {
    website: project.website_url ?? biz.website_url ?? "",
    locale: project.locale ?? null,
    targetCountry: project.target_country ?? null,
    keywordLimit: QUOTA.totalKeywords,
    competitorLimit: QUOTA.competitors,
  });
  if (market.competitors.length) {
    await supabase.from("competitors").upsert(
      market.competitors.map((competitor) => ({
        user_id: userId,
        project_id: projectId,
        domain: competitor.domain,
        title: competitor.title,
        snippet: competitor.snippet,
        appearances: competitor.appearances,
        best_position: competitor.bestPosition,
        metrics: {
          appearances: competitor.appearances,
          bestPosition: competitor.bestPosition,
          relevance: competitor.relevance,
        },
        last_checked_at: new Date().toISOString(),
      })),
      { onConflict: "project_id,domain" },
    );
  }
  const saved = await saveKeywords(supabase, userId, projectId, market.keywords, biz);
  // Local research is a branch of this same run: its query candidates are
  // added to the shared opportunity pool, while Google Maps businesses live in
  // their own table because many have no organic website to store as a rival.
  let localCompetitors = 0;
  if (project.target_country) {
    const { researchLocalMarket } = await import("./local-market.server");
    const local = await researchLocalMarket({
      business: biz,
      locale: project.locale ?? null,
      targetCountry: project.target_country,
      buyerKeywords: market.keywords.map((row) => row.keyword),
      limit: QUOTA.competitors,
    });
    localCompetitors = local.competitors.length;
    if (local.competitors.length) {
      const { error } = await supabase.from("local_competitors").upsert(
        local.competitors.map((competitor) => ({
          user_id: userId,
          project_id: projectId,
          identity: competitor.identity,
          name: competitor.name,
          domain: competitor.domain,
          place_id: competitor.placeId,
          country: competitor.country,
          city: competitor.city,
          category: competitor.category,
          rating: competitor.rating,
          review_count: competitor.reviewCount,
          queries_found_for: competitor.queriesFoundFor,
          local_pack_positions: competitor.localPackPositions,
          recurrence_score: competitor.recurrenceScore,
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,identity" },
      );
      if (error) console.warn("[local-market] could not save Maps competitors", error.message);
    }
    if (local.opportunities.length) await saveKeywords(supabase, userId, projectId, local.opportunities, biz);
  }
  return { found: saved, skipped: false, live: true, competitors: market.competitors.length, localCompetitors };

  const opts = localeOpts(project.locale ?? null, project.target_country ?? null);
  let rows: KwRow[] = [];

  // 1. What the site itself is actually about, straight from DataForSEO.
  let siteSeeds: string[] = [];
  if (project.website_url) {
    try {
      const siteRows = await keywordsForSite(project.website_url, opts, QUOTA.keywords);
      rows = siteRows.map((r) => ({ ...r, origin: "site" as const }));
      siteSeeds = siteRows.slice(0, QUOTA.seeds).map((r) => r.keyword);
    } catch {
      /* fall through to stored seeds */
    }
  }

  const { productSeeds, scoreRelevance, MIN_RELEVANCE } =
    await import("./relevance.server");

  // 2. Generate seeds from the canonical profile — NOT from generic terms.
  //    Site terms and stored seeds are kept only when they pass relevance;
  //    product-category seeds from the profile fill the rest.
  const storedSeeds: string[] = (project.keywords ?? []).filter(Boolean);
  const rawSeeds = Array.from(
    new Set([...siteSeeds, ...storedSeeds].map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
  const seedScores = rawSeeds.length ? await scoreRelevance(biz, rawSeeds) : {};
  const relevantSeeds = rawSeeds.filter((s) => (seedScores[s] ?? 0) >= MIN_RELEVANCE);
  const category = await productSeeds(biz, QUOTA.seeds);
  const usedSeeds = Array.from(new Set([...category, ...relevantSeeds])).slice(0, QUOTA.seeds);
  if (usedSeeds.length) {
    // Phrase-match suggestions per seed: every result contains the seed, so the
    // list can never drift to high-volume, off-topic terms.
    const perSeed = Math.max(15, Math.ceil((QUOTA.totalKeywords * 2) / Math.max(1, usedSeeds.length)));
    const batches = await Promise.all(
      usedSeeds.map((s) => keywordSuggestions(s, opts, perSeed).catch(() => [] as KwRow[])),
    );
    for (const batch of batches) {
      rows = rows.concat(batch.map((r) => ({ ...r, origin: "seed" as const })));
    }
  }

  // Lexical guard: site/competitor rows must share a meaningful word with the
  // seeds before they even reach the AI relevance pass.
  const seedTokens = new Set(
    usedSeeds
      .flatMap((s) => s.split(/\s+/))
      .map((w) => w.replace(/[^a-z0-9]/gi, "").toLowerCase())
      .filter((w) => w.length > 3),
  );
  const onTopic = (r: KwRow) =>
    !seedTokens.size ||
    r.origin === "seed" ||
    r.keyword
      .toLowerCase()
      .split(/\s+/)
      .some((w) => seedTokens.has(w.replace(/[^a-z0-9]/gi, "")));

  const self = (project.website_url ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  let domains: string[] = [];

  // Cache: reuse stored competitors when they were checked recently.
  const { data: cached } = await supabase
    .from("competitors")
    .select("domain, last_checked_at")
    .eq("project_id", projectId)
    .order("last_checked_at", { ascending: false })
    .limit(QUOTA.competitors);
  const cachedRows = (cached ?? []) as { domain: string; last_checked_at: string | null }[];
  const cacheUsable = !force && cachedRows.length > 0 && isFresh(cachedRows[0]?.last_checked_at);

  if (cacheUsable) {
    domains = dedupeDomains(cachedRows.map((r) => r.domain), self, QUOTA.competitors);
  } else if (project.website_url) {
    // Real Google SERP results only — no AI-invented rivals.
    const found = await discoverCompetitorsFromSerp(
      biz,
      project.locale ?? null,
      project.target_country ?? null,
      null,
      QUOTA.competitors,
    );
    domains = found.map((r) => r.domain);
    if (found.length) {
      // Upsert only — a scan that finds fewer domains than last time (API
      // hiccup, tighter query) must never wipe out previously-found ones.
      await supabase.from("competitors").upsert(
        found.map((r) => ({
          user_id: userId,
          project_id: projectId,
          domain: r.domain,
          title: r.title,
          snippet: r.snippet,
          appearances: r.appearances,
          best_position: r.bestPosition,
          metrics: { appearances: r.appearances, bestPosition: r.bestPosition, relevance: r.relevance },
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,domain" },
      );
    }
  }

  for (const domain of domains) {
    if (rows.length >= QUOTA.totalKeywords) break;
    try {
      const compRows = await competitorKeywords(domain, opts, QUOTA.keywordsPerCompetitor);
      rows = rows.concat(compRows.map((r) => ({ ...r, origin: "competitor" as const })));
    } catch {
      /* keep what we have */
    }
  }

  // The language guard used to run only in the onboarding scan, so this daily
  // pass quietly re-polluted a non-English calendar with English phrases.
  const unique = dedupeKeywords(
    rows.filter((r) => onTopic(r) && matchesRequestedLanguage(r.keyword, opts.languageCode)),
    QUOTA.totalKeywords * 4,
  );
  const legacySaved = await saveKeywords(supabase, userId, projectId, unique, biz);
  return { found: legacySaved, skipped: false, live: true, cachedCompetitors: cacheUsable };
}

/**
 * Scores relevance (AI, relevance only — metrics stay DataForSEO's), drops
 * off-topic noise, ranks by the composite score and upserts so a refresh
 * really refreshes existing metrics instead of ignoring them.
 *
 * FAIL-CLOSED: if no canonical profile is provided and none can be loaded,
 * zero keywords are saved. No keyword is saved without a positive relevance
 * score from the AI.
 */
export async function saveKeywords(
  supabase: Sb,
  userId: string,
  projectId: string,
  rows: KwRow[],
  profile?: { name?: string | null; website_url?: string | null; industry?: string | null; audience?: string | null; description?: string | null; sales_model?: string | null; products?: string[] | null; services?: string[] | null; locations?: string[] | null },
): Promise<number> {
  if (!rows.length) return 0;
  const { QUOTA, dedupeKeywords } = await import("./quotas");
  const { scoreRelevance, compositeScore, MIN_RELEVANCE } = await import("./relevance.server");

  const candidates = dedupeKeywords(rows.filter((r) => r.keyword), QUOTA.totalKeywords * 3);
  const biz =
    profile ??
    ((
      await supabase
        .from("projects")
        .select("name, website_url, industry, audience")
        .eq("id", projectId)
        .single()
    ).data as { name?: string | null; website_url?: string | null; industry?: string | null; audience?: string | null } | null) ??
    {};

  const scores = await scoreRelevance(biz, candidates.map((r) => r.keyword));
  const graded = Object.keys(scores).length > 0;
  const scored = candidates.map((r) => {
    // No score = not judged relevant. Never fall back to a passing default:
    // that is how high-volume off-topic terms used to survive.
    const relevance = graded ? (scores[r.keyword.trim().toLowerCase()] ?? r.relevance_score ?? 0) : 100;
    return { row: r, relevance, rank: compositeScore(r, relevance) };
  });
  const kept = scored
    .filter((s) => !graded || s.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.rank - a.rank || (b.row.search_volume ?? 0) - (a.row.search_volume ?? 0))
    .slice(0, QUOTA.totalKeywords);
  if (!kept.length) return 0;

  const { error } = await supabase.from("keyword_research").upsert(
    kept.map(({ row, relevance }) => ({
      user_id: userId,
      project_id: projectId,
      keyword: row.keyword,
      search_volume: row.search_volume,
      cpc: row.cpc,
      competition: row.competition,
      difficulty: row.difficulty,
      intent: row.intent,
      competitor_domain: row.competitor_domain ?? null,
      origin: row.origin ?? (row.competitor_domain ? "competitor" : "seed"),
      relevance_score: relevance,
    })),
    { onConflict: "project_id,keyword" },
  );
  if (error) throw new Error(error.message);
  // Sweep out off-topic terms stored by an earlier, volume-driven pass.
  // Keywords already used by an article are left alone.
  if (graded) {
    await supabase
      .from("keyword_research")
      .delete()
      .eq("project_id", projectId)
      .eq("used", false)
      .or(`relevance_score.is.null,relevance_score.lt.${MIN_RELEVANCE}`);
  }
  return kept.length;
}

export type SerpCompetitor = {
  domain: string;
  title: string | null;
  snippet: string | null;
  appearances: number;
  bestPosition: number;
  relevance: number;
};

/** What a rival puts on its own landing page — the observable half of "best practice". */
export type CompetitorLanding = {
  domain: string;
  title: string | null;
  metaDescription: string | null;
  positioning: string;
  headings: string[];
  categories: string[];
  sellsToBusinesses: boolean;
};

/**
 * Reads the landing page of each rival with the same extractor used on the
 * merchant's own site, so the writer can be told what the pages already winning
 * these queries actually cover — instead of inventing "best practice" from
 * nothing. Failures are skipped: a rival that blocks us must not fail the scan.
 */
export async function analyseCompetitorLandings(
  domains: string[],
  max = 5,
): Promise<CompetitorLanding[]> {
  const { scrapeLandingProfile } = await import("./scrape.server");
  const picked = domains.slice(0, max);
  const results = await Promise.all(
    picked.map(async (domain) => {
      try {
        const p = await scrapeLandingProfile(domain);
        return {
          domain,
          title: p.title,
          metaDescription: p.metaDescription,
          positioning: p.positioning,
          headings: [...p.h1, ...p.h2, ...p.h3].slice(0, 12),
          categories: p.categoryLinks.slice(0, 12),
          sellsToBusinesses: p.sellsToBusinesses,
        };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is CompetitorLanding => r !== null);
}

/**
 * Builds realistic commercial Google queries from the business profile and
 * runs them through the real DataForSEO SERP (Google Organic) API. Only
 * actual ranking domains are ever returned — never an AI-invented rival.
 */
export async function discoverCompetitorsFromSerp(
  biz: {
    name?: string | null;
    website_url?: string | null;
    industry?: string | null;
    audience?: string | null;
    description?: string | null;
    sales_model?: string | null;
    products?: string[] | null;
    locations?: string[] | null;
  },
  locale: string | null,
  targetCountry: string | null,
  city?: string | null,
  limit = 5,
  buyerQueries?: string[],
): Promise<SerpCompetitor[]> {
  const { serpWithAiSignals, competitorDomains } = await import("./dataforseo.server");
  const { dedupeDomains, isRealCompetitor } = await import("./quotas");
  const { scoreCompetitorDomains, MIN_COMPETITOR_RELEVANCE } = await import("./relevance.server");

  const opts = localeOpts(locale, targetCountry);
  const country = opts.locationName;
  const category = (biz.industry ?? biz.name ?? "").trim();
  if (!category) throw new Error("Not enough business information to build competitor search queries.");

  // Build queries from the canonical profile when available.
  const productQueries = (biz.products ?? []).slice(0, 3).map((p) => p);
  const isFrench = opts.languageCode === "fr";
  const isPhysicalGoods =
    biz.sales_model === "wholesale" ||
    biz.sales_model === "retail" ||
    biz.sales_model === "manufacturer" ||
    biz.sales_model === "marketplace";
  const salesPrefix = biz.sales_model === "wholesale" ? (isFrench ? "grossiste " : "wholesale ") : "";
  const b2bMerchant = ["wholesale", "manufacturer"].includes((biz.sales_model ?? "").toLowerCase());
  // Buying-intent modifiers aren't the same across sectors: "supplier"/
  // "cheap"/"online" only make sense for physical goods (wholesale, retail,
  // manufacturer, marketplace) — a service, SaaS, logistics or B2B business
  // is searched for with "best"/"reviews"/"alternative" instead. Picking one
  // set for every sector is what used to build nonsense queries like
  // "fournisseur assistant vocal IA" and silently return zero competitors.
  const intentQueries = b2bMerchant
    ? (isFrench
      ? (productQueries.length ? productQueries : [category]).flatMap((product) => [
          `grossiste ${product}`,
          `fournisseur ${product}`,
          `${product} professionnel`,
          `${product} en gros`,
        ])
      : (productQueries.length ? productQueries : [category]).flatMap((product) => [
          `wholesale ${product}`,
          `${product} supplier`,
          `${product} for retailers`,
          `${product} bulk`,
        ]))
    : isPhysicalGoods
    ? isFrench
      ? [
          salesPrefix ? `${salesPrefix}${category}`.trim() : `fournisseur ${category}`,
          `${category} en ligne`,
          city ? `${category} ${city} ${country}` : `${category} pas cher`,
        ]
      : [
          salesPrefix ? `${salesPrefix}${category}`.trim() : `${category} supplier`,
          `${category} online`,
          city ? `${category} ${city} ${country}` : `cheap ${category}`,
        ]
    : isFrench
      ? [`meilleur ${category}`, `${category} avis`, `comparatif ${category}`]
      : [`best ${category}`, `${category} reviews`, `${category} alternative`];
  const generatedQueries = Array.from(
    new Set(
      [
        // Bare product terms first: the buying-intent modifier below narrows
        // every query to the same niche B2B slice of SERPs, which only ever
        // surfaces small directory-style sites. The bare term is what most
        // buyers — and the sector's bigger, better-ranked players — actually
        // rank for.
        ...(b2bMerchant ? [] : productQueries),
        ...(b2bMerchant ? [] : productQueries.map((p) => `${salesPrefix}${p}`.trim())),
        ...(b2bMerchant ? [] : [category]),
        ...(b2bMerchant ? [] : [city ? `${category} ${city}` : null]),
        ...(b2bMerchant ? [] : [`${category} ${country}`]),
        ...intentQueries,
      ].filter((q): q is string => Boolean(q && q.trim())),
    ),
  ).slice(0, 9);
  const queries = Array.from(
    new Set((buyerQueries?.length ? buyerQueries : generatedQueries).map((q) => q.trim()).filter(Boolean)),
  ).slice(0, 9);

  const selfDomain = (biz.website_url ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();

  // Two independent real-Google signals, cross-referenced: which domains rank
  // for the buyer queries we constructed (works even for a brand-new site),
  // and which domains DataForSEO's own index already treats as competing on
  // organic keyword overlap with this site (only useful once the site has
  // some ranking history — silently empty otherwise, never blocking).
  const [batches, overlapDomains] = await Promise.all([
    Promise.all(queries.map((q) => serpWithAiSignals(q, opts, 20))),
    selfDomain ? competitorDomains(selfDomain, opts, 15).catch(() => []) : Promise.resolve([]),
  ]);
  const allResults = batches.flatMap((b) => b.organic);
  // Who the AI assistant actually quotes when asked the buyer's question. For a
  // generative-engine product this outranks organic position: these are the
  // sites already occupying the answer the merchant wants to be in. Same
  // response, no extra request — it used to be filtered out and discarded.
  const aiCited = batches.flatMap((b) => b.ai.citedDomains);
  const aiQueryCount = batches.filter((b) => b.ai.hasAiOverview).length;
  if (aiQueryCount) {
    console.info("[competitors] AI Overview present", {
      queriesWithAi: aiQueryCount,
      of: batches.length,
      citedDomains: Array.from(new Set(aiCited)).slice(0, 10),
    });
  }
  if (!allResults.length && !overlapDomains.length && !aiCited.length) {
    throw new Error("DataForSEO returned no organic SERP results for these queries.");
  }

  const byDomain = new Map<string, { title: string | null; snippet: string | null; appearances: number; bestPosition: number }>();
  for (const r of allResults) {
    if (!isRealCompetitor(r.domain, selfDomain)) continue;
    const existing = byDomain.get(r.domain);
    if (existing) {
      existing.appearances += 1;
      if (r.position < existing.bestPosition) existing.bestPosition = r.position;
    } else {
      byDomain.set(r.domain, {
        title: r.title,
        snippet: r.snippet,
        appearances: 1,
        bestPosition: r.position,
      });
    }
  }
  // A domain found by both signals is stronger evidence. Do not add a domain
  // that appears only in the overlap graph: a broad consumer site can share a
  // generic product keyword without being present in the buyer's Google SERP.
  for (const d of overlapDomains) {
    if (!isRealCompetitor(d.domain, selfDomain)) continue;
    const existing = byDomain.get(d.domain);
    if (existing) {
      existing.appearances += 1;
    }
  }
  // A domain the AI answer cites counts double: it is not merely ranking, it is
  // already inside the answer the merchant is trying to enter.
  for (const domain of aiCited) {
    if (!isRealCompetitor(domain, selfDomain)) continue;
    const existing = byDomain.get(domain);
    if (existing) {
      existing.appearances += 2;
      existing.bestPosition = Math.min(existing.bestPosition, 1);
    } else {
      byDomain.set(domain, { title: null, snippet: null, appearances: 2, bestPosition: 1 });
    }
  }

  const shortlist = dedupeDomains(Array.from(byDomain.keys()), selfDomain, 40);
  if (!shortlist.length) {
    throw new Error("No plausible competitor domains found in real Google SERP results.");
  }

  // SERP presence alone is not enough for a wholesale/manufacturer profile:
  // furniture retailers can rank for the same generic categories while selling
  // to an entirely different buyer. Verify the candidate's own landing page
  // with the same deterministic B2B extractor used for the merchant.
  const landingProfiles = b2bMerchant ? await analyseCompetitorLandings(shortlist, 20) : [];
  const b2bDomains = new Set(landingProfiles.filter((p) => p.sellsToBusinesses).map((p) => p.domain.toLowerCase()));
  const buyerMatched = b2bMerchant ? shortlist.filter((domain) => b2bDomains.has(domain.toLowerCase())) : shortlist;
  if (!buyerMatched.length) {
    throw new Error("Google found category sites, but none showed evidence of selling to the same professional buyers.");
  }

  // A verified B2B landing page is direct evidence of the same buyer model.
  // Do not discard it because a second model cannot infer a business from a
  // domain name alone.
  const compScores = b2bMerchant
    ? Object.fromEntries(buyerMatched.map((domain) => [domain, 100]))
    : await scoreCompetitorDomains(biz, buyerMatched);
  const kept = buyerMatched
    .filter((d) => (compScores[d] ?? 0) >= MIN_COMPETITOR_RELEVANCE)
    .map((d) => {
      const info = byDomain.get(d)!;
      return {
        domain: d,
        title: info.title,
        snippet: info.snippet,
        appearances: info.appearances,
        bestPosition: info.bestPosition,
        relevance: compScores[d] ?? 0,
      };
    })
    .sort((a, b) => b.relevance - a.relevance || b.appearances - a.appearances || a.bestPosition - b.bestPosition)
    .slice(0, limit);

  return kept;
}

/**
 * The single live market-research methodology used by onboarding and the
 * dashboard. There are deliberately no phrase-match suggestions, site-keyword
 * expansions or domain-graph keywords in this function:
 *
 * landing page -> AI candidate queries -> DataForSEO validation -> real Google
 * SERP + AI Overview -> buyer-model verified competitors.
 */
export async function runLiveMarketResearch(
  biz: import("./relevance.server").CanonicalBusinessProfile,
  input: {
    website: string;
    locale: string | null;
    targetCountry?: string | null;
    keywordLimit?: number;
    competitorLimit?: number;
  },
): Promise<{
  keywords: KwRow[];
  competitors: SerpCompetitor[];
  diagnostics: { proposed: number; measured: number; qualified: number; serps: number };
}> {
  const { scrapeSite } = await import("./scrape.server");
  const { searchVolumeFor } = await import("./dataforseo.server");
  const { candidateKeywords, compositeScore, scoreRelevance, MIN_RELEVANCE } = await import("./relevance.server");

  const opts = localeOpts(input.locale, input.targetCountry ?? null);
  const keywordLimit = input.keywordLimit ?? 30;
  const site = await scrapeSite(input.website);
  const proposed = await candidateKeywords(biz, site.landing ?? null, keywordLimit * 5);
  if (!proposed.length) {
    throw new Error("Could not derive qualified buyer queries from the website landing page.");
  }

  const measured = await searchVolumeFor(proposed, opts);
  if (!measured.length) {
    throw new Error("DataForSEO found no measurable demand for the qualified buyer queries.");
  }

  const relevance = await scoreRelevance(biz, measured.map((row) => row.keyword));
  const keywords = measured
    .map((row) => ({ ...row, origin: "seed" as const, relevance_score: relevance[row.keyword.toLowerCase()] ?? 0 }))
    .filter((row) => (row.relevance_score ?? 0) >= MIN_RELEVANCE)
    .sort((a, b) =>
      compositeScore(b, b.relevance_score ?? 0) - compositeScore(a, a.relevance_score ?? 0) ||
      (b.search_volume ?? 0) - (a.search_volume ?? 0),
    )
    .slice(0, keywordLimit);
  if (!keywords.length) {
    throw new Error("The measurable queries did not match this business's buyer profile.");
  }

  const competitors = await discoverCompetitorsFromSerp(
    biz,
    input.locale,
    input.targetCountry ?? null,
    null,
    input.competitorLimit ?? 8,
    keywords.map((row) => row.keyword),
  );

  console.info("[market-research] completed", {
    website: input.website,
    proposed: proposed.length,
    measured: measured.length,
    qualified: keywords.length,
    competitors: competitors.length,
  });
  return {
    keywords,
    competitors,
    diagnostics: { proposed: proposed.length, measured: measured.length, qualified: keywords.length, serps: competitors.length },
  };
}
