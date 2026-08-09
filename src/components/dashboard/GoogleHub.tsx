import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BarChart3,
  Bot,
  Check,
  CheckCircle2,
  ExternalLink,
  MapPin,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Unplug,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GoogleGlyph } from "@/components/GoogleGlyph";
import { scanAiMentions } from "@/lib/mentions.functions";
import {
  disconnectGoogle,
  listGoogleResources,
  publishToGmb,
  selectGoogleResource,
  startGoogleConnect,
  syncAiTraffic,
  syncSearchConsole,
} from "@/lib/google.functions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Service = "gmb" | "gsc" | "ga4";

type Connection = {
  id: string;
  service: Service;
  account_email: string | null;
  resource_id: string | null;
  resource_name: string | null;
  status: string;
  last_error: string | null;
};

type Metric = {
  dimension: string;
  label: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
};

type Mention = {
  id: string;
  engine: string;
  prompt: string;
  mentioned: boolean;
  rank: number | null;
  brands: string[] | null;
  checked_at: string;
};

type AiTraffic = {
  id: string;
  assistant: string;
  source: string;
  sessions: number;
  users: number;
  engaged_sessions: number;
  conversions: number;
};

const META: Record<Service, { title: string; blurb: string; pick: string; icon: typeof MapPin }> = {
  gmb: {
    title: "Google Business Profile",
    blurb: "Local posts, Q&A visibility and Local AEO answers straight on your listing.",
    pick: "Choose the location this project publishes to",
    icon: MapPin,
  },
  gsc: {
    title: "Google Search Console",
    blurb: "Live clicks, impressions, CTR and positions feeding the next 30 days of topics.",
    pick: "Choose the verified property to track",
    icon: Search,
  },
  ga4: {
    title: "Google Analytics 4",
    blurb: "AI assistant traffic — visits arriving from ChatGPT, Perplexity, Gemini, Claude and Copilot.",
    pick: "Choose the GA4 property to read",
    icon: BarChart3,
  },
};

export function GoogleHub({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const connect = useServerFn(startGoogleConnect);
  const resources = useServerFn(listGoogleResources);
  const pick = useServerFn(selectGoogleResource);
  const sync = useServerFn(syncSearchConsole);
  const syncTraffic = useServerFn(syncAiTraffic);
  const post = useServerFn(publishToGmb);
  const cut = useServerFn(disconnectGoogle);
  const scanMentions = useServerFn(scanAiMentions);

  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, { id: string; label: string; sub: string }[]>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  const { data: connections = [] } = useQuery({
    queryKey: ["google", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("google_connections")
        .select("id, service, account_email, resource_id, resource_name, status, last_error")
        .eq("project_id", projectId);
      if (error) throw error;
      return data as Connection[];
    },
  });

  const { data: metrics = [] } = useQuery({
    queryKey: ["search-metrics", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("search_metrics")
        .select("dimension, label, clicks, impressions, ctr, position")
        .eq("project_id", projectId)
        .order("clicks", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Metric[];
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get("google");
    if (!state) return;
    if (state === "connected") toast.success("Google account connected.");
    else toast.error(params.get("message") ?? "Google connection failed.");
    window.history.replaceState({}, "", window.location.pathname);
    void qc.invalidateQueries({ queryKey: ["google", projectId] });
  }, [projectId, qc]);

  async function startConnect(service: Service) {
    setBusy(service);
    try {
      const res = await connect({ data: { projectId, service, origin: window.location.origin } });
      window.location.href = res.url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start Google sign-in");
      setBusy(null);
    }
  }

  async function loadResources(conn: Connection) {
    setBusy(conn.id);
    try {
      const res = await resources({ data: { connectionId: conn.id } });
      setOptions((o) => ({ ...o, [conn.id]: res }));
      if (!res.length) toast.info("No location or property found on this Google account.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google refused the request");
    } finally {
      setBusy(null);
    }
  }

  // After a Google consent, fetch the available properties / locations so the
  // user can immediately pick one for both services.
  useEffect(() => {
    for (const conn of connections) {
      if (options[conn.id]) continue;
      setOptions((o) => ({ ...o, [conn.id]: [] }));
      void resources({ data: { connectionId: conn.id } })
        .then((res) => setOptions((o) => ({ ...o, [conn.id]: res })))
        .catch(() => undefined);
    }
  }, [connections, options, resources]);

  async function choose(conn: Connection, opt: { id: string; label: string }) {
    await pick({ data: { connectionId: conn.id, resourceId: opt.id, resourceName: opt.label } });
    toast.success(`Linked to ${opt.label}.`);
    void qc.invalidateQueries({ queryKey: ["google", projectId] });
  }

  const queries = metrics.filter((m) => m.dimension === "query").slice(0, 12);
  const pages = metrics.filter((m) => m.dimension === "page").slice(0, 8);
  const totals = metrics
    .filter((m) => m.dimension === "date")
    .reduce(
      (acc, m) => ({ clicks: acc.clicks + Number(m.clicks), impressions: acc.impressions + Number(m.impressions) }),
      { clicks: 0, impressions: 0 },
    );

  const { data: mentions = [] } = useQuery({
    queryKey: ["ai-mentions", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_mentions")
        .select("id, engine, prompt, mentioned, rank, brands, checked_at")
        .eq("project_id", projectId)
        .order("checked_at", { ascending: false });
      if (error) throw error;
      return data as Mention[];
    },
  });
  const mentionRate = mentions.length
    ? Math.round((mentions.filter((m) => m.mentioned).length / mentions.length) * 100)
    : 0;

  const { data: aiTraffic = [] } = useQuery({
    queryKey: ["ai-traffic", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_traffic")
        .select("id, assistant, source, sessions, users, engaged_sessions, conversions")
        .eq("project_id", projectId)
        .order("sessions", { ascending: false });
      if (error) throw error;
      return data as AiTraffic[];
    },
  });
  const aiSessions = aiTraffic.reduce((a, r) => a + Number(r.sessions), 0);
  const aiConversions = aiTraffic.reduce((a, r) => a + Number(r.conversions), 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-3">
        {(["gmb", "gsc", "ga4"] as Service[]).map((service) => {
          const conn = connections.find((c) => c.service === service);
          const meta = META[service];
          const opts = conn ? options[conn.id] ?? [] : [];
          return (
            <div key={service} className="surface flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] border border-border bg-card">
                  <GoogleGlyph />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-[15px] font-semibold">{meta.title}</h3>
                    {conn && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                        <CheckCircle2 className="size-3" /> connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">{meta.blurb}</p>
                  {conn?.resource_name && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium">
                      <meta.icon className="size-3.5 text-primary" /> {conn.resource_name}
                    </p>
                  )}
                  {conn?.last_error && <p className="mt-1 text-[11px] text-destructive">{conn.last_error}</p>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {!conn && (
                  <Button
                    size="sm"
                    onClick={() => startConnect(service)}
                    disabled={busy === service}
                    className="bg-deep text-background hover:bg-deep/90"
                  >
                    <GoogleGlyph className="size-4" />
                    {busy === service ? "Opening Google…" : "Connect with Google"}
                  </Button>
                )}
                {conn && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => loadResources(conn)} disabled={busy === conn.id}>
                      <RefreshCw className={`size-4 ${busy === conn.id ? "animate-spin" : ""}`} />
                      {conn.resource_id ? "Change" : "Pick"} {service === "gmb" ? "location" : "property"}
                    </Button>
                    {service === "ga4" && conn.resource_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setBusy(conn.id);
                          try {
                            const res = await syncTraffic({ data: { projectId } });
                            toast.success(`${res.sessions} AI assistant sessions imported.`);
                            void qc.invalidateQueries({ queryKey: ["ai-traffic", projectId] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "GA4 sync failed");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <RefreshCw className="size-4" /> Sync AI traffic
                      </Button>
                    )}
                    {service === "gsc" && conn.resource_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setBusy(conn.id);
                          try {
                            const res = await sync({ data: { projectId } });
                            toast.success(`${res.rows} rows synced from Search Console.`);
                            void qc.invalidateQueries({ queryKey: ["search-metrics", projectId] });
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Sync failed");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <RefreshCw className="size-4" /> Sync 28 days
                      </Button>
                    )}
                    {service === "gmb" && conn.resource_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setBusy(conn.id);
                          try {
                            const res = await post({ data: { projectId } });
                            toast.success(`Posted “${res.title}” to your listing.`);
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Post failed");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Send className="size-4" /> Post latest article
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await cut({ data: { connectionId: conn.id } });
                        void qc.invalidateQueries({ queryKey: ["google", projectId] });
                      }}
                    >
                      <Unplug className="size-4" /> Disconnect
                    </Button>
                  </>
                )}
              </div>

              {conn && opts.length > 0 && (
                <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[12px] font-medium text-muted-foreground">{meta.pick}</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Select
                      value={draft[conn.id] ?? conn.resource_id ?? ""}
                      onValueChange={(v) => setDraft((d) => ({ ...d, [conn.id]: v }))}
                    >
                      <SelectTrigger className="h-9 flex-1 bg-card text-[13px]">
                        <SelectValue placeholder={service === "gmb" ? "Select a location" : "Select a property"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {opts.map((opt) => (
                          <SelectItem key={opt.id} value={opt.id} className="text-[13px]">
                            <span className="flex min-w-0 items-center gap-2">
                              <meta.icon className="size-3.5 shrink-0 text-primary" />
                              <span className="truncate">{opt.label}</span>
                              <span className="truncate font-mono text-[10.5px] text-muted-foreground">{opt.sub}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-9 bg-deep text-background hover:bg-deep/90"
                      disabled={
                        !draft[conn.id] || draft[conn.id] === conn.resource_id || busy === `pick-${conn.id}`
                      }
                      onClick={async () => {
                        const opt = opts.find((o) => o.id === draft[conn.id]);
                        if (!opt) return;
                        setBusy(`pick-${conn.id}`);
                        try {
                          await choose(conn, opt);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Could not save the selection");
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <Check className="size-4" />
                      {draft[conn.id] && draft[conn.id] === conn.resource_id ? "In use" : "Use this"}
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Only the checked {service === "gmb" ? "location" : "property"} is used for research and publishing.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Search performance</h3>
            <p className="text-[12.5px] text-muted-foreground">Last 28 days from Search Console.</p>
          </div>
          <div className="flex gap-6 font-mono text-[12px]">
            <span>
              <span className="block text-muted-foreground">clicks</span>
              <span className="text-base font-semibold">{Math.round(totals.clicks)}</span>
            </span>
            <span>
              <span className="block text-muted-foreground">impressions</span>
              <span className="text-base font-semibold">{Math.round(totals.impressions)}</span>
            </span>
          </div>
        </div>

        {queries.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing yet — connect Search Console above and run a sync.
          </p>
        ) : (
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Top queries</p>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-[13px]">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Query</th>
                      <th className="px-3 py-2 text-right font-medium">Clicks</th>
                      <th className="px-3 py-2 text-right font-medium">Impr.</th>
                      <th className="px-3 py-2 text-right font-medium">Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((m, i) => (
                      <tr
                        key={m.label}
                        className={`border-t border-border/60 transition-colors hover:bg-primary/5 ${
                          i % 2 ? "bg-muted/15" : ""
                        }`}
                      >
                        <td className="max-w-[220px] truncate px-3 py-2">{m.label}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-primary">
                          {Math.round(m.clicks)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {Math.round(m.impressions)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {m.position ? Number(m.position).toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Top pages</p>
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {pages.map((m, i) => (
                  <li
                    key={m.label}
                    className={`flex items-center gap-2 px-3 py-2 text-[13px] transition-colors hover:bg-primary/5 ${
                      i ? "border-t border-border/60" : ""
                    } ${i % 2 ? "bg-muted/15" : ""}`}
                  >
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    <span className="font-mono text-[12px] font-semibold text-primary">{Math.round(m.clicks)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Sparkles className="size-4 text-primary" /> AI mentions
            </h3>
            {/* AI visibility (mentions) — distinct from AI traffic below. */}
            <p className="max-w-xl text-[12.5px] text-muted-foreground">
              We ask ChatGPT, Perplexity and Gemini the buying questions your customers type, then check whether your
              brand is named and in which position. That is your GEO visibility — tracked right here.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right font-mono text-[12px]">
              <span className="block text-muted-foreground">mention rate</span>
              <span className="text-base font-semibold text-primary">{mentionRate}%</span>
            </div>
            <Button
              size="sm"
              className="bg-deep text-background hover:bg-deep/90"
              disabled={busy === "mentions"}
              onClick={async () => {
                setBusy("mentions");
                try {
                  const res = await scanMentions({ data: { projectId } });
                  toast.success(`${res.mentioned}/${res.checked} answers mention your brand.`);
                  void qc.invalidateQueries({ queryKey: ["ai-mentions", projectId] });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "AI mention scan failed");
                } finally {
                  setBusy(null);
                }
              }}
            >
              <RefreshCw className={`size-4 ${busy === "mentions" ? "animate-spin" : ""}`} /> Run AI scan
            </Button>
          </div>
        </div>

        {mentions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No scan yet — run an AI scan to see where you stand inside AI answers.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Engine</th>
                  <th className="px-3 py-2 text-left font-medium">Question</th>
                  <th className="px-3 py-2 text-left font-medium">Brands cited</th>
                  <th className="px-3 py-2 text-right font-medium">You</th>
                </tr>
              </thead>
              <tbody>
                {mentions.map((m, i) => (
                  <tr
                    key={m.id}
                    className={`border-t border-border/60 transition-colors hover:bg-primary/5 ${
                      i % 2 ? "bg-muted/15" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium capitalize">
                        <Bot className="size-3.5 text-primary" /> {m.engine}
                      </span>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2">{m.prompt}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-muted-foreground">
                      {(m.brands ?? []).slice(0, 4).join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.mentioned ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                          <CheckCircle2 className="size-3" /> #{m.rank ?? "—"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          not cited
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
              <BarChart3 className="size-4 text-primary" /> AI traffic
            </h3>
            <p className="max-w-xl text-[12.5px] text-muted-foreground">
              Real visits arriving from AI assistants, read from your Analytics property by referrer (ChatGPT,
              Perplexity, Gemini, Claude, Copilot…). Mentions above show visibility; this shows the clicks it earns.
            </p>
          </div>
          <div className="flex gap-6 font-mono text-[12px]">
            <span>
              <span className="block text-muted-foreground">AI sessions</span>
              <span className="text-base font-semibold text-primary">{aiSessions}</span>
            </span>
            <span>
              <span className="block text-muted-foreground">conversions</span>
              <span className="text-base font-semibold">{Math.round(aiConversions)}</span>
            </span>
          </div>
        </div>

        {aiTraffic.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing yet — connect Google Analytics 4 above, pick a property and run “Sync AI traffic”.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Assistant</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Sessions</th>
                  <th className="px-3 py-2 text-right font-medium">Users</th>
                  <th className="px-3 py-2 text-right font-medium">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {aiTraffic.map((r, i) => (
                  <tr
                    key={r.id}
                    className={`border-t border-border/60 transition-colors hover:bg-primary/5 ${
                      i % 2 ? "bg-muted/15" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <Bot className="size-3.5 text-primary" /> {r.assistant}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 font-mono text-[11.5px] text-muted-foreground">
                      {r.source}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-primary">{r.sessions}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{r.users}</td>
                    <td className="px-3 py-2 text-right font-mono">{Math.round(Number(r.conversions))}</td>
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
