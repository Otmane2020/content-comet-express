import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const projectInput = z.object({ projectId: z.string().uuid() });

/** Find competitor domains for the project's own website. */
export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { competitorDomains } = await import("./dataforseo.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("id, website_url, locale")
      .eq("id", data.projectId)
      .single();
    if (!project?.website_url) throw new Error("Add your website URL in Settings first.");

    const rows = await competitorDomains(project.website_url, localeOpts(project.locale));
    if (rows.length) {
      await supabase.from("competitors").upsert(
        rows.map((r) => ({
          user_id: userId,
          project_id: data.projectId,
          domain: r.domain,
          metrics: r,
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,domain" },
      );
    }
    return { found: rows.length };
  });

/** Pull keyword ideas from the project's seed keywords. */
export const researchKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    projectInput.extend({ seeds: z.array(z.string().min(1).max(120)).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { keywordIdeas } = await import("./dataforseo.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("locale").eq("id", data.projectId).single();
    const rows = await keywordIdeas(data.seeds, localeOpts(project?.locale ?? null));
    await saveKeywords(supabase, userId, data.projectId, rows);
    return { found: rows.length };
  });

/** Pull the keywords a competitor domain ranks for. */
export const analyzeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.extend({ domain: z.string().min(3).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { competitorKeywords } = await import("./dataforseo.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase.from("projects").select("locale").eq("id", data.projectId).single();
    const rows = await competitorKeywords(data.domain, localeOpts(project?.locale ?? null));
    await supabase.from("competitors").upsert(
      {
        user_id: userId,
        project_id: data.projectId,
        domain: data.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
        metrics: { top_keywords: rows.slice(0, 10) },
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "project_id,domain" },
    );
    await saveKeywords(supabase, userId, data.projectId, rows);
    return { found: rows.length };
  });

function localeOpts(locale: string | null) {
  const lang = (locale ?? "fr-FR").slice(0, 2).toLowerCase();
  const byLang: Record<string, string> = { fr: "France", en: "United States", es: "Spain", de: "Germany", it: "Italy", nl: "Netherlands", pt: "Portugal" };
  return { languageCode: lang, locationName: byLang[lang] ?? "France" };
}

type Sb = { from: (t: string) => any };

async function saveKeywords(
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
