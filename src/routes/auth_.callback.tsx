import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createCheckout } from "@/lib/billing.functions";
import { takeCheckoutIntent } from "@/lib/checkoutIntent";
import { SHOPIFY_CLIENT_ID } from "@/lib/shopify.constants";

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
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const params = new URLSearchParams(window.location.search);
      const fromShopify = params.get("shopify") === "connected";
      if (fromShopify) {
        // OAuth and billing approval both required escaping the iframe to a
        // top-level tab, so we're no longer inside Shopify admin. Sending the
        // merchant to our own bare domain would leave them there — this app
        // is embedded, so the loop only closes by navigating back into
        // Shopify admin. Shopify auto-embeds this legacy myshopify.com admin
        // URL into the new admin.shopify.com shell, which reloads our app
        // inside the iframe; by then everything (account, subscription,
        // integration row) is already set up, so the embedded silent-auth
        // path signs the merchant in without any further redirect.
        const shop = params.get("shop");
        window.location.replace(
          shop ? `https://${shop}/admin/apps/${SHOPIFY_CLIENT_ID}` : "/app?shopify=connected",
        );
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
    <div className="paper-grid flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
