import { createHmac, timingSafeEqual } from "crypto";
import { createFileRoute } from "@tanstack/react-router";

const response = (body: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

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
    .select("user_id")
    .eq("platform", "shopify")
    .eq("config->>shop", shop)
    .limit(1)
    .maybeSingle();
  if (!integration?.user_id) return { error: "shop_not_installed" } as const;
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
  if (!user.user?.email) return { error: "merchant_not_found" } as const;
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
          if ("error" in session) return response(session, 404);
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
            console.warn("[shopify embedded session] installed shop not found", { shop });
            return response(session, 404);
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
