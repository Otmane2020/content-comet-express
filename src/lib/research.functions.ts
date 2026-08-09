import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { KwRow } from "./research.server";

const projectInput = z.object({ projectId: z.string().uuid() });

type ProjectCtx = { name?: string | null; industry?: string | null; locale?: string | null; website_url?: string | null; keywords?: string[] | null };

/** Find competitor domains for the project's own website. */
export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { competitorDomains } = await import("./dataforseo.server");
    const { localeOpts, hasDataForSeo, aiCompetitors } = await import("./research.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, industry, website_url, locale")
      .eq("id", data.projectId)
      .single();
    if (!project?.website_url) throw new Error("Add your website URL in Settings first.");

    let rows: { domain: string; [k: string]: unknown }[] = [];
    try {
      if (!hasDataForSeo()) throw new Error("no-dfs");
      rows = await competitorDomains(project.website_url, localeOpts(project.locale));
    } catch {
      rows = await aiCompetitors(project.website_url, project);
    }
    if (rows.length) {
      await supabase.from("competitors").upsert(
        rows.map((r) => ({
          user_id: userId,
          project_id: data.projectId,
          domain: r.domain,
          metrics: r as unknown as Record<string, never>,
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
    const { localeOpts, saveKeywords, hasDataForSeo, aiKeywords } = await import("./research.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, locale, website_url")
      .eq("id", data.projectId)
      .single();
    let rows: KwRow[] = [];
    try {
      if (!hasDataForSeo()) throw new Error("no-dfs");
      rows = await keywordIdeas(data.seeds, localeOpts(project?.locale ?? null));
    } catch {
      rows = await aiKeywords(data.seeds, { ...(project ?? {}), domain: project?.website_url ?? null });
    }
    await saveKeywords(supabase, userId, data.projectId, rows);
    return { found: rows.length };
  });

/** Pull the keywords a competitor domain ranks for. */
export const analyzeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => projectInput.extend({ domain: z.string().min(3).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const { competitorKeywords } = await import("./dataforseo.server");
    const { localeOpts, saveKeywords, hasDataForSeo, aiKeywords } = await import("./research.server");
    const { supabase, userId } = context;
    const { data: project } = await supabase
      .from("projects")
      .select("name, industry, locale, website_url")
      .eq("id", data.projectId)
      .single();
    const clean = data.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    let rows: KwRow[] = [];
    try {
      if (!hasDataForSeo()) throw new Error("no-dfs");
      rows = await competitorKeywords(data.domain, localeOpts(project?.locale ?? null));
    } catch {
      rows = await aiKeywords([clean], { ...(project ?? {}), domain: project?.website_url ?? null }, clean);
    }
    await supabase.from("competitors").upsert(
      {
        user_id: userId,
        project_id: data.projectId,
        domain: clean,
        metrics: { top_keywords: rows.slice(0, 10) },
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "project_id,domain" },
    );
    await saveKeywords(supabase, userId, data.projectId, rows);
    return { found: rows.length };
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
    const { supabase, userId } = context;
    const { localeOpts, saveKeywords, hasDataForSeo, aiKeywords, aiCompetitors } = await import(
      "./research.server"
    );
    const { keywordIdeas, competitorDomains, competitorKeywords } = await import("./dataforseo.server");

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, industry, locale, website_url, keywords")
      .eq("id", data.projectId)
      .single();
    if (!project) throw new Error("Project not found");

    const { count } = await supabase
      .from("keyword_research")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId);
    if (!data.force && (count ?? 0) > 0) return { found: 0, skipped: true, live: hasDataForSeo() };

    const ctx = { ...(project as ProjectCtx), domain: project.website_url ?? null };
    const seeds = (project.keywords ?? []).filter(Boolean).slice(0, 10);
    const fallbackSeed = project.name ?? project.industry ?? "";
    const usedSeeds = seeds.length ? seeds : fallbackSeed ? [fallbackSeed] : [];
    const opts = localeOpts(project.locale ?? null);
    const live = hasDataForSeo();
    let rows: KwRow[] = [];

    if (usedSeeds.length) {
      try {
        if (!live) throw new Error("no-dfs");
        rows = await keywordIdeas(usedSeeds, opts);
      } catch {
        rows = await aiKeywords(usedSeeds, ctx);
      }
    }

    // competitors
    let domains: { domain: string; [k: string]: unknown }[] = [];
    if (project.website_url) {
      try {
        if (!live) throw new Error("no-dfs");
        domains = await competitorDomains(project.website_url, opts);
      } catch {
        domains = await aiCompetitors(project.website_url, project as ProjectCtx);
      }
      if (domains.length) {
        await supabase.from("competitors").upsert(
          domains.map((r) => ({
            user_id: userId,
            project_id: data.projectId,
            domain: r.domain,
            metrics: r as unknown as Record<string, never>,
            last_checked_at: new Date().toISOString(),
          })),
          { onConflict: "project_id,domain" },
        );
      }
    }

    for (const d of domains.slice(0, 2)) {
      try {
        const more = live ? await competitorKeywords(d.domain, opts) : await aiKeywords([d.domain], ctx, d.domain);
        rows = rows.concat(more);
      } catch {
        /* keep whatever we already have */
      }
    }

    await saveKeywords(supabase, userId, data.projectId, rows);
    return { found: rows.length, skipped: false, live };
  });
