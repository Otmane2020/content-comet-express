import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });
/** An App Store merchant has no Ranki session yet, so /app would only show them
 * the generic sign-up wizard with a toast — the dead end that hid every real
 * install failure so far. Send them somewhere that states the cause and can
 * re-enter OAuth instead. */
const installError = (origin: string, shop: string | null, message: string) =>
  new Response(null, { status: 302, headers: { location: `${origin}/shopify/error?${new URLSearchParams({ ...(shop ? { shop } : {}), message })}` } });
// App Home is the only place an unpaid install may show the plan picker: it
// gives the merchant the native Shopify Admin chrome instead of a Ranki tab.
const embeddedApp = (shop: string) =>
  `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/newai-seo-and-marketing-scale`;
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
    const selectedPlan = state?.plan === "annual" ? "annual" : "monthly";
    if (!shop || !code) return fail("missing_params");
    if (!mod.verifyRequestHmac(url)) return fail("bad_signature");
    const { access_token } = await step("exchangeCode", mod.exchangeCode(shop, code));
    console.info("[shopify callback] OAuth token exchanged", { shop });
    // Webhook registration moved to AFTER each branch below writes its own
    // `integrations` row (or, for a brand-new merchant, deferred to
    // billing.ts — no such row exists yet at OAuth time). Registering here,
    // before any row existed, is what produced the "unknown shop" race seen
    // in production: Shopify can deliver a subscription webhook back to us
    // fast enough to arrive before our own write landed. Fire-and-forget
    // either way — never blocks the install; the 24h reconciliation window
    // in embedded-login.ts is the backstop if a registration or delivery is
    // missed.
    const webhookUrl = `${origin}/api/public/hooks/shopify-billing`;
    // A first App Store install should reach Shopify billing immediately. Only
    // fetch the small shop record needed to mark a development store as test;
    // the product/catalog import runs after Shopify confirms the subscription.
    if (!state) {
      const info = {
        name: shop.replace(".myshopify.com", ""), email: null, domain: null, currency: null, timezone: null,
        locale: null, country: null, description: null, shopId: null, myshopifyDomain: shop, primaryDomain: null,
        countryCode: null, countryName: null, phone: null, city: null, address1: null, planName: null,
        isTestStore: process.env["SHOPIFY_BILLING_TEST"] === "1",
      };
      // A previous billing return can have succeeded while provisioning was
      // interrupted. Resume that paid install instead of creating a second
      // Shopify subscription. Checked regardless of whether this shop has been
      // installed before: a re-install with no active subscription must take
      // this fast path too, not fall through to the full catalogue import
      // below before the merchant has paid.
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (!active) {
        const pending = await import("@/lib/shopifyPendingInstall.server");
        await pending.savePendingShopifyInstall({
          shop, access_token, blog_id: "", store_info: info,
          snapshot: { count: 0, types: [], titles: [] },
          content: { products: [], collections: [], pages: [], policies: [], articles: [] },
          billing_plan: "monthly",
        });
        // Re-enter App Home. embedded-login recognises this pending install
        // and serves the plan picker *inside* Shopify Admin.
        return new Response(null, { status: 302, headers: { location: embeddedApp(shop) } });
      }
    }
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
      // The integration row exists now — safe to register from here on.
      void mod.registerShopifyWebhooks(shop, access_token, webhookUrl).catch(() => undefined);
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null); await provision.recordShopifySubscription(state.userId, email, active, state.plan ?? "monthly");
      if (active) return back(origin, { shopify: "connected" });
      const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, plan: state.plan ?? "monthly", flow: "dashboard", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, state.plan ?? "monthly", info.isTestStore); return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    const { data: existing } = await supabaseAdmin.from("integrations").select("id, user_id, config").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
    if (existing?.user_id) {
      // Reinstall/reconnect: the OAuth exchange above already proved the new
      // token can read the shop, blog, catalogue and pages. Replace the revoked
      // token in the SAME destination before checking billing. Previously this
      // branch never wrote the fresh token, so the UI kept showing the old
      // disconnected row even after a successful reinstall.
      const refreshedConfig = provision.buildShopifyConfig(shop, access_token, blogId, info, snapshot, content);
      const { error: refreshError } = await supabaseAdmin
        .from("integrations")
        .update({ config: refreshedConfig, status: "connected", last_error: null })
        .eq("id", existing.id);
      if (refreshError) throw new Error(refreshError.message);
      void mod.registerShopifyWebhooks(shop, access_token, webhookUrl).catch(() => undefined);
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (active) {
        const { data: user } = await supabaseAdmin.auth.admin.getUserById(existing.user_id); const email = user.user?.email;
        if (!email) throw new Error("Could not resolve the existing merchant account.");
        return new Response(null, { status: 302, headers: { location: await provision.shopifyLoginLink(email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`) } });
      }
      const pending = await import("@/lib/shopifyPendingInstall.server");
      await pending.savePendingShopifyInstall({ shop, access_token, blog_id: blogId, store_info: info, snapshot, content, billing_plan: selectedPlan });
      const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, plan: selectedPlan, flow: "dashboard", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, selectedPlan, info.isTestStore);
      return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    if (!state) {
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (active) {
        const merchant = await provision.provisionShopifyMerchant({ shop, accessToken: access_token, blogId, info, snapshot, content });
        // provisionShopifyMerchant just wrote the integration row — safe now.
        void mod.registerShopifyWebhooks(shop, access_token, webhookUrl).catch(() => undefined);
        await provision.recordShopifySubscription(merchant.userId, merchant.email, active, "monthly");
        return new Response(null, { status: 302, headers: { location: await provision.shopifyLoginLink(merchant.email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`) } });
      }
    }
    // Brand-new merchant: park only the encrypted OAuth/install data, then
    // open Shopify billing immediately. The Supabase user and project are
    // deliberately created by /billing only after Shopify confirms payment —
    // no `integrations` row exists yet at this point, so webhook
    // registration is deferred to billing.ts, right after it writes one.
    const pending = await import("@/lib/shopifyPendingInstall.server");
    await pending.savePendingShopifyInstall({
      shop,
      access_token,
      blog_id: blogId,
      store_info: info,
      snapshot,
      content,
      billing_plan: selectedPlan,
    });
    // Shopify caps `returnUrl` at 255 characters. Keep the shop in signed
    // state (so the return cannot be retargeted), but omit redundant origin,
    // plan and flow values: /billing already has safe defaults for those.
    const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(
      mod.signState({ origin: "", shop, ts: Date.now() }),
    )}`;
    const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, selectedPlan, info.isTestStore);
    return new Response(null, { status: 302, headers: { location: confirmationUrl } });
  } catch (e) { console.error("[shopify callback] installation failed", e); return fail((e instanceof Error ? e.message : "failed").slice(0, 160)); }
} } } });
