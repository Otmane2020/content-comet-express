import type { ShopInfo } from "./shopify.server";

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
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const handle = args.shop.replace(".myshopify.com", "");

  // Re-install of a store we already know: keep the existing account.
  const { data: known } = await supabaseAdmin
    .from("integrations")
    .select("id, user_id, project_id")
    .eq("platform", "shopify")
    .eq("config->>shop", args.shop)
    .limit(1)
    .maybeSingle();

  let userId = known?.user_id ?? null;
  const email = args.info.email ?? `${handle}@shopify-merchant.ranki.ai`;

  if (!userId) {
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { source: "shopify", shopify_shop: args.shop, store_name: args.info.name },
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
        name: args.info.name || handle,
        website_url: args.info.domain,
        industry: args.snapshot.types[0] ?? "E-commerce",
        audience: args.info.country ? `Shoppers in ${args.info.country}` : null,
        keywords: args.snapshot.types.slice(0, 10),
        locale: args.info.locale ?? "en",
        timezone: args.info.timezone ?? "UTC",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not create the project.");
    projectId = inserted.id;
  } else {
    await supabaseAdmin
      .from("projects")
      .update({ website_url: args.info.domain, timezone: args.info.timezone ?? "UTC" })
      .eq("id", projectId);
  }

  const row = {
    user_id: userId,
    project_id: projectId,
    platform: "shopify",
    label: args.info.name || handle,
    config: {
      shop: args.shop,
      blog_id: args.blogId,
      access_token: args.accessToken,
      shop_name: args.info.name,
      site_url: args.info.domain,
      currency: args.info.currency,
      locale: args.info.locale,
      country: args.info.country,
      products_count: args.snapshot.count,
      product_types: args.snapshot.types,
      synced_at: new Date().toISOString(),
    },
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

/** Mirror the Shopify-managed subscription into our own billing table. */
export async function recordShopifySubscription(
  userId: string,
  email: string,
  sub: { id: string; status: string; currentPeriodEnd: string | null } | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: userId,
      email,
      status: sub ? "active" : "inactive",
      cycle: sub ? "monthly" : null,
      stripe_subscription_id: sub ? `shopify:${sub.id}` : null,
      current_period_end: sub?.currentPeriodEnd ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}