import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronRight, ShieldCheck, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shopify/plan")({ component: ShopifyPlan });

const benefits = [
  "Get discovered in ChatGPT, Gemini, Perplexity and Google",
  "30 GEO-optimized articles every month, always planned ahead",
  "SEO, AEO, Local & Shopping content built to grow visibility",
  "Shopify publishing with natural product and page links",
  "Keywords, competitor monitoring and AI images included",
];

function ShopifyPlan() {
  // This route is server-rendered before it is loaded in Shopify's iframe.
  // Reading `window` during SSR turned the plan picker into a 500 response.
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const shop = params.get("shop");
  const state = params.get("state");
  // Shopify App Home can retain its iframe scroll position after OAuth. Reset
  // it explicitly so the plan header is never hidden above the viewport.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.scrollingElement?.scrollTo({ top: 0, left: 0 });
  }, []);
  const choose = (plan: "monthly" | "annual") => {
    if (!shop || !state) return;
    const billingUrl = `/api/public/shopify/billing-choice?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(state)}&plan=${plan}`;
    // The plan picker is embedded, but Shopify's approval screen is a native
    // Admin page and must be opened in the top browsing context.
    if (window.top !== window.self) window.open(billingUrl, "_top");
    else window.location.assign(billingUrl);
  };

  const plans = [
    {
      id: "monthly" as const,
      eyebrow: "RANKI.AI — MONTHLY",
      price: "$9.99",
      unit: "/ month, USD",
      note: "Billed monthly. Cancel any time.",
      cta: "Continue monthly",
    },
    {
      id: "annual" as const,
      eyebrow: "RANKI.AI — FULL ACCESS",
      price: "$8.25",
      unit: "/ month, USD",
      note: "Billed $99 once a year — save $20 yearly.",
      cta: "Continue annual",
      featured: true,
    },
  ];

  return (
    <main className="min-h-screen bg-[#f1f1f1] px-4 py-3 font-sans text-[#303030] sm:px-6 sm:py-4" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <section className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col items-center gap-2 border-b border-[#d2d2d2] pb-3 sm:flex-row sm:justify-between">
          <BrandLockup />
          <div className="flex items-center gap-1.5 text-[13px] text-[#616161]"><ShieldCheck className="size-3.5" /> Secure Shopify billing</div>
        </header>

        <div className="mx-auto mt-4 max-w-xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6d7175]">Ranki + Shopify</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Choose your Ranki plan</h1>
          <p className="mt-1 text-[13px] leading-5 text-[#616161]">Start with a 3-day free trial. Shopify handles the approval securely.</p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className={`relative rounded-xl border bg-white p-4 shadow-sm sm:p-5 ${plan.featured ? "border-[#b98900] ring-1 ring-[#d9b66d]" : "border-[#d4d4d4]"}`}>
              {plan.featured && <span className="absolute right-5 top-5 rounded bg-[#008060] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-white">Recommended</span>}
              <p className="font-mono text-[10px] tracking-[0.1em] text-[#616161]">{plan.eyebrow}</p>
              <div className="mt-2 flex items-end gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-[#202223]">{plan.price}</span>
                <span className="mb-1.5 text-[13px] text-[#616161]">{plan.unit}</span>
              </div>
              <p className="mt-2 text-[13px] text-[#616161]">{plan.note}</p>
              <p className="mt-3 flex items-center gap-2 text-[12px] font-medium text-[#303030]"><Sparkles className="size-3.5 text-[#b98900]" /> 3-day free trial through Shopify</p>
              <ul className="mt-3 space-y-1.5 border-t border-[#e5e5e5] pt-3 text-[12px] leading-5 text-[#303030]">
                {benefits.map((benefit) => <li key={benefit} className="flex gap-2.5"><Check className="mt-0.5 size-3.5 shrink-0 text-[#008060]" />{benefit}</li>)}
              </ul>
              <Button type="button" onClick={() => choose(plan.id)} className={`mt-4 h-9 w-full text-[12px] font-semibold ${plan.featured ? "bg-[#008060] text-white hover:bg-[#006e52]" : "bg-[#303030] text-white hover:bg-black"}`}>
                {plan.cta}<ChevronRight className="ml-1.5 size-4" />
              </Button>
              <p className="mt-2 text-center text-[10px] text-[#616161]">You will approve this plan on Shopify&apos;s secure payment page.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
