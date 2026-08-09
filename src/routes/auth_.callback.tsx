import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

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
  const [message, setMessage] = useState("Finishing sign-in…");

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
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
  }, [navigate]);

  return (
    <div className="paper-grid flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}