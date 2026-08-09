import { useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Loader2,
  Plus,
  Radar,
  Rocket,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan, kickstartFirstDay } from "@/lib/autopilot.functions";
import { detectBusiness, detectMarket } from "@/lib/detect.functions";
import { INDUSTRY_GROUPS, LANGUAGES } from "@/lib/industries";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TONES = [
  { id: "expert", label: "Expert", hint: "Precise, sourced" },
  { id: "friendly", label: "Friendly", hint: "Warm, simple" },
  { id: "premium", label: "Premium", hint: "Elegant, high-end" },
  { id: "direct", label: "Direct", hint: "Short, action-driven" },
];

const STEPS = [
  {
    id: 0,
    icon: Building2,
    kicker: "Step 1",
    title: "Your business",
    lead: "We learn who you are",
    blurb:
      "Name, website, industry, audience and language: the base the AI writes from. The more precise, the more the articles sound like your brand.",
  },
  {
    id: 1,
    icon: Radar,
    kicker: "Step 2",
    title: "Competitors & keywords",
    lead: "We scan your market",
    blurb:
      "We analyse your competitors and pull the keywords that actually drive traffic: volume, difficulty, CPC. They feed the calendar.",
  },
  {
    id: 2,
    icon: Rocket,
    kicker: "Step 3",
    title: "Generation & auto-publish",
    lead: "We write and publish daily",
    blurb:
      "One article a day for 30 days, illustrated and published on its own to your connected destinations. Nothing left for you to do.",
  },
];

const FORMATS = [
  { code: "GEO", desc: "Cited by ChatGPT & Perplexity" },
  { code: "SEO", desc: "Classic Google ranking" },
  { code: "AEO", desc: "Direct buyer answer" },
  { code: "LOCAL", desc: "Near-me intent" },
  { code: "SHOP", desc: "Shopping comparison" },
];

export function Onboarding({ userId, onDone }: { userId: string; onDone: () => void }) {
  const build = useServerFn(buildPlan);
  const kickstart = useServerFn(kickstartFirstDay);
  const detectBiz = useServerFn(detectBusiness);
  const detectMkt = useServerFn(detectMarket);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanningMarket, setScanningMarket] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  const [market, setMarket] = useState<{
    source: "dataforseo" | "ai";
    competitors: string[];
    keywords: { keyword: string; volume: number | null; difficulty: number | null }[];
  } | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    website_url: "",
    industry: "",
    audience: "",
    tone: "expert",
    locale: "en",
    keywords: "",
    competitors: "",
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const canNext = step !== 0 || form.name.trim().length > 1;

  async function autodetectBusiness() {
    if (!form.website_url.trim()) {
      toast.error("Add your website URL first.");
      return;
    }
    setScanning(true);
    try {
      const d = await detectBiz({ data: { website: form.website_url } });
      setForm((f) => ({
        ...f,
        name: f.name || (d.name ?? ""),
        industry: d.industry ?? f.industry,
        audience: d.audience ?? f.audience,
        tone: d.tone,
        locale: d.locale,
        keywords: f.keywords || d.keywords.join(", "),
      }));
      setDetected(d.summary);
      toast.success("Website analysed — fields filled in.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that website");
    } finally {
      setScanning(false);
    }
  }

  async function autodetectMarket() {
    if (!form.website_url.trim()) {
      toast.error("Add your website URL in step 1 first.");
      return;
    }
    setScanningMarket(true);
    try {
      const r = await detectMkt({
        data: {
          website: form.website_url,
          name: form.name || undefined,
          industry: form.industry || undefined,
          locale: form.locale,
          seeds: form.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 10),
        },
      });
      setMarket(r);
      setForm((f) => ({
        ...f,
        competitors: f.competitors.trim() ? f.competitors : r.competitors.join("\n"),
        keywords: f.keywords.trim() ? f.keywords : r.keywords.slice(0, 10).map((k) => k.keyword).join(", "),
      }));
      toast.success(`Live SEO data: ${r.competitors.length} rivals, ${r.keywords.length} keywords.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Market scan failed");
    } finally {
      setScanningMarket(false);
    }
  }

  const addKeyword = (kw: string) =>
    setForm((f) => {
      const list = f.keywords.split(",").map((k) => k.trim()).filter(Boolean);
      if (list.some((k) => k.toLowerCase() === kw.toLowerCase())) return f;
      return { ...f, keywords: [...list, kw].join(", ") };
    });

  const addCompetitor = (domain: string) =>
    setForm((f) => {
      const list = f.competitors.split(/[\n,]/).map((c) => c.trim()).filter(Boolean);
      if (list.some((c) => c.toLowerCase() === domain.toLowerCase())) return f;
      return { ...f, competitors: [...list, domain].join("\n") };
    });

  async function submit() {
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

      const rivals = form.competitors
        .split(/[\n,]/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (rivals.length) {
        await supabase.from("competitors").insert(
          rivals.map((domain) => ({
            user_id: userId,
            project_id: data.id,
            domain: domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""),
          })),
        );
      }

      toast.info("Building your 30-day calendar…");
      await build({ data: { projectId: data.id, days: 30 } });
      toast.success("Your 30 days are planned.");

      toast.info("Writing and illustrating your day-1 GEO article…");
      try {
        const first = await kickstart({
          data: { projectId: data.id, origin: window.location.origin },
        });
        if (first.gmb?.posted) {
          toast.success(`Day 1 ready + Local post published to Google Business Profile.`);
        } else if (first.gmb) {
          toast.warning(`Day 1 ready. Google Business Profile post failed: ${first.gmb.error}`);
        } else {
          toast.success(`Day 1 ready: “${first.title}”`);
        }
      } catch (e) {
        toast.warning(
          e instanceof Error ? `Day 1 will be written shortly (${e.message})` : "Day 1 will be written shortly",
        );
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  const active = STEPS[step]!;

  return (
    <div className="paper-grid min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        <div className="surface mt-6 grid overflow-hidden lg:grid-cols-[330px_1fr]">
          {/* Rail */}
          <aside className="relative overflow-hidden bg-deep px-7 py-8 text-background">
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -left-20 top-10 size-64 rounded-full bg-gold/25 blur-3xl"
              animate={{ y: [0, 28, 0], opacity: [0.55, 0.85, 0.55] }}
              transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
                Setup · {step + 1}/3
              </p>
              <h2 className="mt-2 font-display text-[21px] font-bold leading-tight">
                3 minutes to launch 30 days of content
              </h2>

              <ol className="mt-7 space-y-1.5">
                {STEPS.map((s, i) => {
                  const done = i < step;
                  const current = i === step;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => i <= step && setStep(i)}
                        className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                          current ? "bg-background/10" : "hover:bg-background/5"
                        }`}
                      >
                        <span
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition ${
                            done
                              ? "bg-gold text-gold-foreground"
                              : current
                                ? "bg-background text-deep"
                                : "bg-background/10 text-background/60"
                          }`}
                        >
                          {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-[13px] font-semibold ${current ? "" : "text-background/70"}`}>
                            {s.title}
                          </span>
                          <span className="mt-0.5 block text-[11.5px] leading-snug text-background/50">
                            {s.lead}
                          </span>
                        </span>
                      </button>
                      {current && (
                        <motion.div
                          layoutId="rail-progress"
                          className="ml-6 h-6 w-px bg-gold/50"
                          initial={{ scaleY: 0 }}
                          animate={{ scaleY: 1 }}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="mt-8 h-1 overflow-hidden rounded-full bg-background/15">
                <motion.div
                  className="h-full rounded-full bg-gold"
                  animate={{ width: `${((step + 1) / 3) * 100}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
            </div>
          </aside>

          {/* Panel */}
          <div className="flex min-h-[540px] flex-col px-7 py-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="flex-1"
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                  {active.kicker}
                </p>
                <h1 className="mt-1.5 font-display text-[23px] font-bold leading-tight">{active.title}</h1>
                <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">
                  {active.blurb}
                </p>

                {step === 0 && (
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label htmlFor="name" className="text-[12.5px]">Business name</Label>
                      <Input id="name" required value={form.name} onChange={set("name")} className="mt-1.5" placeholder="Maison Dupont" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="url" className="text-[12.5px]">Website</Label>
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                        <Input id="url" value={form.website_url} onChange={set("website_url")} placeholder="https://yoursite.com" />
                        <Button
                          type="button"
                          onClick={autodetectBusiness}
                          disabled={scanning}
                          className="shrink-0 bg-gold text-gold-foreground hover:bg-gold/90"
                        >
                          {scanning ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Wand2 className="mr-1.5 size-4" />}
                          {scanning ? "Reading site…" : "Auto-detect with AI"}
                        </Button>
                      </div>
                      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                        We read your homepage and fill industry, audience, tone and language for you.
                      </p>
                      {detected && (
                        <motion.p
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-2 rounded-xl border border-gold/30 bg-gold-soft/50 px-3.5 py-2.5 text-[12px] leading-relaxed text-foreground/80"
                        >
                          <strong className="font-semibold">Detected:</strong> {detected}
                        </motion.p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="industry" className="text-[12.5px]">Industry</Label>
                      <select
                        id="industry"
                        value={form.industry}
                        onChange={set("industry")}
                        className="mt-1.5 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Select an industry…</option>
                        {INDUSTRY_GROUPS.map((g) => (
                          <optgroup key={g.group} label={g.group}>
                            {g.items.map((i) => (
                              <option key={i} value={i}>{i}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="locale" className="text-[12.5px]">Language</Label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {LANGUAGES.map((l) => (
                          <button
                            key={l.code}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, locale: l.code }))}
                            title={l.label}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                              form.locale === l.code
                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                : "border-border text-muted-foreground hover:border-primary/40 hover:bg-muted/50"
                            }`}
                          >
                            <span className="text-[15px] leading-none">{l.flag}</span>
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-[12.5px]">Editorial tone</Label>
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
                      <Label htmlFor="audience" className="text-[12.5px]">Who are we writing for?</Label>
                      <Textarea id="audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={2} placeholder="Homeowners in Lyon, 35-60" />
                    </div>
                  </div>
                )}

                {step === 1 && (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      {[
                        { t: "We list your rivals", d: "The sites already capturing your customers." },
                        { t: "We extract their keywords", d: "Real volume, difficulty and cost per click." },
                        { t: "We keep the winners", d: "The ones you can realistically win." },
                      ].map((c, i) => (
                        <motion.div
                          key={c.t}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.06 * i }}
                          className="rounded-xl border border-border bg-secondary/40 p-3.5"
                        >
                          <span className="text-[11px] font-bold text-gold">0{i + 1}</span>
                          <p className="mt-1 text-[12.5px] font-semibold">{c.t}</p>
                          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{c.d}</p>
                        </motion.div>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3.5">
                      <Button
                        type="button"
                        onClick={autodetectMarket}
                        disabled={scanningMarket}
                        className="bg-deep text-background hover:bg-deep/90"
                      >
                        {scanningMarket ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Radar className="mr-1.5 size-4" />}
                        {scanningMarket ? "Scanning market…" : "Auto-detect competitors & keywords"}
                      </Button>
                      <p className="text-[11.5px] leading-snug text-muted-foreground">
                        Live SEO metrics from DataForSEO, with AI estimates as backup.
                      </p>
                      {market && (
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                            market.source === "dataforseo"
                              ? "bg-primary/10 text-primary"
                              : "bg-gold-soft text-foreground/70"
                          }`}
                        >
                          {market.source === "dataforseo" ? "Live DataForSEO" : "AI estimate"}
                        </span>
                      )}
                    </div>

                    {market && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-border p-3.5">
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            Competitors found
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {market.competitors.map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => addCompetitor(d)}
                                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11.5px] hover:border-primary/50 hover:bg-primary/5"
                              >
                                <Plus className="size-3 text-primary" /> {d}
                              </button>
                            ))}
                            {!market.competitors.length && (
                              <span className="text-[11.5px] text-muted-foreground">None found.</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border p-3.5">
                          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                            Keyword opportunities
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {market.keywords.slice(0, 12).map((k) => (
                              <button
                                key={k.keyword}
                                type="button"
                                onClick={() => addKeyword(k.keyword)}
                                className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11.5px] hover:border-primary/50 hover:bg-primary/5"
                              >
                                <Plus className="size-3 text-primary" /> {k.keyword}
                                {k.volume != null && (
                                  <span className="text-[10.5px] text-muted-foreground">{k.volume}/mo</span>
                                )}
                              </button>
                            ))}
                            {!market.keywords.length && (
                              <span className="text-[11.5px] text-muted-foreground">None found.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label htmlFor="competitors" className="text-[12.5px]">Competitors (one domain per line)</Label>
                      <Textarea
                        id="competitors"
                        value={form.competitors}
                        onChange={set("competitors")}
                        className="mt-1.5"
                        rows={3}
                        placeholder={"competitor1.com\ncompetitor2.com"}
                      />
                    </div>
                    <div>
                      <Label htmlFor="keywords" className="text-[12.5px]">Target keywords (comma separated)</Label>
                      <Textarea id="keywords" value={form.keywords} onChange={set("keywords")} className="mt-1.5" rows={2} placeholder="plumber lyon, water leak, boiler" />
                    </div>
                    <p className="rounded-xl border border-gold/30 bg-gold-soft/50 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/80">
                      You can leave this empty: the app analyses your site and finds competitors and keywords
                      on its own as soon as you open the dashboard.
                    </p>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-2 sm:grid-cols-5">
                      {FORMATS.map((f, i) => (
                        <motion.div
                          key={f.code}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05 * i }}
                          className="rounded-xl border border-border bg-secondary/40 p-3"
                        >
                          <span className="rounded-md bg-deep px-2 py-0.5 text-[10.5px] font-bold text-background">
                            {f.code}
                          </span>
                          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">{f.desc}</p>
                        </motion.div>
                      ))}
                    </div>

                    <div className="relative overflow-hidden rounded-2xl bg-deep px-6 py-6 text-background">
                      <motion.div
                        aria-hidden
                        className="pointer-events-none absolute -right-12 -top-12 size-52 rounded-full bg-gold/25 blur-3xl"
                        animate={{ scale: [1, 1.18, 1] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                      />
                      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4">
                        {[
                          { icon: CalendarDays, t: "Planned" },
                          { icon: Sparkles, t: "Written + illustrated" },
                          { icon: Send, t: "Published everywhere" },
                        ].map((s, i) => (
                          <motion.div
                            key={s.t}
                            className="flex items-center gap-2.5"
                            animate={{ opacity: [0.45, 1, 0.45] }}
                            transition={{ duration: 3, repeat: Infinity, delay: i * 1 }}
                          >
                            <span className="flex size-9 items-center justify-center rounded-xl bg-background/10 text-gold">
                              <s.icon className="size-4" />
                            </span>
                            <span className="text-[13px] font-semibold">{s.t}</span>
                            {i < 2 && <ArrowRight className="ml-2 size-4 text-background/40" />}
                          </motion.div>
                        ))}
                      </div>
                      <p className="relative mt-4 text-[12.5px] leading-relaxed text-background/70">
                        Every morning the autopilot writes the article of the day, generates its images and sends
                        it to WordPress, Shopify, PrestaShop, WooCommerce or your Lovable/Bolt site.
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/40 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                      <strong className="font-semibold text-foreground">Recap:</strong>{" "}
                      {form.name || "Your business"}
                      {form.industry ? ` · ${form.industry}` : ""} · {form.tone} tone ·{" "}
                      {form.locale.toUpperCase()} · 30 articles planned.
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Nav */}
            <div className="mt-7 flex items-center justify-between border-t border-border pt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || busy}
                className="text-[13px]"
              >
                <ArrowLeft className="mr-1.5 size-4" /> Back
              </Button>

              {step < 2 ? (
                <Button
                  type="button"
                  onClick={() => setStep((s) => Math.min(2, s + 1))}
                  disabled={!canNext}
                  className="bg-deep text-background hover:bg-deep/90"
                >
                  Continue <ArrowRight className="ml-1.5 size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="bg-deep text-background hover:bg-deep/90"
                >
                  {busy ? "Planning 30 days…" : "Launch my autopilot"}
                  <Rocket className="ml-1.5 size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
