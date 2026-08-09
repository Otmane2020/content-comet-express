export function localeOpts(locale: string | null) {
  const lang = (locale ?? "fr-FR").slice(0, 2).toLowerCase();
  const byLang: Record<string, string> = { fr: "France", en: "United States", es: "Spain", de: "Germany", it: "Italy", nl: "Netherlands", pt: "Portugal" };
  return { languageCode: lang, locationName: byLang[lang] ?? "France" };
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
