import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createCheckout } from "@/lib/billing.functions";
import { takeCheckoutIntent } from "@/lib/checkoutIntent";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Ranki.ai" },
      { name: "description", content: "Access your rolling 30-day AI content calendar and publishing destinations." },
      { property: "og:title", content: "Sign in — Ranki.ai" },
      { property: "og:description", content: "Access your Ranki.ai content calendar." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const startCheckout = useServerFn(createCheckout);
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [shopDomain, setShopDomain] = useState("");

  useEffect(() => {
    if (loading || !session) return;
    // A "Start now" click on the marketing page while logged out lands here
    // to sign up — resume straight into Stripe instead of the empty dashboard.
    const cycle = takeCheckoutIntent();
    if (!cycle) {
      navigate({ to: "/app", replace: true });
      return;
    }
    void startCheckout({ data: { cycle, origin: window.location.origin } })
      .then(({ url, alreadyActive }) => {
        window.location.href = alreadyActive || !url ? "/app" : url;
      })
      .catch(() => navigate({ to: "/app", replace: true }));
  }, [loading, session, navigate, startCheckout]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        toast.success("Account created — welcome aboard.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setGoogleBusy(true);
    try {
      // Ask for Search Console + Business Profile access right after sign-in.
      sessionStorage.setItem("ranki:google-scopes", "1");
      // Supabase's own OAuth redirect (Google credentials configured in the
      // Supabase project's Auth > Providers settings) works on any host. The
      // previous Lovable-managed flow redirected through a `/~oauth/initiate`
      // path that only Lovable's own hosting intercepts — production is
      // deployed elsewhere, so that path 404s.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        sessionStorage.removeItem("ranki:google-scopes");
        toast.error(error.message ?? "Google sign-in failed");
        setGoogleBusy(false);
        return;
      }
      // Success navigates the browser away to Google immediately; nothing left to do here.
    } catch (err) {
      sessionStorage.removeItem("ranki:google-scopes");
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleBusy(false);
    }
  }

  return (
    <div className="paper-grid flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <BrandLockup />
        </div>
        <div className="surface mt-6 p-6">
          <h1 className="text-xl font-bold">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {mode === "signup"
              ? "Set up your project and we build the first 30 days."
              : "Pick up where the autopilot left off."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5"
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-deep text-background hover:bg-deep/90">
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={googleBusy}
            onClick={signInWithGoogle}
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9Z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.7-3.8H1.4v3.1A12 12 0 0 0 12 24Z" />
              <path fill="#FBBC05" d="M5.4 14.3a7.1 7.1 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1Z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.5-3.5A12 12 0 0 0 1.4 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z" />
            </svg>
            {googleBusy ? "Opening Google…" : "Continue with Google"}
          </Button>

          <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
            <p className="text-[12px] font-semibold">Shopify merchant?</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Install the app on your store — your account, project and billing are set up
              automatically through Shopify.
            </p>
            <div className="mt-2.5 flex gap-2">
              <Input
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                placeholder="mystore.myshopify.com"
                className="h-9 bg-background text-[13px]"
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 shrink-0"
                disabled={!shopDomain.trim()}
                onClick={() => {
                  window.location.href = `/api/public/shopify/install?shop=${encodeURIComponent(shopDomain.trim())}`;
                }}
              >
                Continue with Shopify
              </Button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="mt-5 w-full text-center text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {mode === "signup" ? "I already have an account" : "I need an account"}
          </button>
        </div>
      </div>
    </div>
  );
}