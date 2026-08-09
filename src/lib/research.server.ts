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

/** AI estimate used when DataForSEO credentials are missing or rejected. */
export async function aiKeywords(
  seeds: string[],
  ctx: { name?: string | null; industry?: string | null; locale?: string | null; domain?: string | null },
  competitorDomain?: string,
): Promise<KwRow[]> {
  const { callOpenRouter, parseJsonLoose } = await import("./ai.server");
  const raw = await callOpenRouter({
    system:
      "You are an SEO data analyst. Return ONLY JSON: {\"keywords\":[{\"keyword\":string,\"search_volume\":number,\"cpc\":number,\"competition\":number,\"difficulty\":number,\"intent\":\"informational|commercial|transactional|navigational\"}]}. Estimate realistic monthly volumes for the given market. 30 items max.",
    user: JSON.stringify({
      business: ctx.name ?? null,
      industry: ctx.industry ?? null,
      market: localeOpts(ctx.locale ?? null),
      website: ctx.domain ?? null,
      seeds,
      competitor_domain: competitorDomain ?? null,
      task: competitorDomain
        ? "List the keywords this competitor domain most likely ranks for."
        : "Expand these seeds into high-intent keyword opportunities.",
    }),
    json: true,
    maxTokens: 2000,
  });
  const parsed = parseJsonLoose<{ keywords?: KwRow[] }>(raw);
  return (parsed.keywords ?? [])
    .filter((k) => k && typeof k.keyword === "string" && k.keyword.trim())
    .slice(0, 40)
    .map((k) => ({
      keyword: k.keyword.trim(),
      search_volume: Number.isFinite(k.search_volume as number) ? Number(k.search_volume) : null,
      cpc: Number.isFinite(k.cpc as number) ? Number(k.cpc) : null,
      competition: Number.isFinite(k.competition as number) ? Number(k.competition) : null,
      difficulty: Number.isFinite(k.difficulty as number) ? Number(k.difficulty) : null,
      intent: k.intent ?? null,
      competitor_domain: competitorDomain ?? null,
    }));
}

export async function aiCompetitors(
  domain: string,
  ctx: { name?: string | null; industry?: string | null; locale?: string | null },
) {
  const { callOpenRouter, parseJsonLoose } = await import("./ai.server");
  const raw = await callOpenRouter({
    system:
      "You are an SEO analyst. Return ONLY JSON: {\"competitors\":[{\"domain\":string,\"why\":string}]}. Real, existing websites competing in the same market. Max 8.",
    user: JSON.stringify({ site: domain, business: ctx.name ?? null, industry: ctx.industry ?? null, market: localeOpts(ctx.locale ?? null) }),
    json: true,
    maxTokens: 800,
  });
  const parsed = parseJsonLoose<{ competitors?: { domain: string; why?: string }[] }>(raw);
  return (parsed.competitors ?? [])
    .filter((c) => c?.domain)
    .slice(0, 8)
    .map((c) => ({
      domain: c.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase(),
      intersections: 0,
      avg_position: null as number | null,
      organic_keywords: null as number | null,
      organic_traffic: null as number | null,
      why: c.why ?? null,
      source: "ai" as const,
    }));
}

type Sb = { from: (t: string) => any };

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
