import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { ArrowRight, Globe2, Layers, Loader2, Package, ShoppingBag, Tag } from "lucide-react";
import { completeOnboarding, getShopifyPrefill } from "@/lib/onboarding.functions";
import { buildPlan } from "@/lib/autopilot.functions";
import { supabase } from "@/integrations/supabase/client";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shown once, right after a merchant installs from the Shopify App Store:
 * they never see the onboarding wizard (their project is provisioned
 * server-side from the store data), so this is the only moment they get to
 * see what we actually pulled in before landing in the dashboard.
 */
export function ShopifyWelcome({
  userId,
  projectId,
  onContinue,
}: {
  userId: string;
  projectId: string;
  onContinue: () => void;
}) {
  const loadShopify = useServerFn(getShopifyPrefill);
  const completeOnboarding = useServerFn(completeOnboarding);
  const build = useServerFn(buildPlan);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof getShopifyPrefill>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", website: "", industry: "", audience: "" });

  useEffect(() => {
    let cancelled = false;
    loadShopify()
      .then((r) => {
        if (!cancelled) {
          setData(r);
          if (r.connected) {
            setForm({
              name: r.business_name ?? "",
              website: r.website_url ?? "",
              industry: r.industry ?? "",
              audience: r.country ? `Shoppers in ${r.country}` : "",
            });
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show (e.g. the `shopify=connected` param was reused after the
  // integration was later removed) — skip straight past this screen.
  useEffect(() => {
    if (!loading && (!data || !data.connected)) onContinue();
  }, [loading, data, onContinue]);

  if (!loading && (!data || !data.connected)) return null;

  async function finishOnboarding() {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          name: form.name.trim() || data?.business_name || "My Shopify store",
          website_url: form.website.trim() || null,
          industry: form.industry.trim() || null,
          audience: form.audience.trim() || null,
        })
        .eq("id", projectId)
        .eq("user_id", userId);
      if (error) throw error;
      await completeOnboarding({ data: { projectId } });
      await build({ data: { projectId, days: 30 } });
      onContinue();
    } finally {
      setSaving(false);
    }
  }

  const stats = data?.connected
    ? [
        { icon: Package, label: "Products imported", value: data.productCount.toLocaleString("en-US") },
        { icon: Layers, label: "Collections found", value: data.collectionTitles.length.toLocaleString("en-US") },
        { icon: Tag, label: "Industry detected", value: data.industry ?? "Pending scan" },
        { icon: Globe2, label: "Market", value: data.country ?? "—" },
      ]
    : [];

  return (
    <div className="paper-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="surface mt-6 overflow-hidden"
        >
          <div className="relative overflow-hidden bg-deep px-7 py-8 text-background">
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-gold/25 blur-3xl"
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="relative flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-background/10 text-gold">
                <ShoppingBag className="size-5" />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Store connected</p>
                <h1 className="font-display text-[21px] font-bold leading-tight">
                  {loading ? "Reading your store…" : data?.connected ? data.business_name || data.shop : "Welcome"}
                </h1>
              </div>
            </div>
          </div>

          <div className="px-7 py-7">
            {loading ? (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Pulling in your products and collections…
              </div>
            ) : (
              <>
                <p className="text-[13.5px] leading-relaxed text-muted-foreground">
                  Your store is imported. Review the prefilled details, then we’ll build your first 30-day content plan.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><Label htmlFor="shopify-name">Business name</Label><Input id="shopify-name" className="mt-1.5" value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} /></div>
                  <div className="sm:col-span-2"><Label htmlFor="shopify-site">Website</Label><Input id="shopify-site" className="mt-1.5" value={form.website} onChange={(e) => setForm((v) => ({ ...v, website: e.target.value }))} /></div>
                  <div><Label htmlFor="shopify-industry">Industry</Label><Input id="shopify-industry" className="mt-1.5" value={form.industry} onChange={(e) => setForm((v) => ({ ...v, industry: e.target.value }))} /></div>
                  <div><Label htmlFor="shopify-audience">Audience</Label><Input id="shopify-audience" className="mt-1.5" value={form.audience} onChange={(e) => setForm((v) => ({ ...v, audience: e.target.value }))} /></div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {stats.map((s, i) => (
                    <motion.div
                      key={s.label}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.06 * i }}
                      className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3.5"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <s.icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold">{s.value}</p>
                        <p className="text-[11.5px] text-muted-foreground">{s.label}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
                {!!data?.connected && data.collectionTitles.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {data.collectionTitles.slice(0, 8).map((c) => (
                      <span key={c} className="rounded-lg border border-border px-2 py-1 text-[11.5px]">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="mt-7 flex justify-end border-t border-border pt-5">
              <Button
                type="button"
                onClick={() => void finishOnboarding()}
                disabled={loading || saving}
                className="bg-deep text-background hover:bg-deep/90"
              >
                {saving ? "Building your dashboard…" : "Launch my dashboard"} <ArrowRight className="ml-1.5 size-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
