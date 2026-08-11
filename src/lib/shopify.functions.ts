import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ projectId: z.string().uuid(), shop: z.string().min(3), origin: z.string().url() });
const billingInput = z.object({ cycle: z.enum(["monthly", "annual"]), origin: z.string().url() });

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

/** Native billing for an already-connected embedded Shopify merchant.
 * This is deliberately separate from Stripe: Shopify owns both the charge
 * confirmation and the 3-day trial for this platform. */
export const startShopifyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => billingInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { normalizeShop, signState, createAppSubscription, activeAppSubscription } = await import("./shopify.server");
    const { data: integration } = await context.supabase
      .from("integrations")
      .select("config")
      .eq("user_id", context.userId)
      .eq("platform", "shopify")
      .eq("status", "connected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const config = (integration?.config ?? {}) as { shop?: string; access_token?: string; is_test_store?: boolean };
    const shop = normalizeShop(config.shop ?? null);
    if (!shop || !config.access_token) throw new Error("Shopify connection is unavailable. Reinstall the app from Shopify Admin.");

    const active = await activeAppSubscription(shop, config.access_token).catch(() => null);
    if (active) return { url: null, alreadyActive: true as const };

    // Do not repeat `shop` in the query: signed state already contains it and
    // Shopify rejects return URLs longer than 255 characters.
    const returnUrl = `${data.origin.replace(/\/$/, "")}/api/public/shopify/billing?state=${encodeURIComponent(
      signState({ origin: "", shop, plan: data.cycle, flow: "dashboard", ts: Date.now() }),
    )}`;
    const { confirmationUrl } = await createAppSubscription(shop, config.access_token, returnUrl, data.cycle, config.is_test_store === true);
    return { url: confirmationUrl, alreadyActive: false as const };
  });
