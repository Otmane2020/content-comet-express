import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const projectInput = z.object({ projectId: z.string().uuid() });

/** Tells the dashboard whether keyword metrics come from live SEO data or AI estimates. */
export const dataSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { dfsPing } = await import("./dataforseo.server");
    return dfsPing();
  });

/**
 * Find competitor domains for the project's own website.
 *
 * Delegates to the `discover-competitors` Supabase Edge Function, which
 * combines two live, non-manual signals — DataForSEO Labs domain overlap
 * (real shared-keyword rivals, queried straight from the site's URL) and a
 * live Google SERP pass for the business's category — instead of the old
 * category-guess-only SERP pipeline. Everything is AI/DataForSEO-sourced,
 * nothing typed. Results are upserted (never a destructive delete), so an
 * onboarding-time scan survives later dashboard visits.
 */
export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.functions.invoke("discover-competitors", {
      body: { project_id: data.projectId },
    });
    if (error) throw new Error(error.message ?? "Competitor discovery failed");
    return { found: result?.found ?? 0, competitors: result?.competitors ?? [], cached: false };
  });

/**
 * Pull keyword ideas for the project.
 *
 * Delegates to the `discover-keywords` Supabase Edge Function, which combines
 * the site's own ranking keywords, phrase-match seed expansion, and whatever
 * competitors are already tracked — all live DataForSEO data, no manual
 * seed list required (the `seeds` input is accepted for backward
 * compatibility with the UI but the edge function derives its own seeds
 * from the site and stored project keywords).
 */
export const researchKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    projectInput.extend({ seeds: z.array(z.string().min(1).max(120)).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.functions.invoke("discover-keywords", {
      body: { project_id: data.projectId },
    });
    if (error) throw new Error(error.message ?? "Keyword research failed");
    return { found: result?.found ?? 0, keywords: result?.keywords ?? [] };
  });

/**
 * Pull the keywords a single, explicitly-named competitor domain ranks for.
 * Kept as a direct DataForSEO call: this is the manual "look up one rival"
 * tool in the Research tab, not part of the automatic onboarding/dashboard
 * discovery flow, so it stays outside the edge functions above.
 */
export const analyzeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.extend({ domain: z.string().min(3).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { competitorKeywords } = await import("./dataforseo.server");
    const { localeOpts, saveKeywords, requireLiveDataForSeo } = await import("./research.server");
    const { QUOTA, dedupeKeywords } = await import("./quotas");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, audience, locale, target_country, website_url")
      .eq("id", data.projectId)
      .single();
    const clean = data.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    await requireLiveDataForSeo();
    const rows = dedupeKeywords(
      await competitorKeywords(
        data.domain,
        localeOpts(project?.locale ?? null, project?.target_country ?? null),
        QUOTA.keywordsPerCompetitor,
      ),
      QUOTA.keywordsPerCompetitor,
    );
    await supabase.from("competitors").upsert(
      {
        user_id: userId,
        project_id: data.projectId,
        domain: clean,
        metrics: { top_keywords: rows },
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "project_id,domain" },
    );
    const found = await saveKeywords(
      supabase,
      userId,
      data.projectId,
      rows.map((r) => ({ ...r, origin: "competitor" as const })),
    );
    return { found };
  });

/**
 * Hands-free research: runs the competitor and keyword edge functions back
 * to back. Safe to call on every dashboard load — it exits immediately when
 * the project already has tracked keywords (unless `force` is set).
 */
export const autoResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.extend({ force: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    if (!data.force) {
      const { count } = await supabase
        .from("keyword_research")
        .select("id", { count: "exact", head: true })
        .eq("project_id", data.projectId);
      if ((count ?? 0) > 0) return { found: 0, skipped: true, live: true };
    }

    const { data: comp, error: compErr } = await supabase.functions.invoke("discover-competitors", {
      body: { project_id: data.projectId },
    });
    if (compErr) throw new Error(compErr.message ?? "Competitor discovery failed");

    const { data: kw, error: kwErr } = await supabase.functions.invoke("discover-keywords", {
      body: { project_id: data.projectId },
    });
    if (kwErr) throw new Error(kwErr.message ?? "Keyword research failed");

    return {
      found: kw?.found ?? 0,
      skipped: false,
      live: true,
      competitorsFound: comp?.found ?? 0,
    };
  });
