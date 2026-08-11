import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { cleanShopifyValue } from "./shopify.server";
import type { ShopInfo, ShopifyStoreContent } from "./shopify.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function findUserByEmail(admin: Admin, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Everything captured about the store, persisted on integrations.config for onboarding + autopilot. */
export function buildShopifyConfig(
  shop: string,
  accessToken: string,
  blogId: string,
  info: ShopInfo,
  snapshot: { count: number; types: string[]; titles: string[] },
  content?: ShopifyStoreContent,
) {
  return {
    shop,
    shop_id: info.shopId,
    myshopify_domain: info.myshopifyDomain,
    primary_domain: info.primaryDomain,
    blog_id: blogId,
    access_token: accessToken,
    shop_name: info.name,
    shop_email: info.email,
    site_url: info.domain,
    currency: info.currency,
    locale: info.locale,
    country: info.country,
    country_code: info.countryCode,
    timezone: info.timezone,
    phone: info.phone,
    city: info.city,
    address1: info.address1,
    plan: info.planName,
    description: info.description,
    products_count: snapshot.count,
    product_types: snapshot.types,
    products_sample: (content?.products ?? []).slice(0, 10).map((p) => ({
      title: p.title,
      handle: p.handle,
      url: p.url,
      productType: p.productType,
      price: p.variants[0]?.price ?? null,
      images: p.images.slice(0, 1),
    })),
    collections: (content?.collections ?? []).slice(0, 20).map((c) => ({
      title: c.title,
      handle: c.handle,
      url: c.url,
      kind: c.kind,
    })),
    pages: (content?.pages ?? []).map((p) => ({ title: p.title, handle: p.handle, url: p.url })),
    policies: (content?.policies ?? []).map((p) => ({ title: p.title, handle: p.handle })),
    articles: (content?.articles ?? []).slice(0, 100).map((a) => ({ title: a.title, handle: a.handle, url: a.url, blog_id: a.blogId })),
    synced_at: new Date().toISOString(),
  };
}

export type LocalInfoFacts = {
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
};

/** Real address/phone for local_aeo content — never invented, only what Shopify already told us. */
export function shopifyLocalInfo(
  config: Record<string, unknown> | null | undefined,
): LocalInfoFacts | undefined {
  if (!config) return undefined;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const info = {
    phone: str(config["phone"]),
    address: str(config["address1"]),
    city: str(config["city"]),
    country: str(config["country"]),
  };
  return info.phone || info.address || info.city || info.country ? info : undefined;
}

/** Looks up the project's connected Shopify store and reads its real local details. */
export async function fetchShopifyLocalInfo(supabase: SupabaseClient<Database>, projectId: string) {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("project_id", projectId)
    .eq("platform", "shopify")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  return shopifyLocalInfo((data?.config ?? null) as Record<string, unknown> | null);
}

/**
 * A merchant installing from Shopify never fills a signup form: we create the
 * account, the project and the destination from the store data itself.
 */
export async function provisionShopifyMerchant(args: {
  shop: string;
  accessToken: string;
  blogId: string;
  info: ShopInfo;
  snapshot: { count: number; types: string[]; titles: string[] };
  content?: ShopifyStoreContent;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const handle = args.shop.replace(".myshopify.com", "");
  // Belt and braces: the callback already cleans what it fetches, but this also
  // runs from claimPending with a payload replayed out of shopify_pending_installs.
  const info = cleanShopifyValue(args.info);
  const content = cleanShopifyValue(args.content);

  // Re-install of a store we already know: keep the existing account.
  const { data: known } = await supabaseAdmin
    .from("integrations")
    .select("id, user_id, project_id")
    .eq("platform", "shopify")
    .eq("config->>shop", args.shop)
    .limit(1)
    .maybeSingle();

  let userId = known?.user_id ?? null;
  // Shopify merchants receive a deterministic Ranki identity only once their
  // native Shopify subscription is confirmed. It avoids depending on a store
  // contact email and keeps one account per installed shop.
  const email = `user1.${handle}@ranki.ai`;

  if (!userId) {
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "shopify", shopify_shop: args.shop, store_name: info.name },
    });
    userId = created.data.user?.id ?? (await findUserByEmail(supabaseAdmin, email));
    if (!userId) throw new Error(created.error?.message ?? "Could not create the merchant account.");
  }

  // Project: reuse the merchant's first project, otherwise build it from the store.
  let projectId = known?.project_id ?? null;
  if (!projectId) {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    projectId = project?.id ?? null;
  }
  if (!projectId) {
    const { data: inserted, error } = await supabaseAdmin
      .from("projects")
      .insert({
        user_id: userId,
        name: info.name || handle,
        website_url: info.domain,
        // `snapshot.types[0]` is a raw Shopify product type — on a store with a
        // gift card it is literally "giftcard", which then drives keyword
        // research as if that were the merchant's line of business. The real
        // industry comes from the canonical profile built from the site.
        industry: "E-commerce",
        audience: info.country ? `Shoppers in ${info.country}` : null,
        keywords: args.snapshot.types.slice(0, 10),
        locale: info.locale ?? "en",
        timezone: info.timezone ?? "UTC",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not create the project.");
    projectId = inserted.id;
  } else {
    // Never overwrite a website the merchant corrected by hand. A store with no
    // custom domain reports its myshopify.com address here, and re-imposing it
    // on every reinstall would keep pointing research at a bare storefront
    // instead of the real site — only fill it in when it is still missing or
    // still the myshopify address.
    const { data: current } = await supabaseAdmin
      .from("projects")
      .select("website_url")
      .eq("id", projectId)
      .maybeSingle();
    const existingUrl = current?.website_url ?? null;
    const isPlaceholder = !existingUrl || /\.myshopify\.com/i.test(existingUrl);
    await supabaseAdmin
      .from("projects")
      .update({
        ...(isPlaceholder && info.domain ? { website_url: info.domain } : {}),
        timezone: info.timezone ?? "UTC",
      })
      .eq("id", projectId);
  }

  const row = {
    user_id: userId,
    project_id: projectId,
    platform: "shopify",
    label: info.name || handle,
    config: buildShopifyConfig(args.shop, args.accessToken, args.blogId, info, args.snapshot, content),
    status: "connected",
    last_error: null,
    auto_publish: true,
  };

  const { error: saveError } = known
    ? await supabaseAdmin.from("integrations").update(row).eq("id", known.id)
    : await supabaseAdmin.from("integrations").insert(row);
  if (saveError) throw new Error(saveError.message);

  return { userId, projectId, email };
}

/** One-time sign-in link so the merchant lands logged in, without a password. */
export async function shopifyLoginLink(email: string, redirectTo: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error || !data.properties?.action_link) {
    throw new Error(error?.message ?? "Could not create the sign-in link.");
  }
  return data.properties.action_link;
}

/** Creates a one-time OTP hash for an authenticated Shopify App Bridge launch.
 * The browser verifies it locally, so its Supabase session lives in the iframe
 * partition and no cross-site redirect or cookie is required. */
export async function shopifyEmbeddedSession(email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(error?.message ?? "Could not create embedded session.");
  // Supabase verifies a generated email-link token hash with the current
  // `email` verification type. `magiclink` is legacy and rejects valid hashes
  // on recent GoTrue versions.
  return { token_hash: data.properties.hashed_token, type: "email" as const };
}

/** Mirror the Shopify-managed subscription into our own billing table. */
export async function recordShopifySubscription(
  userId: string,
  email: string,
  sub: { id: string; status: string; currentPeriodEnd: string | null } | null,
  cycle: "monthly" | "annual" = "monthly",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      email,
      status: sub ? "active" : "inactive",
      cycle: sub ? cycle : null,
      stripe_subscription_id: sub ? `shopify:${sub.id}` : null,
      current_period_end: sub?.currentPeriodEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}
