import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Radar, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react";
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
      <header>
        <h1 className="font-display text-[25px] font-bold leading-tight">Keywords &amp; rivals</h1>
        <p className="mt-1 text-[14.5px] text-muted-foreground">
          The market research that feeds every article the autopilot writes.
        </p>
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
          <div key={stat.label} className="surface p-5">
            <p className="text-[13px] text-muted-foreground">{stat.label}</p>
            <p className="mt-2 font-display text-2xl font-bold">{stat.value}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{stat.sub}</p>
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
            className="mt-auto w-full bg-deep pt-0 text-background hover:bg-deep/90 sm:mt-5"
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
              competitors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
                >
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
              ))
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
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  {["Keyword", "Volume", "CPC", "Difficulty", "Intent", "Source"].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border px-2 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => {
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
                    <tr key={k.id} className="border-b border-border last:border-b-0">
                      <td className="px-2 py-3 text-[13.5px] font-medium">{k.keyword}</td>
                      <td className="px-2 py-3 font-mono text-[13px]">
                        {k.search_volume != null ? k.search_volume.toLocaleString("en-US") : "—"}
                      </td>
                      <td className="px-2 py-3 font-mono text-[13px]">
                        {k.cpc != null ? `€${k.cpc.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 font-mono text-[11.5px] font-bold ${diffTone}`}
                        >
                          {diff ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-[13px] text-muted-foreground">{k.intent ?? "—"}</td>
                      <td className="px-2 py-3 text-[12.5px] text-muted-foreground">
                        {k.competitor_domain ?? "seed"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
