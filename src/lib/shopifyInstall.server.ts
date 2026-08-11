import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ShopInfo, ShopifyStoreContent } from "./shopify.server";

/**
 * Shopify installs land on our own domain (standalone), not inside the
 * Admin iframe: the store credentials are parked in shopify_pending_installs
 * for a short window so the merchant can see what we imported and start the
 * plan on /shopify/setup before we create their account.
 */

type PendingRow = {
  id: string;
  shop: string;
  access_token: string;
  blog_id: string;
  store_info: ShopInfo;
  snapshot: { count: number; types: string[]; titles: string[] };
  content: ShopifyStoreContent;
  billing_plan: "monthly" | "annual";
  status: string;
  pending_token: string | null;
  is_claimed: boolean;
  expires_at: string;
};

type PendingTable = {
  upsert: (values: object, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
  select: (columns: string) => {
    eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: PendingRow | null; error: { message: string } | null }> };
  };
  update: (values: object) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
};

function pendingTable() {
  // This table intentionally has no client-side generated type: it is a
  // server-only token vault and is never queried by the browser.
  return (supabaseAdmin.from("shopify_pending_installs" as never) as unknown) as PendingTable;
}

export type PendingSummary = {
  shop: string;
  storeName: string;
  domain: string | null;
  country: string | null;
  currency: string | null;
  productCount: number;
  collectionCount: number;
  pageCount: number;
  productTitles: string[];
  alreadyClaimed: boolean;
};

/** Parks the OAuth token and store snapshot, returns the unguessable token for /shopify/setup. */
export async function createPendingConnection(args: {
  shop: string;
  accessToken: string;
  blogId: string;
  info: ShopInfo;
  snapshot: { count: number; types: string[]; titles: string[] };
  content: ShopifyStoreContent;
}) {
  const pendingToken = randomBytes(24).toString("base64url");
  const { error } = await pendingTable().upsert(
    {
      shop: args.shop,
      access_token: args.accessToken,
      blog_id: args.blogId,
      store_info: args.info,
      snapshot: args.snapshot,
      content: args.content,
      billing_plan: "monthly",
      status: "oauth_connected",
      pending_token: pendingToken,
      is_claimed: false,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "shop" },
  );
  if (error) throw new Error(error.message);
  return pendingToken;
}

async function loadPending(pendingToken: string) {
  const { data, error } = await pendingTable().select("*").eq("pending_token", pendingToken).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

/** Public: the setup screen shows what we imported before the merchant signs up. */
export async function readPending(pendingToken: string): Promise<PendingSummary | null> {
  const row = await loadPending(pendingToken);
  if (!row) return null;
  const info = row.store_info ?? ({} as Partial<ShopInfo>);
  const content = row.content ?? ({} as Partial<ShopifyStoreContent>);
  return {
    shop: row.shop,
    storeName: info.name || row.shop.replace(".myshopify.com", ""),
    domain: info.primaryDomain ?? info.domain ?? null,
    country: info.countryName ?? info.country ?? null,
    currency: info.currency ?? null,
    productCount: content.products?.length ?? row.snapshot?.count ?? 0,
    collectionCount: content.collections?.length ?? 0,
    pageCount: content.pages?.length ?? 0,
    productTitles: (content.products ?? []).slice(0, 6).map((p) => p.title),
    alreadyClaimed: row.is_claimed,
  };
}

/**
 * The merchant pressed "Start". We create (or reuse) their account and
 * project from the store data, then hand them either the Shopify charge
 * confirmation or a one-time sign-in link straight into the dashboard.
 */
export async function claimPending(pendingToken: string, origin: string) {
  const row = await loadPending(pendingToken);
  if (!row) throw new Error("This installation link has expired. Please reinstall the app from Shopify.");

  const shopify = await import("./shopify.server");
  const existingSub = await shopify.activeAppSubscription(row.shop, row.access_token).catch(() => null);
  if (!existingSub) {
    // The billing callback independently verifies this subscription before it
    // creates the merchant account, project, or Shopify destination.
    const returnUrl = `${origin}/api/public/shopify/billing?state=${encodeURIComponent(
      shopify.signState({ origin: "", shop: row.shop, plan: row.billing_plan, ts: Date.now() }),
    )}`;
    const { confirmationUrl } = await shopify.createAppSubscription(
      row.shop,
      row.access_token,
      returnUrl,
      row.billing_plan,
      row.store_info.isTestStore,
    );
    return { url: confirmationUrl };
  }

  const provision = await import("./shopifyProvision.server");
  const created = await provision.provisionShopifyMerchant({
    shop: row.shop,
    accessToken: row.access_token,
    blogId: row.blog_id,
    info: row.store_info,
    snapshot: row.snapshot,
    content: row.content,
  });
  await pendingTable().update({ is_claimed: true, claimed_by: created.userId }).eq("shop", row.shop);
  await provision.recordShopifySubscription(created.userId, created.email, existingSub, row.billing_plan);
  const link = await provision.shopifyLoginLink(created.email, `${origin}/auth/callback?shopify=connected&shop=${encodeURIComponent(row.shop)}`);
  return { url: link };
}
