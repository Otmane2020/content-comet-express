import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, BookOpen, Bot, Building2, CalendarDays, Check, FileText, Globe2, Layers3, Loader as Loader2, LogOut, Package, Plus, Radar, RefreshCw, Rocket, Send, Sparkles, ShieldCheck, Tag, Wand as Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan, kickstartFirstDay } from "@/lib/autopilot.functions";
import { createCheckout, getSubscription, syncSubscription } from "@/lib/billing.functions";
import { detectBusiness, detectMarket } from "@/lib/detect.functions";
import {
  completeOnboarding,
  getOnboarding,
  getShopifyPrefill,
  saveMarketResearch,
  saveOnboarding,
} from "@/lib/onboarding.functions";
import { syncSiteKnowledge } from "@/lib/sitecrawl.functions";
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
    icon: Sparkles,
    kicker: "Step 2",
    title: "Your content profile",
    lead: "Set the voice of your autopilot",
    blurb:
      "Confirm the industry, language, editorial tone and audience Ranki should use. These settings shape every article before we scan your market.",
  },
  {
    id: 2,
    icon: Radar,
    kicker: "Step 3",
    title: "Competitors & keywords",
    lead: "We scan your market",
    blurb:
      "We analyse your competitors and pull the keywords that actually drive traffic: volume, difficulty, CPC. They feed the calendar.",
  },
  {
    id: 3,
    icon: Rocket,
    kicker: "Step 4",
    title: "Generation & auto-publish",
    lead: "We write and publish daily",
    blurb:
      "One article a day for 30 days, illustrated and published on its own to your connected destinations. Nothing left for you to do.",
  },
];

const MARKET_STAGES = [
  { icon: Radar, label: "We're searching your competitors…" },
  { icon: Tag, label: "We're searching your keywords…" },
  { icon: Sparkles, label: "We're scoring the real opportunities…" },
];

const FORMATS = [
  { code: "GEO", desc: "Cited by ChatGPT & Perplexity" },
  { code: "SEO", desc: "Classic Google ranking" },
  { code: "AEO", desc: "Direct buyer answer" },
  { code: "LOCAL", desc: "Near-me intent" },
  { code: "SHOP", desc: "Shopping comparison" },
];

const BUSINESS_ANALYSIS_STAGES = [
  { icon: Wand2, label: "Reading your website" },
  { icon: Building2, label: "Understanding your positioning" },
  { icon: Radar, label: "Mapping competitors and keywords" },
  { icon: Sparkles, label: "Preparing your content strategy" },
];

type ShopifyWelcomeReport = {
  shop: string;
  business_name: string | null;
  website_url: string | null;
  productCount: number;
  collectionTitles: string[];
  pages: { title: string | null; url: string | null }[];
  products: { title: string | null; url: string | null; image: string | null }[];
  blogConnected: boolean;
};

/**
 * Illustrative-only mockup of a buyer question, built from the detected
 * category — never sent to an AI model. Pairs with aiPreviewAnswer below to
 * show the format of a real AI-assistant answer without inventing one.
 */
function previewCategory(industry: string, locale: string) {
  const raw = (industry || "this").toLowerCase();
  if (locale === "fr" && /home\s*&\s*furniture|furniture|home decor/.test(raw)) return "meubles et décoration";
  return raw;
}

function aiPreviewQuestion(industry: string, locale: string): string {
  const category = previewCategory(industry, locale);
  return locale === "fr" ? `Quel est le meilleur ${category} ?` : `What's the best ${category}?`;
}

/** Uses only real, already-discovered competitor domains — never invented. */
function aiPreviewAnswer(industry: string, competitors: string[], locale: string): string {
  const category = previewCategory(industry || "this category", locale);
  const names = competitors.slice(0, 3).join(", ");
  return locale === "fr"
    ? `Pour ${category}, on cite souvent ${names}. Comparez leurs prix, délais de livraison et gamme de produits.`
    : `For ${category}, well-known options include ${names}. Compare them on pricing, delivery times and range.`;
}

function aiPreviewOutcome(name: string, locale: string) {
  return locale === "fr"
    ? `${name} n’apparaît pas encore dans cette réponse. C’est précisément ce que vos 30 prochains jours de contenu vont changer.`
    : `${name} isn't in that answer yet. That's exactly what your next 30 days of content change.`;
}

export function Onboarding({ userId, onDone }: { userId: string | null; onDone: () => void }) {
  const build = useServerFn(buildPlan);
  const kickstart = useServerFn(kickstartFirstDay);
  const detectBiz = useServerFn(detectBusiness);
  const detectMkt = useServerFn(detectMarket);
  const checkout = useServerFn(createCheckout);
  const fetchSub = useServerFn(getSubscription);
  const syncSub = useServerFn(syncSubscription);
  const loadDraft = useServerFn(getOnboarding);
  const persistDraft = useServerFn(saveOnboarding);
  const persistMarket = useServerFn(saveMarketResearch);
  const syncKnowledge = useServerFn(syncSiteKnowledge);
  const markComplete = useServerFn(completeOnboarding);
  const loadShopify = useServerFn(getShopifyPrefill);
  const [shopContext, setShopContext] = useState<string | null>(null);
  const [shopifyWelcome, setShopifyWelcome] = useState(false);
  const [shopifyReport, setShopifyReport] = useState<ShopifyWelcomeReport | null>(null);
  const [launching, setLaunching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [subActive, setSubActive] = useState<boolean | null>(null);
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [scanning, setScanning] = useState(false);
  const [scanningMarket, setScanningMarket] = useState(false);
  const [lastAnalysedWebsite, setLastAnalysedWebsite] = useState("");
  const [detected, setDetected] = useState<string | null>(null);
  const [market, setMarket] = useState<{
    source: "dataforseo" | "ai";
    competitors: string[];
    keywords: { keyword: string; volume: number | null; difficulty: number | null }[];
    business_profile?: Record<string, unknown> | null;
    error?: string;
  } | null>(null);
  const [step, setStep] = useState(0);
  const [showMoreLanguages, setShowMoreLanguages] = useState(false);
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

  const DRAFT_KEY = "apgeo_onboarding_draft";

  const asList = (v: string, sep: RegExp | string = ",") =>
    v.split(sep as never).map((x: string) => x.trim()).filter(Boolean);

  /** Mirror the wizard into the database so it survives Checkout and reloads. */
  async function saveDraft(atStep: number, values = form, description = detected) {
    if (!userId) return; // no session yet — nothing to persist to until sign-up
    try {
      await persistDraft({
        data: {
          website_url: values.website_url,
          business_name: values.name,
          industry: values.industry,
          target_market: values.audience,
          tone: values.tone,
          language: values.locale,
          keywords: asList(values.keywords),
          competitors: asList(values.competitors, /[\n,]/),
          current_step: atStep,
          ...(description ? { business_description: description } : {}),
        },
      });
    } catch {
      /* never block the wizard on a draft write */
    }
  }

  // Local-only restore: runs once, independent of whether a session exists yet.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as typeof form;
        setForm((f) => ({ ...f, ...saved }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Everything below needs a session — re-runs once sign-up (in step 1)
  // establishes one, since it starts null for a brand-new visitor.
  useEffect(() => {
    if (!userId) return;
    let returned = false;
    if (new URLSearchParams(window.location.search).get("checkout") === "success") {
      returned = true;
      setStep(3);
    }

    // Server draft wins over the local copy: it survives device changes.
    loadDraft()
      .then(({ draft }) => {
        if (!draft) return;
        setForm((f) => ({
          ...f,
          name: draft.business_name || f.name,
          website_url: draft.website_url || f.website_url,
          industry: draft.industry || f.industry,
          audience: draft.target_market || f.audience,
          tone: draft.tone || f.tone,
          locale: draft.language || f.locale,
          keywords: (draft.keywords as string[] | null)?.join(", ") || f.keywords,
          competitors: (draft.competitors as string[] | null)?.join("\n") || f.competitors,
        }));
        if (!returned && typeof draft.current_step === "number") setStep(draft.current_step);
      })
      .catch(() => undefined);

    // Shopify merchants should never retype what the store already knows.
    loadShopify()
      .then((s) => {
        if (!s.connected) return;
        setShopContext(s.shop);
        setShopifyReport(s);
        setShopifyWelcome(true);
        setForm((f) => ({
          ...f,
          name: f.name || s.business_name || "",
          website_url: f.website_url || (s.website_url ? `https://${s.website_url.replace(/^https?:\/\//, "")}` : ""),
          industry: f.industry || s.industry || "",
          locale: s.language || f.locale,
        }));
        setDetected(
          (d) =>
            d ??
            `Shopify store ${s.shop} — ${s.productCount} products${
              s.collectionTitles.length ? `, collections: ${s.collectionTitles.join(", ")}` : ""
            }`,
        );
      })
      .catch(() => undefined);

    // Payment truth comes from our database; only poll Stripe when the
    // webhook has not landed yet.
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < (returned ? 6 : 1); attempt++) {
        if (cancelled) return;
        const s = await fetchSub().catch(() => null);
        if (s?.active) return setSubActive(true);
        if (returned) {
          const synced = await syncSub().catch(() => null);
          if (synced?.active) return setSubActive(true);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      if (!cancelled) setSubActive(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Run the competitor/keyword scan the moment the merchant reaches step 2 —
  // no button to press, it just happens while they read.
  useEffect(() => {
    if (step === 2 && !market && !scanningMarket && form.website_url.trim()) {
      void autodetectMarket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // A website is enough to start: wait until the merchant finishes typing,
  // then reveal the analysis state and continue through the wizard on its own.
  useEffect(() => {
    const website = form.website_url.trim();
    const host = website.replace(/^https?:\/\//, "").split("/")[0] ?? "";
    if (step !== 0 || !website || !host.includes(".") || scanning || website === lastAnalysedWebsite) return;
    const id = window.setTimeout(() => void autodetectBusiness(), 700);
    return () => window.clearTimeout(id);
    // autodetectBusiness is deliberately omitted: it is recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, form.website_url, scanning, lastAnalysedWebsite]);

  async function startCheckout() {
    setBusy(true);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      await saveDraft(3);
      const { url, alreadyActive } = await checkout({
        data: {
          cycle,
          origin: window.location.origin,
          next: "/app",
          shopDomain: shopContext ?? undefined,
        },
      });
      if (alreadyActive || !url) {
        setSubActive(true);
        setBusy(false);
        toast.success("Your subscription is already active.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const canNext =
    step !== 0 || (form.name.trim().length > 1 && (!!userId || (email.trim().length > 3 && password.length >= 6)));

  /** Step 1's Continue also doubles as sign-up for a brand-new visitor —
   * the account is created here, then the rest of the wizard runs signed in. */
  async function continueFromStep0() {
    if (!userId) {
      setSigningUp(true);
      try {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create your account");
        setSigningUp(false);
        return;
      }
      setSigningUp(false);
    }
    setStep((s) => {
      const next = Math.min(3, s + 1);
      void saveDraft(next);
      return next;
    });
  }

  async function autodetectBusiness() {
    if (!form.website_url.trim()) {
      toast.error("Add your website URL first.");
      return false;
    }
    setLastAnalysedWebsite(form.website_url.trim());
    setScanning(true);
    try {
      const d = await detectBiz({ data: { website: form.website_url } });
      const profileKeywords = (form.keywords || d.keywords.join(", "))
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean);
      const nextForm = {
        ...form,
        name: form.name || (d.name ?? ""),
        industry: d.industry ?? form.industry,
        audience: d.audience ?? form.audience,
        tone: d.tone,
        locale: d.locale,
        competitors: form.competitors,
        keywords: profileKeywords.slice(0, 15).join(", "),
      };
      setForm(nextForm);
      setDetected(d.summary);
      toast.success("Website analysed — your profile is ready.");
      // The website analysis completes step 1. Move directly to the editable
      // content profile, then let the merchant confirm before the SEO scan.
      void saveDraft(1, nextForm, d.summary);
      setStep(1);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that website");
      return false;
    } finally {
      setScanning(false);
    }
  }

  async function autodetectMarket() {
    if (!form.website_url.trim()) {
      toast.error("Add your website URL in step 1 first.");
      return null;
    }
    setScanningMarket(true);
    try {
      const scanInput = {
        website: form.website_url,
        name: form.name || undefined,
        industry: form.industry || undefined,
        locale: form.locale,
        seeds: form.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
          .slice(0, 10),
      };
      let r = await detectMkt({
        data: {
          ...scanInput,
        },
      });
      if (!r.competitors.length && !r.keywords.length && !r.error) {
        toast.message("No usable SEO data on the first pass. Retrying live data once…");
        r = await detectMkt({ data: { ...scanInput, retry: true } });
      }
      setMarket(r);
      // Live DataForSEO keywords take priority over the AI-detected ones,
      // which are only kept as a tail so a wrong industry guess can't drive
      // the 30-day calendar.
      setForm((f) => {
        const aiKeywords = f.keywords.split(",").map((k) => k.trim()).filter(Boolean);
        const dfsKeywords = r.keywords.slice(0, 15).map((k) => k.keyword);
        const merged = Array.from(
          new Map([...dfsKeywords, ...aiKeywords].map((k) => [k.toLowerCase(), k])).values(),
        ).slice(0, 15);
        return {
          ...f,
          competitors: f.competitors.trim() ? f.competitors : r.competitors.join("\n"),
          keywords: merged.join(", "),
        };
      });
      if (r.error) toast.error(r.error);
      else toast.success(`Live SEO data: ${r.competitors.length} rivals, ${r.keywords.length} keywords.`);
      return r;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Market scan failed");
      return null;
    } finally {
      setScanningMarket(false);
    }
  }

  async function submit() {
    if (!userId) {
      toast.error("Please finish creating your account first.");
      return;
    }
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
          business_profile: (market?.business_profile ?? null) as never,
        })
        .select()
        .single();
      if (error) throw error;

      const rivals = form.competitors
        .split(/[\n,]/)
        .map((c) => c.trim())
        .filter(Boolean)
        .map((domain) => domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));

      // Carry over the live volume/difficulty the market scan already found so
      // the dashboard opens with real numbers instead of re-scanning (and
      // re-billing DataForSEO) from a blank slate.
      const marketByKeyword = new Map(
        (market?.keywords ?? []).map((k) => [k.keyword.toLowerCase(), k]),
      );
      const keywordsForResearch = form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .map((keyword) => {
          const m = marketByKeyword.get(keyword.toLowerCase());
          return { keyword, volume: m?.volume ?? null, difficulty: m?.difficulty ?? null };
        });
      if (rivals.length || keywordsForResearch.length) {
        await persistMarket({
          data: { projectId: data.id, competitors: rivals, keywords: keywordsForResearch },
        }).catch(() => undefined);
      }

      // Crawls the site in the background — never blocks setup on it, it can
      // take a while on a large catalogue and isn't needed for day 1.
      if (form.website_url.trim()) {
        void syncKnowledge({ data: { projectId: data.id } }).catch(() => undefined);
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
      localStorage.removeItem(DRAFT_KEY);
      await markComplete({ data: { projectId: data.id } }).catch(() => undefined);
      setLaunching(true);
      await new Promise((resolve) => window.setTimeout(resolve, 2200));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  const active = STEPS[step]!;

  if (shopifyWelcome && shopifyReport) {
    const displayDomain = (shopifyReport.website_url || shopifyReport.shop).replace(/^https?:\/\//, "").replace(/\/$/, "");
    const previews = [
      ...shopifyReport.products.slice(0, 3).map((item) => ({ ...item, kind: "Product", icon: Package })),
      ...shopifyReport.collectionTitles.slice(0, 2).map((title) => ({ title, url: null, image: null, kind: "Collection", icon: Layers3 })),
      ...shopifyReport.pages.slice(0, 2).map((item) => ({ ...item, image: null, kind: "Page", icon: FileText })),
    ].slice(0, 7);
    return (
      <div className="paper-grid min-h-screen px-4 py-10">
        <div className="mx-auto w-full max-w-5xl">
          <div className="relative flex justify-center">
            <BrandLockup />
            <Button type="button" variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }} className="absolute right-0 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground hover:text-foreground">
              <LogOut className="mr-1.5 size-3.5" /> Sign out
            </Button>
          </div>
          <section className="surface mt-7 overflow-hidden">
            <div className="relative overflow-hidden bg-deep px-7 py-9 text-background sm:px-10">
              <motion.div aria-hidden className="absolute -right-10 -top-20 size-72 rounded-full bg-gold/25 blur-3xl" animate={{ scale: [1, 1.15, 1], opacity: [0.35, 0.7, 0.35] }} transition={{ duration: 6, repeat: Infinity }} />
              <div className="relative max-w-2xl">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Shopify store synced</p>
                <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">Welcome, {shopifyReport.business_name || "your store"}.</h1>
                <p className="mt-3 text-sm leading-6 text-background/70">Your Shopify data is securely connected. Here is the content foundation Ranki will use to build your GEO autopilot.</p>
                <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-background/15 bg-background/10 px-3 py-1.5 text-sm font-medium">
                  <Globe2 className="size-4 text-gold" /> {displayDomain}
                </div>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Products", value: shopifyReport.productCount, icon: Package },
                  { label: "Collections", value: shopifyReport.collectionTitles.length, icon: Layers3 },
                  { label: "Store pages", value: shopifyReport.pages.length, icon: FileText },
                  { label: "Blog", value: shopifyReport.blogConnected ? "Connected" : "Not connected", icon: BookOpen },
                ].map((stat) => <div key={stat.label} className="rounded-2xl border border-border bg-muted/30 p-4"><stat.icon className="size-4 text-primary" /><p className="mt-3 text-2xl font-bold">{stat.value}</p><p className="mt-0.5 text-xs text-muted-foreground">{stat.label}</p></div>)}
              </div>

              <div className="mt-8 flex items-end justify-between gap-4">
                <div><p className="font-display text-xl font-bold">Your connected content</p><p className="mt-1 text-sm text-muted-foreground">Real Shopify products, collections and pages — ready for internal linking.</p></div>
                <span className="hidden rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success sm:block">Sync complete</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {previews.map((item, index) => {
                  const Icon = item.icon;
                  return <article key={`${item.kind}-${item.title}-${index}`} className="group overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-muted to-gold/15">
                      {item.image ? <img src={item.image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" /> : <Icon className="size-7 text-primary/60" />}
                      <span className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">{item.kind}</span>
                    </div>
                    <div className="p-3"><p className="truncate text-sm font-semibold">{item.title || "Untitled"}</p><p className="mt-1 text-xs text-muted-foreground">Available for GEO content</p></div>
                  </article>;
                })}
              </div>
              <div className="mt-8 flex flex-col justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
                <p className="max-w-xl text-sm leading-6 text-muted-foreground">Next, confirm your writing profile. We then map the queries and competitors that matter for {shopifyReport.business_name || "your store"}.</p>
                <Button type="button" size="lg" onClick={() => { setShopifyWelcome(false); setStep(1); void saveDraft(1); }} className="bg-deep text-background hover:bg-deep/90">Start your onboarding <ArrowRight className="ml-2 size-4" /></Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="paper-grid min-h-screen px-4 py-10">
      <AnimatePresence>
        {launching && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-deep/95 px-4 text-background backdrop-blur-md">
            <motion.section initial={{ y: 18, scale: 0.96 }} animate={{ y: 0, scale: 1 }} className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-background/15 bg-background/10 p-8 text-center shadow-2xl sm:p-12">
              <motion.div aria-hidden className="absolute left-1/2 top-0 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/30 blur-3xl" animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <div className="relative">
                <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-xl shadow-gold/30"><Rocket className="size-8" /></div>
                <p className="mt-7 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Autopilot launched</p>
                <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">Your 30-day GEO engine is live.</h2>
                <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-background/70">We’re generating optimized content designed to be discovered in AI Search, ChatGPT, Gemini and Google — with your products and pages linked naturally.</p>
                <div className="mt-7 flex flex-wrap justify-center gap-2">{["AI Search", "ChatGPT", "Gemini", "Google"].map((channel) => <span key={channel} className="rounded-full border border-background/15 bg-background/10 px-3 py-1.5 text-xs font-semibold">{channel}</span>)}</div>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mx-auto w-full max-w-5xl">
        <div className="relative flex justify-center">
          <BrandLockup />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              localStorage.removeItem(DRAFT_KEY);
              await supabase.auth.signOut();
              window.location.assign("/");
            }}
            className="absolute right-0 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-1.5 size-3.5" /> Sign out
          </Button>
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
                Setup · {step + 1}/4
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
                  animate={{ width: `${((step + 1) / 4) * 100}%` }}
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

                {step === 0 && scanning && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative mt-6 overflow-hidden rounded-3xl border border-primary/15 bg-[#f7f6ff] px-6 py-8 shadow-[0_20px_60px_-30px_rgba(35,35,105,0.4)] sm:px-9 sm:py-10"
                  >
                    <motion.div
                      aria-hidden
                      className="pointer-events-none absolute -right-14 -top-14 size-64 rounded-full bg-primary/15 blur-3xl"
                      animate={{ scale: [1, 1.16, 1], opacity: [0.3, 0.75, 0.3] }}
                      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    />
                    <div className="relative mx-auto max-w-md text-center">
                      <span className="mx-auto flex size-16 items-center justify-center rounded-[22px] bg-deep text-gold shadow-lg shadow-primary/25">
                        <Sparkles className="size-6 animate-pulse" />
                      </span>
                      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-gold">AI analysis in progress</p>
                      <h2 className="mt-2 font-display text-2xl font-bold">We’re analysing your business…</h2>
                      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                        We’re turning what makes {form.name || "your brand"} unique into a content plan made for your audience.
                      </p>
                      <div className="mt-7 rounded-2xl border border-primary/10 bg-background/80 p-2 text-left shadow-sm">
                        {BUSINESS_ANALYSIS_STAGES.map((item, index) => (
                          <motion.div
                            key={item.label}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: [0.5, 1, 0.7], x: 0 }}
                            transition={{ duration: 2.8, repeat: Infinity, delay: index * 0.45 }}
                            className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-[12.5px] font-medium text-foreground"
                          >
                            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><item.icon className="size-3.5" /></span>
                            {item.label}
                            <span className="ml-auto flex gap-0.5"><i className="size-1 rounded-full bg-gold animate-pulse" /><i className="size-1 rounded-full bg-gold animate-pulse [animation-delay:150ms]" /><i className="size-1 rounded-full bg-gold animate-pulse [animation-delay:300ms]" /></span>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 0 && !scanning && (
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label htmlFor="name" className="text-[12.5px]">Business name</Label>
                      <Input id="name" required value={form.name} onChange={set("name")} className="mt-1.5" placeholder="Acme Studio" />
                    </div>
                    {!userId && (
                      <div className="sm:col-span-2 grid gap-3 rounded-2xl border border-border bg-secondary/25 p-4 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="signup-email" className="text-[12.5px]">Email</Label>
                          <Input
                            id="signup-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="mt-1.5"
                            placeholder="you@company.com"
                          />
                        </div>
                        <div>
                          <Label htmlFor="signup-password" className="text-[12.5px]">Password</Label>
                          <Input
                            id="signup-password"
                            type="password"
                            required
                            minLength={6}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="mt-1.5"
                            placeholder="••••••••"
                          />
                        </div>
                        <p className="text-[11.5px] text-muted-foreground sm:col-span-2">
                          Creates your Ranki account — no separate sign-up step.{" "}
                          <a href="/auth" className="underline underline-offset-2 hover:text-foreground">
                            Already have an account?
                          </a>
                        </p>
                      </div>
                    )}
                    <div className="sm:col-span-2 rounded-2xl border border-primary/15 bg-primary/[0.025] p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="url" className="text-[12.5px] font-semibold">Website</Label>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold-soft/60 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.1em] text-foreground/80">
                          <Sparkles className="size-3 text-gold" /> Autopilot starts here
                        </span>
                      </div>
                      <div className="relative mt-2">
                        <Globe2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary/70" />
                        <Input
                          id="url"
                          value={form.website_url}
                          onChange={set("website_url")}
                          placeholder="sweet-deco.fr"
                          className="h-11 border-primary/20 bg-background pl-9 shadow-sm focus-visible:ring-gold/50"
                        />
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <Wand2 className="size-3.5 text-gold" />
                        {form.website_url.trim()
                          ? "Your website will be analysed automatically in a moment."
                          : "Enter your site and we’ll find your positioning, audience and keyword opportunities."}
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
                    {false && <>
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
                    <div className="rounded-2xl border border-border bg-secondary/25 p-3.5 sm:col-span-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <Label htmlFor="locale" className="text-[12.5px] font-semibold">Content language</Label>
                        <span className="text-[10.5px] text-muted-foreground">Choose how Ranki writes</span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {LANGUAGES.map((l) => (
                          <button
                            key={l.code}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, locale: l.code }))}
                            title={l.label}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition ${
                              form.locale === l.code
                                ? "border-primary bg-background text-foreground shadow-sm ring-1 ring-primary/30"
                                : "border-border bg-background/70 text-muted-foreground hover:border-primary/40 hover:bg-background"
                            }`}
                          >
                            <img
                              src={`https://flagcdn.com/24x18/${l.countryCode}.png`}
                              alt=""
                              width={16}
                              height={12}
                              className="h-3 w-4 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(15,23,42,0.12)]"
                            />
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
                    </>}
                  </div>
                )}

                {step === 1 && (
                  <div className="mt-6 space-y-5">
                    <div className="relative overflow-hidden rounded-2xl bg-deep p-6 text-background">
                      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-44 rounded-full bg-gold/25 blur-3xl" />
                      <div className="relative flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-[11px] bg-gold/20 text-gold">
                          <Sparkles className="size-4" />
                        </span>
                        <div>
                          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold">Writing brief</p>
                          <p className="mt-1 font-display text-lg font-semibold">Your AI writing brief</p>
                          <p className="mt-1 text-[12.5px] text-background/65">Fine-tune what Ranki learned before the live SEO scan.</p>
                        </div>
                      </div>
                    </div>

                    <div className="surface grid gap-5 p-5 sm:grid-cols-2">
                      <div className="border-l-2 border-gold pl-3">
                        <Label htmlFor="profile-industry" className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Industry</Label>
                        <select id="profile-industry" value={form.industry} onChange={set("industry")} className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="">Select an industry…</option>
                          {INDUSTRY_GROUPS.map((g) => (
                            <optgroup key={g.group} label={g.group}>
                              {g.items.map((i) => <option key={i} value={i}>{i}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="border-l-2 border-primary pl-3">
                        <Label className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Content language</Label>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {LANGUAGES.slice(0, showMoreLanguages ? LANGUAGES.length : 7).map((l) => (
                            <button key={l.code} type="button" onClick={() => setForm((f) => ({ ...f, locale: l.code }))} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition ${form.locale === l.code ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-background hover:border-primary/40"}`}>
                              <img src={`https://flagcdn.com/24x18/${l.countryCode}.png`} alt="" width={16} height={12} className="h-3 w-4 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(15,23,42,0.12)]" />
                              {l.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setShowMoreLanguages((shown) => !shown)}
                            aria-expanded={showMoreLanguages}
                            className="flex size-[34px] items-center justify-center rounded-lg border border-dashed border-primary/40 bg-primary/5 text-primary transition hover:bg-primary/10"
                            title={showMoreLanguages ? "Show fewer languages" : "More languages"}
                          >
                            <Plus className={`size-4 transition-transform ${showMoreLanguages ? "rotate-45" : ""}`} />
                          </button>
                        </div>
                      </div>
                      <div className="border-t border-border pt-5 sm:col-span-2">
                        <Label className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Editorial tone</Label>
                        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {TONES.map((t) => (
                            <button key={t.id} type="button" onClick={() => setForm((f) => ({ ...f, tone: t.id }))} className={`rounded-xl border px-3 py-2.5 text-left transition ${form.tone === t.id ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40"}`}>
                              <span className="block text-[12.5px] font-semibold">{t.label}</span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">{t.hint}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="sm:col-span-2">
                        <Label htmlFor="profile-audience" className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Who are we writing for?</Label>
                        <Textarea id="profile-audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={3} placeholder="Businesses seeking AI-powered automation and data insights." />
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-6 space-y-5">
                    {scanningMarket && (
                      <div className="relative overflow-hidden rounded-2xl bg-deep px-5 py-4 text-background">
                        <motion.div
                          aria-hidden
                          className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-gold/30 to-transparent blur-xl"
                          animate={{ x: ["-120%", "260%"] }}
                          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
                        />
                        <div className="relative flex items-center gap-3">
                          <span className="flex size-9 items-center justify-center rounded-xl bg-background/10 text-gold">
                            <Radar className="size-4 animate-pulse" />
                          </span>
                          <div>
                            <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold">Live DataForSEO</p>
                            <p className="mt-0.5 text-[13px] font-semibold">Mapping your real search market…</p>
                          </div>
                          <Loader2 className="ml-auto size-4 animate-spin text-background/60" />
                        </div>
                      </div>
                    )}

                    {!scanningMarket && market && !market.error && (
                      <div className="surface flex items-center gap-3 px-4 py-3 text-[12.5px] font-medium text-foreground">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="size-3.5" />
                        </span>
                        Scan complete — {market.competitors.length} competitors,{" "}
                        {market.keywords.length} keywords found.
                      </div>
                    )}

                    {!scanningMarket && market?.error && (
                      <div className="surface flex flex-wrap items-center gap-3 border-gold/30 bg-gold-soft/40 px-4 py-3 text-[12.5px] text-foreground">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold-foreground">
                          <Radar className="size-3.5" />
                        </span>
                        <p className="min-w-0 flex-1 leading-relaxed">{market.error}</p>
                        <Button type="button" size="sm" variant="outline" onClick={() => void autodetectMarket()}>
                          <RefreshCw className="mr-1.5 size-3.5" /> Retry scan
                        </Button>
                      </div>
                    )}

                    {!scanningMarket && !market && !form.website_url.trim() && (
                      <p className="rounded-xl border border-gold/30 bg-gold-soft/50 px-4 py-3 text-[12.5px] leading-relaxed text-foreground/80">
                        Add your website in step 1 so we can scan it automatically — or type your competitors
                        and keywords by hand below.
                      </p>
                    )}

                    {market && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="surface relative overflow-hidden p-5 pl-6">
                          <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-gold" />
                          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                            Competitors found
                          </p>
                          <div className="mt-3 divide-y divide-border border-t border-border">
                            {market.competitors.slice(0, 5).map((d, index) => (
                              <div key={d} className="flex items-center gap-2.5 py-2.5 text-[13px] font-medium">
                                <span className="w-5 font-mono text-[10.5px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                                <span className="size-1.5 rounded-full bg-gold" />
                                <span className="truncate">{d}</span>
                              </div>
                            ))}
                            {!market.competitors.length && (
                              <span className="text-[11.5px] text-muted-foreground">None found.</span>
                            )}
                          </div>
                        </div>
                        <div className="surface relative overflow-hidden p-5 pl-6">
                          <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-primary" />
                          <p className="flex items-center justify-between font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                            Keyword opportunities
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal ${
                                market.source === "dataforseo"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-gold-soft text-foreground/70"
                              }`}
                            >
                              {market.source === "dataforseo" ? "Live DataForSEO" : "AI estimate"}
                            </span>
                          </p>
                          <div className="mt-3 divide-y divide-border border-t border-border">
                            {market.keywords.slice(0, 5).map((k, index) => (
                              <div key={k.keyword} className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-2 py-2.5 text-[12.5px]">
                                <span className="font-mono text-[10.5px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                                <span className="truncate font-medium">{k.keyword}</span>
                                <span className="font-mono text-[11px] text-muted-foreground">{k.volume != null ? `${k.volume}/mo` : "—"}</span>
                                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${k.difficulty == null ? "bg-muted text-muted-foreground" : k.difficulty < 34 ? "bg-success-soft text-success" : k.difficulty < 67 ? "bg-gold/20 text-gold-foreground" : "bg-destructive/10 text-destructive"}`}>{k.difficulty ?? "—"}</span>
                              </div>
                            ))}
                            {!market.keywords.length && (
                              <span className="text-[11.5px] text-muted-foreground">None found.</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {market && market.competitors.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative overflow-hidden rounded-2xl bg-deep px-6 py-6 text-background"
                      >
                        <motion.div
                          aria-hidden
                          className="pointer-events-none absolute -right-12 -top-12 size-56 rounded-full bg-gold/25 blur-3xl"
                          animate={{ scale: [1, 1.15, 1] }}
                          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <div className="relative flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#10a37f] shadow-sm"><Bot className="size-4" /></span>
                            <div><p className="text-[13px] font-semibold text-white">ChatGPT</p><p className="text-[10px] text-background/55">Buyer-search preview</p></div>
                          </div>
                          <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gold">Illustrative</span>
                        </div>
                        <p className="relative mt-4 text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
                          This is what buyers see today
                        </p>
                        <p className="relative mt-1 text-[12px] text-background/60">
                          Illustrative example, built from your own market scan — not a live AI query.
                        </p>
                        <div className="relative mt-4 space-y-2.5">
                          <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-background/10 px-3.5 py-2.5 text-[12.5px]">
                            {aiPreviewQuestion(form.industry, form.locale)}
                          </div>
                          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-background/95 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-deep">
                            {aiPreviewAnswer(form.industry, market.competitors, form.locale)}
                          </div>
                        </div>
                        <div className="relative mt-4 flex items-center gap-2 rounded-xl border border-background/15 bg-background/5 px-3 py-2 text-[11.5px] text-background/45">
                          <Bot className="size-3.5 text-[#74d7bb]" /> Ask ChatGPT anything…
                          <span className="ml-auto flex size-5 items-center justify-center rounded-md bg-background/10 text-background/60">↑</span>
                        </div>
                        <p className="relative mt-4 text-[12px] leading-relaxed text-background/70">
                          <strong className="font-semibold text-gold">{aiPreviewOutcome(form.name || (form.locale === "fr" ? "Votre entreprise" : "Your business"), form.locale)}</strong>
                        </p>
                      </motion.div>
                    )}

                    <details className="group rounded-xl border border-border">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12.5px] font-semibold text-foreground marker:hidden">
                        Edit the list by hand
                        <ArrowRight className="size-3.5 transition group-open:rotate-90" />
                      </summary>
                      <div className="space-y-4 border-t border-border p-4">
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
                      </div>
                    </details>
                  </div>
                )}

                {step === 3 && (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      {FORMATS.map((f, i) => {
                        const styles = [
                          { icon: Sparkles, tint: "bg-primary/10 text-primary", line: "bg-primary", badge: "bg-primary text-primary-foreground" },
                          { icon: Globe2, tint: "bg-sky-500/10 text-sky-700", line: "bg-sky-500", badge: "bg-sky-600 text-white" },
                          { icon: Bot, tint: "bg-gold/20 text-gold-foreground", line: "bg-gold", badge: "bg-gold text-gold-foreground" },
                          { icon: Radar, tint: "bg-emerald-500/10 text-emerald-700", line: "bg-emerald-500", badge: "bg-emerald-600 text-white" },
                          { icon: Package, tint: "bg-rose-500/10 text-rose-700", line: "bg-rose-500", badge: "bg-rose-600 text-white" },
                        ][i]!;
                        const Icon = styles.icon;
                        return (
                          <motion.div key={f.code} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i }} whileHover={{ y: -3 }} className="group relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                            <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${styles.line}`} />
                            <div className="flex items-start justify-between gap-2">
                              <span className={`flex size-9 items-center justify-center rounded-xl ${styles.tint}`}><Icon className="size-4" /></span>
                              <span className={`rounded-md px-2 py-1 font-mono text-[10px] font-bold tracking-[0.08em] ${styles.badge}`}>{f.code}</span>
                            </div>
                            <p className="mt-4 text-[12px] font-semibold leading-snug text-foreground">{f.desc}</p>
                            <p className="mt-1 text-[10.5px] text-muted-foreground">Included in your 30-day mix</p>
                          </motion.div>
                        );
                      })}
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

                    {subActive === false && (
                      <div className="rounded-2xl border border-gold/40 bg-gold-soft/40 p-5">
                        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                          <ShieldCheck className="size-4 text-gold" /> Activate your plan to launch
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                          The autopilot writes, illustrates and publishes daily. Pick a billing cycle —
                          you can enter a promo code on the secure checkout page.
                        </p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          {([
                            { id: "monthly", price: "$9.99", per: "/month", note: "Cancel anytime" },
                            { id: "annual", price: "$7.99", per: "/month", note: "Billed yearly · save 20%" },
                          ] as const).map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setCycle(p.id)}
                              className={`rounded-xl border p-4 text-left transition ${
                                cycle === p.id
                                  ? "border-gold bg-background shadow-sm"
                                  : "border-border bg-background/60 hover:border-gold/50"
                              }`}
                            >
                              <div className="flex items-baseline gap-1">
                                <span className="text-xl font-bold text-foreground">{p.price}</span>
                                <span className="text-[12px] text-muted-foreground">{p.per}</span>
                              </div>
                              <p className="mt-1 text-[11.5px] text-muted-foreground">{p.note}</p>
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                          <Tag className="size-3.5 text-gold" /> Got a promo code? Apply it at checkout.
                        </p>
                      </div>
                    )}
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

              {step < 3 ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (step === 0) {
                      void continueFromStep0();
                      return;
                    }
                    setStep((s) => {
                      const next = Math.min(3, s + 1);
                      void saveDraft(next);
                      return next;
                    });
                  }}
                  disabled={!canNext || scanning || signingUp || (step === 1 && scanningMarket)}
                  className="bg-deep text-background hover:bg-deep/90"
                >
                  {signingUp
                    ? "Creating your account…"
                    : step === 1 && scanningMarket
                      ? "Finishing your market scan…"
                      : step === 0
                      ? detected
                        ? "Continue"
                        : "Continue without analysis"
                      : "Continue"}{" "}
                  <ArrowRight className="ml-1.5 size-4" />
                </Button>
              ) : subActive === false ? (
                <Button
                  type="button"
                  onClick={startCheckout}
                  disabled={busy}
                  className="bg-deep text-background hover:bg-deep/90"
                >
                  {busy ? "Opening checkout…" : "Subscribe & launch"}
                  <Rocket className="ml-1.5 size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={submit}
                  disabled={busy || subActive === null}
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
