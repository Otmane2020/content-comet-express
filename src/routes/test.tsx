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
 * `String(err)` on a plain object (not an Error instance) produces the
 * useless "[object Object]" — exactly what a platform-level failure (a 504
 * timeout, a non-Error rejection surfaced by the RPC layer) throws as here.
 * Every catch block below funnels through this so a stage's error box
 * always shows something diagnosable.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const asRecord = err as Record<string, unknown>;
    const nested = asRecord["message"] ?? (asRecord["error"] as Record<string, unknown> | string | undefined);
    if (typeof nested === "string") return nested;
    if (nested && typeof nested === "object") {
      const inner = (nested as Record<string, unknown>)["message"];
      if (typeof inner === "string") return inner;
    }
    const details = asRecord["details"];
    if (typeof details === "string") return details;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

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
          {state.status === "running" ? "…" : "Lancer cette étape"}
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
  // Carries each batch's accumulated context across separate button clicks so
  // a re-run can resume from the first incomplete stage instead of re-billing
  // every DataForSEO call the earlier stages already paid for.
  const [pipelineContext, setPipelineContext] = useState<unknown>(undefined);
  // The diagnostic endpoint is the authority for authentication. The client
  // must not hide /test because a just-restored local session briefly reads as
  // null. It also must never reveal a calendar/article until every gate has
  // succeeded in the same complete run.
  const stageStates = { landing: s1, profile: s2, keywords: s3, serp: s4, rivals: s5, calendar: s6, article: s7 } as const;
  const batchOrder = ["landing", "profile", "keywords", "serp", "rivals", "calendar", "article"] as const;
  const stageDone = (st: StageState) => st.status === "done" && st.checks.length > 0 && st.checks.every((c) => c.ok);
  const allStagesGreen = [s1, s2, s3, s4, s5, s6, s7].every(stageDone);
  // Where a click would resume from: 0 unless the cached context still
  // matches the current URL and at least the first stage already passed.
  const contextMatchesWebsite = (pipelineContext as { website?: string } | undefined)?.website === website;
  const firstIncompleteStage = batchOrder.findIndex((batch) => !stageDone(stageStates[batch]));
  const resumePoint = contextMatchesWebsite && firstIncompleteStage > 0 ? firstIncompleteStage : 0;
  const calendarPreview = s6.status === "done" && Array.isArray(s6.raw)
    ? (s6.raw as { date?: string; type?: string; topic?: string; keyword?: string | null; generationSource?: "ai" }[])
    : [];
  const aiCount = calendarPreview.filter((item) => item.generationSource === "ai").length;
  const articlePreview = s7.status === "done"
    ? (s7.raw as { title?: string; excerpt?: string; body_md?: string; quality?: { ok: boolean; failures: string[] } } | null)
    : null;
  const qualityFailures = articlePreview?.quality?.failures ?? [];
  const failedChecks = [s1, s2, s3, s4, s5, s6, s7].flatMap((stage) => stage.checks.filter((check) => !check.ok));
  const allStagesFinished = [s1, s2, s3, s4, s5, s6, s7].every((stage) => stage.status === "done");
  const hasQualityStageError = [s1, s2, s3, s4, s5, s6, s7].some((stage) => /QUALITY_FAILED|LANGUAGE_MISMATCH|ARTICLE_QUALITY_FAILED/i.test(stage.error ?? ""));
  const [reportCopied, setReportCopied] = useState(false);
  const [reportCopyError, setReportCopyError] = useState<string | null>(null);
  const [showManualCopy, setShowManualCopy] = useState(false);
  const diagnosticReport = {
    generatedAt: new Date().toISOString(),
    website,
    status: hasQualityStageError || (allStagesFinished && (qualityFailures.length || failedChecks.length))
      ? "quality_failed"
      : allStagesGreen ? "complete" : "incomplete",
    stages: [
      ["landing", s1], ["profile", s2], ["keywords", s3], ["serp", s4],
      ["rivals", s5], ["calendar", s6], ["article", s7],
    ].map(([id, state]) => ({
      id,
      status: (state as StageState).status,
      durationMs: (state as StageState).ms ?? null,
      checks: (state as StageState).checks,
      error: (state as StageState).error ?? null,
      result: (state as StageState).raw ?? null,
    })),
  };
  const reportJson = JSON.stringify(diagnosticReport, null, 2);
  const hasDiagnosticOutput = [s1, s2, s3, s4, s5, s6, s7].some(
    (stage) => stage.status === "done" || stage.status === "error",
  );

  async function copyDiagnosticReport() {
    setShowManualCopy(false);
    try {
      // navigator.clipboard requires a secure context (https/localhost) and
      // can be undefined or reject (permission, focus) depending on the
      // browser — the button looked "broken" because the rejection was
      // never caught, so neither the "Copied" state nor an error ever showed.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(reportJson);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setReportCopied(true);
      setReportCopyError(null);
    } catch {
      // Fallback for browsers/contexts without navigator.clipboard: a
      // hidden textarea + the legacy execCommand copy path.
      try {
        const textarea = document.createElement("textarea");
        textarea.value = reportJson;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) throw new Error("execCommand copy failed");
        setReportCopied(true);
        setReportCopyError(null);
      } catch {
        // Both the async Clipboard API and execCommand can be blocked by a
        // Permissions Policy — the common real-world case here is /test
        // loaded inside Shopify admin's iframe, which restricts clipboard
        // access on embedded apps regardless of user gesture. There is no
        // programmatic copy left to try at that point, so fall back to
        // showing the JSON in a selectable textarea the merchant can copy
        // manually (Ctrl/Cmd+C) instead of a dead-end error.
        setReportCopyError("Clipboard access is blocked here (likely the embedded app view) — select the text below and copy it manually, or use \"Download JSON\".");
        setShowManualCopy(true);
        return; // leave the manual textarea open; don't auto-clear the message
      }
    }
    window.setTimeout(() => {
      setReportCopied(false);
      setReportCopyError(null);
    }, 2500);
  }

  const setters = {
    landing: setS1, profile: setS2, keywords: setS3, serp: setS4,
    rivals: setS5, calendar: setS6, article: setS7,
  } as const;

  /**
   * `startBatch` is the exact stage to (re)run — pass a specific stage's own
   * id, not always resumePoint, so retrying stage 6 after a "Calendar
   * mismatch" runs *stage 6 alone* against the context stages 1-5 already
   * produced, rather than resumePoint recomputing "the first incomplete
   * stage" and potentially cascading through every stage after it too.
   * `stopAfterOne` is what makes a single stage's button behave as "just
   * this stage": each per-stage card passes true; only the page-level "Run
   * full pipeline" button passes false to keep running to the end.
   */
  async function runPipelineFrom(startBatch: (typeof batchOrder)[number], stopAfterOne: boolean) {
    if (pipelineRunning) return;
    setPipelineRunning(true);
    const startIndex = batchOrder.indexOf(startBatch);
    // Every click used to wipe all seven stages and restart from "landing",
    // so a developer probing stage 5 alone still paid for the SERP/DataForSEO
    // work stages 3-4 already did successfully seconds earlier — the actual
    // driver of a debugging session burning far more than "one pipeline run"
    // in DataForSEO cost. Reuse the context already accumulated through the
    // requested stage instead of re-billing everything before it — the
    // server itself rejects a stale/mismatched context with a clear
    // "Run the previous diagnostic batch before X" error, so an out-of-order
    // click fails loudly rather than silently re-running earlier stages.
    if (startIndex === 0) {
      setS1(IDLE); setS2(IDLE); setS3(IDLE); setS4(IDLE); setS5(IDLE); setS6(IDLE); setS7(IDLE);
    } else {
      for (const batch of batchOrder.slice(startIndex)) setters[batch](IDLE);
    }
    let context: unknown = startIndex === 0 ? undefined : pipelineContext;
    let runningBatch: (typeof batchOrder)[number] = batchOrder[startIndex]!;
    try {
      for (const batch of batchOrder.slice(startIndex)) {
        runningBatch = batch;
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
            ...(stage.ok && stage.data && typeof stage.data === "object" && "qualityFailures" in stage.data
              ? ((stage.data as { qualityFailures?: string[] }).qualityFailures ?? []).map((failure) => ({
                  label: "Quality gate",
                  ok: false,
                  detail: failure,
                }))
              : []),
            ...(batch === "article" && stage.ok && stage.data && typeof stage.data === "object" && "quality" in stage.data
              ? [{
                  label: "Article fulfils its title promise",
                  ok: Boolean((stage.data as { quality?: { ok?: boolean } }).quality?.ok),
                  detail: ((stage.data as { quality?: { failures?: string[] } }).quality?.failures ?? []).join(" · ") || "ok",
                }]
              : []),
            ...localPack.map((business) => ({
              label: `Google Maps #${business.localPackPositions?.[0] ?? "—"} — ${business.name ?? "Unknown business"}`,
              ok: true,
              detail: [business.city, business.category].filter(Boolean).join(" · ") || "Local Pack result",
            })),
            ...(batch === "rivals" && stage.ok && localPack.length === 0
              ? [{ label: "Google Maps Local Pack", ok: true, detail: "No Maps business was returned for the tested buyer queries; see the raw result for the exact queries." }]
              : []),
          ],
          ...(stage.error ? { error: stage.error } : {}),
          ms: stage.ms,
          raw: stage.data,
        });
        if (!stage.ok) break;
        context = result.context;
        setPipelineContext(context);
        if (stopAfterOne) break;
      }
    } catch (error) {
      // Previously always blamed stage 1 regardless of which batch actually
      // threw — a genuine mid-loop exception on a later stage silently
      // vanished if stage 1 had already finished, leaving no visible error.
      const failed = { status: "error" as const, checks: [], error: errorMessage(error) };
      setters[runningBatch](failed);
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
      set({ status: "error", checks: [], error: errorMessage(e) });
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
        <div className="sm:col-span-3 flex gap-2">
          <button
            onClick={() => void runPipelineFrom(batchOrder[resumePoint]!, false)}
            disabled={pipelineRunning}
            className="flex-1 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pipelineRunning
              ? "Running successive batches..."
              : resumePoint > 0
                ? `Resume from stage ${resumePoint + 1} (skips ${resumePoint} already-billed stage${resumePoint > 1 ? "s" : ""})`
                : "Run full pipeline"}
          </button>
          {resumePoint > 0 && !pipelineRunning && (
            <button
              onClick={() => {
                setS1(IDLE); setS2(IDLE); setS3(IDLE); setS4(IDLE); setS5(IDLE); setS6(IDLE); setS7(IDLE);
                setPipelineContext(undefined);
              }}
              className="rounded border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
              title="Clear every stage and pay for a full run from scratch"
            >
              Start over
            </button>
          )}
        </div>
        <p className="sm:col-span-3 text-[11px] text-muted-foreground">
          One URL only. A stage already marked done is never re-billed — the button resumes from the first
          incomplete stage. Changing the URL, or "Start over", forces a fresh run from stage 1.
        </p>
      </div>

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div className="mr-auto">
            <p className="text-sm font-semibold">JSON report</p>
            <p className="text-xs text-muted-foreground">
              {reportCopyError
                ? reportCopyError
                : hasDiagnosticOutput
                  ? "All diagnostic outputs, calendar and article preview in one copyable file."
                  : "Run at least one pipeline batch to generate the report."}
            </p>
          </div>
          <button
            onClick={() => void copyDiagnosticReport()}
            disabled={!hasDiagnosticOutput}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reportCopied ? "Copied" : reportCopyError ? "Retry copy" : "Copy JSON report"}
          </button>
          <a
            href={`data:application/json;charset=utf-8,${encodeURIComponent(reportJson)}`}
            download="ranki-pipeline-report.json"
            aria-disabled={!hasDiagnosticOutput}
            onClick={(event) => { if (!hasDiagnosticOutput) event.preventDefault(); }}
            className={`rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted ${!hasDiagnosticOutput ? "pointer-events-none opacity-50" : ""}`}
          >
            Download JSON
          </a>
      </section>

      {showManualCopy && (
        <section className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium">Select all and copy (Ctrl/Cmd+C):</p>
          <textarea
            readOnly
            value={reportJson}
            onFocus={(event) => event.currentTarget.select()}
            ref={(el) => el?.select()}
            className="h-40 w-full resize-y rounded border border-border bg-muted/30 p-2 font-mono text-[11px]"
          />
        </section>
      )}

      <Stage
        n={1}
        title="Landing page — titre SEO, titre de page, meta, sections, marqueurs B2B"
        cost="free"
        state={s1}
        fullPipelineRun={() => void runPipelineFrom("landing", true)}
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
        fullPipelineRun={() => void runPipelineFrom("profile", true)}
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
        fullPipelineRun={() => void runPipelineFrom("keywords", true)}
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
        fullPipelineRun={() => void runPipelineFrom("serp", true)}
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
        fullPipelineRun={() => void runPipelineFrom("rivals", true)}
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
        fullPipelineRun={() => void runPipelineFrom("calendar", true)}
        onRun={() => void runPipelineFrom("calendar", true)}
      />

      <Stage
        n={7}
        title="First article preview — generated from the calendar, profile and rivals"
        cost="billed"
        state={s7}
        fullPipelineRun={() => void runPipelineFrom("article", true)}
        onRun={() => void runPipelineFrom("article", true)}
      />

      {calendarPreview.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">Test output</p>
          <h2 className="mt-1 text-base font-semibold">30-day content calendar</h2>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              AI-generated: {aiCount}/{calendarPreview.length}
              {aiCount !== calendarPreview.length && <> · Invalid non-AI rows: {calendarPreview.length - aiCount}</>}
            </span>
            {aiCount !== calendarPreview.length && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-700">
                INVALID: NON-AI TITLE
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {calendarPreview.map((item, index) => (
              <div key={`${item.date}-${index}`} className="rounded-md border border-border/70 bg-background p-2.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>{item.date}</span>
                  <span className="flex items-center gap-1">
                    {item.type?.toUpperCase()}
                    {item.generationSource && (
                      <span className={`rounded px-1 py-0.5 font-bold ${
                        item.generationSource === "ai"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : "bg-amber-500/15 text-amber-700"
                      }`}>
                        {item.generationSource === "ai" ? "AI" : "FB"}
                      </span>
                    )}
                  </span>
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
