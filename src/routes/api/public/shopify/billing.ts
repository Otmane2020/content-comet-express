import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams({ tab: "platforms", ...params }).toString();
  return new Response(null, { status: 302, headers: { location: `${origin}/app?${q}` } });
}

/** Shopify sends the merchant back here once they approve (or decline) the charge. */
export const Route = createFileRoute("/api/public/shopify/billing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const mod = await import("@/lib/shopify.server");

        try {
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          const state = mod.verifyState(url.searchParams.get("state"));
          if (!shop || !state) return back(origin, { shopify: "error", message: "invalid_state" });

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: integration } = await supabaseAdmin
            .from("integrations")
            .select("config")
            .eq("platform", "shopify")
            .eq("config->>shop", shop)
            .limit(1)
            .maybeSingle();
          const token = (integration?.config as { access_token?: string } | null)?.access_token;
          if (!token) return back(origin, { shopify: "error", message: "store_not_connected" });

          const provision = await import("@/lib/shopifyProvision.server");
          const sub = await mod.activeAppSubscription(shop, token);
          const { data: user } = await supabaseAdmin.auth.admin.getUserById(state.userId);
          const email = user.user?.email ?? `${shop}@shopify-merchant.ranki.ai`;
          await provision.recordShopifySubscription(state.userId, email, sub);

          if (!sub) return back(origin, { shopify: "error", message: "billing_declined" });

          const link = await provision.shopifyLoginLink(
            email,
            `${origin}/auth/callback?shopify=connected`,
          );
          return new Response(null, { status: 302, headers: { location: link } });
        } catch (e) {
          console.error("[shopify billing] return failed", e);
          return back(origin, {
            shopify: "error",
            message: (e instanceof Error ? e.message : "failed").slice(0, 160),
          });
        }
      },
    },
  },
});