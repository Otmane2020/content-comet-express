import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, Bot, Building2, CalendarDays, Check, Globe2, Loader as Loader2, LogOut, Package, Plus, Radar, RefreshCw, Rocket, Send, Sparkles, ShieldCheck, Tag, Wand as Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildPlan, kickstartFirstDay } from "@/lib/autopilot.functions";
import { createCheckout, getSubscription, syncSubscription } from "@/lib/billing.functions";
import { startShopifyBilling } from "@/lib/shopify.functions";
import { runPipelineDiagnosticBatch } from "@/lib/diagnostics.functions";
import {
  completeOnboarding,
  getOnboarding,
  getShopifyPrefill,
  saveMarketResearch,
  saveOnboarding,
} from "@/lib/onboarding.functions";
import { syncSiteKnowledge } from "@/lib/sitecrawl.functions";
import { INDUSTRY_GROUPS, LANGUAGES } from "@/lib/industries";
import { isShoppingEligible } from "@/lib/geo";
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

/**
 * A merchant setting up their store has no "retry" button and shouldn't need
 * one — a cold start or a slow DataForSEO/AI call timing out is transient,
 * not a real failure, and onboarding is the one place we can't ask a
 * customer to read a stack trace and try again themselves. Retries ONLY on
 * the specific shapes a transient failure actually takes (a timed-out fetch,
 * a JSON parse choking on an HTML error/cold-start page, a network drop) —
 * never on a real thrown business error, which must still surface to the
 * merchant immediately rather than silently re-running (and re-billing) the
 * call that already correctly failed.
 */
function isTransientFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error instanceof SyntaxError ||
    /unexpected token|aborted due to timeout|failed to fetch|network ?error|fetch failed|timed? ?out/i.test(message)
  );
}

async function withTransientRetry<T>(run: () => Promise<T>, attempts = 2, delayMs = 3000): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientFailure(error)) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// The most-targeted markets for SEO/GEO research: every country a supported
// content language defaults to (industries.ts's LANGUAGES), plus the other
// large e-commerce economies merchants commonly target directly.
const MARKET_COUNTRIES = [
  { value: "France", flag: "fr" },
  { value: "United States", flag: "us" },
  { value: "United Kingdom", flag: "gb" },
  { value: "Canada", flag: "ca" },
  { value: "Belgium", flag: "be" },
  { value: "Switzerland", flag: "ch" },
  { value: "Spain", flag: "es" },
  { value: "Germany", flag: "de" },
  { value: "Italy", flag: "it" },
  { value: "Netherlands", flag: "nl" },
  { value: "Portugal", flag: "pt" },
  { value: "Austria", flag: "at" },
  { value: "Ireland", flag: "ie" },
  { value: "Poland", flag: "pl" },
  { value: "Sweden", flag: "se" },
  { value: "Norway", flag: "no" },
  { value: "Denmark", flag: "dk" },
  { value: "Finland", flag: "fi" },
  { value: "Romania", flag: "ro" },
  { value: "Turkey", flag: "tr" },
  { value: "Australia", flag: "au" },
  { value: "Japan", flag: "jp" },
  { value: "South Korea", flag: "kr" },
  { value: "Brazil", flag: "br" },
  { value: "Mexico", flag: "mx" },
  { value: "India", flag: "in" },
  { value: "United Arab Emirates", flag: "ae" },
  { value: "Saudi Arabia", flag: "sa" },
];

function normalizeMarketCountry(country: string | null | undefined) {
  const raw = country?.trim() ?? "";
  if (!raw) return "";
  const code = raw.toLowerCase();
  const fromCode: Record<string, string> = {
    fr: "France", us: "United States", gb: "United Kingdom", uk: "United Kingdom",
    ca: "Canada", be: "Belgium", ch: "Switzerland", es: "Spain", de: "Germany",
    it: "Italy", nl: "Netherlands", pt: "Portugal", at: "Austria", ie: "Ireland",
    pl: "Poland", se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland",
    ro: "Romania", tr: "Turkey", au: "Australia", jp: "Japan", kr: "South Korea",
    br: "Brazil", mx: "Mexico", in: "India", ae: "United Arab Emirates", sa: "Saudi Arabia",
  };
  return fromCode[code] ?? raw;
}

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
      "Confirm the industry, language and audience Ranki should use. These settings shape every article before we scan your market.",
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
  country?: string | null;
  productCount: number;
  collectionTitles: string[];
  pages: { title: string | null; url: string | null }[];
  products: { title: string | null; url: string | null; image: string | null }[];
  blogConnected: boolean;
};

type FirstPostResult = {
  title: string;
  coverUrl: string | null;
  shopify: { published: boolean; url: string | null; error: string | null } | null;
};

/**
 * Illustrative-only mockup of a buyer question — never sent to an AI model.
 * Pairs with aiPreviewAnswer below to show the shape of a real AI-assistant
 * answer without inventing one.
 *
 * The category comes from the merchant's own words. `business_profile` is built
 * by the AI from their site, so it is already in their language; the English
 * `industry` label is only the last resort. Translating that label instead
 * meant one hardcoded French string for furniture and raw English for every
 * other trade ("Quel est le meilleur fashion & apparel ?").
 */
function previewCategory(
  industry: string,
  locale: string,
  profile?: Record<string, unknown> | null,
): string {
  const products = Array.isArray(profile?.["products"]) ? (profile["products"] as unknown[]) : [];
  const own = products.find((p): p is string => typeof p === "string" && p.trim().length > 2);
  if (own) return own.trim().toLowerCase();
  const services = Array.isArray(profile?.["services"]) ? (profile["services"] as unknown[]) : [];
  const service = services.find((s): s is string => typeof s === "string" && s.trim().length > 2);
  if (service) return service.trim().toLowerCase();
  const label = industry.trim().toLowerCase();
  if (label) return label;
  return locale === "fr" ? "ce type de produit" : "this category";
}

/**
 * "Which site is best to buy X" and "compare delivery times" are e-commerce
 * framing: correct for a furniture wholesaler, nonsensical for a SaaS —
 * Ranki.ai itself rendered as "Which site is best to buy seo & geo software?
 * Compare them on pricing, delivery times and range." Nobody "buys a
 * software from a site" or checks its "delivery time". The two framings
 * share nothing but the category noun.
 *
 * Reuses isShoppingEligible (geo.ts) — the same "does this business have a
 * real catalogue" question already answered for calendar format eligibility
 * this session, tested against 10 fixtures — instead of a second, ad-hoc
 * sales_model string list. That old list treated `sales_model: "marketplace"`
 * as inherently physical-goods, which is what put "compare their pricing,
 * delivery times and product range" in front of Trust Avis, a marketplace of
 * customer REVIEWS with zero products.
 */
function sellsPhysicalGoods(profile: { sales_model?: string | null; products?: string[] | null; primary_entity?: string | null } | null | undefined): boolean {
  return isShoppingEligible(profile ?? {});
}

function aiPreviewQuestion(category: string, locale: string, profile: { sales_model?: string | null; products?: string[] | null; primary_entity?: string | null } | null | undefined): string {
  if (sellsPhysicalGoods(profile)) {
    // The fixed noun head ("site") carries the agreement, so the category can
    // be plural, feminine or a mass noun without breaking the sentence.
    // Inlining it as `le meilleur ${category}` produced "le meilleur meubles
    // et décoration".
    return locale === "fr"
      ? `Quel est le meilleur site pour acheter ${category} ?`
      : `Which site is best to buy ${category}?`;
  }
  return locale === "fr" ? `Quel est le meilleur outil pour ${category} ?` : `What's the best tool for ${category}?`;
}

/** Uses only real, already-discovered competitor domains — never invented. */
function aiPreviewAnswer(category: string, competitors: string[], locale: string, profile: { sales_model?: string | null; products?: string[] | null; primary_entity?: string | null } | null | undefined): string {
  const names = competitors.slice(0, 3).join(", ");
  if (sellsPhysicalGoods(profile)) {
    return locale === "fr"
      ? `Pour ${category}, on cite souvent ${names}. Comparez leurs prix, délais de livraison et gamme de produits.`
      : `For ${category}, well-known options include ${names}. Compare them on pricing, delivery times and range.`;
  }
  return locale === "fr"
    ? `Pour ${category}, on cite souvent ${names}. Comparez leurs fonctionnalités, tarifs et facilité de mise en place.`
    : `For ${category}, well-known options include ${names}. Compare them on features, pricing and ease of setup.`;
}

function audienceFieldCopy(locale: string) {
  const copies: Record<string, { label: string; placeholder: string }> = {
    fr: { label: "Who are we writing for?", placeholder: "Revendeurs et professionnels du meuble en France" },
    es: { label: "Who are we writing for?", placeholder: "Distribuidores y profesionales del mueble en España" },
    de: { label: "Who are we writing for?", placeholder: "Möbelhändler und Fachleute in Deutschland" },
    it: { label: "Who are we writing for?", placeholder: "Rivenditori e professionisti dell'arredamento in Italia" },
    nl: { label: "Who are we writing for?", placeholder: "Meubelhandelaren en professionals in Nederland" },
    pt: { label: "Who are we writing for?", placeholder: "Revendedores e profissionais de mobiliário em Portugal" },
    en: { label: "Who are we writing for?", placeholder: "Homeowners in London, 35–60" },
  };
  return copies[locale] ?? copies.en;
}

const bareDomain = (value: string) =>
  value.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();

/** The favicon confirms that the scan refers to a real website. A concise
 * initial is used when a storefront has no exposed favicon. */
function WebsiteFavicon({ website, label, className = "" }: { website: string; label: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const domain = bareDomain(website);
  const initial = (label.trim().charAt(0) || domain.charAt(0) || "?").toUpperCase();
  if (!domain || failed) {
    return <span aria-label={`${label} icon`} className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary ${className}`}>{initial}</span>;
  }
  return <img src={`https://${domain}/favicon.ico`} alt="" loading="lazy" onError={() => setFailed(true)} className={`shrink-0 rounded-full border border-border/70 bg-background object-contain p-0.5 ${className}`} />;
}

/**
 * The answer cites domains while this caption names the business, so the check
 * has to run on the domain. Without it the caption claimed the merchant was
 * absent from a sentence that listed them first.
 */
function aiPreviewOutcome(name: string, website: string, competitors: string[], locale: string) {
  const me = bareDomain(website);
  if (me && competitors.slice(0, 3).some((d) => bareDomain(d) === me)) {
    return locale === "fr"
      ? `${name} est déjà cité dans cette réponse. Vos 30 prochains jours de contenu servent à y rester et à gagner des places.`
      : `${name} is already cited in that answer. Your next 30 days of content are about holding that spot and climbing.`;
  }
  return locale === "fr"
    ? `${name} n’apparaît pas encore dans cette réponse. C’est précisément ce que vos 30 prochains jours de contenu vont changer.`
    : `${name} isn't in that answer yet. That's exactly what your next 30 days of content change.`;
}

/**
 * This block renders an illustrative buyer conversation ("Quel est le
 * meilleur site pour acheter tables ?" / the answer / the outcome line) — its
 * chrome has to match, or a French question sits inside an English-labelled
 * card with an English input placeholder, which reads as broken rather than
 * as "the dashboard is in English". Keep this localized even though the rest
 * of the dashboard chrome is not: this card's whole point is to look like a
 * real conversation in the merchant's language.
 */
function previewCopy(locale: string) {
  const fr = locale === "fr";
  return {
    kicker: fr ? "Aperçu des recherches acheteurs" : "Buyer-search preview",
    badge: fr ? "Illustratif" : "Illustrative",
    headline: fr ? "Ce que vos acheteurs voient aujourd’hui" : "This is what buyers see today",
    disclaimer: fr
      ? "Exemple illustratif, construit à partir de votre propre scan de marché — ce n’est pas une requête IA en direct."
      : "Illustrative example, built from your own market scan — not a live AI query.",
    placeholder: fr ? "Poser une question à ChatGPT…" : "Ask ChatGPT anything…",
  };
}

export function Onboarding({ userId, onDone }: { userId: string | null; onDone: () => void }) {
  // TEMPORARY diagnostic — traces whether a repeated market scan comes from a
  // real `step` change, a full remount of this component, or something else
  // entirely (a page navigation would show as a new /app in the HTTP logs
  // instead of any of these). One id per mount makes the two cases
  // distinguishable in the console: same runId + new scan => step genuinely
  // changed; new runId => <Onboarding> was remounted.
  const [runId] = useState(() => Math.random().toString(36).slice(2, 8));
  useEffect(() => {
    console.info("[onboarding] mounted", { runId });
    return () => console.info("[onboarding] unmounted", { runId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const build = useServerFn(buildPlan);
  const kickstart = useServerFn(kickstartFirstDay);
  const runProductionPipelineBatch = useServerFn(runPipelineDiagnosticBatch);
  const checkout = useServerFn(createCheckout);
  const shopifyBilling = useServerFn(startShopifyBilling);
  const fetchSub = useServerFn(getSubscription);
  const syncSub = useServerFn(syncSubscription);
  const loadDraft = useServerFn(getOnboarding);
  const persistDraft = useServerFn(saveOnboarding);
  const persistMarket = useServerFn(saveMarketResearch);
  const syncKnowledge = useServerFn(syncSiteKnowledge);
  const markComplete = useServerFn(completeOnboarding);
  const loadShopify = useServerFn(getShopifyPrefill);
  const [shopContext, setShopContext] = useState<string | null>(null);
  // True once loadShopify() has settled (connected or not) — the wizard must
  // never render before this is known, otherwise a Shopify merchant briefly
  // sees the plain (non-Shopify) wizard and can start typing before the
  // payment gate below has a chance to appear, which read as onboarding
  // starting before payment was even checked.
  const [shopifyChecked, setShopifyChecked] = useState(false);
  const [shopifyReport, setShopifyReport] = useState<ShopifyWelcomeReport | null>(null);
  const [launching, setLaunching] = useState(false);
  const [firstPost, setFirstPost] = useState<FirstPostResult | null>(null);
  const wizardTopRef = useRef<HTMLDivElement | null>(null);
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
  /** Canonical profile from step 1 (sales model, products, audience). It used to
   * be returned by detectBusiness and thrown away, so the market scan rebuilt it
   * from scratch without knowing who the business sells to. */
  const [bizProfile, setBizProfile] = useState<Record<string, unknown> | null>(null);
  // Context produced by landing/profile on the analysis screen. Step 3
  // continues from it instead of running a second, separate market engine.
  const [marketPipelineContext, setMarketPipelineContext] = useState<unknown>(undefined);
  const [market, setMarket] = useState<{
    source: "dataforseo" | "ai";
    competitors: string[];
    keywords: { keyword: string; volume: number | null; difficulty: number | null }[];
    business_profile?: Record<string, unknown> | null;
    error?: string;
  } | null>(null);
  const [step, setStep] = useState(0);
  // TEMPORARY diagnostic — see the "step changed" log above.
  const previousStepRef = useRef<number | null>(null);
  const [showMoreLanguages, setShowMoreLanguages] = useState(false);
  const [form, setForm] = useState({
    name: "",
    website_url: "",
    industry: "",
    audience: "",
    tone: "expert",
    locale: "en",
    country: "",
    keywords: "",
    competitors: "",
  });
  const audienceCopy = audienceFieldCopy(form.locale);

  const DRAFT_KEY = "apgeo_onboarding_draft";
  const MARKET_PIPELINE_VERSION = "validated_pipeline_v1";

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
          country: values.country || undefined,
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
        const hasCurrentMarketPipeline = draft.data_source === MARKET_PIPELINE_VERSION;
        setForm((f) => ({
          ...f,
          name: draft.business_name || f.name,
          website_url: draft.website_url || f.website_url,
          industry: draft.industry || f.industry,
          audience: draft.target_market || f.audience,
          tone: draft.tone || f.tone,
          locale: draft.language || f.locale,
          country: draft.country || f.country,
          // Results produced by the retired detectMarket function must never
          // masquerade as output from the validated /test pipeline.
          keywords: hasCurrentMarketPipeline
            ? ((draft.keywords as string[] | null)?.join(", ") || f.keywords)
            : "",
          competitors: hasCurrentMarketPipeline
            ? ((draft.competitors as string[] | null)?.join("\n") || f.competitors)
            : "",
        }));
        if (!hasCurrentMarketPipeline && (draft.current_step ?? 0) >= 2) {
          console.info("[onboarding] invalidating legacy market cache", {
            previousSource: draft.data_source ?? null,
            nextSource: MARKET_PIPELINE_VERSION,
          });
          setMarket(null);
          setStep(2);
        } else if (!returned && typeof draft.current_step === "number") {
          setStep(draft.current_step);
        }
      })
      .catch(() => undefined);

    // Shopify merchants should never retype what the store already knows.
    loadShopify()
      .then((s) => {
        if (!s.connected) return;
        setShopContext(s.shop);
        setShopifyReport(s);
        setForm((f) => ({
          ...f,
          name: f.name || s.business_name || "",
          website_url: f.website_url || (s.website_url ? `https://${s.website_url.replace(/^https?:\/\//, "")}` : ""),
          industry: f.industry || s.industry || "",
          locale: s.language || f.locale,
          country: f.country || normalizeMarketCountry(s.country),
        }));
        setDetected(
          (d) =>
            d ??
            `Shopify store ${s.shop} — ${s.productCount} products${
              s.collectionTitles.length ? `, collections: ${s.collectionTitles.join(", ")}` : ""
            }`,
        );
      })
      .catch(() => undefined)
      .finally(() => setShopifyChecked(true));

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

  // A confirmed, paid Shopify merchant skips straight past step 0 (manual
  // website entry) since loadShopify() already prefilled it silently — no
  // separate "Store synced / Start your onboarding" interstitial page. Guarded
  // to fire once and only from step 0, so it never overrides a step already
  // restored from a saved draft or a Stripe checkout return.
  const shopifyAdvancedRef = useRef(false);
  useEffect(() => {
    if (shopifyAdvancedRef.current || !shopifyReport || subActive !== true || step !== 0) return;
    shopifyAdvancedRef.current = true;
    setStep(1);
    void saveDraft(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopifyReport, subActive, step]);

  // Run the competitor/keyword scan the moment the merchant reaches step 2 —
  // no button to press, it just happens while they read.
  useEffect(() => {
    // TEMPORARY diagnostic, same runId as the mount log above.
    console.info("[onboarding] step changed", { runId, previousStep: previousStepRef.current, step });
    previousStepRef.current = step;
    if (step === 2 && !market && !scanningMarket && form.website_url.trim()) {
      console.info("[onboarding] market scan started", { runId, step });
      void autodetectMarket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // The wizard can advance itself after an analysis finishes. Scroll both the
  // document and the visible onboarding anchor: this also works inside the
  // Shopify Admin iframe, where the scroll container is not always `window`.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      wizardTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step, shopifyChecked, subActive]);

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
      if (shopContext) {
        const { url, alreadyActive } = await shopifyBilling({ data: { cycle, origin: window.location.origin } });
        if (alreadyActive || !url) {
          setSubActive(true);
          setBusy(false);
          return;
        }
        // Shopify's approval screen must be opened by the top Admin frame,
        // never as a Stripe page or as a page inside the embedded iframe.
        if (window.top !== window.self) window.open(url, "_top");
        else window.location.assign(url);
        return;
      }
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
  const waitingForMarketScan =
    step === 2 && Boolean(form.website_url.trim()) && (!market || scanningMarket || Boolean(market.error));

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
    const website = form.website_url.trim();
    setLastAnalysedWebsite(website);
    setScanning(true);
    try {
      let context: unknown = undefined;
      // Run the complete validated /test pipeline behind ONE waiting screen.
      // The merchant should not finish a business analysis and immediately
      // encounter a second market-analysis loader for the same scan.
      for (const batch of ["landing", "profile", "keywords", "serp", "rivals"] as const) {
        const result = await runProductionPipelineBatch({
          data: { website, batch, context },
        }) as {
          stage: { ok: boolean; error: string | null };
          context: unknown;
        };
        if (!result.stage.ok) throw new Error(result.stage.error || `Business pipeline failed at ${batch}`);
        context = result.context;
      }
      setMarketPipelineContext(context);
      const pipeline = context as {
        profile?: Record<string, unknown>;
        site?: { landing?: { lang?: string | null; description?: string | null } };
        qualified?: Array<{ keyword: string; search_volume?: number | null; difficulty?: number | null }>;
        competitors?: Array<{ domain?: string }>;
      };
      const profile = pipeline.profile ?? {};
      const completedMarket = {
        source: "dataforseo" as const,
        competitors: (pipeline.competitors ?? [])
          .map((competitor) => competitor.domain?.trim() ?? "")
          .filter(Boolean)
          .slice(0, 8),
        keywords: (pipeline.qualified ?? [])
          .map((keyword) => ({
            keyword: keyword.keyword,
            volume: keyword.search_volume ?? null,
            difficulty: keyword.difficulty ?? null,
          }))
          .slice(0, 15),
        business_profile: profile,
      };
      const nextForm = {
        ...form,
        name: form.name || String(profile["name"] ?? ""),
        industry: String(profile["industry"] ?? form.industry ?? ""),
        audience: String(profile["audience"] ?? form.audience ?? ""),
        tone: form.tone,
        locale: String(pipeline.site?.landing?.lang ?? form.locale ?? "en").slice(0, 2).toLowerCase(),
        competitors: completedMarket.competitors.join("\n"),
        keywords: completedMarket.keywords.map((keyword) => keyword.keyword).join(", "),
      };
      const summary = String(profile["canonical"] ?? profile["description"] ?? pipeline.site?.landing?.description ?? "");
      setForm(nextForm);
      setMarket(completedMarket);
      setBizProfile(profile);
      setDetected(summary || null);
      toast.success("Website analysed — your validated profile is ready.");
      void saveDraft(1, nextForm, summary || null);
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
      // Production onboarding deliberately runs the exact same validated
      // batches as /test. /test is only the UI harness; this shared server
      // pipeline is the source of truth for both Stripe and Shopify merchants.
      // Keeping the context between calls also avoids one long server request
      // timing out after paid DataForSEO work has already completed.
      const canResumeValidatedContext =
        Boolean(marketPipelineContext) &&
        (marketPipelineContext as { website?: string }).website === form.website_url.trim();
      const batches = canResumeValidatedContext
        ? (["keywords", "serp", "rivals"] as const)
        : (["landing", "profile", "keywords", "serp", "rivals"] as const);
      let context: unknown = canResumeValidatedContext ? marketPipelineContext : undefined;
      for (const batch of batches) {
        const result = await runProductionPipelineBatch({
          data: { website: form.website_url.trim(), batch, context },
        }) as {
          stage: { ok: boolean; error: string | null };
          context: unknown;
        };
        if (!result.stage.ok) {
          throw new Error(result.stage.error || `Market pipeline failed at ${batch}`);
        }
        context = result.context;
      }

      const pipeline = context as {
        profile?: Record<string, unknown>;
        qualified?: Array<{
          keyword: string;
          search_volume?: number | null;
          difficulty?: number | null;
        }>;
        competitors?: Array<{ domain?: string }>;
      };
      const r = {
        source: "dataforseo" as const,
        competitors: (pipeline.competitors ?? [])
          .map((competitor) => competitor.domain?.trim() ?? "")
          .filter(Boolean)
          .slice(0, 8),
        keywords: (pipeline.qualified ?? [])
          .map((keyword) => ({
            keyword: keyword.keyword,
            volume: keyword.search_volume ?? null,
            difficulty: keyword.difficulty ?? null,
          }))
          .slice(0, 15),
        business_profile: pipeline.profile ?? bizProfile,
      };

      setMarket(r);
      setBizProfile(r.business_profile ?? null);
      const validatedForm = {
        ...form,
        competitors: r.competitors.join("\n"),
        keywords: r.keywords.map((keyword) => keyword.keyword).join(", "),
      };
      setForm(validatedForm);
      // Cache only after every production batch passed. This marker lets both
      // Shopify and Stripe resume without paying for the same scan again,
      // while all results from the retired market engine are invalidated.
      if (userId) {
        await persistDraft({
          data: {
            website_url: validatedForm.website_url,
            business_name: validatedForm.name,
            industry: validatedForm.industry,
            target_market: validatedForm.audience,
            country: validatedForm.country || undefined,
            tone: validatedForm.tone,
            language: validatedForm.locale,
            keywords: r.keywords.map((keyword) => keyword.keyword),
            competitors: r.competitors,
            current_step: 2,
            data_source: MARKET_PIPELINE_VERSION,
          },
        });
      }
      toast.success(`Validated market data: ${r.competitors.length} rivals, ${r.keywords.length} keywords.`);
      return r;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Market scan failed";
      console.error("[onboarding] production pipeline failed", { website: form.website_url, message });
      setMarket({
        source: "dataforseo",
        competitors: [],
        keywords: [],
        business_profile: bizProfile,
        error: message,
      });
      toast.error(message);
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
    let completion: FirstPostResult | null = null;
    try {
      const projectPayload = {
        user_id: userId,
        name: form.name,
        website_url: form.website_url || null,
        industry: form.industry || null,
        audience: form.audience || null,
        tone: form.tone,
        locale: form.locale,
        target_country: form.country || null,
        keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean),
        business_profile: (market?.business_profile ?? null) as never,
      };
      // Shopify creates the project at payment approval. Reuse it here so the
      // completed store connection and its publishing destination are retained.
      const { data: existingProject } = shopContext
        ? await supabase
            .from("projects")
            .select("id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };
      const { data, error } = existingProject
        ? await supabase.from("projects").update(projectPayload).eq("id", existingProject.id).select().single()
        : await supabase.from("projects").insert(projectPayload).select().single();
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

      // The merchant has now given us everything we asked for and the project
      // exists — their part of setup is DONE. Record that before any content
      // generation runs, because app.tsx keeps showing this wizard until the
      // flag is true: previously a failed calendar build threw past the
      // markComplete call at the end, so a merchant who had completed the whole
      // form (and paid) was sent back through the entire wizard on every
      // reload, forever. Generation is retried and reported below, never a
      // reason to make someone fill the form again.
      localStorage.removeItem(DRAFT_KEY);
      try {
        await withTransientRetry(() => markComplete({ data: { projectId: data.id } }));
      } catch (markError) {
        // This is the flag that ends the wizard loop — if it genuinely cannot
        // be written, say so loudly rather than silently looping the merchant.
        console.error("[onboarding] completeOnboarding failed", markError);
        toast.error("Setup saved, but we couldn't finish marking it complete. Please reload.");
      }

      toast.info("Building your 30-day calendar…");
      try {
        await withTransientRetry(() => build({ data: { projectId: data.id, days: 30 } }));
        toast.success("Your 30 days are planned.");
      } catch (buildError) {
        // A generation failure is not a setup failure. The daily autopilot cron
        // refills an empty window on its own, so the merchant gets a working
        // app now and a calendar shortly, instead of a dead-end wizard.
        console.error("[onboarding] calendar build failed", buildError);
        toast.warning("Your calendar will be generated shortly — you can start using the app now.");
      }

      toast.info("Writing and illustrating your day-1 GEO article…");
      try {
        const first = await withTransientRetry(() =>
          kickstart({ data: { projectId: data.id, origin: window.location.origin } }),
        );
        completion = { title: first.title, coverUrl: first.coverUrl, shopify: first.shopify };
        setFirstPost(completion);
        if (first.gmb?.posted) {
          toast.success(`Day 1 ready + Local post published to Google Business Profile.`);
        } else if (first.gmb) {
          toast.warning(`Day 1 ready. Google Business Profile post failed: ${first.gmb.error}`);
        } else {
          toast.success(`Day 1 ready: “${first.title}”`);
        }
        // Cover image failures used to vanish silently (no toast, no log) —
        // an article missing its cover looked identical to "nothing
        // happened". Same non-blocking pattern as the GMB warning above.
        if (first.coverError) {
          toast.warning(`Day 1 published without a cover image: ${first.coverError}`);
        }
      } catch (e) {
        toast.warning(
          e instanceof Error ? `Day 1 will be written shortly (${e.message})` : "Day 1 will be written shortly",
        );
      }
      setLaunching(true);
      await new Promise((resolve) => window.setTimeout(resolve, 2200));
      setLaunching(false);
      // Keep the merchant in the completion moment; the dashboard only opens
      // once they have seen the real publication result below.
      if (!completion) {
        onDone();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  const active = STEPS[step]!;

  // The wizard must never render before we know whether this is a Shopify
  // merchant and, if so, whether they have an active subscription — rendering
  // the plain wizard first and only then swapping in the payment gate once
  // loadShopify()/the subscription check resolved is what let a merchant
  // start typing before the paywall it turned out they were behind ever
  // appeared. Non-Shopify visitors just wait for loadShopify() to confirm
  // they're not connected (a single fast read), then fall straight through.
  if (!shopifyChecked || (shopifyReport && subActive === null)) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-primary" /> Preparing your onboarding…
      </div>
    );
  }

  // A Shopify connection only proves that the store authorised the app. It is
  // deliberately not enough to unlock the onboarding: Shopify must confirm
  // the recurring-app charge first.
  if (shopifyReport && subActive !== true) {
    return (
      <div className="paper-grid min-h-screen px-4 py-10">
        <div className="mx-auto w-full max-w-3xl">
          <div className="sticky top-0 z-40 -mx-4 flex justify-center bg-background/92 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
            <BrandLockup />
            <nav className="absolute left-0 top-1/2 hidden -translate-y-1/2 items-center gap-5 text-[11px] font-semibold text-muted-foreground lg:flex" aria-label="Shopify setup progress">
              <span className="flex items-center gap-1.5 text-primary"><Check className="size-3.5" /> Store synced</span>
              <span className="flex items-center gap-1.5"><span className="flex size-4 items-center justify-center rounded-full bg-deep text-[9px] text-background">2</span> Shopify payment</span>
              <span className="flex items-center gap-1.5"><span className="flex size-4 items-center justify-center rounded-full border border-border text-[9px]">3</span> Onboarding</span>
            </nav>
          </div>

          <section className="surface mt-10 overflow-hidden">
            <div className="relative overflow-hidden bg-deep px-7 py-10 text-background sm:px-10 sm:py-12">
              <motion.div aria-hidden className="absolute -right-12 -top-20 size-72 rounded-full bg-gold/25 blur-3xl" animate={{ scale: [1, 1.15, 1], opacity: [0.35, 0.7, 0.35] }} transition={{ duration: 5, repeat: Infinity }} />
              <div className="relative max-w-xl">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-gold">Ranki + Shopify</p>
                <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">Approve your Ranki plan in Shopify</h1>
                <p className="mt-3 text-sm leading-6 text-background/70">Your store is synced. Approve the plan in Shopify to start the 3-day free trial, then we will open your pre-filled onboarding.</p>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  { id: "monthly", title: "$9.99 / month", note: "3-day free trial · billed by Shopify" },
                  { id: "annual", title: "$99 / year", note: "3-day free trial · billed by Shopify" },
                ] as const).map((plan) => (
                  <button key={plan.id} type="button" onClick={() => setCycle(plan.id)} className={`rounded-2xl border p-5 text-left transition ${cycle === plan.id ? "border-gold bg-gold-soft/30 shadow-sm" : "border-border bg-muted/20 hover:border-gold/50"}`}>
                    <p className="font-display text-lg font-bold">{plan.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{plan.note}</p>
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-col justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
                <p className="max-w-md text-sm leading-6 text-muted-foreground">Payment is handled by Shopify. Ranki does not open Stripe or create your onboarding until Shopify approves the subscription.</p>
                <Button type="button" size="lg" onClick={() => void startCheckout()} disabled={busy} className="bg-deep text-background hover:bg-deep/90">
                  {busy ? "Opening Shopify checkout…" : "Approve in Shopify"} <ArrowRight className="ml-2 size-4" />
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div ref={wizardTopRef} className="paper-grid min-h-screen px-4 py-10">
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
      <AnimatePresence>
        {firstPost && !launching && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-deep/75 px-4 backdrop-blur-md">
            <motion.section initial={{ y: 22, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.98 }} className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-background/20 bg-background p-6 shadow-2xl sm:p-8">
              <div aria-hidden className="absolute -right-12 -top-16 size-52 rounded-full bg-gold/25 blur-3xl" />
              <div className="relative">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-lg shadow-gold/30"><Check className="size-7" /></div>
                <p className="mt-6 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">Your GEO autopilot is live</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight">Congratulations — your first post is ready.</h2>
                <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-muted/30">
                  {firstPost.coverUrl && <img src={firstPost.coverUrl} alt="" className="h-36 w-full object-cover" />}
                  <div className="p-4"><p className="text-xs font-semibold uppercase tracking-wide text-primary">First GEO article</p><p className="mt-1 text-base font-bold leading-snug">{firstPost.title}</p></div>
                </div>
                {firstPost.shopify?.published ? (
                  <p className="mt-5 text-sm leading-6 text-muted-foreground">It has been published directly to your Shopify blog, with your store pages and products ready for natural internal linking.</p>
                ) : (
                  <p className="mt-5 text-sm leading-6 text-muted-foreground">Your first GEO article is ready. {firstPost.shopify?.error ? "Shopify will retry publishing it automatically from the calendar." : "Connect a Shopify blog to publish it automatically."}</p>
                )}
                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-end">
                  {firstPost.shopify?.published && firstPost.shopify.url && <Button asChild variant="outline"><a href={firstPost.shopify.url} target="_blank" rel="noreferrer">View on Shopify</a></Button>}
                  <Button onClick={() => { setFirstPost(null); onDone(); }} className="bg-deep text-background hover:bg-deep/90">Open my dashboard <ArrowRight className="ml-2 size-4" /></Button>
                </div>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mx-auto w-full max-w-5xl">
        <div className="sticky top-0 z-40 -mx-4 flex justify-center bg-background/92 px-4 py-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/80">
          <BrandLockup />
          {!shopContext && <Button
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
          </Button>}
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
                      <div className="mt-5" aria-label="Analysis in progress">
                        <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                          <motion.div className="h-full rounded-full bg-gradient-to-r from-primary via-gold to-primary" animate={{ x: ["-55%", "105%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }} style={{ width: "58%" }} />
                        </div>
                        <p className="mt-2 text-center text-[11px] font-medium text-muted-foreground">This usually takes a few seconds. Please wait.</p>
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
                          placeholder="ranki.ai"
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
                      <Label htmlFor="audience" className="text-[12.5px]">{audienceCopy.label}</Label>
                      <Textarea id="audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={2} placeholder={audienceCopy.placeholder} />
                    </div>
                    </>}
                  </div>
                )}

                {step === 1 && (
                  <div className="mt-6 space-y-5">
                    <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-r from-[#f6f7ff] via-background to-[#fff9ec] p-6 text-foreground shadow-[0_18px_45px_-35px_rgba(35,35,105,0.45)]">
                      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 size-44 rounded-full bg-gold/20 blur-3xl" />
                      <div className="relative flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-[11px] bg-primary/10 text-primary">
                          <Sparkles className="size-4" />
                        </span>
                        <div>
                          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-primary">Writing brief</p>
                          <p className="mt-1 font-display text-lg font-semibold">Your AI writing brief</p>
                          <p className="mt-1 text-[12.5px] text-muted-foreground">Fine-tune what Ranki learned before the live SEO scan.</p>
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
                        <Label htmlFor="profile-country" className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Target country</Label>
                        <div className="mt-1.5 flex items-center gap-2">
                          {form.country && <img src={`https://flagcdn.com/24x18/${MARKET_COUNTRIES.find((country) => country.value === form.country)?.flag ?? "un"}.png`} alt="" width={16} height={12} className="h-3 w-4 rounded-[2px] object-cover" />}
                          <select id="profile-country" value={form.country} onChange={set("country")} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm">
                            <option value="">Match the content language</option>
                            {MARKET_COUNTRIES.map((country) => <option key={country.value} value={country.value}>{country.value}</option>)}
                          </select>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">Used for Google results and Google Business Profile local visibility. It can differ from your content language.</p>
                      </div>
                      {/* Editorial tone is picked by the AI from the business profile
                          (see detectBusiness's `tone` field) — not a merchant choice,
                          so no picker is shown here. */}
                      <div className="border-t border-border pt-5 sm:col-span-2">
                        <Label htmlFor="profile-audience" className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{audienceCopy.label}</Label>
                        <Textarea id="profile-audience" value={form.audience} onChange={set("audience")} className="mt-1.5" rows={3} placeholder={audienceCopy.placeholder} />
                      </div>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="mt-6 space-y-5">
                    {scanningMarket && (
                      <div className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-[#f5f7ff] via-background to-[#fff9ec] px-6 py-7 text-foreground shadow-[0_20px_55px_-35px_rgba(35,35,105,0.42)] sm:px-8">
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
                            <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-gold">Market analysis</p>
                            <p className="mt-1 font-display text-xl font-bold tracking-tight">Mapping your real search market…</p>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">Please keep this page open while we prepare the inputs for your 30-day content plan.</p>
                            <div className="mt-4 grid gap-2 sm:grid-cols-3">
                              {["Searching competitors", "Finding buyer keywords", "Improving your visibility inputs"].map((label, index) => (
                                <motion.div key={label} className="flex items-center gap-2 rounded-xl border border-primary/10 bg-background/80 px-3 py-2 text-[11.5px] font-medium text-foreground/80 shadow-sm" animate={{ opacity: [0.45, 1, 0.45], y: [2, 0, 2] }} transition={{ duration: 2.8, delay: index * 0.55, repeat: Infinity, ease: "easeInOut" }}>
                                  <Loader2 className="size-3.5 shrink-0 animate-spin text-gold" /> {label}
                                </motion.div>
                              ))}
                            </div>
                          </div>
                          <Loader2 className="ml-auto size-4 animate-spin text-primary/60" />
                        </div>
                        <div className="relative mt-6">
                          <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                            <motion.div className="h-full rounded-full bg-gradient-to-r from-primary via-gold to-primary" animate={{ x: ["-55%", "105%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }} style={{ width: "58%" }} />
                          </div>
                          <p className="mt-2 text-[11px] font-medium text-muted-foreground">Checking live search and local market signals. Please wait.</p>
                        </div>
                      </div>
                    )}

                    {!scanningMarket && market && !market.error && (
                      <div className="surface flex items-center gap-3 px-4 py-3 text-[12.5px] font-medium text-foreground">
                        <WebsiteFavicon website={form.website_url} label={form.name || "Your brand"} className="size-6" />
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
                                <WebsiteFavicon website={d} label={d} className="size-5" />
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
                              {market.source === "dataforseo" ? "Market data" : "AI estimate"}
                            </span>
                          </p>
                          <div className="mt-3 divide-y divide-border border-t border-border">
                            {market.keywords.slice(0, 5).map((k, index) => (
                              <div key={k.keyword} className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-2 py-2.5 text-[12.5px]">
                                <span className="font-mono text-[10.5px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                                <span className="min-w-0 break-words font-medium leading-5">{k.keyword}</span>
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

                    <details className="group rounded-xl border border-primary/25 bg-primary/[0.025]">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12.5px] font-semibold text-primary marker:hidden">
                        Edit competitors & keywords
                        <ArrowRight className="size-3.5 transition group-open:rotate-90" />
                      </summary>
                      <div className="space-y-4 border-t border-primary/15 bg-background p-4">
                        <div>
                          <Label htmlFor="competitors" className="text-[12.5px]">Competitors (one domain per line)</Label>
                          <Textarea id="competitors" value={form.competitors} onChange={set("competitors")} className="mt-1.5" rows={3} placeholder={"competitor1.com\ncompetitor2.com"} />
                        </div>
                        <div>
                          <Label htmlFor="keywords" className="text-[12.5px]">Target keywords (comma separated)</Label>
                          <Textarea id="keywords" value={form.keywords} onChange={set("keywords")} className="mt-1.5" rows={2} placeholder="plumber lyon, water leak, boiler" />
                        </div>
                      </div>
                    </details>

                    {market && market.competitors.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative overflow-hidden rounded-3xl border border-border bg-card px-0 py-0 text-foreground shadow-[0_20px_55px_-38px_rgba(15,23,42,0.35)]"
                      >
                        <motion.div
                          aria-hidden
                          className="pointer-events-none absolute -right-12 -top-12 size-56 rounded-full bg-emerald-200/45 blur-3xl"
                          animate={{ scale: [1, 1.15, 1] }}
                          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        />
                        <div className="relative flex items-center justify-between gap-3 border-b border-border px-6 py-5 sm:px-8">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-8 items-center justify-center rounded-full bg-white text-[#10a37f] shadow-sm"><Bot className="size-4" /></span>
                            <div><p className="text-[15px] font-semibold text-foreground">ChatGPT</p><p className="text-[11px] text-muted-foreground">{previewCopy(form.locale).kicker}</p></div>
                          </div>
                          <span className="rounded-full border border-primary/15 bg-primary/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">{previewCopy(form.locale).badge}</span>
                        </div>
                        <p className="relative mx-6 mt-6 text-[12px] font-bold uppercase tracking-[0.16em] text-foreground sm:mx-8">
                          {previewCopy(form.locale).headline}
                        </p>
                        <p className="relative mx-6 mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground sm:mx-8">
                          {previewCopy(form.locale).disclaimer}
                        </p>
                        <div className="relative mx-6 mt-7 space-y-5 sm:mx-8">
                          <div className="ml-auto max-w-[85%] rounded-3xl rounded-tr-sm border border-emerald-900/10 bg-[#eff8f4] px-4 py-3 text-[13px] shadow-sm">
                            {aiPreviewQuestion(previewCategory(form.industry, form.locale, market.business_profile), form.locale, market.business_profile as { sales_model?: string | null; products?: string[] | null; primary_entity?: string | null } | null | undefined)}
                          </div>
                          <div className="max-w-[90%] rounded-3xl rounded-tl-sm border border-border bg-background px-4 py-3 text-[13px] leading-relaxed text-foreground shadow-sm">
                            {aiPreviewAnswer(previewCategory(form.industry, form.locale, market.business_profile), market.competitors, form.locale, market.business_profile as { sales_model?: string | null; products?: string[] | null; primary_entity?: string | null } | null | undefined)}
                          </div>
                        </div>
                        <div className="relative mx-6 mt-6 flex items-center gap-2 rounded-2xl border border-border bg-muted/25 px-4 py-3 text-[12px] text-muted-foreground sm:mx-8">
                          <Bot className="size-3.5 text-[#74d7bb]" /> {previewCopy(form.locale).placeholder}
                          <span className="ml-auto flex size-5 items-center justify-center rounded-md bg-background/10 text-background/60">↑</span>
                        </div>
                        <p className="relative mx-6 mb-6 mt-5 rounded-2xl border border-gold/20 bg-gold-soft/35 px-4 py-3 text-[12.5px] leading-relaxed text-foreground sm:mx-8 sm:mb-8">
                          {/* Prefer the name FROM this scan's own business_profile — form.name
                              can lag behind (a stale draft, a prior site's prefill) while
                              market.competitors/keywords are already correctly this scan's.
                              Showing a mismatched brand next to a correct competitor list is
                              what made the whole card read as broken. */}
                          <strong className="font-semibold text-gold">{aiPreviewOutcome((market.business_profile as { name?: string | null } | null | undefined)?.name || form.name || (form.locale === "fr" ? "Votre entreprise" : "Your business"), form.website_url, market.competitors, form.locale)}</strong>
                        </p>
                      </motion.div>
                    )}

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
                  disabled={!canNext || scanning || signingUp || (step === 1 && scanningMarket) || waitingForMarketScan}
                  className="bg-deep text-background hover:bg-deep/90"
                >
                  {signingUp
                    ? "Creating your account…"
                    : (step === 1 && scanningMarket) || waitingForMarketScan
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
