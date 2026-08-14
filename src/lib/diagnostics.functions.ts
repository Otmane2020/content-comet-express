import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const siteInput = z.object({ website: z.string().min(3).max(300) });
const diagnosticBatchInput = z.object({
  website: z.string().min(3).max(300),
  batch: z.enum(["landing", "profile", "keywords", "serp", "rivals", "calendar", "article"]),
  context: z.unknown().optional(),
});

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const r = err as Record<string, unknown>;
    if (typeof r["message"] === "string") return r["message"] as string;
    try { return JSON.stringify(err); } catch { /* noop */ }
  }
  return String(err);
}

export type PipelineDiagnosticStage = {
  id: "landing" | "profile" | "keywords" | "serp" | "rivals" | "calendar" | "article";
  ok: boolean;
  ms: number;
  summary: string;
  error: string | null;
  data: unknown;
};

type DiagnosticContext = {
  website: string;
  research?: Awaited<ReturnType<typeof import("./engine2/orchestrator.server").runMarketResearch>>;
  articleRun?: Awaited<ReturnType<typeof import("./engine2/orchestrator.server").runArticleFromOpportunity>>;
};

function readContext(website: string, value: unknown): DiagnosticContext {
  const context = value && typeof value === "object" ? value as DiagnosticContext : { website };
  if (context.website !== website) throw new Error("Diagnostic context belongs to a different website.");
  return context;
}

function deepSeekKey() {
  const key = process.env["DEEPSEEK_API_KEY"];
  if (!key) throw new Error("DEEPSEEK_API_KEY is not configured");
  return key;
}

export const runPipelineDiagnosticBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => diagnosticBatchInput.parse(input))
  .handler(async ({ data }): Promise<{ stage: PipelineDiagnosticStage; context: DiagnosticContext }> => {
    const started = Date.now();
    const context = readContext(data.website, data.context);
    const finish = (summary: string, result: unknown, next: DiagnosticContext) => ({
      stage: { id: data.batch, ok: true, ms: Date.now() - started, summary, error: null, data: JSON.parse(JSON.stringify(result)) },
      context: JSON.parse(JSON.stringify(next)) as DiagnosticContext,
    });
    try {
      let research = context.research;
      if (!research) {
        const { runMarketResearch } = await import("./engine2/orchestrator.server");
        research = await runMarketResearch(deepSeekKey(), data.website);
      }
      const nextBase: DiagnosticContext = { ...context, research };

      if (data.batch === "landing") {
        return finish(`${research.site.pages.length} page(s) crawlées; ${research.site.domain}; langue ${research.site.lang}`, research.site, nextBase);
      }
      if (data.batch === "profile") {
        const b = research.business;
        return finish(`${b.businessType}; ${b.products.length} produit(s); ${b.services.length} service(s); ${b.locations.length} localisation(s)`, b, nextBase);
      }
      if (data.batch === "keywords") {
        const selected = research.selected;
        const result = {
          selected,
          opportunities: research.opportunities,
          rejectedKeywords: research.rejectedKeywords,
          notes: research.notes,
        };
        return finish(`${research.opportunities.length} opportunité(s) validée(s); meilleur mot-clé: ${selected.keyword} (${selected.opportunityScore}/100)`, result, nextBase);
      }
      if (data.batch === "serp") {
        const result = {
          semanticCompetitors: research.semanticCompetitors,
          rejectedCompetitors: research.rejectedCompetitors,
          serpOverlap: research.serpOverlap,
        };
        return finish(`${research.semanticCompetitors.length} concurrent(s) sémantique(s) AI validé(s); ${research.serpOverlap.length} domaine(s) de chevauchement DataForSEO`, result, nextBase);
      }
      if (data.batch === "rivals") {
        return finish(`${research.semanticCompetitors.length} concurrent(s) AI conservé(s) après blocklist + seuil 70`, { organicLandingPages: [], locallyEligible: research.business.locations.length > 0, localPack: [], semanticCompetitors: research.semanticCompetitors }, nextBase);
      }

      let articleRun = context.articleRun;
      if (!articleRun) {
        const { runArticleFromOpportunity } = await import("./engine2/orchestrator.server");
        articleRun = await runArticleFromOpportunity(deepSeekKey(), research, research.selected);
      }
      const next: DiagnosticContext = { ...nextBase, articleRun };

      if (data.batch === "calendar") {
        const sample = [{
          date: new Date().toISOString().slice(0, 10),
          type: articleRun.formatDecision.format,
          topic: articleRun.brief.title,
          keyword: research.selected.keyword,
          angle: articleRun.brief.angle,
          generationSource: "ai" as const,
          articleBrief: {
            title: articleRun.brief.title,
            targetKeyword: articleRun.brief.targetKeyword,
            angle: articleRun.brief.angle,
            outline: articleRun.brief.outline.map((o) => o.heading),
            questions: articleRun.brief.questions,
            entities: articleRun.brief.entities,
          },
        }];
        return finish(`Diagnostic mono-article engine2: ${articleRun.formatDecision.format} — ${articleRun.brief.title}`, sample, next);
      }

      const { renderBlocksToHtml } = await import("./engine2/article.server");
      const a = articleRun.article;
      const result = {
        title: a.title,
        excerpt: a.excerpt,
        body_md: renderBlocksToHtml(a.blocks),
        blocks: a.blocks,
        articleBrief: {
          title: articleRun.brief.title,
          targetKeyword: articleRun.brief.targetKeyword,
          angle: articleRun.brief.angle,
          outline: articleRun.brief.outline.map((o) => o.heading),
          questions: articleRun.brief.questions,
          entities: articleRun.brief.entities,
        },
        quality: { ok: a.quality.passed, failures: a.quality.errors, scores: a.quality },
      };
      return finish(`Article preview generated: ${a.title}; quality ${a.quality.overall}/100`, result, next);
    } catch (error) {
      const message = errorMessage(error);
      console.error("[pipeline-diagnostic:engine2] batch failed", { id: data.batch, website: data.website, error: message, stack: error instanceof Error ? error.stack : undefined });
      return { stage: { id: data.batch, ok: false, ms: Date.now() - started, summary: "Failed", error: message, data: null }, context };
    }
  });

export const runPipelineDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => siteInput.parse(input))
  .handler(async ({ data }) => {
    const stages: PipelineDiagnosticStage[] = [];
    let context: DiagnosticContext | undefined;
    for (const batch of ["landing", "profile", "keywords", "serp", "rivals", "calendar", "article"] as const) {
      const started = Date.now();
      try {
        let research = context?.research;
        if (!research) {
          const { runMarketResearch } = await import("./engine2/orchestrator.server");
          research = await runMarketResearch(deepSeekKey(), data.website);
        }
        context = { website: data.website, research };
        if (batch === "calendar" || batch === "article") {
          const { runArticleFromOpportunity } = await import("./engine2/orchestrator.server");
          context.articleRun ??= await runArticleFromOpportunity(deepSeekKey(), research, research.selected);
        }
        const payload = batch === "landing" ? research.site : batch === "profile" ? research.business : batch === "keywords" ? research.opportunities : batch === "serp" || batch === "rivals" ? research.semanticCompetitors : context.articleRun;
        stages.push({ id: batch, ok: true, ms: Date.now() - started, summary: "engine2 ok", error: null, data: JSON.parse(JSON.stringify(payload)) });
      } catch (error) {
        stages.push({ id: batch, ok: false, ms: Date.now() - started, summary: "Failed", error: errorMessage(error), data: null });
        break;
      }
    }
    return { stages };
  });

// Legacy one-stage probes kept for the /test UI imports. The actual card buttons
// use runPipelineDiagnosticBatch above; these remain compatible for direct calls.
export const probeLanding = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => siteInput.parse(input)).handler(async ({ data }) => {
  const { scrapeLandingProfile } = await import("./scrape.server"); const started = Date.now(); return { landing: await scrapeLandingProfile(data.website), ms: Date.now() - started };
});
export const probeProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => siteInput.parse(input)).handler(async ({ data }) => {
  const started = Date.now(); const { runMarketResearch } = await import("./engine2/orchestrator.server"); const r = await runMarketResearch(deepSeekKey(), data.website); return { profile: { ...r.business, sales_model: r.business.businessType }, site: r.site, ms: Date.now() - started };
});
export const probeCandidates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => siteInput.extend({ locale: z.string().max(8).optional() }).parse(input)).handler(async ({ data }) => {
  const started = Date.now(); const { runMarketResearch } = await import("./engine2/orchestrator.server"); const r = await runMarketResearch(deepSeekKey(), data.website); return { proposed: r.opportunities.map((o) => o.keyword), measured: r.opportunities, profile: r.business, ms: Date.now() - started };
});
export const probeSerpAi = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ keyword: z.string().min(2).max(120), locale: z.string().max(8).optional() }).parse(input)).handler(async ({ data }) => ({ keyword: data.keyword, source: "engine2", aiOverview: null, organic: [], ms: 0 }));
export const probeRivals = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ domains: z.array(z.string().min(3).max(200)).min(1).max(6) }).parse(input)).handler(async ({ data }) => ({ rivals: data.domains.map((domain) => ({ domain })), ms: 0 }));
