import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BrandLockup } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — AutopilotGEO" },
      { name: "description", content: "Access your rolling 30-day AI content calendar and publishing destinations." },
      { property: "og:title", content: "Sign in — AutopilotGEO" },
      { property: "og:description", content: "Access your AutopilotGEO content calendar." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/app", replace: true });
  }, [loading, session, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/app` },
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