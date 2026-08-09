import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Check, ExternalLink, HelpCircle, Plug, ShieldCheck, Timer, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_META, type PlatformId } from "@/lib/geo";
import { PLATFORM_GUIDES } from "@/lib/platformGuides";
import { PlatformLogo } from "@/components/PlatformLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Integration = {
  id: string;
  platform: string;
  label: string;
  status: string;
  last_error: string | null;
};

export function Platforms({ projectId, userId }: { projectId: string; userId: string }) {
  const qc = useQueryClient();
  const [platform, setPlatform] = useState<PlatformId>("wordpress");
  const [values, setValues] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [guideFor, setGuideFor] = useState<PlatformId | null>(null);

  const { data: integrations = [] } = useQuery({
    queryKey: ["integrations", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, platform, label, status, last_error")
        .eq("project_id", projectId)
        .order("created_at");
      if (error) throw error;
      return data as Integration[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("integrations").insert({
        user_id: userId,
        project_id: projectId,
        platform,
        label: label || PLATFORM_META[platform].label,
        config: values,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Destination connected.");
      setValues({});
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["integrations", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integrations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["integrations", projectId] }),
  });

  const guide = guideFor ? PLATFORM_GUIDES[guideFor] : null;
  const healthy = integrations.filter((i) => !i.last_error).length;

  return (
    <div className="space-y-6">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-deep px-6 py-7 text-background">
        <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Destinations</p>
            <h1 className="mt-1.5 font-display text-[26px] font-bold leading-tight">
              Connect your sites once. The autopilot publishes every day.
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-background/70">
              Every generated article is sent automatically to your connected platforms — through their
              official APIs, no plugin required. Unsure about credentials? Open the platform guide,
              every step is explained.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-background/15 bg-background/10 px-4 py-3">
              <p className="font-display text-2xl font-bold">{integrations.length}</p>
              <p className="text-[11px] uppercase tracking-wide text-background/60">Connected</p>
            </div>
            <div className="rounded-xl border border-background/15 bg-background/10 px-4 py-3">
              <p className="font-display text-2xl font-bold text-gold">{healthy}</p>
              <p className="text-[11px] uppercase tracking-wide text-background/60">Live</p>
            </div>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-4 text-[12px] text-background/70">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-gold" /> Encrypted credentials</span>
          <span className="inline-flex items-center gap-1.5"><Plug className="size-3.5 text-gold" /> Official APIs</span>
          <span className="inline-flex items-center gap-1.5"><Timer className="size-3.5 text-gold" /> 2–5 min per site</span>
        </div>
      </section>

      {/* Connected list */}
      <div className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Connected destinations
          </p>
          <span className="text-[12px] text-muted-foreground">{integrations.length} site(s)</span>
        </div>
        {integrations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-secondary">
              <Plug className="size-5 text-muted-foreground" />
            </span>
            <h3 className="mt-3 font-display text-base font-semibold">No destination yet</h3>
            <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
              Pick a platform below, open the guide if needed, and paste your credentials.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {integrations.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-4 transition hover:bg-muted/40">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-secondary/60">
                  <PlatformLogo platform={i.platform} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{i.label}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    {PLATFORM_META[i.platform as PlatformId]?.label ?? i.platform}
                  </p>
                  {i.last_error && <p className="mt-1 text-[11.5px] text-destructive">{i.last_error}</p>}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[12px] text-muted-foreground"
                  onClick={() => setGuideFor(i.platform as PlatformId)}
                >
                  <HelpCircle className="mr-1.5 size-3.5" /> Guide
                </Button>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                    i.last_error ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
                  }`}
                >
                  {i.last_error ? "Needs attention" : "Connected"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(i.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add */}
      <div className="surface grid gap-8 p-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-deep text-[11px] font-bold text-background">1</span>
            <h2 className="font-display text-base font-semibold">Choose the platform</h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Published through the official API — no plugin to install.
          </p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {(Object.entries(PLATFORM_META) as [PlatformId, (typeof PLATFORM_META)[PlatformId]][]).map(
              ([id, meta]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setPlatform(id);
                    setValues({});
                  }}
                  className={`group relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition ${
                    platform === id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                      : "border-border hover:border-primary/40 hover:bg-muted/50"
                  }`}
                >
                  <PlatformLogo platform={id} className="mt-0.5 size-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold">{meta.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                      {PLATFORM_GUIDES[id].time} setup
                    </span>
                  </span>
                  {platform === id && (
                    <Check className="absolute right-2.5 top-2.5 size-3.5 text-primary" />
                  )}
                </button>
              ),
            )}
          </div>

          <div className="mt-4 rounded-xl border border-gold/30 bg-gold-soft/50 p-4">
            <p className="text-[12.5px] leading-relaxed text-foreground/80">
              <strong className="font-semibold">{PLATFORM_META[platform].label} :</strong>{" "}
              {PLATFORM_GUIDES[platform].summary}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-deep/20 bg-background text-[12.5px]"
              onClick={() => setGuideFor(platform)}
            >
              <BookOpen className="mr-1.5 size-3.5" /> View step-by-step guide
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-deep text-[11px] font-bold text-background">2</span>
            <h2 className="font-display text-base font-semibold">Enter your credentials</h2>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Encrypted and used only to publish your own content.
          </p>
          <div className="mt-4 space-y-3.5 rounded-xl border border-border bg-secondary/30 p-4">
            <div>
              <Label htmlFor="label" className="text-[12.5px]">Name</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1.5 bg-background"
                placeholder="Mon blog principal"
              />
            </div>
            {PLATFORM_META[platform].fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={field.key} className="text-[12.5px]">{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.secret ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  className="mt-1.5 bg-background"
                />
              </div>
            ))}
            <Button
              onClick={() => add.mutate()}
              disabled={add.isPending}
              className="w-full bg-deep text-background hover:bg-deep/90"
            >
              {add.isPending ? "Connecting…" : "Connect destination"}
            </Button>
            <p className="text-center text-[11.5px] text-muted-foreground">
              Need help?{" "}
              <button type="button" className="font-semibold text-primary underline" onClick={() => setGuideFor(platform)}>
                Open the {PLATFORM_META[platform].label} guide
              </button>
            </p>
          </div>
        </div>
      </div>

      {/* Guide dialog */}
      <Dialog open={!!guideFor} onOpenChange={(o) => !o && setGuideFor(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto p-0">
          {guideFor && guide && (
            <>
              <div className="bg-deep px-6 py-6 text-background">
                <DialogHeader className="space-y-0 text-left">
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-background">
                      <PlatformLogo platform={guideFor} className="size-6" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
                        Setup guide · {guide.time}
                      </p>
                      <DialogTitle className="font-display text-xl text-background">
                        {PLATFORM_META[guideFor].label}
                      </DialogTitle>
                    </div>
                  </div>
                  <DialogDescription className="mt-3 text-[13px] leading-relaxed text-background/70">
                    {guide.summary}
                  </DialogDescription>
                </DialogHeader>
              </div>

              <div className="space-y-4 px-6 py-6">
                <ol className="space-y-4">
                  {guide.steps.map((s, idx) => (
                    <li key={s.title} className="flex gap-3.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold text-primary">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 border-b border-border pb-4 last:border-0">
                        <p className="text-[13.5px] font-semibold">{s.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                {guide.tips && guide.tips.length > 0 && (
                  <div className="rounded-xl border border-gold/30 bg-gold-soft/50 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gold-foreground">
                      Good to know
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {guide.tips.map((t) => (
                        <li key={t} className="flex gap-2 text-[12.5px] leading-relaxed text-foreground/80">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-gold" />
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2.5">
                  <Button
                    className="bg-deep text-background hover:bg-deep/90"
                    onClick={() => {
                      setPlatform(guideFor);
                      setValues({});
                      setGuideFor(null);
                    }}
                  >
                    Set up {PLATFORM_META[guideFor].label}
                  </Button>
                  {guide.docUrl && (
                    <Button variant="outline" asChild>
                      <a href={guide.docUrl} target="_blank" rel="noreferrer">
                        Official documentation <ExternalLink className="ml-1.5 size-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
