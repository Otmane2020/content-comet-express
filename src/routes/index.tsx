import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  Globe2,
  Loader2,
  MapPin,
  Search,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { DemoSlider } from "@/components/DemoSlider";
import { Footer } from "@/components/Footer";
import { CustomSiteLogos, PlatformLogo } from "@/components/PlatformLogo";
import { Button } from "@/components/ui/button";
import { createCheckout } from "@/lib/billing.functions";
import { PLATFORM_META, ROTATION, TYPE_META } from "@/lib/geo";

const FAQ = [
  {
    q: "Do I need to install a plugin?",
    a: "No. AutopilotGEO publishes through the official APIs of WordPress, WooCommerce, PrestaShop and Shopify, or posts the article to your own endpoint.",
  },
  {
    q: "Who writes the articles?",
    a: "DeepSeek through OpenRouter writes every piece in your language and tone, using your keywords, your competitors' winning queries and your Search Console data.",
  },
  {
    q: "Can I review before publishing?",
    a: "Yes. Every slot lands as an editable draft. Turn auto-publish on per destination when you trust the output.",
  },
  {
    q: "What is GEO exactly?",
    a: "Generative Engine Optimisation: writing so ChatGPT, Perplexity, Gemini and AI Overviews quote your brand instead of a competitor.",
  },
];

const PLAN_FEATURES = [
  "30 articles a month, on a rolling calendar",
  "GEO, SEO, AEO, Local & Shopping rotation",
  "Unlimited destinations (WordPress, Woo, PrestaShop, Shopify, webhook)",
  "Keyword research & competitor mining",
  "AI cover + in-article images on every article, text-free",
  "One-click \"Illustrate all\" for the whole 30-day calendar",
  "Google Business Profile posts & Search Console sync",
  "Auto-publish every morning",
];

const CAPABILITIES = [
  {
    icon: Search,
    title: "Keywords & rivals",
    body: "Live volume, CPC and difficulty, plus the queries your competitors already win — mined automatically.",
  },
  {
    icon: MapPin,
    title: "Google Business Profile",
    body: "Connect your listing and the article of the day goes out as a local post, every morning.",
  },
  {
    icon: BarChart3,
    title: "Search Console feedback",
    body: "28-day clicks, impressions and positions flow back in, so the next articles target what actually moves.",
  },
  {
    icon: Zap,
    title: "Daily autopilot job",
    body: "The window refills, today's piece gets written and pushed everywhere auto-publish is on. No clicks needed.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AutopilotGEO — 30 days of AI content, auto-published" },
      {
        name: "description",
        content:
          "A rolling 30-day calendar of GEO, SEO and AEO content written by DeepSeek and published automatically to WordPress, WooCommerce, PrestaShop, Shopify and your own site.",
      },
      { property: "og:title", content: "AutopilotGEO — 30 days of AI content, auto-published" },
      {
        property: "og:description",
        content: "Plan, write and publish a month of generative-search content on autopilot.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    icon: CalendarDays,
    title: "A rolling 30-day plan",
    body: "One piece per day, rotating GEO → SEO → AEO → Local → Shopping. The window refills itself every day.",
  },
  {
    icon: Bot,
    title: "Written by DeepSeek",
    body: "Each slot gets a full article in your language and tone, structured for the format that day requires.",
  },
  {
    icon: Send,
    title: "Published everywhere",
    body: "One click — or automatic — publishing to every CMS and site you connected.",
  },
];

function Landing() {
  const [annual, setAnnual] = useState(true);
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const startCheckout = useServerFn(createCheckout);

  const onSubscribe = async () => {
    setLoading(true);
    setCheckoutError(null);
    try {
      const { url } = await startCheckout({
        data: { cycle: annual ? "annual" : "monthly", origin: window.location.origin },
      });
      window.location.href = url;
    } catch {
      setCheckoutError("Checkout is unavailable right now. Please try again in a moment.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-deep text-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-5 py-2 text-center text-[12.5px]">
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold tracking-wide text-gold">
            <Sparkles className="size-3.5" /> NEW
          </span>
          <span className="opacity-90">
            AutopilotGEO writes and publishes one article a day to your CMS — keywords, competitors,
            images and Google included.
          </span>
          <a href="#demo" className="font-semibold text-gold underline-offset-4 hover:underline">
            Watch the demo
          </a>
        </div>
      </div>
      <nav className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <BrandLockup />
          <div className="flex items-center gap-2">
            <a
              href="#capabilities"
              className="hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Features
            </a>
            <a
              href="#demo"
              className="hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Demo
            </a>
            <a
              href="#pricing"
              className="hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Pricing
            </a>
            <Link
              to="/blog"
              className="mr-2 hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Blog
            </Link>
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-deep text-background hover:bg-deep/90">
              <Link to="/auth">Start free</Link>
            </Button>
          </div>
        </div>
      </nav>

      <header className="paper-grid border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold-soft px-3 py-1 font-mono text-[11px] font-semibold tracking-wide text-gold-foreground">
              <Sparkles className="size-3.5" /> GEO · SEO · AEO ON AUTOPILOT
            </span>
            <h1 className="mt-5 text-4xl font-bold sm:text-5xl">
              30 days of content.
              <br />
              Written and published
              <span className="text-primary"> without you.</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              AutopilotGEO builds a rolling 30-day editorial calendar for your business, writes every
              article with DeepSeek through OpenRouter, and pushes it live to WordPress, WooCommerce,
              PrestaShop, Shopify and your Lovable, Bolt or Replit site.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-deep text-background hover:bg-deep/90">
                <Link to="/auth">
                  Build my 30 days <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/app">Open the dashboard</Link>
              </Button>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
              {["No plugin to install", "Your own CMS credentials", "Editable drafts before publish"].map(
                (item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-4 text-success" /> {item}
                  </li>
                ),
              )}
            </ul>
          </div>

          <div className="surface p-5">
            <div className="flex items-center justify-between">
              <p className="font-display text-sm font-semibold">Your next 10 days</p>
              <span className="font-mono text-[11px] text-muted-foreground">AUTO-ROTATION</span>
            </div>
            <div className="mt-4 space-y-2">
              {Array.from({ length: 10 }, (_, i) => {
                const type = ROTATION[i % ROTATION.length]!;
                const meta = TYPE_META[type];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">D+{i}</span>
                    <span className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${meta.tone}`}>
                      {meta.short}
                    </span>
                    <span className="truncate text-[13px] text-foreground/80">{meta.blurb}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <DemoSlider />

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold">How the autopilot runs</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.title} className="surface p-6">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <step.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-secondary/50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Globe2 className="size-4" />
            <h2 className="text-2xl font-bold text-foreground">Publishes to</h2>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(PLATFORM_META).map(([id, meta]) => (
              <div
                key={id}
                className="surface group flex items-start gap-4 p-5 transition-all hover:border-primary/40 hover:shadow-sm"
              >
                <span className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl border border-border bg-background px-3 shadow-sm transition-transform group-hover:scale-105">
                  {id === "webhook" ? (
                    <CustomSiteLogos className="size-6" />
                  ) : (
                    <PlatformLogo platform={id} className="size-7" />
                  )}
                </span>
                <div>
                  <p className="font-display font-semibold">{meta.label}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{meta.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="capabilities" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold">Everything the autopilot handles</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
          Research, writing, publishing and measurement live in one loop — each day feeds the next.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="surface flex gap-4 p-6">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-gold-foreground">
                <c.icon className="size-5" />
              </span>
              <div>
                <h3 className="text-lg font-semibold">{c.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-secondary/50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold">The five formats it rotates</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROTATION.map((type) => {
              const meta = TYPE_META[type];
              return (
                <div key={type} className="surface p-5">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${meta.tone}`}
                  >
                    {meta.short}
                  </span>
                  <p className="mt-3 font-display font-semibold">{meta.label}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">{meta.blurb}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-5 py-16">
        <div className="text-center">
          <h2 className="text-2xl font-bold">One price. Everything included.</h2>
          <p className="mt-2 text-[15px] text-muted-foreground">
            No tiers, no per-article billing. Save 20% when you pay yearly.
          </p>
          <div className="mt-6 inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 p-1">
            <button
              type="button"
              onClick={() => setAnnual(false)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${!annual ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setAnnual(true)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${annual ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              Yearly
              <span className="rounded-full bg-gold-soft px-2 py-0.5 font-mono text-[10px] text-gold-foreground">
                −20%
              </span>
            </button>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-xl">
          <div className="surface relative overflow-hidden p-8 ring-2 ring-gold/50">
            <span className="absolute inset-x-0 top-0 h-1 bg-gold" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
              AutopilotGEO — full access
            </p>
            <p className="mt-3 flex items-end gap-2">
              <span className="font-display text-5xl font-bold">
                ${annual ? "7.99" : "9.99"}
              </span>
              <span className="pb-1.5 text-[13px] text-muted-foreground">/ month, USD</span>
            </p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              {annual ? "Billed $95.90 once a year — two months free." : "Billed monthly, cancel anytime."}
            </p>
            <ul className="mt-6 space-y-2.5 text-[13.5px] text-foreground/85">
              {PLAN_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {f}
                </li>
              ))}
            </ul>
            <Button
              onClick={onSubscribe}
              disabled={loading}
              className="mt-7 w-full bg-deep text-background hover:bg-deep/90"
              size="lg"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {annual ? "Start yearly — save 20%" : "Start monthly"}
            </Button>
            {checkoutError && (
              <p className="mt-3 text-center text-[13px] text-destructive">{checkoutError}</p>
            )}
            <p className="mt-3 text-center text-[12px] text-muted-foreground">
              Secure payment by Stripe. Cancel in one click.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/50">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-2xl font-bold">Questions</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="surface group p-5">
                <summary className="cursor-pointer list-none font-display font-semibold marker:hidden">
                  {item.q}
                </summary>
                <p className="mt-2.5 text-[14px] leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h2 className="text-3xl font-bold">Give the machine a month of work</h2>
        <p className="mt-3 text-muted-foreground">
          Connect your site, describe your business, and wake up to a calendar that keeps itself full.
        </p>
        <Button asChild size="lg" className="mt-7 bg-deep text-background hover:bg-deep/90">
          <Link to="/auth">
            Start now <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-center text-[13px] text-muted-foreground">
          <BrandLockup />
          <p>© {new Date().getFullYear()} AutopilotGEO — generative search, on autopilot.</p>
        </div>
      </footer>
    </div>
  );
}
