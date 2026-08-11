import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { AlertTriangle, ArrowRight, LifeBuoy, RefreshCw } from "lucide-react";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/shopify/error")({
  head: () => ({
    meta: [
      { title: "We couldn't finish your Shopify install — Ranki.ai" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ShopifyErrorPage,
});

/** Plain-language cause for the codes the OAuth and billing routes emit. Anything
 * else is a raw Shopify or Admin API message, which we show as-is. */
const HINTS: Record<string, string> = {
  missing_params: "Shopify didn't send the details we need to identify your store.",
  bad_signature:
    "Shopify couldn't be verified as the sender. This usually means the app's API secret doesn't match the app that started the install.",
  invalid_state: "The secure token for this installation was missing or had expired.",
  install_expired: "This installation link has expired — they're only valid for one hour.",
  billing_declined:
    "The subscription wasn't approved in Shopify, so we stopped here and created nothing.",
};

function ShopifyErrorPage() {
  const [params, setParams] = useState<{ shop: string | null; message: string | null }>({
    shop: null,
    message: null,
  });

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setParams({ shop: search.get("shop"), message: search.get("message") });
  }, []);

  const { shop, message } = params;
  const hint = message ? HINTS[message] : undefined;

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
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Installation interrupted
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">We couldn't finish your setup</h1>
          <p className="mt-2 text-muted-foreground">
            {shop
              ? `Nothing was created for ${shop}, and you haven't been charged. You can retry the installation right away.`
              : "Nothing was created, and you haven't been charged."}
          </p>

          {(hint || message) && (
            <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              {hint && <p className="text-sm text-foreground">{hint}</p>}
              {message && (
                <p className={`text-xs text-muted-foreground ${hint ? "mt-2" : ""}`}>
                  Details: <span className="font-mono">{message}</span>
                </p>
              )}
            </div>
          )}

          {shop ? (
            <Button size="lg" className="mt-6 w-full" asChild>
              <a href={`/api/public/shopify/install?shop=${encodeURIComponent(shop)}`}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry the installation
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          ) : (
            <p className="mt-6 rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Reinstall Ranki.ai from your Shopify admin to start again.
            </p>
          )}

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <LifeBuoy className="h-3.5 w-3.5" />
            Still stuck? Email{" "}
            <a className="underline" href="mailto:support@ranki.ai">
              support@ranki.ai
            </a>{" "}
            with the details above.
          </p>
        </motion.div>
      </div>
    </main>
  );
}
