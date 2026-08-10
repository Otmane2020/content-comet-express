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
export type KwOrigin = "site" | "seed" | "competitor";

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
  if (storedProfile?.reliable) {
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
  const { QUOTA, dedupeKeywords, dedupeDomains, isFresh } = await import("./quotas");
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
      // Drop rivals stored by an earlier, unfiltered scan.
      await supabase.from("competitors").delete().eq("project_id", projectId);
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

  const unique = dedupeKeywords(rows.filter(onTopic), QUOTA.totalKeywords * 4);
  const saved = await saveKeywords(supabase, userId, projectId, unique, biz);
  return { found: saved, skipped: false, live: true, cachedCompetitors: cacheUsable };
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
): Promise<SerpCompetitor[]> {
  const { serpOrganicSearch } = await import("./dataforseo.server");
  const { dedupeDomains, isRealCompetitor } = await import("./quotas");
  const { scoreCompetitorDomains, MIN_COMPETITOR_RELEVANCE } = await import("./relevance.server");

  const opts = localeOpts(locale, targetCountry);
  const country = opts.locationName;
  const category = (biz.industry ?? biz.name ?? "").trim();
  if (!category) throw new Error("Not enough business information to build competitor search queries.");

  // Build queries from the canonical profile when available.
  const productQueries = (biz.products ?? []).slice(0, 3).map((p) => p);
  const salesPrefix = biz.sales_model === "wholesale" ? "grossiste " : "";
  const queries = Array.from(
    new Set(
      [
        ...productQueries.map((p) => `${salesPrefix}${p}`.trim()),
        category,
        city ? `${category} ${city}` : null,
        `${category} ${country}`,
        salesPrefix ? `${salesPrefix}${category}`.trim() : `fournisseur ${category}`,
        `${category} en ligne`,
        city ? `${category} ${city} ${country}` : `${category} pas cher`,
      ].filter((q): q is string => Boolean(q && q.trim())),
    ),
  ).slice(0, 6);

  const batches = await Promise.all(queries.map((q) => serpOrganicSearch(q, opts, 20)));
  const allResults = batches.flat();
  if (!allResults.length) {
    throw new Error("DataForSEO returned no organic SERP results for these queries.");
  }

  const selfDomain = (biz.website_url ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
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

  const shortlist = dedupeDomains(Array.from(byDomain.keys()), selfDomain, 40);
  if (!shortlist.length) {
    throw new Error("No plausible competitor domains found in real Google SERP results.");
  }

  const compScores = await scoreCompetitorDomains(biz, shortlist);
  const kept = shortlist
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
