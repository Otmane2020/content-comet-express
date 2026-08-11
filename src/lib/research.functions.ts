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
      .select("id, name, industry, audience, website_url, locale, target_country, business_profile")
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

    // Use the stored business profile if available; fall back to basic fields.
    const biz =
      (project.business_profile as Record<string, any> | null) ?? {
        name: project.name,
        website_url: project.website_url,
        industry: project.industry,
        audience: project.audience,
      };

    // Real Google SERP results only — no AI-invented rivals.
    const rows = await discoverCompetitorsFromSerp(
      biz,
      project.locale ?? null,
      project.target_country ?? null,
      null,
      QUOTA.competitors,
    );
    if (rows.length) {
      // Upsert only — a scan that finds fewer domains than last time (API
      // hiccup, tighter query) must never wipe out previously-found ones.
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

/**
 * Pull keyword suggestions from the project's seed keywords.
 * Uses phrase-match suggestions (every result contains the seed) instead of
 * broad keyword ideas, so the list can never drift to off-topic high-volume
 * terms. Requires a canonical business profile for relevance scoring.
 */
export const researchKeywords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    projectInput.extend({ seeds: z.array(z.string().min(1).max(120)).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { keywordSuggestions } = await import("./dataforseo.server");
    const { localeOpts, saveKeywords, requireLiveDataForSeo } = await import("./research.server");
    const { QUOTA, dedupeKeywords } = await import("./quotas");
    const { productSeeds, scoreRelevance, MIN_RELEVANCE } = await import("./relevance.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, audience, locale, target_country, website_url, business_profile")
      .eq("id", data.projectId)
      .single();
    await requireLiveDataForSeo();

    const opts = localeOpts(project?.locale ?? null, project?.target_country ?? null);
    const biz =
      (project?.business_profile as Record<string, any> | null) ?? {
        name: project?.name,
        website_url: project?.website_url,
        industry: project?.industry,
        audience: project?.audience,
      };

    // Validate user-provided seeds against the canonical profile.
    const userSeeds = data.seeds.slice(0, QUOTA.seeds).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const seedScores = await scoreRelevance(biz, userSeeds);
    const validSeeds = userSeeds.filter((s) => (seedScores[s] ?? 0) >= MIN_RELEVANCE);

    // Fill remaining seed slots with profile-derived category seeds.
    const categorySeeds = await productSeeds(biz, QUOTA.seeds);
    const usedSeeds = Array.from(new Set([...validSeeds, ...categorySeeds])).slice(0, QUOTA.seeds);

    // Phrase-match per seed: every result contains the seed.
    const perSeed = Math.max(10, Math.ceil((QUOTA.keywords * 2) / Math.max(1, usedSeeds.length)));
    const batches = await Promise.all(
      usedSeeds.map((s) => keywordSuggestions(s, opts, perSeed).catch(() => [] as KwRow[])),
    );
    const rows: KwRow[] = dedupeKeywords(batches.flat(), QUOTA.keywords * 2);

    const found = await saveKeywords(supabase, userId, data.projectId, rows.map((r) => ({ ...r, origin: "seed" as const })), biz);
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
      .select("name, industry, audience, locale, target_country, website_url, business_profile")
      .eq("id", data.projectId)
      .single();
    const clean = data.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    await requireLiveDataForSeo();
    const biz =
      (project?.business_profile as Record<string, any> | null) ?? {
        name: project?.name,
        website_url: project?.website_url,
        industry: project?.industry,
        audience: project?.audience,
      };
    const rows: KwRow[] = dedupeKeywords(
      await competitorKeywords(
        data.domain,
        localeOpts(project?.locale ?? null, project?.target_country ?? null),
        QUOTA.keywordsPerCompetitor,
      ),
      QUOTA.keywordsPerCompetitor * 2,
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
      biz,
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
