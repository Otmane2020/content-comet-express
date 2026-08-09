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
 * Full hands-free research pass for one project: seed expansion, competitor
 * discovery, and competitor keyword extraction. Live DataForSEO data only —
 * there is no estimated fallback. No-ops when keywords already exist unless
 * `force`.
 */
export async function runResearch(supabase: Sb, userId: string, projectId: string, force = false) {
  const { keywordIdeas, competitorDomains, competitorKeywords } = await import("./dataforseo.server");
  const { QUOTA, dedupeKeywords, dedupeDomains, isFresh } = await import("./quotas");
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, industry, locale, website_url, keywords")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("Project not found");

  const { count } = await supabase
    .from("keyword_research")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (!force && (count ?? 0) > 0) return { found: 0, skipped: true, live: true };

  await requireLiveDataForSeo();

  const seeds: string[] = (project.keywords ?? []).filter(Boolean).slice(0, QUOTA.seeds);
  const fallback = project.name ?? project.industry ?? "";
  const usedSeeds = seeds.length ? seeds : fallback ? [fallback] : [];
  const opts = localeOpts(project.locale ?? null);
  let rows: KwRow[] = [];

  if (usedSeeds.length) {
    rows = await keywordIdeas(usedSeeds, opts, QUOTA.keywords);
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
    const found = await competitorDomains(project.website_url, opts, QUOTA.competitors);
    domains = dedupeDomains(found.map((r) => r.domain), self, QUOTA.competitors);
    if (found.length) {
      await supabase.from("competitors").upsert(
        found.slice(0, QUOTA.competitors).map((r) => ({
          user_id: userId,
          project_id: projectId,
          domain: r.domain,
          metrics: r,
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,domain" },
      );
    }
  }

  for (const domain of domains) {
    if (rows.length >= QUOTA.totalKeywords) break;
    try {
      rows = rows.concat(await competitorKeywords(domain, opts, QUOTA.keywordsPerCompetitor));
    } catch {
      /* keep what we have */
    }
  }

  const unique = dedupeKeywords(rows, QUOTA.totalKeywords);
  await saveKeywords(supabase, userId, projectId, unique);
  return { found: unique.length, skipped: false, live: true, cachedCompetitors: cacheUsable };
}

export async function saveKeywords(
  supabase: Sb,
  userId: string,
  projectId: string,
  rows: {
    keyword: string;
    search_volume: number | null;
    cpc: number | null;
    competition: number | null;
    difficulty: number | null;
    intent: string | null;
    competitor_domain?: string | null;
  }[],
) {
  if (!rows.length) return;
  const { QUOTA, dedupeKeywords } = await import("./quotas");
  const { data: existing } = await supabase
    .from("keyword_research")
    .select("keyword")
    .eq("project_id", projectId);
  const seen = new Set(((existing ?? []) as { keyword: string }[]).map((r) => r.keyword.toLowerCase()));
  const fresh = dedupeKeywords(
    rows.filter((r) => r.keyword && !seen.has(r.keyword.toLowerCase())),
    QUOTA.totalKeywords,
  );
  if (!fresh.length) return;
  await supabase.from("keyword_research").insert(
    fresh.map((r) => ({
      user_id: userId,
      project_id: projectId,
      keyword: r.keyword,
      search_volume: r.search_volume,
      cpc: r.cpc,
      competition: r.competition,
      difficulty: r.difficulty,
      intent: r.intent,
      competitor_domain: r.competitor_domain ?? null,
    })),
  );
}
