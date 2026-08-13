import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

/** Starts native Shopify billing only after the merchant selected monthly or annual. */
export const Route = createFileRoute("/api/public/shopify/billing-choice")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        let shop: string | null = null;
        const mod = await import("@/lib/shopify.server");
        try {
          shop = mod.normalizeShop(url.searchParams.get("shop"));
          const state = mod.verifyState(url.searchParams.get("state"));
          const plan = url.searchParams.get("plan") === "annual" ? "annual" : "monthly";
          if (!shop || !state || state.shop !== shop) throw new Error("invalid_plan_selection");
          const pendingStore = await import("@/lib/shopifyPendingInstall.server");
          const pending = await pendingStore.getPendingShopifyInstall(shop);
          // Partial installs from an older flow have a connected integration
          // but no pending record. They still need to resume native billing
          // rather than landing in onboarding without a subscription.
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: integration } = pending
            ? { data: null }
            : await supabaseAdmin
                .from("integrations")
                .select("config")
                .eq("platform", "shopify")
                .eq("config->>shop", shop)
                .limit(1)
                .maybeSingle();
          const config = (integration?.config ?? {}) as { access_token?: string; is_test_store?: boolean };
          const accessToken = pending?.access_token ?? config.access_token;
          if (!accessToken) throw new Error("install_expired");
          if (pending) await pendingStore.setPendingShopifyPlan(shop, plan);
          const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, plan, ts: Date.now() }))}`;
          const { confirmationUrl } = await mod.createAppSubscription(shop, accessToken, returnUrl, plan, pending?.store_info.isTestStore ?? config.is_test_store === true);
          return redirect(confirmationUrl);
        } catch (error) {
          const message = (error instanceof Error ? error.message : "failed").slice(0, 140);
          // An OAuth token may be revoked between installation and plan choice
          // (for example after a rapid uninstall/reinstall). A 401 is
          // recoverable: obtain a fresh offline token instead of abandoning
          // the merchant on a fatal setup screen.
          if (shop && /Shopify API error \(401\)|Unauthorized/i.test(message)) {
            console.warn("[shopify billing-choice] stale token; restarting OAuth", { shop });
            const resumeState = mod.signState({ origin: "", shop, plan, ts: Date.now() });
            return redirect(`${origin}/api/public/shopify/install?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(resumeState)}`);
          }
          return redirect(`${origin}/shopify/error?${new URLSearchParams({ ...(shop ? { shop } : {}), message })}`);
        }
      },
    },
  },
});
