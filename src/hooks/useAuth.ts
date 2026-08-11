import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Embedded Shopify runs inside a constrained iframe. A stale browser
    // storage entry or a blocked network request must never leave the whole
    // app on its loading screen forever.
    let active = true;
    const settle = (next: Session | null) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    };
    const timeout = window.setTimeout(() => settle(null), 8_000);
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      settle(next);
    });
    void supabase.auth.getSession()
      .then(({ data }) => settle(data.session))
      .catch(() => settle(null));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: (session?.user ?? null) as User | null, loading };
}
