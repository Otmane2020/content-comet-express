import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Check, Sparkles, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan } from "@/lib/autopilot.functions";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TONES = [
  { id: "expert", label: "Expert", hint: "Précis, sourcé" },
  { id: "friendly", label: "Proche", hint: "Chaleureux, simple" },
  { id: "premium", label: "Premium", hint: "Élégant, haut de gamme" },
  { id: "direct", label: "Direct", hint: "Court, orienté action" },
];

export function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const build = useServerFn(buildPlan);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    website_url: "",
    industry: "",
    audience: "",
    tone: "expert",
    locale: "fr",
    keywords: "",
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          name: form.name,
          website_url: form.website_url || null,
          industry: form.industry || null,
          audience: form.audience || null,
          tone: form.tone,
          locale: form.locale,
          keywords: form.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        })
        .select()
        .single();
      if (error) throw error;
      toast.info("Construction de ton calendrier 30 jours…");
      await build({ data: { projectId: data.id, days: 30 } });
      toast.success("Tes 30 jours sont planifiés.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-grid min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        <div className="surface mt-6 grid overflow-hidden lg:grid-cols-[340px_1fr]">
          {/* Left rail */}
          <aside className="relative overflow-hidden bg-deep px-7 py-8 text-background">
            <div className="pointer-events-none absolute -left-16 bottom--10 size-56 rounded-full bg-gold/20 blur-3xl" />
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Configuration</p>
            <h2 className="mt-2 font-display text-[22px] font-bold leading-tight">
              3 minutes pour lancer 30 jours de contenu
            </h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-background/70">
              On utilise ces informations pour planifier, rédiger et publier automatiquement chaque jour.
            </p>

            <ol className="mt-7 space-y-5">
              {[
                { icon: Sparkles, t: "Ton activité", d: "Marché, audience et mots-clés cibles." },
                { icon: CalendarDays, t: "Calendrier 30 jours", d: "Rotation GEO · SEO · AEO · Local · Shopping." },
                { icon: Rocket, t: "Publication auto", d: "Connecte tes sites, l'autopilot fait le reste." },
              ].map((s, i) => (
                <li key={s.t} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/10 text-gold">
                    <s.icon className="size-4" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold">
                      <span className="mr-1.5 text-gold">{i + 1}.</span>
                      {s.t}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-background/60">{s.d}</p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="relative mt-8 inline-flex items-center gap-1.5 rounded-full bg-background/10 px-3 py-1.5 text-[11.5px] text-background/70">
              <Check className="size-3.5 text-gold" /> Modifiable à tout moment
            </p>
          </aside>

          {/* Form */}
          <form onSubmit={submit} className="space-y-5 px-7 py-8">
            <div>
              <h1 className="font-display text-[21px] font-bold leading-tight">Parle-nous de ton activité</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Plus c'est précis, plus les articles seront pertinents.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name" className="text-[12.5px]">Nom de l'entreprise</Label>
                <Input id="name" required value={form.name} onChange={set("name")} className="mt-1.5" placeholder="Maison Dupont" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="url" className="text-[12.5px]">Site web</Label>
                <Input id="url" value={form.website_url} onChange={set("url" as never) || set("website_url")} onChangeCapture={undefined} className="mt-1.5" placeholder="https://monsite.com" />
              </div>
              <div>
                <Label htmlFor="industry" className="text-[12.5px]">Secteur</Label>
                <Input id="industry" value={form.industry} onChange={set("industry")} className="mt-1.5" placeholder="Plomberie, SaaS RH…" />
              </div>
              <div>
                <Label htmlFor="locale" className="text-[12.5px]">Langue</Label>
                <select
                  id="locale"
                  value={form.locale}
                  onChange={set("locale")}
                  className="mt-1.5 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[12.5px]">Ton éditorial</Label>
                <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tone: t.id }))}
                      className={`rounded-xl border px-3 py-2.5 text-left transition ${
                        form.tone === t.id
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/40 hover:bg-muted/50"
                      }`}
                    >
                      <span className="block text-[12.5px] font-semibold">{t.label}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="audience" className="text-[12.5px]">Pour qui écrit-on ?</Label>
                <Textarea id="audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={2} placeholder="Propriétaires de maison à Lyon, 35-60 ans" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="keywords" className="text-[12.5px]">Mots-clés cibles (séparés par des virgules)</Label>
                <Textarea id="keywords" value={form.keywords} onChange={set("keywords")} className="mt-1.5" rows={2} placeholder="plombier lyon, fuite d'eau, chaudière" />
                <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                  Pas d'idée ? Laisse vide — on les trouve pour toi à partir de ton site.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/40 p-4">
              <Button type="submit" disabled={busy} className="w-full bg-deep text-background hover:bg-deep/90">
                {busy ? "Planification des 30 jours…" : "Construire mon calendrier 30 jours"}
              </Button>
              <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                Génération instantanée · aucune carte bancaire requise
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
