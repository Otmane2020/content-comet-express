import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { createCheckout } from "@/lib/billing.functions";
import { takeCheckoutIntent } from "@/lib/checkoutIntent";

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
      const fromShopify =
        new URLSearchParams(window.location.search).get("shopify") === "connected";
      if (fromShopify) {
        window.location.replace("/app?shopify=connected");
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
