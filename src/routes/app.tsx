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
import { ShopifyWelcome } from "@/components/dashboard/ShopifyWelcome";
import { exchangeShopifySession } from "@/lib/shopify.functions";
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

/** App Bridge attaches window.shopify asynchronously once its script loads. */
async function waitForShopifyAppBridge(timeoutMs = 8000): Promise<Window["shopify"] | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.shopify) return window.shopify;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

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
  const exchangeSession = useServerFn(exchangeShopifySession);
  const [refilling, setRefilling] = useState(false);
  const [showShopifyWelcome, setShowShopifyWelcome] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("shopify") === "connected";
  });
  // Shopify appends ?host=... to every load of an embedded app — the one
  // reliable signal that we're running inside the admin iframe.
  const [embedded] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(new URLSearchParams(window.location.search).get("host"));
  });
  // Storage is partitioned inside the iframe, so a session that exists when
  // Ranki.ai is visited directly is invisible here — this stays false while
  // we try to silently establish one from the App Bridge session token, so
  // the plain "no session -> /auth" redirect below doesn't fire too early.
  const [shopifyAuthChecked, setShopifyAuthChecked] = useState(!embedded);
  const [shopifyPlan, setShopifyPlan] = useState<"monthly" | "annual" | null>(null);
  const [choosingShopifyPlan, setChoosingShopifyPlan] = useState(false);
  const [shopifyEmbedError, setShopifyEmbedError] = useState<string | null>(null);

  useEffect(() => {
    if (!embedded || loading || user || shopifyAuthChecked || choosingShopifyPlan || shopifyEmbedError) return;
    let cancelled = false;
    void (async () => {
      // Only ever flip this on a confirmed, unrecoverable failure: on
      // success, `user` becomes truthy once useAuth's onAuthStateChange
      // listener catches up, which already satisfies every gate that reads
      // shopifyAuthChecked — setting it eagerly here raced ahead of that
      // update and sent a freshly authenticated merchant to the signup
      // screen anyway.
      const fail = (reason = "We couldn't connect this Shopify session.") => {
        if (cancelled) return;
        // Embedded merchants must never be sent into Ranki's normal
        // email/password or legacy OAuth flows. Keep them in Shopify with a
        // clear retry state instead.
        setShopifyEmbedError(reason);
        setShopifyAuthChecked(true);
      };
      try {
        const shopify = await waitForShopifyAppBridge();
        if (cancelled) return;
        if (!shopify) {
          console.error("[shopify embed] App Bridge did not load in time");
          return fail();
        }
        const token = await shopify.idToken();
        const result = await exchangeSession({ data: { token, origin: window.location.origin, plan: shopifyPlan ?? undefined } });
        if ("requiresPlanChoice" in result) {
          setChoosingShopifyPlan(true);
          return;
        }
        if ("confirmationUrl" in result) {
          // The Shopify approval page must replace the top-level admin frame.
          // Same dual-attempt as fail() below: window.open(_top) alone is
          // known to silently no-op under some browser/iframe combinations.
          window.open(result.confirmationUrl, "_top");
          try {
            if (window.top) window.top.location.href = result.confirmationUrl;
          } catch {
            /* window.open above already attempted the navigation */
          }
          return;
        }
        const { hashedToken } = result;
        // hashed_token (from admin.generateLink) verifies via token_hash, not
        // the email+token pair used for user-typed OTP codes.
        const { error } = await supabase.auth.verifyOtp({
          token_hash: hashedToken,
          type: "magiclink",
        });
        if (error) throw error;
      } catch (e) {
        console.error("[shopify embed] silent sign-in failed", e);
        fail();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [embedded, loading, user, shopifyAuthChecked, choosingShopifyPlan, shopifyEmbedError, shopifyPlan, exchangeSession]);

  // Safety net: if the silent sign-in above succeeded but useAuth's session
  // state is somehow still lagging past a generous window, stop blocking the
  // UI on it instead of spinning forever.
  useEffect(() => {
    if (!embedded || user || shopifyAuthChecked || choosingShopifyPlan || shopifyEmbedError) return;
    const timer = setTimeout(() => setShopifyAuthChecked(true), 12000);
    return () => clearTimeout(timer);
  }, [embedded, user, shopifyAuthChecked, choosingShopifyPlan, shopifyEmbedError]);

  useEffect(() => {
    if (!embedded && !loading && !user && shopifyAuthChecked) navigate({ to: "/auth", replace: true });
  }, [loading, user, shopifyAuthChecked, navigate]);

  useEffect(() => {
    if (!user) return;
    void announceSignup({ data: undefined }).catch(() => undefined);
  }, [user, announceSignup]);

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

  if (embedded && !user && choosingShopifyPlan) {
    const choosePlan = (plan: "monthly" | "annual") => {
      setShopifyPlan(plan);
      setChoosingShopifyPlan(false);
      setShopifyEmbedError(null);
    };
    return (
      <div className="paper-grid flex min-h-screen items-center justify-center p-5">
        <div className="surface w-full max-w-lg p-7 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Ranki-full-access</p>
          <h1 className="mt-2 font-display text-2xl font-bold">Start your 3-day trial</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose your billing cycle. Shopify will show the final approval page.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Button variant="outline" className="h-auto flex-col gap-1 py-5" onClick={() => choosePlan("monthly")}>
              <span className="font-semibold">Monthly</span><span className="text-muted-foreground">$9.99 / month</span>
            </Button>
            <Button className="h-auto flex-col gap-1 bg-deep py-5 text-background hover:bg-deep/90" onClick={() => choosePlan("annual")}>
              <span className="font-semibold">Annual</span><span className="text-background/75">$99 / year</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (embedded && !user && shopifyEmbedError) {
    return (
      <div className="paper-grid flex min-h-screen items-center justify-center p-5">
        <div className="surface w-full max-w-md p-7 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-destructive">Shopify connection</p>
          <h1 className="mt-2 font-display text-2xl font-bold">We couldn't finish the connection</h1>
          <p className="mt-2 text-sm text-muted-foreground">{shopifyEmbedError}</p>
          <Button className="mt-6 bg-deep text-background hover:bg-deep/90" onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    );
  }

  if (loading || (user && projectLoading) || (embedded && !user && !shopifyAuthChecked)) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your autopilot…
      </div>
    );
  }
  if (!user) return null;
  if (!project) {
    return (
      <Onboarding
        userId={user.id}
        onDone={() => void qc.invalidateQueries({ queryKey: ["project", user.id] })}
      />
    );
  }

  // A merchant installed from the Shopify App Store: their project was
  // provisioned server-side, so this welcome screen is the only place they
  // ever see what we imported before landing in the dashboard.
  if (showShopifyWelcome) {
    return (
      <ShopifyWelcome
        userId={user.id}
        projectId={project.id}
        onContinue={() => {
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
    <div className="flex min-h-screen bg-background">
      {/* Embedded in Shopify admin: Shopify supplies the nav chrome, we only
          feed it links — our own sidebar would just duplicate it. Ranki
          keeps its branding on content (buttons, badges, accent colors). */}
      {embedded && (
        <ui-nav-menu>
          {nav.map((entry, i) => (
            <a key={entry.id} href={`/app?tab=${entry.id}`} rel={i === 0 ? "home" : undefined}>
              {entry.label}
            </a>
          ))}
        </ui-nav-menu>
      )}

      {!embedded && (
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar px-4 py-5 text-sidebar-foreground md:flex">
          <div className="px-1 pb-6">
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
                {entry.label}
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
      )}

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
