import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ projectId: z.string().uuid(), shop: z.string().min(3), origin: z.string().url() });

export const startShopifyInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => input.parse(raw))
  .handler(async ({ data, context }) => {
    const { normalizeShop, signState, authorizeUrl } = await import("./shopify.server");
    const shop = normalizeShop(data.shop);
    if (!shop) throw new Error("Enter your shop domain, e.g. mystore.myshopify.com");
    return { url: authorizeUrl(shop, signState({ userId: context.userId, projectId: data.projectId, origin: data.origin, ts: Date.now() }), data.origin) };
  });

/** Embedded session exchange is used only after a Shopify-paid install exists.
 * A first load exits the iframe into the durable OAuth + billing flow. */
export const exchangeShopifySession = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ token: z.string().min(10), origin: z.string().url() }).parse(raw))
  .handler(async ({ data }) => {
    const mod = await import("./shopify.server");
    const claims = mod.verifyShopifySessionToken(data.token);
    if (!claims) throw new Error("Invalid Shopify session token");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin.from("integrations").select("user_id").eq("platform", "shopify").eq("config->>shop", claims.shop).limit(1).maybeSingle();
    if (!integration?.user_id) return { installUrl: `/api/public/shopify/install?shop=${encodeURIComponent(claims.shop)}` };
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
    const email = user.user?.email;
    if (!email) throw new Error("Could not resolve the merchant account.");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link.properties?.hashed_token) throw new Error(error?.message ?? "Could not start a session.");
    return { email, hashedToken: link.properties.hashed_token };
  });
