import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2 } from "lucide-react";
import {
  probeLanding,
  probeProfile,
  probeCandidates,
  probeSerpAi,
  probeRivals,
  runPipelineDiagnosticBatch,
} from "@/lib/diagnostics.functions";

/**
 * Pipeline diagnostics. Each stage runs on its own so a failure can be seen
 * where it happens instead of surfacing as an empty scan three steps later.
 *
 * Stages 3-5 spend real DataForSEO and model credits, so nothing runs on load —
 * every stage is a button, and the billed ones say so.
 */
export const Route = createFileRoute("/test")({
  head: () => ({
    meta: [{ title: "Pipeline diagnostics — Ranki.ai" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: TestPage,
});

type Check = { label: string; ok: boolean; detail?: string };

function Badge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
        ok ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
      }`}
    >
      {ok ? "PASS" : "FAIL"}
    </span>
  );
}

function Stage({
  n,
  title,
  cost,
  onRun,
  fullPipelineRun,
  state,
}: {
  n: number;
  title: string;
  cost: "free" | "billed";
  onRun: () => void;
  fullPipelineRun?: () => void;
  state: { status: "idle" | "running" | "done" | "error"; checks: Check[]; error?: string; ms?: number; raw?: unknown };
}) {
  const [showRaw, setShowRaw] = useState(false);
  const passed = state.checks.filter((c) => c.ok).length;
  const total = state.checks.length;
  const completed = state.status === "done" && total > 0 && passed === total;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
          {n}
          {completed && <CheckCircle2 aria-label="Étape terminée" className="h-4 w-4 text-emerald-600" />}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
            cost === "billed" ? "bg-amber-500/15 text-amber-700" : "bg-muted text-muted-foreground"
          }`}
        >
          {cost === "billed" ? "facturé" : "gratuit"}
        </span>
        {state.status === "done" && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {passed}/{total} · {state.ms}ms
          </span>
        )}
        <button
          onClick={fullPipelineRun ?? onRun}
          disabled={state.status === "running"}
          className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {state.status === "running" ? "…" : fullPipelineRun ? "Run full pipeline" : "Lancer"}
        </button>
      </div>

      {state.status === "error" && (
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded bg-red-500/10 p-2 text-xs text-red-600">
          {state.error}
        </pre>
      )}

      {state.checks.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {state.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-xs">
              <Badge ok={c.ok} />
              <span className="min-w-0">
                <span className={c.ok ? "" : "font-medium text-red-600"}>{c.label}</span>
                {c.detail && (
                  <span className="block break-words font-mono text-[11px] text-muted-foreground">{c.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.raw != null && (
        <>
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="mt-3 font-mono text-[11px] text-muted-foreground underline"
          >
            {showRaw ? "masquer" : "voir"} la réponse brute
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px]">
              {JSON.stringify(state.raw, null, 2)}
            </pre>
          )}
        </>
      )}
    </section>
  );
}

type StageState = {
  status: "idle" | "running" | "done" | "error";
  checks: Check[];
  error?: string;
  ms?: number;
  raw?: unknown;
};
const IDLE: StageState = { status: "idle", checks: [] };

function TestPage() {
  const [website, setWebsite] = useState("https://sweet-deco.fr/");
  const [keyword, setKeyword] = useState("grossiste meubles");
  const [rivals, setRivals] = useState("miliboo.com, atmosphera.com");

  const [s1, setS1] = useState<StageState>(IDLE);
  const [s2, setS2] = useState<StageState>(IDLE);
  const [s3, setS3] = useState<StageState>(IDLE);
  const [s4, setS4] = useState<StageState>(IDLE);
  const [s5, setS5] = useState<StageState>(IDLE);
  const [s6, setS6] = useState<StageState>(IDLE);
  const [s7, setS7] = useState<StageState>(IDLE);

  const runLanding = useServerFn(probeLanding);
  const runProfile = useServerFn(probeProfile);
  const runCandidates = useServerFn(probeCandidates);
  const runSerp = useServerFn(probeSerpAi);
  const runRivals = useServerFn(probeRivals);
  const runDiagnosticBatch = useServerFn(runPipelineDiagnosticBatch);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  // The diagnostic endpoint is the authority for authentication. The client
  // must not hide /test because a just-restored local session briefly reads as
  // null. It also must never reveal a calendar/article until every gate has
  // succeeded in the same complete run.
  const allStagesGreen = [s1, s2, s3, s4, s5, s6, s7].every(
    (stage) => stage.status === "done" && stage.checks.length > 0 && stage.checks.every((check) => check.ok),
  );
  const calendarPreview = allStagesGreen && Array.isArray(s6.raw)
    ? (s6.raw as { date?: string; type?: string; topic?: string; keyword?: string | null }[])
    : [];
  const articlePreview = allStagesGreen
    ? (s7.raw as { title?: string; excerpt?: string; body_md?: string } | null)
    : null;

  async function runCompleteDiagnostic() {
    if (pipelineRunning) return;
    setPipelineRunning(true);
    setS1(IDLE); setS2(IDLE); setS3(IDLE); setS4(IDLE); setS5(IDLE); setS6(IDLE); setS7(IDLE);
    const setters = {
      landing: setS1, profile: setS2, keywords: setS3, serp: setS4,
      rivals: setS5, calendar: setS6, article: setS7,
    } as const;
    const batches = ["landing", "profile", "keywords", "serp", "rivals", "calendar", "article"] as const;
    let context: unknown = undefined;
    try {
      for (const batch of batches) {
        setters[batch]({ status: "running", checks: [] });
        const result = await runDiagnosticBatch({ data: { website, batch, context } }) as {
          stage: { ok: boolean; summary: string; error: string | null; ms: number; data: unknown };
          context: unknown;
        };
        const stage = result.stage;
        const localPack = batch === "rivals" && stage.data && typeof stage.data === "object" && "localPack" in stage.data
          ? (stage.data as { localPack?: { name?: string; city?: string | null; category?: string | null; localPackPositions?: number[] }[] }).localPack ?? []
          : [];
        setters[batch]({
          status: stage.ok ? "done" : "error",
          checks: [
            { label: stage.summary, ok: stage.ok, ...(stage.error ? { detail: stage.error } : {}) },
            ...localPack.map((business) => ({
              label: `Google Maps #${business.localPackPositions?.[0] ?? "—"} — ${business.name ?? "Unknown business"}`,
              ok: true,
              detail: [business.city, business.category].filter(Boolean).join(" · ") || "Local Pack result",
            })),
          ],
          ...(stage.error ? { error: stage.error } : {}),
          ms: stage.ms,
          raw: stage.data,
        });
        if (!stage.ok) break;
        context = result.context;
      }
    } catch (error) {
      const failed = { status: "error" as const, checks: [], error: error instanceof Error ? error.message : String(error) };
      setS1((current) => current.status === "running" ? failed : current);
    } finally {
      setPipelineRunning(false);
    }
  }

  async function run(
    set: (s: StageState) => void,
    fn: () => Promise<{ checks: Check[]; ms: number; raw: unknown }>,
  ) {
    set({ status: "running", checks: [] });
    try {
      const { checks, ms, raw } = await fn();
      set({ status: "done", checks, ms, raw });
    } catch (e) {
      set({ status: "error", checks: [], error: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <header>
        <h1 className="text-lg font-semibold">Diagnostics du pipeline</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Landing page → IA → DataForSEO → SERP &amp; assistant IA → concurrents. Les étapes « facturé »
          consomment des crédits réels : rien ne se lance au chargement.
        </p>
      </header>

      <div className="grid gap-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <label className="sm:col-span-3">
          <span className="text-[11px] font-medium text-muted-foreground">Site analysé</span>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="hidden sm:col-span-2">
          <span className="text-[11px] font-medium text-muted-foreground">Mot-clé (étape 4)</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="hidden">
          <span className="text-[11px] font-medium text-muted-foreground">Concurrents (étape 5)</span>
          <input
            value={rivals}
            onChange={(e) => setRivals(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => void runCompleteDiagnostic()}
          disabled={pipelineRunning}
          className="sm:col-span-3 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pipelineRunning ? "Running successive batches..." : "Run full pipeline"}
        </button>
        <p className="sm:col-span-3 text-[11px] text-muted-foreground">One URL only. Seven successive batches: every stage keeps its result and stops only at the failing batch.</p>
      </div>

      <Stage
        n={1}
        title="Landing page — titre SEO, titre de page, meta, sections, marqueurs B2B"
        cost="free"
        state={s1}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() =>
          void run(setS1, async () => {
            const r = await runLanding({ data: { website } });
            const l = r.landing;
            return {
              ms: r.ms,
              raw: l,
              checks: [
                { label: "Titre SEO (<title>) lu", ok: Boolean(l.title), detail: l.title ?? "—" },
                { label: "Titre de page lu", ok: Boolean(l.pageTitle), detail: l.pageTitle ?? "—" },
                {
                  label: "Meta description lue",
                  ok: Boolean(l.metaDescription),
                  detail: (l.metaDescription ?? "—").slice(0, 120),
                },
                { label: "Langue déclarée", ok: Boolean(l.lang), detail: l.lang ?? "—" },
                {
                  label: "Titres de sections (h1/h2/h3)",
                  ok: l.h1.length + l.h2.length + l.h3.length > 0,
                  detail: `h1:${l.h1.length} h2:${l.h2.length} h3:${l.h3.length}`,
                },
                {
                  label: "Taxonomie de catégories",
                  ok: l.categoryLinks.length > 0,
                  detail: l.categoryLinks.slice(0, 5).join(", ") || "aucune",
                },
                {
                  label: "Corps de page transmis à l'IA",
                  ok: l.bodyExcerpt.length > 300,
                  detail: `${l.bodyExcerpt.length} caractères`,
                },
                {
                  label: "Modèle de vente déduit de la page",
                  ok: true,
                  detail: l.sellsToBusinesses
                    ? `B2B — ${l.b2bMarkers.join(", ")} (${l.b2bMentions} mentions, ${l.b2bDistinct} distincts)`
                    : `B2C — ${l.b2bMentions} mentions B2B, sous le seuil`,
                },
              ],
            };
          })
        }
      />

      <Stage
        n={2}
        title="Profil canonique — le modèle de vente qui fixe l'audience"
        cost="billed"
        state={s2}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() =>
          void run(setS2, async () => {
            const r = await runProfile({ data: { website } });
            const p = r.profile;
            const b2b = ["wholesale", "manufacturer"].includes((p.sales_model ?? "").toLowerCase());
            return {
              ms: r.ms,
              raw: r,
              checks: [
                { label: "Profil jugé fiable", ok: p.reliable, detail: p.reliable ? "oui" : "non — le scan refuserait de continuer" },
                { label: "Produits identifiés", ok: (p.products ?? []).length > 0, detail: (p.products ?? []).join(", ") || "aucun" },
                { label: "Modèle de vente", ok: Boolean(p.sales_model), detail: p.sales_model ?? "—" },
                {
                  label: "Cohérent avec la page",
                  ok: !r.landingSaysB2B || b2b,
                  detail: r.landingSaysB2B
                    ? `page = B2B (${r.b2bMarkers.join(", ")}) → profil = ${p.sales_model}`
                    : "page sans marqueur B2B",
                },
                { label: "Audience décrite", ok: Boolean(p.audience), detail: p.audience ?? "—" },
              ],
            };
          })
        }
      />

      <Stage
        n={3}
        title="IA → DataForSEO — candidats proposés, puis mesurés"
        cost="billed"
        state={s3}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() =>
          void run(setS3, async () => {
            const r = await runCandidates({ data: { website } });
            const consumer = r.proposed.filter((k) =>
              /canapé|canape|table|chaise|lit\b/i.test(k) && !/gros|fournisseur|grossiste|professionnel|revendeur|b2b|volume/i.test(k),
            );
            const isB2B = ["wholesale", "manufacturer"].includes((r.salesModel ?? "").toLowerCase());
            return {
              ms: r.ms,
              raw: r,
              checks: [
                { label: "L'IA a proposé des candidats", ok: r.proposed.length > 0, detail: `${r.proposed.length} proposés` },
                {
                  label: "searchVolumeFor a répondu (jamais testé en réel jusqu'ici)",
                  ok: r.volumeError === null,
                  detail: r.volumeError ?? `${r.measured.length} mots-clés avec volume mesuré`,
                },
                {
                  label: "Des candidats survivent à la mesure",
                  ok: r.measured.length > 0,
                  detail: r.measured.slice(0, 6).map((m) => `${m.keyword} (${m.search_volume})`).join(" · ") || "aucun",
                },
                {
                  label: isB2B ? "Aucune requête grand public pour un B2B" : "Requêtes cohérentes avec un B2C",
                  ok: !isB2B || consumer.length === 0,
                  detail: isB2B && consumer.length ? `${consumer.length} suspectes : ${consumer.slice(0, 4).join(", ")}` : "ok",
                },
                { label: "Marché ciblé", ok: true, detail: `${r.opts.locationName} / ${r.opts.languageCode}` },
              ],
            };
          })
        }
      />

      <Stage
        n={4}
        title="SERP + assistant IA — présence d'une AI Overview et domaines cités"
        cost="billed"
        state={s4}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() =>
          void run(setS4, async () => {
            const r = await runSerp({ data: { keyword } });
            return {
              ms: r.ms,
              raw: r,
              checks: [
                { label: "SERP récupérée", ok: r.topOrganic.length > 0, detail: r.topOrganic.map((o) => o.domain).join(", ") || "aucun résultat" },
                {
                  label: "Fonctionnalités SERP détectées",
                  ok: r.ai.featureTypes.length > 0,
                  detail: r.ai.featureTypes.join(", ") || "aucune",
                },
                {
                  label: "AI Overview présente",
                  ok: r.ai.hasAiOverview,
                  detail: r.ai.hasAiOverview ? (r.ai.aiOverviewText ?? "").slice(0, 160) : "absente sur ce mot-clé (normal selon la requête)",
                },
                {
                  label: "Domaines cités par l'assistant",
                  ok: r.ai.citedDomains.length > 0,
                  detail: r.ai.citedDomains.join(", ") || "aucun",
                },
              ],
            };
          })
        }
      />

      <Stage
        n={5}
        title="Landing pages concurrentes — matière pour la génération"
        cost="billed"
        state={s5}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() =>
          void run(setS5, async () => {
            const domains = rivals.split(",").map((d) => d.trim()).filter(Boolean);
            const r = await runRivals({ data: { domains } });
            return {
              ms: r.ms,
              raw: r.rivals,
              checks: [
                {
                  label: "Concurrents analysés",
                  ok: r.rivals.length > 0,
                  detail: `${r.rivals.length}/${r.requested} joignables`,
                },
                ...r.rivals.map((rv) => ({
                  label: rv.domain,
                  ok: rv.positioning.length > 10,
                  detail: rv.positioning.slice(0, 110),
                })),
              ],
            };
          })
        }
      />

      <Stage
        n={6}
        title="30-day calendar — topics selected from the validated keywords"
        cost="billed"
        state={s6}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() => void runCompleteDiagnostic()}
      />

      <Stage
        n={7}
        title="First article preview — generated from the calendar, profile and rivals"
        cost="billed"
        state={s7}
        fullPipelineRun={() => void runCompleteDiagnostic()}
        onRun={() => void runCompleteDiagnostic()}
      />

      {calendarPreview.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Test output</p>
          <h2 className="mt-1 text-base font-semibold">30-day content calendar</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {calendarPreview.map((item, index) => (
              <div key={`${item.date}-${index}`} className="rounded-md border border-border/70 bg-background p-2.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>{item.date}</span><span>{item.type?.toUpperCase()}</span>
                </div>
                <p className="mt-1 text-sm font-medium leading-snug">{item.topic}</p>
                {item.keyword && <p className="mt-1 text-[11px] text-muted-foreground">Target: {item.keyword}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {articlePreview?.body_md && (
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Test output</p>
          <h2 className="mt-1 text-xl font-semibold">{articlePreview.title}</h2>
          {articlePreview.excerpt && <p className="mt-2 text-sm text-muted-foreground">{articlePreview.excerpt}</p>}
          <pre className="mt-4 max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-4 font-sans text-sm leading-7 text-foreground">
            {articlePreview.body_md}
          </pre>
        </section>
      )}
    </main>
  );
}
