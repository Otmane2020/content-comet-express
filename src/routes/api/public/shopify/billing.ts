import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });
/** See callback.ts: a merchant coming back from the charge screen on an install
 * has no session yet, so /app would only offer them the sign-up wizard. */
const installError = (origin: string, shop: string | null, message: string) =>
  new Response(null, { status: 302, headers: { location: `${origin}/shopify/error?${new URLSearchParams({ ...(shop ? { shop } : {}), message })}` } });

export const Route = createFileRoute("/api/public/shopify/billing")({ server: { handlers: { GET: async ({ request }) => {
  const url = new URL(request.url); const origin = url.origin; const mod = await import("@/lib/shopify.server");
  let shop: string | null = null;
  let flow: "install" | "dashboard" = "install";
  const fail = (message: string) => (flow === "dashboard" ? back(origin, { shopify: "error", message }) : installError(origin, shop, message));
  try {
    shop = mod.normalizeShop(url.searchParams.get("shop"));
    const state = mod.verifyState(url.searchParams.get("state"));
    flow = mod.stateFlow(state);
    if (!shop || !state || (state.shop && state.shop !== shop)) return fail("invalid_state");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const provision = await import("@/lib/shopifyProvision.server");
    const pendingStore = await import("@/lib/shopifyPendingInstall.server");

    const { data: integration } = await supabaseAdmin.from("integrations").select("config, user_id").eq("platform", "shopify").eq("config->>shop", shop).limit(1).maybeSingle();
    const storedToken = (integration?.config as { access_token?: string } | null)?.access_token;
    const pending = await pendingStore.getPendingShopifyInstall(shop);
    const token = storedToken ?? pending?.access_token;
    if (!token) return fail("install_expired");

    // Shopify sends the merchant back here whether they approved or declined —
    // the live subscription is the only thing that says which.
    const sub = await mod.activeAppSubscription(shop, token);
    if (!sub) {
      if (pending) await pendingStore.markPendingShopifyInstall(shop, "declined");
      return fail("billing_declined");
    }

    // Every current entry point signs the merchant into the state, and the
    // install flow already provisioned them in claimPending. Provisioning here
    // is the fallback for a shop we only hold as a pending install.
    let merchant: { userId: string; email: string } | null = null;
    const knownUserId = state.userId ?? integration?.user_id ?? null;
    if (knownUserId) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(knownUserId);
      if (user.user?.email) merchant = { userId: knownUserId, email: user.user.email };
    }
    if (!merchant) {
      if (!pending) throw new Error("Could not resolve the merchant account for this shop.");
      const [blogId, info, snapshot, content] = await Promise.all([
        mod.resolveBlogId(shop, pending.access_token),
        mod.fetchShopInfo(shop, pending.access_token),
        mod.fetchProductSnapshot(shop, pending.access_token),
        mod.fetchStoreContent(shop, pending.access_token),
      ]);
      const created = await provision.provisionShopifyMerchant({
        shop,
        accessToken: pending.access_token,
        blogId,
        info: mod.cleanShopifyValue(info),
        snapshot: mod.cleanShopifyValue(snapshot),
        content: mod.cleanShopifyValue(content),
      });
      merchant = { userId: created.userId, email: created.email };
    }

    // Flips the subscriptions row claimPending wrote as "inactive" to active.
    await provision.recordShopifySubscription(merchant.userId, merchant.email, sub, state.plan ?? pending?.billing_plan ?? "monthly");
    if (pending) await pendingStore.markPendingShopifyInstall(shop, "active");

    if (flow === "dashboard") return back(origin, { shopify: "connected" });
    return new Response(null, { status: 302, headers: { location: await provision.shopifyLoginLink(merchant.email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(shop)}`) } });
  } catch (e) { console.error("[shopify billing] return failed", e); return fail((e instanceof Error ? e.message : "failed").slice(0, 160)); }
} } } });
