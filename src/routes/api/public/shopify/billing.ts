import { createFileRoute } from "@tanstack/react-router";
const back = (origin: string, params: Record<string, string>) => new Response(null, { status: 302, headers: { location: `${origin}/app?${new URLSearchParams({ tab: "platforms", ...params })}` } });
const embeddedApp = (shop: string) => `https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/newai-seo-and-marketing-scale`;
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
    const state = mod.verifyState(url.searchParams.get("state"));
    shop = mod.normalizeShop(url.searchParams.get("shop") ?? state?.shop ?? null);
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

    // Provision only after Shopify has confirmed payment (`sub`, above) — and
    // import the catalogue exactly once, here, for EVERY shape of install. This
    // used to run only for a pending install with no resolvable user; a
    // re-install (known shop, known user) skipped it entirely, both here and at
    // the pre-payment fast path in callback.ts, so its catalogue was never
    // refreshed at all.
    let merchant: { userId: string; email: string } | null = null;
    const knownUserId = state.userId ?? integration?.user_id ?? null;
    if (knownUserId) {
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(knownUserId);
      if (user.user?.email) merchant = { userId: knownUserId, email: user.user.email };
    }
    const [blogId, rawInfo, rawSnapshot, rawContent] = await Promise.all([
      mod.resolveBlogId(shop, token),
      mod.fetchShopInfo(shop, token),
      mod.fetchProductSnapshot(shop, token),
      mod.fetchStoreContent(shop, token),
    ]);
    const info = mod.cleanShopifyValue(rawInfo);
    const snapshot = mod.cleanShopifyValue(rawSnapshot);
    const content = mod.cleanShopifyValue(rawContent);
    if (!merchant) {
      if (!pending) throw new Error("Could not resolve the merchant account for this shop.");
      const created = await provision.provisionShopifyMerchant({
        shop,
        accessToken: pending.access_token,
        blogId,
        info,
        snapshot,
        content,
      });
      merchant = { userId: created.userId, email: created.email };
    } else if (integration) {
      const { error } = await supabaseAdmin
        .from("integrations")
        .update({ config: provision.buildShopifyConfig(shop, token, blogId, info, snapshot, content) })
        .eq("platform", "shopify")
        .eq("config->>shop", shop);
      if (error) console.error("[shopify billing] catalogue refresh failed to save", { shop, error: error.message });
    }

    // The integration row is guaranteed to exist now (just created above, or
    // already did) — this is the earliest point in the fresh-install path
    // where registering is safe. Registering any earlier (e.g. right after
    // OAuth in callback.ts, before any row existed) is what produced the
    // "unknown shop" race seen in production: Shopify can deliver a
    // subscription webhook back to us before our own write had landed.
    void mod.registerShopifyWebhooks(shop, token, `${origin}/api/public/hooks/shopify-billing`).catch(() => undefined);

    await provision.recordShopifySubscription(merchant.userId, merchant.email, sub, state.plan ?? pending?.billing_plan ?? "monthly");
    if (pending) await pendingStore.markPendingShopifyInstall(shop, "active");

    // Whether this charge came from a fresh App Store install or from the
    // existing dashboard flow, the Shopify journey finishes back in App Home.
    // embedded-login will establish the Ranki session inside Shopify Admin.
    return new Response(null, { status: 302, headers: { location: embeddedApp(shop) } });
  } catch (e) { console.error("[shopify billing] return failed", e); return fail((e instanceof Error ? e.message : "failed").slice(0, 160)); }
} } } });
