import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createCheckout } from "@/lib/billing.functions";
import { takeCheckoutIntent } from "@/lib/checkoutIntent";

// Shopify opens embedded apps through this canonical Admin URL. Returning to
// `/app` after the post-billing magic link loses that frame and makes the
// merchant land in the regular web dashboard instead.
const SHOPIFY_APP_HANDLE = "newai-seo-and-marketing-scale";
const SHOPIFY_SETUP_STEPS = [
  "Securing your Shopify connection",
  "Setting up your GEO foundation",
  "Preparing your AI content workspace",
];

function embeddedShopifyAppUrl(shop: string | null) {
  const handle = shop?.replace(/\.myshopify\.com$/i, "").trim().toLowerCase();
  if (!handle || !/^[a-z0-9][a-z0-9-]*$/.test(handle)) return null;
  return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/apps/${SHOPIFY_APP_HANDLE}`;
}

/**
 * Public landing route for OAuth / email-confirmation redirects.
 * Waits for the Supabase session to hydrate, then sends the user to the app.
 */
export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing you in — Ranki.ai" },
      { name: "description", content: "Finishing your Ranki.ai sign-in." },
      { property: "og:title", content: "Signing you in — Ranki.ai" },
      { property: "og:description", content: "Finishing your Ranki.ai sign-in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const startCheckout = useServerFn(createCheckout);
  const [shopifyReturn] = useState(() => new URLSearchParams(window.location.search).get("shopify") === "connected");
  const [setupStage, setSetupStage] = useState(0);
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    if (!shopifyReturn) return;
    const timer = window.setInterval(() => {
      setSetupStage((stage) => Math.min(stage + 1, SHOPIFY_SETUP_STEPS.length - 1));
    }, 1400);
    return () => window.clearInterval(timer);
  }, [shopifyReturn]);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const params = new URLSearchParams(window.location.search);
      const fromShopify = params.get("shopify") === "connected";
      if (fromShopify) {
        // Re-enter via Shopify Admin so the app gets its signed host parameter
        // and renders inside Shopify instead of as a standalone Ranki tab.
        const embeddedUrl = embeddedShopifyAppUrl(params.get("shop"));
        window.location.replace(embeddedUrl ?? "/app?shopify=connected");
        return;
      }
      // A "Start now" click on the marketing page (e.g. via Google sign-in)
      // resumes straight into Stripe instead of the empty dashboard.
      const cycle = takeCheckoutIntent();
      if (cycle) {
        void startCheckout({ data: { cycle, origin: window.location.origin } })
          .then(({ url, alreadyActive }) => {
            window.location.href = alreadyActive || !url ? "/app" : url;
          })
          .catch(() => navigate({ to: "/app", replace: true }));
        return;
      }
      navigate({ to: "/app", replace: true });
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });

    const timeout = setTimeout(() => {
      if (done) return;
      // A Shopify merchant never set a password — the generic /auth signup
      // form is a dead end for them. Retry the Shopify entry point instead,
      // which issues a fresh magic link, rather than stranding them here.
      const params = new URLSearchParams(window.location.search);
      const shop = params.get("shopify") === "connected" ? params.get("shop") : null;
      if (shop) {
        setMessage("We couldn't confirm your session. Retrying…");
        setTimeout(() => {
          window.location.href = `/api/public/shopify/install?shop=${encodeURIComponent(shop)}`;
        }, 1200);
        return;
      }
      setMessage("We couldn't confirm your session. Redirecting to sign in…");
      setTimeout(() => navigate({ to: "/auth", replace: true }), 1200);
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate, startCheckout]);

  return (
    <div className="paper-grid flex min-h-screen items-center justify-center px-4 py-8">
      {shopifyReturn ? (
        <section className="w-full max-w-md rounded-3xl border border-border/70 bg-card/95 p-8 shadow-2xl shadow-primary/10 backdrop-blur sm:p-10">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25">R</div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Generative search</p>
              <p className="text-lg font-bold leading-none">Ranki.ai + Shopify</p>
            </div>
          </div>
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full border-2 border-primary/15">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">We’re setting up your GEO autopilot</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Your subscription is confirmed. Ranki is preparing your workspace before opening it in Shopify.</p>
          <div className="mt-8 space-y-3">
            {SHOPIFY_SETUP_STEPS.map((step, index) => (
              <div key={step} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${index === setupStage ? "bg-primary/10 text-foreground" : index < setupStage ? "text-muted-foreground" : "text-muted-foreground/55"}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${index < setupStage ? "bg-primary text-primary-foreground" : index === setupStage ? "border-2 border-primary" : "border border-border"}`}>
                  {index < setupStage ? "✓" : index + 1}
                </span>
                <span className="text-sm font-medium">{step}</span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  );
}
