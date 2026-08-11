import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

/** Starts native Shopify billing only after the merchant selected monthly or annual. */
export const Route = createFileRoute("/api/public/shopify/billing-choice")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        try {
          const mod = await import("@/lib/shopify.server");
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          const state = mod.verifyState(url.searchParams.get("state"));
          const plan = url.searchParams.get("plan") === "annual" ? "annual" : "monthly";
          if (!shop || !state || state.shop !== shop) throw new Error("invalid_plan_selection");
          const pendingStore = await import("@/lib/shopifyPendingInstall.server");
          const pending = await pendingStore.getPendingShopifyInstall(shop);
          if (!pending) throw new Error("install_expired");
          await pendingStore.setPendingShopifyPlan(shop, plan);
          const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, plan, ts: Date.now() }))}`;
          const { confirmationUrl } = await mod.createAppSubscription(shop, pending.access_token, returnUrl, plan, pending.store_info.isTestStore);
          return redirect(confirmationUrl);
        } catch (error) {
          const message = (error instanceof Error ? error.message : "failed").slice(0, 140);
          return redirect(`${origin}/shopify/error?message=${encodeURIComponent(message)}`);
        }
      },
    },
  },
});
