import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, MapPin, RefreshCw, Search, Send, Unplug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  disconnectGoogle,
  listGoogleResources,
  publishToGmb,
  selectGoogleResource,
  startGoogleConnect,
  syncSearchConsole,
} from "@/lib/google.functions";
import { Button } from "@/components/ui/button";

type Service = "gmb" | "gsc";

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
};

function GoogleGlyph({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8Z" />
    </svg>
  );
}

export function GoogleHub({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const connect = useServerFn(startGoogleConnect);
  const resources = useServerFn(listGoogleResources);
  const pick = useServerFn(selectGoogleResource);
  const sync = useServerFn(syncSearchConsole);
  const post = useServerFn(publishToGmb);
  const cut = useServerFn(disconnectGoogle);

  const [busy, setBusy] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, { id: string; label: string; sub: string }[]>>({});

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

  async function startConnect(service: Service | "all") {
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
      if (conn.resource_id || options[conn.id]) continue;
      setOptions((o) => ({ ...o, [conn.id]: [] }));
      void resources({ data: { connectionId: conn.id } })
        .then((res) => setOptions((o) => ({ ...o, [conn.id]: res })))
        .catch(() => undefined);
    }
  }, [connections, options, resources]);

  async function choose(conn: Connection, opt: { id: string; label: string }) {
    await pick({ data: { connectionId: conn.id, resourceId: opt.id, resourceName: opt.label } });
    setOptions((o) => ({ ...o, [conn.id]: [] }));
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

  return (
    <div className="space-y-5">
      <div className="surface flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] border border-border bg-card">
            <GoogleGlyph />
          </span>
          <div>
            <h3 className="font-display text-[15px] font-semibold">Authorize Google once</h3>
            <p className="mt-1 max-w-xl text-[12.5px] text-muted-foreground">
              One consent screen grants Search Console and Business Profile access. We then list your verified
              properties and locations so you can pick the ones this project uses.
            </p>
          </div>
        </div>
        <Button
          onClick={() => startConnect("all")}
          disabled={busy === "all"}
          className="bg-deep text-background hover:bg-deep/90"
        >
          <GoogleGlyph className="size-4" />
          {busy === "all" ? "Opening Google…" : "Connect Search Console + Business Profile"}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(["gmb", "gsc"] as Service[]).map((service) => {
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
                  {conn?.account_email && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">{conn.account_email}</p>
                  )}
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

              {opts.length > 0 && conn && (
                <div className="mt-4 space-y-1.5 rounded-xl border border-border p-2">
                  <p className="px-1 text-[12px] text-muted-foreground">{meta.pick}</p>
                  {opts.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => choose(conn, opt)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-muted/60"
                    >
                      <meta.icon className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{opt.label}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{opt.sub}</span>
                      </span>
                    </button>
                  ))}
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
              <table className="w-full text-[13px]">
                <thead className="text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left font-medium">Query</th>
                    <th className="py-1 text-right font-medium">Clicks</th>
                    <th className="py-1 text-right font-medium">Impr.</th>
                    <th className="py-1 text-right font-medium">Pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((m) => (
                    <tr key={m.label} className="border-t border-border">
                      <td className="max-w-[220px] truncate py-1.5">{m.label}</td>
                      <td className="py-1.5 text-right font-mono">{Math.round(m.clicks)}</td>
                      <td className="py-1.5 text-right font-mono">{Math.round(m.impressions)}</td>
                      <td className="py-1.5 text-right font-mono">{m.position ? Number(m.position).toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Top pages</p>
              <ul className="space-y-1.5">
                {pages.map((m) => (
                  <li key={m.label} className="flex items-center gap-2 border-t border-border py-1.5 text-[13px]">
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{m.label}</span>
                    <span className="font-mono text-[12px]">{Math.round(m.clicks)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
