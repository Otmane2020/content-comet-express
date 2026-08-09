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
    const { localeOpts, saveKeywords } = await import("./research.server");
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
    const { localeOpts, saveKeywords } = await import("./research.server");
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
    const { localeOpts, saveKeywords } = await import("./research.server");
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
