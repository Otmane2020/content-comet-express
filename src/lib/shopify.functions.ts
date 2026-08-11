import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  projectId: z.string().uuid(),
  shop: z.string().min(3),
  origin: z.string().url(),
});

/** Build the signed Shopify app install URL for the current user. */
export const startShopifyInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }) => {
    const { normalizeShop, signState, authorizeUrl } = await import("./shopify.server");
    const shop = normalizeShop(data.shop);
    if (!shop) throw new Error("Enter your shop domain, e.g. mystore.myshopify.com");
    const state = signState({
      userId: context.userId,
      projectId: data.projectId,
      origin: data.origin,
      ts: Date.now(),
    });
    return { url: authorizeUrl(shop, state, data.origin) };
  });

/**
 * Silently signs a merchant in when the app loads embedded in Shopify admin.
 * Browsers partition storage by top-level site, so a Supabase session that
 * exists when Ranki.ai is visited directly is invisible inside the Shopify
 * iframe — this trades a verified App Bridge session token for a fresh
 * Supabase session instead of bouncing the merchant out to sign in again.
 * Deliberately has no requireSupabaseAuth: there is no session yet.
 */
export const exchangeShopifySession = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ token: z.string().min(10), origin: z.string().url() }).parse(raw))
  .handler(async ({ data }) => {
    const mod = await import("./shopify.server");
    const claims = mod.verifyShopifySessionToken(data.token);
    if (!claims) {
      console.error("[shopify-embed] session token failed verification");
      throw new Error("Invalid Shopify session token");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("integrations")
      .select("user_id")
      .eq("platform", "shopify")
      .eq("config->>shop", claims.shop)
      .limit(1)
      .maybeSingle();
    let userId = integration?.user_id;
    if (!userId) {
      // Fresh App Store install: use Shopify's supported token exchange from
      // the App Bridge ID token, without bouncing back through legacy OAuth.
      const { access_token } = await mod.exchangeSessionToken(claims.shop, data.token);
      const [blogId, info, snapshot, content] = await Promise.all([
        mod.resolveBlogId(claims.shop, access_token),
        mod.fetchShopInfo(claims.shop, access_token),
        mod.fetchProductSnapshot(claims.shop, access_token),
        mod.fetchStoreContent(claims.shop, access_token),
      ]);
      const provision = await import("./shopifyProvision.server");
      const created = await provision.provisionShopifyMerchant({
        shop: claims.shop,
        accessToken: access_token,
        blogId,
        info,
        snapshot,
        content,
      });
      userId = created.userId;

      const existingSub = await mod.activeAppSubscription(claims.shop, access_token).catch(() => null);
      await provision.recordShopifySubscription(created.userId, created.email, existingSub);
      if (!existingSub) {
        const state = mod.signState({
          userId,
          projectId: created.projectId,
          origin: data.origin,
          shop: claims.shop,
          ts: Date.now(),
        });
        const returnUrl = `${data.origin}/api/public/shopify/billing?shop=${encodeURIComponent(claims.shop)}&state=${encodeURIComponent(state)}`;
        const { confirmationUrl } = await mod.createAppSubscription(claims.shop, access_token, returnUrl);
        return { confirmationUrl };
      }
    }

    const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = user.user?.email;
    if (!email) {
      console.error(`[shopify-embed] user ${userId} has no email`);
      throw new Error("Could not resolve the merchant account.");
    }

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error || !link.properties?.hashed_token) {
      console.error(`[shopify-embed] generateLink failed: ${error?.message}`);
      throw new Error(error?.message ?? "Could not start a session.");
    }
    return { email, hashedToken: link.properties.hashed_token };
  });
