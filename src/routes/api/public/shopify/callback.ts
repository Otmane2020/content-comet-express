import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });
/** An App Store merchant has no Ranki session yet, so /app would only show them
 * the generic sign-up wizard with a toast — the dead end that hid every real
 * install failure so far. Send them somewhere that states the cause and can
 * re-enter OAuth instead. */
const installError = (origin: string, shop: string | null, message: string) =>
  new Response(null, { status: 302, headers: { location: `${origin}/shopify/error?${new URLSearchParams({ ...(shop ? { shop } : {}), message })}` } });
/** Labels which step threw — an unlabeled crash here otherwise just says
 * "TypeError: ..." with no way to tell which of several parallel Shopify
 * Admin API calls actually failed. */
async function step<T>(name: string, p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[${name}] ${msg}`);
  }
}

export const Route = createFileRoute("/api/public/shopify/callback")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url); const origin = url.origin; const mod = await import("@/lib/shopify.server");
  // Tracked outside the try so the catch knows where to send the merchant back to.
  let shop: string | null = null;
  let flow: "install" | "dashboard" = "install";
  const fail = (message: string) => (flow === "dashboard" ? back(origin, { shopify: "error", message }) : installError(origin, shop, message));
  try {
    shop = mod.normalizeShop(url.searchParams.get("shop")); const code = url.searchParams.get("code"); const state = mod.verifyState(url.searchParams.get("state"));
    flow = mod.stateFlow(state);
    if (!shop || !code) return fail("missing_params");
    if (!mod.verifyRequestHmac(url)) return fail("bad_signature");
    const { access_token } = await step("exchangeCode", mod.exchangeCode(shop, code));
    console.info("[shopify callback] OAuth token exchanged", { shop });
    const [blogId, rawInfo, rawSnapshot, rawContent] = await Promise.all([
      step("resolveBlogId", mod.resolveBlogId(shop, access_token)),
      step("fetchShopInfo", mod.fetchShopInfo(shop, access_token)),
      step("fetchProductSnapshot", mod.fetchProductSnapshot(shop, access_token)),
      step("fetchStoreContent", mod.fetchStoreContent(shop, access_token)),
    ]);
    // Strip U+FFFD here, once, before any of the three branches below writes to
    // Supabase: a single corrupted store field otherwise kills the whole install
    // with an opaque "Cannot convert argument to a ByteString" TypeError.
    const info = mod.cleanShopifyValue(rawInfo);
    const snapshot = mod.cleanShopifyValue(rawSnapshot);
    const content = mod.cleanShopifyValue(rawContent);
    console.info("[shopify callback] Shopify store data imported", { shop });
    const provision = await import("@/lib/shopifyProvision.server"); const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (state?.userId && state.projectId) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(state.userId); const email = user.user?.email ?? info.email ?? `${shop}@shopify-merchant.ranki.ai`;
      const { data: existing } = await supabaseAdmin.from("integrations").select("id").eq("project_id", state.projectId).eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
      const row = { user_id: state.userId, project_id: state.projectId, platform: "shopify", label: info.name || shop.replace(".myshopify.com", ""), config: provision.buildShopifyConfig(shop, access_token, blogId, info, snapshot, content), status: "connected", last_error: null };
      const { error } = existing ? await supabaseAdmin.from("integrations").update(row).eq("id", existing.id) : await supabaseAdmin.from("integrations").insert(row); if (error) throw new Error(error.message);
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null); await provision.recordShopifySubscription(state.userId, email, active, state.plan ?? "monthly");
      if (active) return back(origin, { shopify: "connected" });
      const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(mod.signState({ ...state, shop, flow: "dashboard", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, state.plan ?? "monthly", info.isTestStore); return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    const { data: existing } = await supabaseAdmin.from("integrations").select("user_id").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
    if (existing?.user_id) {
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (active) {
        const { data: user } = await supabaseAdmin.auth.admin.getUserById(existing.user_id); const email = user.user?.email;
        if (!email) throw new Error("Could not resolve the existing merchant account.");
        return new Response(null, { status: 302, headers: { location: await provision.shopifyLoginLink(email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`) } });
      }
      const pending = await import("@/lib/shopifyPendingInstall.server");
      await pending.savePendingShopifyInstall({ shop, access_token, blog_id: blogId, store_info: info, snapshot, content, billing_plan: "monthly" });
      const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(mod.signState({ origin, shop, userId: existing.user_id, flow: "install", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, "monthly", info.isTestStore);
      return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    // Brand-new merchant, never seen this shop before: show what we imported
    // on our own domain before creating an account or touching Shopify
    // billing, instead of bouncing them straight into a charge screen.
    const install = await import("@/lib/shopifyInstall.server");
    const pendingToken = await install.createPendingConnection({ shop, accessToken: access_token, blogId, info, snapshot, content });
    return new Response(null, { status: 302, headers: { location: `${origin}/shopify/setup?${new URLSearchParams({ shop, pending_token: pendingToken })}` } });
  } catch (e) { console.error("[shopify callback] installation failed", e); return fail((e instanceof Error ? e.message : "failed").slice(0, 160)); }
} } } });
