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
    window.location.assign(
      `/api/public/shopify/billing-choice?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(state)}&plan=${plan}`,
    );
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
    <main className="min-h-screen bg-[#f6f6f7] px-4 py-8 text-[#202223] sm:px-8 sm:py-12">
      <section className="mx-auto w-full max-w-6xl">
        <header className="flex flex-col items-center gap-4 border-b border-[#dedede] pb-6 sm:flex-row sm:justify-between">
          <BrandLockup />
          <div className="flex items-center gap-2 text-sm text-[#616161]"><ShieldCheck className="size-4" /> Secure Shopify billing</div>
        </header>

        <div className="mx-auto mt-10 max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6d7175]">Ranki + Shopify</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Choose your Ranki plan</h1>
          <p className="mt-3 text-base leading-6 text-[#616161]">Start with a 3-day free trial. Your selected plan is then approved securely by Shopify.</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className={`relative rounded-[26px] border-2 bg-white p-7 shadow-sm sm:p-10 ${plan.featured ? "border-[#d4af55] shadow-[0_12px_35px_rgba(32,34,35,0.08)]" : "border-[#d9d9d9]"}`}>
              {plan.featured && <span className="absolute right-6 top-6 rounded-full bg-[#202223] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">Best value</span>}
              <p className="font-mono text-[12px] tracking-[0.12em] text-[#475467]">{plan.eyebrow}</p>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-5xl font-bold tracking-tight text-[#171b3d] sm:text-6xl">{plan.price}</span>
                <span className="mb-2 text-sm text-[#475467]">{plan.unit}</span>
              </div>
              <p className="mt-3 text-sm text-[#475467]">{plan.note}</p>
              <p className="mt-5 flex items-center gap-2 text-sm font-medium text-[#202223]"><Sparkles className="size-4 text-[#b98900]" /> 3-day free trial through Shopify</p>
              <ul className="mt-7 space-y-3 border-t border-[#e5e5e5] pt-6 text-[15px] leading-5 text-[#303030]">
                {benefits.map((benefit) => <li key={benefit} className="flex gap-3"><Check className="mt-0.5 size-4 shrink-0 text-[#008060]" />{benefit}</li>)}
              </ul>
              <Button type="button" onClick={() => choose(plan.id)} className={`mt-9 h-12 w-full text-[15px] ${plan.featured ? "bg-[#20236a] text-white hover:bg-[#171b55]" : "bg-[#202223] text-white hover:bg-black"}`}>
                {plan.cta}<ChevronRight className="ml-1.5 size-4" />
              </Button>
              <p className="mt-4 text-center text-xs text-[#616161]">You will approve this plan on Shopify&apos;s secure payment page.</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
