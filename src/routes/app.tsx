import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarDays, LifeBuoy, LineChart, LogOut, MapPin, Plug, RefreshCw, Settings2, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { buildPlan } from "@/lib/autopilot.functions";
import { notifySignup } from "@/lib/support.functions";
import { startGoogleConnect } from "@/lib/google.functions";
import { BrandLockup } from "@/components/BrandMark";
import { Onboarding } from "@/components/dashboard/Onboarding";
import { Calendar } from "@/components/dashboard/Calendar";
import { Platforms } from "@/components/dashboard/Platforms";
import { Research } from "@/components/dashboard/Research";
import { GoogleHub } from "@/components/dashboard/GoogleHub";
import { Support } from "@/components/dashboard/Support";
import { SiteKnowledge } from "@/components/dashboard/SiteKnowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ranki.ai" },
      { name: "description", content: "Your rolling 30-day content calendar, drafts and publishing destinations." },
      { property: "og:title", content: "Dashboard — Ranki.ai" },
      { property: "og:description", content: "Your rolling 30-day AI content calendar." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

type Tab = "calendar" | "research" | "local" | "platforms" | "help" | "settings";

type Project = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  audience: string | null;
  tone: string | null;
  locale: string | null;
  keywords: string[] | null;
};

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "calendar";
    const t = new URLSearchParams(window.location.search).get("tab");
    return (["calendar", "research", "local", "platforms", "help", "settings"] as const).includes(t as Tab)
      ? (t as Tab)
      : "calendar";
  });
  const build = useServerFn(buildPlan);
  const announceSignup = useServerFn(notifySignup);
  const [refilling, setRefilling] = useState(false);
  const [showShopifyWelcome, setShowShopifyWelcome] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("shopify") === "connected";
  });
  // Read once at mount: the redirect effects below rewrite the query string.
  const [shopifyVisitor] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return !!(params.get("shop") || params.get("shopify"));
  });
  const [embedded] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("host");
  });

  useEffect(() => {
    if (!embedded || document.querySelector('script[data-ranki-app-bridge]')) return;
    const script = document.createElement("script");
    script.src = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
    script.async = true;
    script.dataset.rankiAppBridge = "true";
    document.head.appendChild(script);
  }, [embedded]);

  useEffect(() => {
    if (!user) return;
    void announceSignup({ data: undefined }).catch(() => undefined);
  }, [user, announceSignup]);

  // Shopify opens the app from the admin's app tile (or the Partner
  // Dashboard's "App URL") by sending the merchant's browser straight here
  // with a signed shop/hmac/host launch — not through our own
  // /api/public/shopify/install entry point. A signed-out visitor here has
  // no Ranki session, so route them into the real OAuth install flow
  // instead of showing an empty sign-up wizard with no context.
  useEffect(() => {
    if (loading || user) return;
    const params = new URLSearchParams(window.location.search);
    const shop = params.get("shop");
    if (shop) {
      // A signed App Home launch for a shop we already know is a session
      // restoration, not a new OAuth install. Repeating OAuth here causes
      // Shopify's `same_site_cookies` failure loop inside embedded apps.
      const signedLaunch = params.has("hmac");
      const installUrl = signedLaunch
        ? `/api/public/shopify/embedded-login?${params.toString()}`
        : `/api/public/shopify/install?shop=${encodeURIComponent(shop)}`;
      // Shopify account and billing pages cannot render in App Home. Navigate
      // the top browsing context explicitly instead of leaving the iframe in a
      // blocked third-party-cookie state.
      if (window.top !== window.self) {
        window.open(installUrl, "_top");
      } else {
        window.location.href = installUrl;
      }
      return;
    }
    // An install that broke before we could identify the shop still lands here.
    // A merchant provisioned from Shopify never set a password, so the sign-up
    // wizard is a dead end — send them somewhere that states the reason.
    if (params.get("shopify")) {
      window.location.href = `/shopify/error?${new URLSearchParams({ message: params.get("message") ?? "failed" })}`;
    }
  }, [loading, user]);

  // A signed-in merchant can also hit a Shopify error (e.g. adding a second
  // store) — Platforms.tsx only shows this toast on its own tab, so surface it
  // here too. Gated on `user` so it cannot strip the query params the
  // signed-out redirect above still needs to read.
  useEffect(() => {
    if (loading || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("shopify") !== "error") return;
    toast.error(params.get("message") ?? "Shopify install failed.");
    window.history.replaceState({}, "", window.location.pathname);
  }, [loading, user]);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["project", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Project | null;
    },
  });

  // Someone who just signed in with Google is asked once, right away, for
  // Search Console + Business Profile access — wherever they land in the app.
  const startGoogle = useServerFn(startGoogleConnect);
  useEffect(() => {
    if (typeof window === "undefined" || !user || !project) return;
    if (sessionStorage.getItem("ranki:google-scopes") !== "1") return;
    let cancelled = false;
    void (async () => {
      const { count } = await supabase
        .from("google_connections")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id);
      if (cancelled) return;
      sessionStorage.removeItem("ranki:google-scopes");
      if (count && count > 0) return;
      try {
        const res = await startGoogle({
          data: { projectId: project.id, service: "all", origin: window.location.origin },
        });
        window.location.href = res.url;
      } catch {
        /* the user can still connect from Local & Search */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, project, startGoogle]);

  if (loading || (user && projectLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your autopilot…
      </div>
    );
  }
  if (!project) {
    // Mid-install Shopify visitor: the effect above is already sending them
    // back into OAuth or to /shopify/error. Hold rather than flash the
    // sign-up wizard they can never complete.
    if (!user && shopifyVisitor) {
      return (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Resuming your Shopify installation…
        </div>
      );
    }
    return (
      <Onboarding
        userId={user?.id ?? null}
        onDone={() => void qc.invalidateQueries({ queryKey: ["project", user?.id] })}
      />
    );
  }
  if (!user) return null;

  // A Shopify merchant arrives with their project already provisioned. Keep
  // them in the full Ranki onboarding wizard, prefilled from their store,
  // rather than dropping them into a separate abbreviated welcome screen.
  if (showShopifyWelcome) {
    return (
      <Onboarding
        userId={user.id}
        onDone={() => {
          void qc.invalidateQueries({ queryKey: ["project", user.id] });
          setShowShopifyWelcome(false);
          window.history.replaceState(null, "", "/app");
        }}
      />
    );
  }

  async function refill() {
    if (!project) return;
    setRefilling(true);
    try {
      const res = await build({ data: { projectId: project.id, days: 30 } });
      toast.success(res.created ? `${res.created} new day(s) planned.` : "Calendar already full.");
      void qc.invalidateQueries({ queryKey: ["content", project.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refill the calendar");
    } finally {
      setRefilling(false);
    }
  }

  const nav: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
    { id: "calendar", label: "30-day calendar", icon: CalendarDays },
    { id: "research", label: "Keywords & rivals", icon: LineChart },
    { id: "local", label: "Local & Search", icon: MapPin },
    { id: "platforms", label: "Destinations", icon: Plug },
    { id: "help", label: "Help & contact", icon: LifeBuoy },
    { id: "settings", label: "Settings", icon: Settings2 },
  ];

  return (
    <div className={`flex min-h-screen bg-background ${embedded ? "bg-muted/30" : ""}`}>
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex ${embedded ? "w-[76px] px-2 py-4 xl:w-56 xl:px-4" : "w-60 px-4 py-5"}`}>
          <div className={`px-1 ${embedded ? "pb-4 xl:pb-6" : "pb-6"}`}>
            <BrandLockup dark />
          </div>
          <nav className="space-y-1">
            {nav.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors ${
                  tab === entry.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/60"
                }`}
              >
                <entry.icon className="size-4" />
                <span className={embedded ? "hidden xl:inline" : ""}>{entry.label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-1 px-1 text-[12px] text-sidebar-foreground/70">
            <button
              type="button"
              onClick={() => setTab("help")}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                tab === "help" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"
              }`}
            >
              <LifeBuoy className="size-3.5" /> Help
            </button>
            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate({ to: "/", replace: true });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-primary"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-gradient-to-r from-background via-background to-muted/30 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-sm shadow-primary/20">
              <span className="font-display text-base font-bold text-primary-foreground">
                {project.name?.slice(0, 2).toUpperCase() || "AB"}
              </span>
            </div>
            <div>
              <h1 className="font-display text-lg font-bold leading-tight">{project.name}</h1>
              <p className="font-mono text-[11px] text-muted-foreground">
                {project.website_url ?? "no website"} · {project.locale}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1 md:hidden">
              {nav.map((entry) => (
                <Button
                  key={entry.id}
                  size="sm"
                  variant={tab === entry.id ? "default" : "outline"}
                  onClick={() => setTab(entry.id)}
                >
                  <entry.icon className="size-4" />
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={refill} disabled={refilling} className="gap-1.5">
              <RefreshCw className={`size-4 ${refilling ? "animate-spin" : ""}`} /> Refill 30 days
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="group flex items-center gap-2.5 rounded-full border border-border/70 bg-background pl-1.5 pr-3 py-1 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <Avatar className="size-8 border border-primary/20">
                    <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-[10px] font-bold text-primary-foreground">
                      {user.email?.slice(0, 2).toUpperCase() || "AD"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <p className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
                      <Crown className="size-2.5" /> Admin
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setTab("help")} className="gap-2 text-xs">
                  <LifeBuoy className="size-3.5" /> Help
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTab("settings")} className="gap-2 text-xs">
                  <Settings2 className="size-3.5" /> Project settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await supabase.auth.signOut();
                    navigate({ to: "/", replace: true });
                  }}
                  className="gap-2 text-xs text-destructive focus:text-destructive"
                >
                  <LogOut className="size-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="p-5">
          {tab === "calendar" && <Calendar projectId={project.id} />}
          {tab === "research" && <Research projectId={project.id} seedKeywords={project.keywords ?? []} />}
          {tab === "local" && <GoogleHub projectId={project.id} />}
          {tab === "platforms" && <Platforms projectId={project.id} userId={user.id} />}
          {tab === "help" && <Support />}
          {tab === "settings" && <SettingsTab project={project} />}
        </div>
      </main>
    </div>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: project.name,
    website_url: project.website_url ?? "",
    industry: project.industry ?? "",
    audience: project.audience ?? "",
    keywords: (project.keywords ?? []).join(", "),
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from("projects")
      .update({
        name: form.name,
        website_url: form.website_url || null,
        industry: form.industry || null,
        audience: form.audience || null,
        keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
      })
      .eq("id", project.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Project updated.");
    void qc.invalidateQueries({ queryKey: ["project"] });
  }

  return (
    <div className="surface max-w-xl space-y-4 p-5">
      <h2 className="font-display text-lg font-semibold">Project settings</h2>
      {(
        [
          ["name", "Business name"],
          ["website_url", "Website"],
          ["industry", "Industry"],
          ["audience", "Audience"],
          ["keywords", "Target keywords"],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <Label htmlFor={key}>{label}</Label>
          <Input
            id={key}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className="mt-1.5"
          />
        </div>
      ))}
      <Button onClick={save} disabled={busy} className="bg-deep text-background hover:bg-deep/90">
        {busy ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function SettingsTab({ project }: { project: Project }) {
  return (
    <div className="space-y-5">
      <ProjectSettings project={project} />
      <SiteKnowledge projectId={project.id} />
    </div>
  );
}
