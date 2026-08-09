export function localeOpts(locale: string | null) {
  const lang = (locale ?? "fr-FR").slice(0, 2).toLowerCase();
  const byLang: Record<string, string> = { fr: "France", en: "United States", es: "Spain", de: "Germany", it: "Italy", nl: "Netherlands", pt: "Portugal" };
  return { languageCode: lang, locationName: byLang[lang] ?? "France" };
}

export type KwRow = {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  competitor_domain?: string | null;
};

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

  const seeds: string[] = (project.keywords ?? []).filter(Boolean).slice(0, 10);
  const fallback = project.name ?? project.industry ?? "";
  const usedSeeds = seeds.length ? seeds : fallback ? [fallback] : [];
  const opts = localeOpts(project.locale ?? null);
  let rows: KwRow[] = [];

  if (usedSeeds.length) {
    rows = await keywordIdeas(usedSeeds, opts);
  }

  let domains: { domain: string }[] = [];
  if (project.website_url) {
    domains = await competitorDomains(project.website_url, opts);
    if (domains.length) {
      await supabase.from("competitors").upsert(
        domains.map((r) => ({
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

  for (const d of domains.slice(0, 2)) {
    try {
      rows = rows.concat(await competitorKeywords(d.domain, opts));
    } catch {
      /* keep what we have */
    }
  }

  await saveKeywords(supabase, userId, projectId, rows);
  return { found: rows.length, skipped: false, live: true };
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
  const { data: existing } = await supabase
    .from("keyword_research")
    .select("keyword")
    .eq("project_id", projectId);
  const seen = new Set(((existing ?? []) as { keyword: string }[]).map((r) => r.keyword.toLowerCase()));
  const fresh = rows.filter((r) => !seen.has(r.keyword.toLowerCase()));
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
