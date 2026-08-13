import { createHmac, timingSafeEqual } from "crypto";
import { createFileRoute } from "@tanstack/react-router";

const response = (body: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const embeddedErrorStatus = (error: string) => {
  if (error === "billing_required") return 200;
  if (error === "shop_not_installed" || error === "merchant_not_found") return 404;
  if (error === "subscription_check_failed") return 503;
  return 500;
};

async function verifyAppBridgeToken(token: string) {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;
  const mod = await import("@/lib/shopify.server");
  const expected = createHmac("sha256", mod.shopifySecret()).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString()) as { aud?: string; dest?: string; exp?: number };
  if (payload.aud !== mod.SHOPIFY_CLIENT_ID || !payload.dest || !payload.exp || payload.exp * 1000 < Date.now()) return null;
  const host = new URL(payload.dest).hostname;
  return mod.normalizeShop(host);
}

async function issueEmbeddedSession(shop: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: integration } = await supabaseAdmin
    .from("integrations")
    .select("user_id, config")
    .eq("platform", "shopify")
    .eq("config->>shop", shop)
    .limit(1)
    .maybeSingle();
  const { activeAppSubscription, signState } = await import("@/lib/shopify.server");
  const billingUrl = () => {
    const state = signState({ origin: "", shop, ts: Date.now() });
    return `/shopify/plan?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(state)}`;
  };
  if (!integration?.user_id) {
    // OAuth has completed but payment has not: the pending row is enough to
    // show the embedded selector; a Ranki user is intentionally not created
    // until Shopify approves the charge.
    const pendingStore = await import("@/lib/shopifyPendingInstall.server");
    const pending = await pendingStore.getPendingShopifyInstall(shop);
    if (pending) return { error: "billing_required", billing_url: billingUrl() } as const;
    return { error: "shop_not_installed" } as const;
  }
  const config = (integration.config ?? {}) as { access_token?: string };

  // CRITICAL UX requirement: for a merchant whose local subscription is
  // active and fresh, opening App Home must make ZERO Shopify Billing/Admin
  // API requests before issuing the session. billing.ts already writes
  // status="active" synchronously right after Shopify confirms the charge,
  // before ever redirecting back here — so the merchant's very next load
  // reads that fresh row and skips the live check entirely. This is what
  // actually removes the "About a minute before I see my plan" wait; the
  // live check below is now exceptional reconciliation, not the normal path.
  const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
  const { data: cached } = await supabaseAdmin
    .from("subscriptions")
    .select("status, updated_at")
    .eq("user_id", integration.user_id)
    .maybeSingle();
  const cacheFresh =
    !!cached && Date.now() - new Date(cached.updated_at as string).getTime() < FRESH_WINDOW_MS;
  if (cached?.status === "active" && cacheFresh) {
    const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
    if (!user.user?.email) return { error: "merchant_not_found" } as const;
    const provision = await import("@/lib/shopifyProvision.server");
    return provision.shopifyEmbeddedSession(user.user.email);
  }

  // Reconciliation: either no fresh cached verdict yet, or the cache says
  // inactive/missing and needs a real answer before showing the plan picker.
  // Old partial installs can have an integration/user but no Shopify
  // subscription; opening the embedded tile must never be treated as
  // payment approval on its own.
  //
  // activeAppSubscription() returns null when Shopify says there is no
  // active subscription, and THROWS when we could not ask Shopify at all.
  // Collapsing both into null used to report any transient GraphQL failure
  // as "you have not paid". One retry (graphql() is now 5s-timeout bounded,
  // so worst case here is ~10s, not the ~45s three retries used to allow) —
  // if it still cannot be answered, say so instead of inventing a billing state.
  let active: Awaited<ReturnType<typeof activeAppSubscription>> = null;
  let checkFailed = false;
  if (config.access_token) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        active = await activeAppSubscription(shop, config.access_token);
        checkFailed = false;
        break;
      } catch (error) {
        checkFailed = true;
        console.error("[shopify embedded-login] subscription check failed", {
          shop,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
  if (checkFailed) return { error: "subscription_check_failed" } as const;
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
  if (!user.user?.email) return { error: "merchant_not_found" } as const;
  // The whole point of reconciling is to correct the cache either way — an
  // `active` result refreshes `updated_at` and restarts the 24h fast-path
  // window; an inactive result corrects a stale "active" row (the case the
  // user flagged: DB says active, Shopify says cancelled, webhook missed).
  const { recordShopifySubscription } = await import("@/lib/shopifyProvision.server");
  await recordShopifySubscription(integration.user_id, user.user.email, active);
  if (!active) {
    return {
      error: "billing_required",
      billing_url: billingUrl(),
    } as const;
  }
  const provision = await import("@/lib/shopifyProvision.server");
  return provision.shopifyEmbeddedSession(user.user.email);
}

/** Exchanges an App Bridge ID token for a Supabase OTP inside the iframe.
 * No Shopify OAuth / cookie redirect is involved for an installed merchant. */
export const Route = createFileRoute("/api/public/shopify/embedded-login")({
  server: {
    handlers: {
      // App Home launches include a Shopify-signed query. Prefer it because it
      // is available before App Bridge finishes hydrating inside the iframe.
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const mod = await import("@/lib/shopify.server");
          const shop = mod.normalizeShop(url.searchParams.get("shop"));
          const timestamp = Number(url.searchParams.get("timestamp"));
          const fresh = Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp * 1000) < 5 * 60 * 1000;
          if (!shop || !fresh || !mod.verifyRequestHmac(url)) return response({ error: "invalid_embedded_launch" }, 401);
          const session = await issueEmbeddedSession(shop);
          if ("error" in session) return response(session, embeddedErrorStatus(session.error));
          console.info("[shopify embedded session] issued from signed launch", { shop });
          return response(session);
        } catch (error) {
          console.error("[shopify embedded session] signed launch failed", { message: error instanceof Error ? error.message : String(error) });
          return response({ error: "embedded_session_failed" }, 500);
        }
      },
      POST: async ({ request }) => {
        try {
          const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
          const shop = await verifyAppBridgeToken(token);
          if (!shop) {
            console.warn("[shopify embedded session] rejected ID token");
            return response({ error: "invalid_embedded_token" }, 401);
          }
          console.info("[shopify embedded session] verified Shopify token", { shop });
          const session = await issueEmbeddedSession(shop);
          if ("error" in session) {
            console.info("[shopify embedded session] business state", { shop, error: session.error });
            return response(session, embeddedErrorStatus(session.error));
          }
          console.info("[shopify embedded session] Supabase OTP issued", { shop });
          return response(session);
        } catch (error) {
          console.error("[shopify embedded session] failed", { message: error instanceof Error ? error.message : String(error) });
          return response({ error: "embedded_session_failed" }, 500);
        }
      },
    },
  },
});
