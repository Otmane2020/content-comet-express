import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { KwRow } from "./research.server";

const projectInput = z.object({ projectId: z.string().uuid() });

/** Tells the dashboard whether keyword metrics come from live SEO data or AI estimates. */
export const dataSourceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { dfsPing } = await import("./dataforseo.server");
    return dfsPing();
  });

type ProjectCtx = { name?: string | null; industry?: string | null; locale?: string | null; website_url?: string | null; keywords?: string[] | null };

/** Find competitor domains for the project's own website. */
export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { discoverCompetitorsFromSerp, requireLiveDataForSeo } = await import("./research.server");
    const { QUOTA, isFresh } = await import("./quotas");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, industry, audience, website_url, locale, target_country")
      .eq("id", data.projectId)
      .single();
    if (!project?.website_url) throw new Error("Add your website URL in Settings first.");

    // Cache guard: don't re-bill DataForSEO for a list scanned this week.
    const { data: cached } = await supabase
      .from("competitors")
      .select("domain, last_checked_at")
      .eq("project_id", data.projectId)
      .order("last_checked_at", { ascending: false })
      .limit(QUOTA.competitors);
    const cachedRows = (cached ?? []) as { last_checked_at: string | null }[];
    if (cachedRows.length >= QUOTA.competitors && isFresh(cachedRows[0]?.last_checked_at)) {
      return { found: cachedRows.length, cached: true };
    }

    await requireLiveDataForSeo();

    // Real Google SERP results only — no AI-invented rivals.
    const rows = await discoverCompetitorsFromSerp(
      { name: project.name, website_url: project.website_url, industry: project.industry, audience: project.audience },
      project.locale ?? null,
      project.target_country ?? null,
      null,
      QUOTA.competitors,
    );
    if (rows.length) {
      // Replace results from earlier scans that included platforms/aggregators.
      await supabase.from("competitors").delete().eq("project_id", data.projectId);
      await supabase.from("competitors").upsert(
        rows.map((r) => ({
          user_id: userId,
          project_id: data.projectId,
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
    return { found: rows.length, cached: false };
  });

/** Pull keyword ideas from the project's seed keywords. */
export const researchKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    projectInput.extend({ seeds: z.array(z.string().min(1).max(120)).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { keywordIdeas } = await import("./dataforseo.server");
    const { localeOpts, saveKeywords, requireLiveDataForSeo } = await import("./research.server");
    const { QUOTA, dedupeKeywords } = await import("./quotas");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, audience, locale, target_country, website_url")
      .eq("id", data.projectId)
      .single();
    await requireLiveDataForSeo();
    const rows: KwRow[] = await keywordIdeas(
      data.seeds.slice(0, QUOTA.seeds),
      localeOpts(project?.locale ?? null, project?.target_country ?? null),
      QUOTA.keywords,
    );
    const unique = dedupeKeywords(rows, QUOTA.keywords);
    const found = await saveKeywords(supabase, userId, data.projectId, unique.map((r) => ({ ...r, origin: "seed" as const })));
    return { found };
  });

/** Pull the keywords a competitor domain ranks for. */
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
    const rows: KwRow[] = dedupeKeywords(
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
 * Hands-free research: expands the project's own keywords, discovers
 * competitors and pulls their keywords. Safe to call on every dashboard load —
 * it exits immediately when the project already has tracked keywords.
 */
export const autoResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.extend({ force: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { runResearch } = await import("./research.server");
    return runResearch(context.supabase, context.userId, data.projectId, data.force ?? false);
  });
