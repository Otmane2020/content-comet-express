import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import {
  probeLanding,
  probeProfile,
  probeCandidates,
  probeSerpAi,
  probeRivals,
  runPipelineDiagnostic,
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
  state,
}: {
  n: number;
  title: string;
  cost: "free" | "billed";
  onRun: () => void;
  state: { status: "idle" | "running" | "done" | "error"; checks: Check[]; error?: string; ms?: number; raw?: unknown };
}) {
  const [showRaw, setShowRaw] = useState(false);
  const passed = state.checks.filter((c) => c.ok).length;
  const total = state.checks.length;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{n}</span>
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
          onClick={onRun}
          disabled={state.status === "running"}
          className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {state.status === "running" ? "…" : "Lancer"}
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
  const { user, loading } = useAuth();
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
  const runFullDiagnostic = useServerFn(runPipelineDiagnostic);

  async function runCompleteDiagnostic() {
    const running: StageState = { status: "running", checks: [] };
    setS1(running); setS2(running); setS3(running); setS4(running); setS5(running); setS6(running); setS7(running);
    try {
      const result = await runFullDiagnostic({ data: { website } });
      const byId = new Map(result.stages.map((stage) => [stage.id, stage]));
      const stateFor = (id: "landing" | "profile" | "keywords" | "serp" | "rivals" | "calendar" | "article"): StageState => {
        const stage = byId.get(id);
        if (!stage) return { status: "error", checks: [], error: "Blocked by an earlier pipeline stage." };
        return {
          status: stage.ok ? "done" : "error",
          checks: [{ label: stage.summary, ok: stage.ok, detail: stage.error ?? undefined }],
          error: stage.error ?? undefined,
          ms: stage.ms,
          raw: stage.data,
        };
      };
      setS1(stateFor("landing"));
      setS2(stateFor("profile"));
      setS3(stateFor("keywords"));
      setS4(stateFor("serp"));
      setS5(stateFor("rivals"));
      setS6(stateFor("calendar"));
      setS7(stateFor("article"));
    } catch (error) {
      const failed = { status: "error" as const, checks: [], error: error instanceof Error ? error.message : String(error) };
      setS1(failed); setS2(failed); setS3(failed); setS4(failed); setS5(failed); setS6(failed); setS7(failed);
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

  if (loading) return <main className="p-8 text-sm text-muted-foreground">…</main>;
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-lg font-semibold">Diagnostics</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ces sondes lancent des appels facturés et lisent une URL arbitraire côté serveur.{" "}
          <a href="/auth" className="underline">
            Connectez-vous
          </a>{" "}
          pour y accéder.
        </p>
      </main>
    );
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
          disabled={s1.status === "running"}
          className="sm:col-span-3 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {s1.status === "running" ? "Running full pipeline..." : "Run full pipeline"}
        </button>
        <p className="sm:col-span-3 text-[11px] text-muted-foreground">One URL only. Every diagnostic stage runs in sequence and keeps its own error report.</p>
      </div>

      <Stage
        n={1}
        title="Landing page — titre SEO, titre de page, meta, sections, marqueurs B2B"
        cost="free"
        state={s1}
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
        cost="free"
        state={s5}
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
        onRun={() => void runCompleteDiagnostic()}
      />

      <Stage
        n={7}
        title="First article preview — generated from the calendar, profile and rivals"
        cost="billed"
        state={s7}
        onRun={() => void runCompleteDiagnostic()}
      />
    </main>
  );
}
