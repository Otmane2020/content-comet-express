import { useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan } from "@/lib/autopilot.functions";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
      toast.info("Building your 30-day calendar…");
      await build({ data: { projectId: data.id, days: 30 } });
      toast.success("Your 30 days are planned.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-grid flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="flex justify-center">
          <BrandLockup />
        </div>
        <form onSubmit={submit} className="surface mt-6 space-y-4 p-6">
          <div>
            <h1 className="text-xl font-bold">Tell us about your business</h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              We use this to plan 30 days of GEO, SEO, AEO, local and shopping content.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Business name</Label>
              <Input id="name" required value={form.name} onChange={set("name")} className="mt-1.5" placeholder="Maison Dupont" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="url">Website</Label>
              <Input id="url" value={form.website_url} onChange={set("website_url")} className="mt-1.5" placeholder="https://monsite.com" />
            </div>
            <div>
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" value={form.industry} onChange={set("industry")} className="mt-1.5" placeholder="Plomberie, SaaS RH…" />
            </div>
            <div>
              <Label htmlFor="locale">Language</Label>
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
              <Label htmlFor="audience">Who are you writing for?</Label>
              <Textarea id="audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={2} placeholder="Propriétaires de maison à Lyon, 35-60 ans" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="keywords">Target keywords (comma separated)</Label>
              <Textarea id="keywords" value={form.keywords} onChange={set("keywords")} className="mt-1.5" rows={2} placeholder="plombier lyon, fuite d'eau, chaudière" />
            </div>
          </div>

          <Button type="submit" disabled={busy} className="w-full bg-deep text-background hover:bg-deep/90">
            {busy ? "Planning 30 days…" : "Build my 30-day calendar"}
          </Button>
        </form>
      </div>
    </div>
  );
}