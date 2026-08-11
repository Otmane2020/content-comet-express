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
  .inputValidator((raw: unknown) =>
    z.object({
      token: z.string().min(10),
      origin: z.string().url(),
      plan: z.enum(["monthly", "annual"]).optional(),
    }).parse(raw),
  )
  .handler(async ({ data }) => {
    const mod = await import("./shopify.server");
    const claims = mod.verifyShopifySessionToken(data.token);
    if (!claims) throw new Error("Invalid Shopify session token");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("integrations")
      .select("user_id, project_id, config")
      .eq("platform", "shopify")
      .eq("config->>shop", claims.shop)
      .limit(1)
      .maybeSingle();

    let userId = existing?.user_id ?? null;
    let projectId = existing?.project_id ?? null;
    let accessToken = (existing?.config as { access_token?: string } | null)?.access_token;
    let email: string | null = null;

    if (!userId || !projectId || !accessToken) {
      const exchanged = await mod.exchangeSessionToken(claims.shop, data.token);
      accessToken = exchanged.access_token;
      const [blogId, info, snapshot, content] = await Promise.all([
        mod.resolveBlogId(claims.shop, accessToken),
        mod.fetchShopInfo(claims.shop, accessToken),
        mod.fetchProductSnapshot(claims.shop, accessToken),
        mod.fetchStoreContent(claims.shop, accessToken),
      ]);
      const provision = await import("./shopifyProvision.server");
      const created = await provision.provisionShopifyMerchant({
        shop: claims.shop,
        accessToken,
        blogId,
        info,
        snapshot,
        content,
      });
      userId = created.userId;
      projectId = created.projectId;
      email = created.email;
    }

    const provision = await import("./shopifyProvision.server");
    const active = await mod.activeAppSubscription(claims.shop, accessToken).catch(() => null);
    if (!email) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
      email = user.user?.email ?? `${claims.shop}@shopify-merchant.ranki.ai`;
    }
    await provision.recordShopifySubscription(userId, email, active);

    if (!active) {
      console.info(`[shopify-embed] ${claims.shop}: subscription inactive; plan=${data.plan ?? "not-selected"}`);
      if (!data.plan) return { requiresPlanChoice: true as const };
      const state = mod.signState({
        userId,
        projectId,
        origin: data.origin,
        shop: claims.shop,
        plan: data.plan,
        ts: Date.now(),
      });
      const returnUrl = `${data.origin}/api/public/shopify/billing?shop=${encodeURIComponent(claims.shop)}&state=${encodeURIComponent(state)}`;
      const { confirmationUrl } = await mod.createAppSubscription(claims.shop, accessToken, returnUrl, data.plan);
      return { confirmationUrl };
    }

    console.info(`[shopify-embed] ${claims.shop}: subscription active; issuing merchant session`);
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error || !link.properties?.hashed_token) {
      throw new Error(error?.message ?? "Could not start a session.");
    }
    return { email, hashedToken: link.properties.hashed_token };
  });

