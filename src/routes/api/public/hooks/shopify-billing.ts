import { createFileRoute } from "@tanstack/react-router";

/**
 * Keeps `subscriptions.status` in sync with Shopify in near-real-time —
 * the same role src/routes/api/public/hooks/stripe.ts already plays for
 * Stripe, mirrored here rather than reinvented. Access itself never waits on
 * this: billing.ts already writes "active" synchronously right after Shopify
 * confirms the charge, before the merchant is ever redirected back into the
 * app. This webhook is what keeps that cached row correct for every load
 * AFTER that first one — a cancellation, a plan change, or an uninstall.
 */
export const Route = createFileRoute("/api/public/hooks/shopify-billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyWebhookHmac } = await import("@/lib/shopify.server");
        const body = await request.text();
        if (!verifyWebhookHmac(body, request.headers.get("x-shopify-hmac-sha256"))) {
          console.error("[shopify webhook] signature rejected", { bytes: body.length });
          return new Response("Invalid signature", { status: 401 });
        }

        const topic = request.headers.get("x-shopify-topic");
        const shop = request.headers.get("x-shopify-shop-domain");
        console.info("[shopify webhook] event received", { topic, shop });
        if (!shop) return new Response("ok"); // nothing to resolve against — not retry-worthy

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: integration } = await supabaseAdmin
            .from("integrations")
            .select("user_id, config")
            .eq("platform", "shopify")
            .eq("config->>shop", shop)
            .limit(1)
            .maybeSingle();
          if (!integration?.user_id) {
            console.warn("[shopify webhook] unknown shop", { shop, topic });
            return new Response("ok"); // unknown shop is not retry-worthy either
          }

          if (topic === "app_subscriptions/update") {
            const payload = JSON.parse(body) as { app_subscription?: { admin_graphql_api_id?: string; status?: string } };
            const status = (payload.app_subscription?.status ?? "").toUpperCase();
            const active = status === "ACTIVE";
            const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
            if (!user.user?.email) return new Response("ok");
            const { recordShopifySubscription } = await import("@/lib/shopifyProvision.server");
            await recordShopifySubscription(
              integration.user_id,
              user.user.email,
              active ? { id: payload.app_subscription?.admin_graphql_api_id ?? shop, status, currentPeriodEnd: null } : null,
              "monthly",
            );
            console.info("[shopify webhook] subscription synced", { shop, status });
            return new Response("ok");
          }

          if (topic === "app/uninstalled") {
            await supabaseAdmin.from("subscriptions").update({ status: "inactive", updated_at: new Date().toISOString() }).eq("user_id", integration.user_id);
            await supabaseAdmin.from("integrations").update({ status: "disconnected" }).eq("platform", "shopify").eq("config->>shop", shop);
            console.info("[shopify webhook] uninstall processed", { shop });
            return new Response("ok");
          }

          console.info("[shopify webhook] topic ignored", { topic });
          return new Response("ok");
        } catch (error) {
          // 500 makes Shopify retry, which is what we want on a transient DB error.
          console.error("[shopify webhook] handler failed", { topic, shop, error: error instanceof Error ? error.message : String(error) });
          return new Response("handler error", { status: 500 });
        }
      },
    },
  },
});
