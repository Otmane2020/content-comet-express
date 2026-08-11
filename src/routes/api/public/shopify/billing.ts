import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });

export const Route = createFileRoute("/api/public/shopify/billing")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url); const origin = url.origin; const mod = await import("@/lib/shopify.server");
  try {
    const shop = mod.normalizeShop(url.searchParams.get("shop")); const state = mod.verifyState(url.searchParams.get("state"));
    if (!shop || !state) return back(origin, { shopify: "error", message: "invalid_state" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server"); const provision = await import("@/lib/shopifyProvision.server");
    const { data: integration } = await supabaseAdmin.from("integrations").select("config, user_id").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
    const storedToken = (integration?.config as { access_token?: string } | null)?.access_token;
    if (integration?.user_id && storedToken && state.userId) {
      const sub = await mod.activeAppSubscription(shop, storedToken); const { data: user } = await supabaseAdmin.auth.admin.getUserById(state.userId); const email = user.user?.email ?? `${shop}@shopify-merchant.ranki.ai`;
      await provision.recordShopifySubscription(state.userId, email, sub, state.plan ?? "monthly"); if (!sub) return back(origin, { shopify: "error", message: "billing_declined" }); return back(origin, { shopify: "connected" });
    }
    const pendingStore = await import("@/lib/shopifyPendingInstall.server"); const pending = await pendingStore.getPendingShopifyInstall(shop);
    if (!pending) return back(origin, { shopify: "error", message: "install_expired" });
    const sub = await mod.activeAppSubscription(shop, pending.access_token);
    if (!sub) { await pendingStore.markPendingShopifyInstall(shop, "declined"); return back(origin, { shopify: "error", message: "billing_declined" }); }
    const created = await provision.provisionShopifyMerchant({ shop, accessToken: pending.access_token, blogId: pending.blog_id, info: pending.store_info, snapshot: pending.snapshot, content: pending.content });
    await provision.recordShopifySubscription(created.userId, created.email, sub, pending.billing_plan); await pendingStore.markPendingShopifyInstall(shop, "active");
    return new Response(null, { status: 302, headers: { location: await provision.shopifyLoginLink(created.email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`) } });
  } catch (e) { console.error("[shopify billing] return failed", e); return back(origin, { shopify: "error", message: (e instanceof Error ? e.message : "failed").slice(0, 160) }); }
} } } });
