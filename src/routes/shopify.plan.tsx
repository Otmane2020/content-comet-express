import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronRight, ShieldCheck, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shopify/plan")({ component: ShopifyPlan });

const benefits = [
  "30 articles a month, on a rolling calendar",
  "GEO, SEO, AEO, Local & Shopping rotation",
  "Shopify products, collections and pages linked naturally",
  "Keyword research & competitor monitoring",
  "AI cover and in-article images, text-free",
  "Google Business Profile & Search Console sync",
  "Automatic Shopify publishing every morning",
];

function ShopifyPlan() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop");
  const state = params.get("state");
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
    <main className="min-h-screen bg-[#f1f1f1] px-4 py-5 font-sans text-[#303030] sm:px-8 sm:py-7" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <section className="mx-auto w-full max-w-5xl">
        <header className="flex flex-col items-center gap-3 border-b border-[#d2d2d2] pb-4 sm:flex-row sm:justify-between">
          <BrandLockup />
          <div className="flex items-center gap-1.5 text-[13px] text-[#616161]"><ShieldCheck className="size-3.5" /> Secure Shopify billing</div>
        </header>

        <div className="mx-auto mt-7 max-w-xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6d7175]">Ranki + Shopify</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Choose your Ranki plan</h1>
          <p className="mt-2 text-sm leading-5 text-[#616161]">Start with a 3-day free trial. Shopify handles the approval securely.</p>
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className={`relative rounded-xl border bg-white p-5 shadow-sm sm:p-6 ${plan.featured ? "border-[#b98900] ring-1 ring-[#d9b66d]" : "border-[#d4d4d4]"}`}>
              {plan.featured && <span className="absolute right-5 top-5 rounded bg-[#303030] px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-white">Best value</span>}
              <p className="font-mono text-[10px] tracking-[0.1em] text-[#616161]">{plan.eyebrow}</p>
              <div className="mt-3 flex items-end gap-1.5">
                <span className="text-4xl font-semibold tracking-tight text-[#202223]">{plan.price}</span>
                <span className="mb-1.5 text-[13px] text-[#616161]">{plan.unit}</span>
              </div>
              <p className="mt-2 text-[13px] text-[#616161]">{plan.note}</p>
              <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-[#303030]"><Sparkles className="size-3.5 text-[#b98900]" /> 3-day free trial through Shopify</p>
              <ul className="mt-5 space-y-2 border-t border-[#e5e5e5] pt-5 text-[13px] leading-5 text-[#303030]">
                {benefits.map((benefit) => <li key={benefit} className="flex gap-2.5"><Check className="mt-0.5 size-3.5 shrink-0 text-[#008060]" />{benefit}</li>)}
              </ul>
              <Button type="button" onClick={() => choose(plan.id)} className={`mt-6 h-10 w-full text-[13px] font-semibold ${plan.featured ? "bg-[#008060] text-white hover:bg-[#006e52]" : "bg-[#303030] text-white hover:bg-black"}`}>
                {plan.cta}<ChevronRight className="ml-1.5 size-4" />
              </Button>
              <p className="mt-3 text-center text-[11px] text-[#616161]">You will approve this plan on Shopify&apos;s secure payment page.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
