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

/** Exchanges an App Bridge ID token for a Supabase OTP inside the iframe.
 * No Shopify OAuth / cookie redirect is involved for an installed merchant. */
export const Route = createFileRoute("/api/public/shopify/embedded-login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
          const shop = await verifyAppBridgeToken(token);
          if (!shop) return response({ error: "invalid_embedded_token" }, 401);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: integration } = await supabaseAdmin.from("integrations").select("user_id").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
          if (!integration?.user_id) return response({ error: "shop_not_installed" }, 404);
          const { data: user } = await supabaseAdmin.auth.admin.getUserById(integration.user_id);
          if (!user.user?.email) return response({ error: "merchant_not_found" }, 404);
          const provision = await import("@/lib/shopifyProvision.server");
          const session = await provision.shopifyEmbeddedSession(user.user.email);
          return response(session);
        } catch (error) {
          console.error("[shopify embedded session]", error);
          return response({ error: "embedded_session_failed" }, 500);
        }
      },
    },
  },
});
