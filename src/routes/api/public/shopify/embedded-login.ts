import { createFileRoute } from "@tanstack/react-router";

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const publicOrigin = () => "https://www.ranki.ai";

/**
 * App Home is framed by Shopify. Supabase browser storage may be unavailable
 * there, so an already installed merchant can appear signed out. Do not start
 * OAuth again: verify Shopify's signed launch and restore the merchant's
 * existing Ranki session at top level instead.
 */
export const Route = createFileRoute("/api/public/shopify/embedded-login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mod = await import("@/lib/shopify.server");
        try {
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          if (!shop || !mod.verifyRequestHmac(url)) return redirect(`${publicOrigin()}/shopify/error?message=invalid_embedded_launch`);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: integration } = await supabaseAdmin
            .from("integrations")
            .select("user_id")
            .eq("platform", "shopify")
            .eq("config->>shop", shop)
            .limit(1)
            .maybeSingle();

          if (!integration?.user_id) {
            return redirect(`${publicOrigin()}/api/public/shopify/install?shop=${encodeURIComponent(shop)}`);
          }
          const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
          if (!user.user?.email) throw new Error("merchant_not_found");

          const provision = await import("@/lib/shopifyProvision.server");
          return redirect(
            await provision.shopifyLoginLink(
              user.user.email,
              `${publicOrigin()}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`,
            ),
          );
        } catch (error) {
          console.error("[shopify embedded login]", error);
          return redirect(`${publicOrigin()}/shopify/error?message=embedded_login_failed`);
        }
      },
    },
  },
});
