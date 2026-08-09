import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Radar, Search, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCompetitor, discoverCompetitors, researchKeywords } from "@/lib/research.functions";
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

  const { data: keywords = [] } = useQuery({
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
      toast.success(res.found ? `${res.found} result(s) from DataForSEO.` : "No result returned.");
      void qc.invalidateQueries({ queryKey: ["keywords", projectId] });
      void qc.invalidateQueries({ queryKey: ["competitors", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "DataForSEO request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="surface p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-[11px] bg-primary/10 text-primary">
              <Search className="size-4.5" />
            </span>
            <h2 className="font-display text-lg font-semibold">Keyword research</h2>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Seed keywords are expanded with live volume, CPC and difficulty from DataForSEO.
          </p>
          <Label htmlFor="seeds" className="mt-4 block">Seed keywords</Label>
          <Input
            id="seeds"
            value={seeds}
            onChange={(e) => setSeeds(e.target.value)}
            placeholder="plombier paris, dépannage fuite"
            className="mt-1.5"
          />
          <Button
            className="mt-3 w-full bg-deep text-background hover:bg-deep/90"
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

        <div className="surface p-5">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-[11px] bg-gold/15 text-gold-foreground">
              <Radar className="size-4.5" />
            </span>
            <h2 className="font-display text-lg font-semibold">Competitors</h2>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Discover who ranks against your site, then steal the keywords they already win.
          </p>
          <div className="mt-4 flex gap-2">
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="competitor.com" />
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
            className="mt-2 w-full"
            disabled={busy === "disc"}
            onClick={() => run("disc", () => discover({ data: { projectId } }))}
          >
            {busy === "disc" ? "Scanning…" : "Auto-discover my competitors"}
          </Button>
          <div className="mt-3 space-y-1.5">
            {competitors.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="font-medium">{c.domain}</span>
                <button
                  type="button"
                  className="text-[12px] text-primary hover:underline"
                  onClick={() => run("comp", () => analyze({ data: { projectId, domain: c.domain } }))}
                >
                  Pull keywords
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="surface p-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Keyword opportunities</h2>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{keywords.length} tracked</span>
        </div>
        {keywords.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing yet — run a keyword or competitor analysis above.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Keyword</th>
                  <th className="py-2">Volume</th>
                  <th className="py-2">CPC</th>
                  <th className="py-2">Difficulty</th>
                  <th className="py-2">Intent</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((k) => (
                  <tr key={k.id} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{k.keyword}</td>
                    <td className="py-2 pr-3 font-mono">{k.search_volume ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono">{k.cpc != null ? `${k.cpc.toFixed(2)}` : "—"}</td>
                    <td className="py-2 pr-3 font-mono">{k.difficulty ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{k.intent ?? "—"}</td>
                    <td className="py-2 text-muted-foreground">{k.competitor_domain ?? "seed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
