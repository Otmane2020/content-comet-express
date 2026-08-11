import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });

export const Route = createFileRoute("/api/public/shopify/callback")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url); const origin = url.origin; const mod = await import("@/lib/shopify.server");
  try {
    const shop = mod.normalizeShop(url.searchParams.get("shop")); const code = url.searchParams.get("code"); const state = mod.verifyState(url.searchParams.get("state"));
    if (!shop || !code) return back(origin, { shopify: "error", message: "missing_params" });
    if (!mod.verifyRequestHmac(url)) return back(origin, { shopify: "error", message: "bad_signature" });
    const { access_token } = await mod.exchangeCode(shop, code);
    console.info("[shopify callback] OAuth token exchanged", { shop });
    const [blogId, info, snapshot, content] = await Promise.all([mod.resolveBlogId(shop, access_token), mod.fetchShopInfo(shop, access_token), mod.fetchProductSnapshot(shop, access_token), mod.fetchStoreContent(shop, access_token)]);
    console.info("[shopify callback] Shopify store data imported", { shop });
    const provision = await import("@/lib/shopifyProvision.server"); const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (state?.userId && state.projectId) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(state.userId); const email = user.user?.email ?? info.email ?? `${shop}@shopify-merchant.ranki.ai`;
      const { data: existing } = await supabaseAdmin.from("integrations").select("id").eq("project_id", state.projectId).eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
      const row = { user_id: state.userId, project_id: state.projectId, platform: "shopify", label: info.name || shop.replace(".myshopify.com", ""), config: provision.buildShopifyConfig(shop, access_token, blogId, info, snapshot, content), status: "connected", last_error: null };
      const { error } = existing ? await supabaseAdmin.from("integrations").update(row).eq("id", existing.id) : await supabaseAdmin.from("integrations").insert(row); if (error) throw new Error(error.message);
      const active = await mod.activeAppSubscription(shop, access_token).catch(() => null); await provision.recordShopifySubscription(state.userId, email, active, state.plan ?? "monthly");
      if (active) return back(origin, { shopify: "connected" });
      const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(mod.signState({ ...state, shop, ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, state.plan ?? "monthly"); return new Response(null, { status: 302, headers: { location: confirmationUrl } });
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
      const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(mod.signState({ origin, shop, ts: Date.now() }))}`;
      const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, "monthly");
      return new Response(null, { status: 302, headers: { location: confirmationUrl } });
    }
    const pending = await import("@/lib/shopifyPendingInstall.server"); await pending.savePendingShopifyInstall({ shop, access_token, blog_id: blogId, store_info: info, snapshot, content, billing_plan: "monthly" });
    const returnUrl = `${origin}/api/public/shopify/billing?shop=${encodeURIComponent(shop)}&state=${encodeURIComponent(mod.signState({ origin, shop, ts: Date.now() }))}`;
    const { confirmationUrl } = await mod.createAppSubscription(shop, access_token, returnUrl, "monthly"); return new Response(null, { status: 302, headers: { location: confirmationUrl } });
  } catch (e) { console.error("[shopify callback] installation failed", e); return back(origin, { shopify: "error", message: (e instanceof Error ? e.message : "failed").slice(0, 160) }); }
} } } });
