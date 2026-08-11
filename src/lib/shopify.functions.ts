import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ projectId: z.string().uuid(), shop: z.string().min(3), origin: z.string().url() });

/** Build the signed Shopify app install URL for a merchant already signed in
 * (e.g. connecting an additional store from the dashboard). */
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
