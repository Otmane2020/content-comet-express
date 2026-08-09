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
import { BrandLockup } from "@/components/BrandMark";
import { Onboarding } from "@/components/dashboard/Onboarding";
import { Calendar } from "@/components/dashboard/Calendar";
import { Platforms } from "@/components/dashboard/Platforms";
import { Research } from "@/components/dashboard/Research";
import { GoogleHub } from "@/components/dashboard/GoogleHub";
import { Support } from "@/components/dashboard/Support";
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
      { title: "Dashboard — AutopilotGEO" },
      { name: "description", content: "Your rolling 30-day content calendar, drafts and publishing destinations." },
      { property: "og:title", content: "Dashboard — AutopilotGEO" },
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

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [loading, user, navigate]);

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

  if (loading || (user && projectLoading)) {
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
        <div className="mt-auto space-y-2 px-1 text-[12px] text-sidebar-foreground/70">
          <p className="truncate">{user.email}</p>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/", replace: true });
            }}
            className="flex items-center gap-2 hover:text-sidebar-primary"
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
                    <p className="max-w-[140px] truncate text-[11px] font-semibold leading-tight">{user.email}</p>
                    <p className="flex items-center gap-1 text-[10px] font-medium text-amber-500">
                      <Crown className="size-2.5" /> Admin
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-3 py-2">
                  <p className="text-xs font-semibold">Signed in as</p>
                  <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTab("settings")} className="gap-2 text-xs">
                  <Settings2 className="size-3.5" /> Project settings
                </DropdownMenuItem>
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
          {tab === "settings" && <ProjectSettings project={project} />}
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
