import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Radar, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCompetitor, autoResearch, discoverCompetitors, researchKeywords } from "@/lib/research.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Keyword = {
  id: string;
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  competitor_domain: string | null;
};

type Competitor = { id: string; domain: string; metrics: Record<string, unknown>; last_checked_at: string | null };

export function Research({ projectId, seedKeywords }: { projectId: string; seedKeywords: string[] }) {
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [seeds, setSeeds] = useState(seedKeywords.join(", "));
  const [busy, setBusy] = useState<string | null>(null);

  const research = useServerFn(researchKeywords);
  const discover = useServerFn(discoverCompetitors);
  const analyze = useServerFn(analyzeCompetitor);
  const auto = useServerFn(autoResearch);
  const started = useRef(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [kwShown, setKwShown] = useState(5);
  const [compShown, setCompShown] = useState(5);

  const { data: keywords = [], isLoading: kwLoading } = useQuery({
    queryKey: ["keywords", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keyword_research")
        .select("id, keyword, search_volume, cpc, competition, difficulty, intent, competitor_domain")
        .eq("project_id", projectId)
        .order("search_volume", { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return data as Keyword[];
    },
  });

  const { data: competitors = [] } = useQuery({
    queryKey: ["competitors", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitors")
        .select("id, domain, metrics, last_checked_at")
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw error;
      return data as Competitor[];
    },
  });

  async function run(key: string, fn: () => Promise<{ found: number }>) {
    setBusy(key);
    try {
      const res = await fn();
      toast.success(res.found ? `${res.found} keyword(s) added.` : "No new result.");
      void qc.invalidateQueries({ queryKey: ["keywords", projectId] });
      void qc.invalidateQueries({ queryKey: ["competitors", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Research request failed");
    } finally {
      setBusy(null);
    }
  }

  // Hands-free: the first time a project has no keywords, run the full
  // research pass (seeds + competitors + their keywords) automatically.
  useEffect(() => {
    if (kwLoading || started.current || keywords.length > 0) return;
    started.current = true;
    setAutoRunning(true);
    auto({ data: { projectId } })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["keywords", projectId] });
        void qc.invalidateQueries({ queryKey: ["competitors", projectId] });
      })
      .catch(() => undefined)
      .finally(() => setAutoRunning(false));
  }, [auto, keywords.length, kwLoading, projectId, qc]);

  return (
    <div className="space-y-6">
      {/* Explainer banner — brand indigo → deep with gold accents */}
      <header className="relative overflow-hidden rounded-2xl bg-deep p-6 text-background sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-gold/25 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold">
            <Sparkles className="size-3" />
            Market research
          </span>
          <h1 className="mt-3 font-display text-[26px] font-bold leading-tight sm:text-[30px]">
            Keywords &amp; rivals
          </h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-background/75">
            This is the fuel of your autopilot. We read what your market searches for and what your
            competitors already rank on — then every article of the 30-day calendar is written around
            those exact terms.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { n: "01", t: "We find the keywords", d: "Real volume, CPC and difficulty for your topics." },
              { n: "02", t: "We scan your rivals", d: "Their winning terms become your opportunities." },
              { n: "03", t: "The autopilot writes", d: "Best-volume, low-difficulty terms are used first." },
            ].map((s) => (
              <div key={s.n} className="rounded-xl bg-background/10 p-3.5 backdrop-blur-sm">
                <p className="font-mono text-[11px] font-bold text-gold">{s.n}</p>
                <p className="mt-1 text-[13.5px] font-semibold">{s.t}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-background/65">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Keywords tracked", value: keywords.length, sub: "ranked by monthly volume" },
          { label: "Competitors watched", value: competitors.length, sub: "domains fighting for your terms" },
          {
            label: "Total monthly volume",
            value: keywords.reduce((sum, k) => sum + (k.search_volume ?? 0), 0).toLocaleString("en-US"),
            sub: "searches across all keywords",
          },
        ].map((stat) => (
          <div key={stat.label} className="surface relative overflow-hidden p-5 pl-6">
            <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-gold" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-2 font-display text-[28px] font-bold leading-none text-primary">{stat.value}</p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{stat.sub}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Run the research</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface flex flex-col p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[11px] bg-primary/10 text-primary">
              <Search className="size-[19px]" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">Keyword research</h2>
              <p className="text-[12.5px] text-muted-foreground">
                Live volume, CPC and difficulty for your seed terms.
              </p>
            </div>
          </div>
          <Label htmlFor="seeds" className="mt-5 block text-[12.5px]">Seed keywords</Label>
          <Input
            id="seeds"
            value={seeds}
            onChange={(e) => setSeeds(e.target.value)}
            placeholder="plombier paris, dépannage fuite"
            className="mt-1.5"
          />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">Separate each term with a comma.</p>
          <Button
            className="mt-5 w-full bg-deep text-background hover:bg-deep/90"
            disabled={busy === "kw"}
            onClick={() =>
              run("kw", () =>
                research({
                  data: {
                    projectId,
                    seeds: seeds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20),
                  },
                }),
              )
            }
          >
            {busy === "kw" ? "Analyzing…" : "Find keywords"}
          </Button>
        </div>

        <div className="surface flex flex-col p-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[11px] bg-gold-soft text-gold-foreground">
              <Radar className="size-[19px]" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">Competitors</h2>
              <p className="text-[12.5px] text-muted-foreground">
                Take the keywords your rivals already win.
              </p>
            </div>
          </div>
          <Label htmlFor="rival" className="mt-5 block text-[12.5px]">Competitor domain</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              id="rival"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="competitor.com"
            />
            <Button
              variant="outline"
              disabled={busy === "comp" || !domain.trim()}
              onClick={() => run("comp", () => analyze({ data: { projectId, domain: domain.trim() } }))}
            >
              Analyze
            </Button>
          </div>
          <Button
            variant="ghost"
            className="mt-2 w-full text-[13px] text-primary hover:bg-primary/5"
            disabled={busy === "disc"}
            onClick={() => run("disc", () => discover({ data: { projectId } }))}
          >
            {busy === "disc" ? "Scanning…" : "Auto-discover my competitors"}
          </Button>
          <div className="mt-4 border-t border-border">
            {competitors.length === 0 ? (
              <p className="pt-3 text-[12.5px] text-muted-foreground">
                No competitor tracked yet.
              </p>
            ) : (
              <>
                {competitors.slice(0, compShown).map((c, i) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                  >
                    <span className="w-5 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="size-2 shrink-0 rounded-full bg-gold" />
                    <span className="flex-1 truncate text-[13.5px] font-medium">{c.domain}</span>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2.5 py-1 text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/5"
                      onClick={() => run("comp", () => analyze({ data: { projectId, domain: c.domain } }))}
                    >
                      Pull keywords
                    </button>
                  </div>
                ))}
                {competitors.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setCompShown((n) => (n >= competitors.length ? 5 : n + 5))}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[9px] border border-border py-2 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/5"
                  >
                    <ChevronDown
                      className={`size-3.5 transition-transform ${compShown >= competitors.length ? "rotate-180" : ""}`}
                    />
                    {compShown >= competitors.length
                      ? "Show less"
                      : `Show more (${competitors.length - compShown} left)`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Keyword opportunities
      </p>
      <div className="surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[11px] bg-success-soft text-success">
              <TrendingUp className="size-[19px]" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold">What to write about</h2>
              <p className="text-[12.5px] text-muted-foreground">
                {keywords.length} keyword{keywords.length === 1 ? "" : "s"} tracked, best volume first.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-2 text-[12.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-50"
            disabled={autoRunning || busy !== null}
            onClick={() => run("auto", () => auto({ data: { projectId, force: true } }))}
          >
            <RefreshCw className={`size-3.5 ${autoRunning || busy === "auto" ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {autoRunning || busy === "auto" ? (
          <div className="mt-5 rounded-xl border border-border bg-secondary/40 px-4 py-8 text-center">
            <Sparkles className="mx-auto size-6 animate-pulse text-gold-foreground" />
            <p className="mx-auto mt-3 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Analyzing your market and competitors — this runs automatically, no action needed.
            </p>
          </div>
        ) : keywords.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border px-6 py-12 text-center">
            <h3 className="font-display text-base font-semibold">No keyword yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Add keywords or your website URL in Settings, then hit Refresh — the research runs on its own.
            </p>
          </div>
        ) : (
          <>
          <div className="mt-5 overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-secondary/60">
                  {[
                    { h: "Keyword", a: "text-left" },
                    { h: "Volume", a: "text-right" },
                    { h: "CPC", a: "text-right" },
                    { h: "Difficulty", a: "text-center" },
                    { h: "Intent", a: "text-left" },
                    { h: "Source", a: "text-left" },
                  ].map((c) => (
                    <th
                      key={c.h}
                      className={`border-b border-border px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground ${c.a}`}
                    >
                      {c.h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keywords.slice(0, kwShown).map((k, i) => {
                  const diff = k.difficulty ?? null;
                  const diffTone =
                    diff == null
                      ? "bg-muted text-muted-foreground"
                      : diff < 34
                        ? "bg-success-soft text-success"
                        : diff < 67
                          ? "bg-warning-soft text-warning"
                          : "bg-destructive/10 text-destructive";
                  return (
                    <tr
                      key={k.id}
                      className={`border-b border-border last:border-b-0 transition-colors hover:bg-primary/5 ${
                        i % 2 ? "bg-secondary/25" : ""
                      }`}
                    >
                      <td className="px-3 py-3 text-[13.5px] font-medium">{k.keyword}</td>
                      <td className="px-3 py-3 text-right font-mono text-[13px] font-semibold">
                        {k.search_volume != null ? k.search_volume.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-[13px] text-muted-foreground">
                        {k.cpc != null ? `€${k.cpc.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 font-mono text-[11.5px] font-bold ${diffTone}`}
                        >
                          {diff ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-muted-foreground">{k.intent ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className="rounded-md bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">
                          {k.competitor_domain ?? "seed"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {keywords.length > 5 && (
            <button
              type="button"
              onClick={() => setKwShown((n) => (n >= keywords.length ? 5 : n + 5))}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card py-2.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <ChevronDown
                className={`size-4 transition-transform ${kwShown >= keywords.length ? "rotate-180" : ""}`}
              />
              {kwShown >= keywords.length
                ? "Show less"
                : `Show more (${keywords.length - kwShown} keywords left)`}
            </button>
          )}
          </>
        )}
      </div>
    </div>
  );
}
