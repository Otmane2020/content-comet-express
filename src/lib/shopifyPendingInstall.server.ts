import type { ShopInfo, ShopifyStoreContent } from "./shopify.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type PendingInstall = {
  id: string;
  shop: string;
  access_token: string;
  blog_id: string;
  store_info: ShopInfo;
  snapshot: { count: number; types: string[]; titles: string[] };
  content: ShopifyStoreContent;
  billing_plan: "monthly" | "annual";
  status: string;
  expires_at: string;
};

type PendingTable = {
  upsert: (values: object, options: { onConflict: string }) => Promise<{ error: { message: string } | null }>;
  select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: PendingInstall | null; error: { message: string } | null }> } };
  update: (values: object) => { eq: (column: string, value: string) => Promise<{ error: { message: string } | null }> };
};

function pendingTable() {
  // This table intentionally has no client-side generated type: it is a
  // server-only token vault and is never queried by the browser.
  return (supabaseAdmin.from("shopify_pending_installs" as never) as unknown) as PendingTable;
}

export async function savePendingShopifyInstall(args: Omit<PendingInstall, "id" | "status" | "expires_at">) {
  const { error } = await pendingTable().upsert(
    {
      ...args,
      status: "billing_pending",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "shop" },
  );
  if (error) throw new Error(error.message);
}

export async function getPendingShopifyInstall(shop: string) {
  const { data, error } = await pendingTable().select("*").eq("shop", shop).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

export async function markPendingShopifyInstall(shop: string, status: "active" | "declined") {
  const { error } = await pendingTable().update({ status }).eq("shop", shop);
  if (error) throw new Error(error.message);
}

export async function setPendingShopifyPlan(shop: string, billingPlan: "monthly" | "annual") {
  const { error } = await pendingTable().update({ billing_plan: billingPlan }).eq("shop", shop);
  if (error) throw new Error(error.message);
}
