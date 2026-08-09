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
 * Full hands-free research pass for one project:
 *   site keywords → seeds → keyword ideas → competitors → competitor keywords
 *   → relevance scoring → save.
 * DataForSEO decides the topic of the site (keywords_for_site) before any
 * stored/AI seed is used, so a wrong industry guess can no longer steer the
 * whole calendar. Live DataForSEO data only — no estimated fallback.
 */
export async function runResearch(supabase: Sb, userId: string, projectId: string, force = false) {
  const { keywordIdeas, keywordsForSite, competitorDomains, competitorKeywords } = await import(
    "./dataforseo.server"
  );
  const { QUOTA, dedupeKeywords, dedupeDomains, isFresh } = await import("./quotas");
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, industry, audience, locale, target_country, website_url, keywords")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("Project not found");

  const { count } = await supabase
    .from("keyword_research")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (!force && (count ?? 0) > 0) return { found: 0, skipped: true, live: true };

  await requireLiveDataForSeo();

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

  const biz = {
    name: project.name,
    website_url: project.website_url,
    industry: project.industry,
    audience: project.audience,
  };
  const { productSeeds, scoreRelevance, scoreCompetitorDomains, MIN_RELEVANCE, MIN_COMPETITOR_RELEVANCE } =
    await import("./relevance.server");

  // 2. Expand with seeds. Site terms and stored seeds are kept only when they
  //    describe the product; product-category seeds fill the rest, so a
  //    high-volume off-topic term can never steer the whole calendar.
  const storedSeeds: string[] = (project.keywords ?? []).filter(Boolean);
  const rawSeeds = Array.from(
    new Set([...siteSeeds, ...storedSeeds].map((s) => s.trim().toLowerCase()).filter(Boolean)),
  );
  const seedScores = rawSeeds.length ? await scoreRelevance(biz, rawSeeds) : {};
  const relevantSeeds = rawSeeds.filter((s) => (seedScores[s] ?? 0) >= MIN_RELEVANCE);
  const category = await productSeeds(biz, QUOTA.seeds);
  const usedSeeds = Array.from(new Set([...category, ...relevantSeeds])).slice(0, QUOTA.seeds);
  if (usedSeeds.length) {
    const ideas = await keywordIdeas(usedSeeds, opts, QUOTA.keywords);
    rows = rows.concat(ideas.map((r) => ({ ...r, origin: "seed" as const })));
  }

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
    // Over-fetch: platforms/aggregators are stripped out, so ask for more than we keep.
    const raw = await competitorDomains(project.website_url, opts, QUOTA.competitors * 5);
    const shortlist = dedupeDomains(raw.map((r) => r.domain), self, QUOTA.competitors * 4);
    // Ranking for the same words is not enough: the domain must sell to the
    // same buyers before we mine its keywords.
    const compScores = await scoreCompetitorDomains(biz, shortlist);
    const validated = shortlist.filter((d) => (compScores[d] ?? 0) >= MIN_COMPETITOR_RELEVANCE);
    domains = (validated.length ? validated : []).slice(0, QUOTA.competitors);
    const found = domains
      .map((d) => raw.find((r) => r.domain.replace(/^www\./, "").toLowerCase() === d))
      .filter(Boolean) as typeof raw;
    if (found.length) {
      // Drop rivals stored by an earlier, unfiltered scan.
      await supabase.from("competitors").delete().eq("project_id", projectId);
      await supabase.from("competitors").upsert(
        found.slice(0, QUOTA.competitors).map((r) => ({
          user_id: userId,
          project_id: projectId,
          domain: r.domain,
          metrics: { ...r, relevance: compScores[r.domain.replace(/^www\./, "").toLowerCase()] ?? null },
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

  const unique = dedupeKeywords(rows, QUOTA.totalKeywords * 4);
  const saved = await saveKeywords(supabase, userId, projectId, unique, biz);
  return { found: saved, skipped: false, live: true, cachedCompetitors: cacheUsable };
}

/**
 * Scores relevance (AI, relevance only — metrics stay DataForSEO's), drops
 * off-topic noise, ranks by the composite score and upserts so a refresh
 * really refreshes existing metrics instead of ignoring them.
 */
export async function saveKeywords(
  supabase: Sb,
  userId: string,
  projectId: string,
  rows: KwRow[],
  profile?: { name?: string | null; website_url?: string | null; industry?: string | null; audience?: string | null },
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
  return kept.length;
}
