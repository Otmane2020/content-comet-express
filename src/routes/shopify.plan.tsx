import { createFileRoute } from "@tanstack/react-router";
import { Check, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shopify/plan")({ component: ShopifyPlan });

function ShopifyPlan() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get("shop");
  const state = params.get("state");
  const choose = (plan: "monthly" | "annual") => {
    if (!shop || !state) return;
    window.location.assign(`/api/public/shopify/billing-choice?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(state)}&plan=${plan}`);
  };
  const plans = [
    { id: "monthly" as const, price: "$9.99", unit: "per month", note: "Flexible monthly billing" },
    { id: "annual" as const, price: "$99", unit: "per year", note: "Save $20 each year", featured: true },
  ];
  return <main className="paper-grid flex min-h-screen items-center justify-center px-4 py-10"><section className="w-full max-w-3xl"><div className="flex justify-center"><BrandLockup /></div><div className="mt-8 rounded-3xl border border-border bg-card p-6 shadow-xl sm:p-10"><p className="text-center text-xs font-bold uppercase tracking-[0.18em] text-primary">Ranki + Shopify</p><h1 className="mt-3 text-center font-display text-3xl font-bold">Choose your autopilot plan</h1><p className="mx-auto mt-3 max-w-lg text-center text-sm text-muted-foreground">Start with a 3-day free trial. Shopify handles payment securely.</p><div className="mt-8 grid gap-4 sm:grid-cols-2">{plans.map((plan) => <article key={plan.id} className={`rounded-2xl border p-5 ${plan.featured ? "border-primary bg-primary/[0.03] shadow-lg shadow-primary/10" : "border-border"}`}><div className="flex items-center justify-between"><h2 className="font-semibold">{plan.id === "annual" ? "Annual" : "Monthly"}</h2>{plan.featured && <span className="rounded-full bg-primary px-2 py-1 text-[10px] font-bold text-primary-foreground">BEST VALUE</span>}</div><p className="mt-5 text-3xl font-bold">{plan.price} <span className="text-sm font-medium text-muted-foreground">{plan.unit}</span></p><p className="mt-2 text-sm text-muted-foreground">{plan.note}</p><p className="mt-5 flex items-center gap-2 text-sm"><Check className="size-4 text-primary" />3-day free trial</p><Button className="mt-6 w-full" variant={plan.featured ? "default" : "outline"} onClick={() => choose(plan.id)}><Sparkles className="mr-2 size-4" />Choose {plan.id}</Button></article>)}</div></div></section></main>;
}
