import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "motion/react";
import { ArrowRight, Check, Layers, Loader2, Package, ShoppingBag, Sparkles } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { getShopifyInstall, claimShopifyInstall } from "@/lib/shopifyInstall.functions";

export const Route = createFileRoute("/shopify/setup")({
  head: () => ({
    meta: [
      { title: "Finish your Shopify setup — Ranki.ai" },
      {
        name: "description",
        content:
          "Confirm your Shopify store and start Ranki.ai: 30 days of GEO, SEO and AEO articles written and published to your store automatically.",
      },
      { property: "og:title", content: "Finish your Shopify setup — Ranki.ai" },
      {
        property: "og:description",
        content: "Connect your Shopify store and let Ranki.ai publish SEO & GEO content every day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ShopifySetupPage,
});

function ShopifySetupPage() {
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const pendingToken = search?.get("pending_token") ?? "";
  const load = useServerFn(getShopifyInstall);
  const claim = useServerFn(claimShopifyInstall);

  const [store, setStore] = useState<Awaited<ReturnType<typeof getShopifyInstall>>>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingToken) {
      setLoading(false);
      setError("This installation link is incomplete. Please reinstall the app from Shopify.");
      return;
    }
    let cancelled = false;
    load({ data: { pendingToken } })
      .then((r) => {
        if (cancelled) return;
        if (!r) setError("This installation link has expired. Please reinstall the app from Shopify.");
        setStore(r);
      })
      .catch(() => !cancelled && setError("We could not read your store. Please reinstall the app."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pendingToken]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { url } = await claim({ data: { pendingToken, origin: window.location.origin } });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setStarting(false);
    }
  };

  const stats = store
    ? [
        { icon: Package, label: "Products imported", value: store.productCount.toLocaleString("en-US") },
        { icon: Layers, label: "Collections", value: store.collectionCount.toLocaleString("en-US") },
        { icon: ShoppingBag, label: "Pages", value: store.pageCount.toLocaleString("en-US") },
      ]
    : [];

  return (
    <main className="paper-grid flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 rounded-2xl border border-border bg-card p-8 shadow-xl"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Reading your Shopify store…
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Shopify app installed
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                {store ? store.storeName : "Finish your setup"}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {store?.domain ? `${store.domain} · ` : ""}
                We imported your catalog. Start the plan and Ranki.ai writes and publishes a new GEO,
                SEO or AEO article to your store every day.
              </p>

              {store && (
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {stats.map((s) => (
                    <div key={s.label} className="rounded-xl border border-border bg-muted/40 p-4">
                      <s.icon className="h-4 w-4 text-primary" />
                      <div className="mt-2 text-2xl font-semibold">{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {store && store.productTitles.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {store.productTitles.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <ul className="mt-6 space-y-2 text-sm">
                {[
                  "30-day rolling content calendar, generated for your catalog",
                  "Auto-published to your Shopify blog with a magazine layout",
                  "$9.99 / month, billed by Shopify — 3-day free trial",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">{line}</span>
                  </li>
                ))}
              </ul>

              {error && (
                <p className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button size="lg" className="mt-6 w-full" disabled={starting || !store} onClick={() => void start()}>
                {starting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening Shopify…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" /> Start my free trial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                You approve the charge inside Shopify. Cancel any time from your Shopify admin.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
