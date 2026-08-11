import { createFileRoute } from "@tanstack/react-router";

function back(origin: string, params: Record<string, string>) {
  const q = new URLSearchParams({ tab: "platforms", ...params }).toString();
  return new Response(null, { status: 302, headers: { location: `${origin}/app?${q}` } });
}

export const Route = createFileRoute("/api/public/shopify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = url.origin;
        const mod = await import("@/lib/shopify.server");

        try {
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          const code = url.searchParams.get("code");
          const state = mod.verifyState(url.searchParams.get("state"));

          if (!shop || !code) return back(origin, { shopify: "error", message: "missing_params" });
          if (!mod.verifyRequestHmac(url)) return back(origin, { shopify: "error", message: "bad_signature" });

          const { access_token } = await mod.exchangeCode(shop, code);
          const [blogId, info, snapshot, content] = await Promise.all([
            mod.resolveBlogId(shop, access_token),
            mod.fetchShopInfo(shop, access_token),
            mod.fetchProductSnapshot(shop, access_token),
            mod.fetchStoreContent(shop, access_token),
          ]);

          const provision = await import("@/lib/shopifyProvision.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let userId: string;
          let email: string;
          let projectId = "";

          if (state) {
            // Merchant already signed in here: attach the store to their project.
            userId = state.userId;
            projectId = state.projectId;
            const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
            email = user.user?.email ?? info.email ?? `${shop}@shopify-merchant.ranki.ai`;
            // Scope the lookup to this exact shop: a merchant can connect several
            // stores to the same project, and matching on project only would make
            // a second install silently overwrite the first store's token.
            const { data: existing } = await supabaseAdmin
              .from("integrations")
              .select("id")
              .eq("project_id", state.projectId)
              .eq("platform", "shopify")
              .eq("config->>shop", shop)
              .limit(1)
              .maybeSingle();
            const row = {
              user_id: userId,
              project_id: state.projectId,
              platform: "shopify",
              label: info.name || shop.replace(".myshopify.com", ""),
              config: provision.buildShopifyConfig(shop, access_token, blogId, info, snapshot, content),
              status: "connected",
              last_error: null,
            };
            const { error } = existing
              ? await supabaseAdmin.from("integrations").update(row).eq("id", existing.id)
              : await supabaseAdmin.from("integrations").insert(row);
            if (error) throw new Error(error.message);
          } else {
            // Install started from Shopify: create the account and project from the store.
            const created = await provision.provisionShopifyMerchant({
              shop,
              accessToken: access_token,
              blogId,
              info,
              snapshot,
              content,
            });
            userId = created.userId;
            email = created.email;
            projectId = created.projectId;
          }

          // Billing is handled by Shopify, never Stripe, for merchants coming from a store.
          const existingSub = await mod.activeAppSubscription(shop, access_token).catch(() => null);
          await provision.recordShopifySubscription(userId, email, existingSub);

          if (!existingSub) {
            const billingState = mod.signState({ userId, projectId, origin, shop, ts: Date.now() });
            const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(billingState)}`;
            const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl);
            return new Response(null, { status: 302, headers: { location: confirmationUrl } });
          }

          const link = await provision.shopifyLoginLink(
            email,
            `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`,
          );
          return new Response(null, { status: 302, headers: { location: link } });
        } catch (e) {
          console.error("[shopify callback] installation failed", e);
          return back(origin, {
            shopify: "error",
            message: (e instanceof Error ? e.message : "failed").slice(0, 160),
          });
        }
      },
    },
  },
});