import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });
const installError = (origin: string, shop: string | null, message: string) =>
  new Response(null, { status: 302, headers: { location: `${origin}/shopify/error?${new URLSearchParams({ ...(shop ? { shop } : {}), message })}` } });
const embeddedApp = (shop: string) =>
  `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/newai-seo-and-marketing-scale`;
async function step<T>(name: string, p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { throw new Error(`[${name}] ${e instanceof Error ? e.message : String(e)}`); }
}

export const Route = createFileRoute("/api/public/shopify/callback")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url); const origin = url.origin; const mod = await import("@/lib/shopify.server");
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

    if (!state) {
      const info = {
        name: shop.replace(".myshopify.com", ""), email: null, domain: null, currency: null, timezone: null,
        locale: null, country: null, description: null, shopId: null, myshopifyDomain: shop, primaryDomain: null,
        countryCode: null, countryName: null, phone: null, city: null, address1: null, planName: null,
        isTestStore: process.env["SHOPIFY_BILLING_TEST"] === "1",
      };
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (!active) {
        const pending = await import("@/lib/shopifyPendingInstall.server");
        await pending.savePendingShopifyInstall({
          shop, access_token, blog_id: "", store_info: info,
          snapshot: { count: 0, types: [], titles: [] },
          content: { products: [], collections: [], pages: [], policies: [], articles: [] },
          billing_plan: "monthly",
        });
        return new Response(null, { status: 302, headers: { location: embeddedApp(shop) } });
      }
    }

    const [blogId, rawInfo, rawSnapshot, rawContent] = await Promise.all([
      step("resolveBlogId", mod.resolveBlogId(shop, access_token)),
      step("fetchShopInfo", mod.fetchShopInfo(shop, access_token)),
      step("fetchProductSnapshot", mod.fetchProductSnapshot(shop, access_token)),
      step("fetchStoreContent", mod.fetchStoreContent(shop, access_token)),
    ]);
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
      const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, plan: state.plan ?? "monthly", flow: "dashboard", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, state.plan ?? "monthly", info.isTestStore); return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    const { data: existing } = await supabaseAdmin.from("integrations").select("user_id").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
    if (existing?.user_id) {
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (active) return new Response(null, { status: 302, headers: { location: embeddedApp(shop) } });
      const pending = await import("@/lib/shopifyPendingInstall.server");
      await pending.savePendingShopifyInstall({ shop, access_token, blog_id: blogId, store_info: info, snapshot, content, billing_plan: "monthly" });
      const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, flow: "install", ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, "monthly", info.isTestStore);
      return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    if (!state) {
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null);
      if (active) {
        const merchant = await provision.provisionShopifyMerchant({ shop, accessToken: access_token, blogId, info, snapshot, content });
        await provision.recordShopifySubscription(merchant.userId, merchant.email, active, "monthly");
        return new Response(null, { status: 302, headers: { location: embeddedApp(shop) } });
      }
    }
    const pending = await import("@/lib/shopifyPendingInstall.server");
    await pending.savePendingShopifyInstall({ shop, access_token, blog_id: blogId, store_info: info, snapshot, content, billing_plan: "monthly" });
    const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(mod.signState({ origin: "", shop, flow: "install", ts: Date.now() }))}`;
    const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, "monthly", info.isTestStore);
    return new Response(null, { status: 302, headers: { location: confirmationUrl } });
  } catch (e) { console.error("[shopify callback] installation failed", e); return fail((e instanceof Error ? e.message : "failed").slice(0, 160)); }
} } } });
