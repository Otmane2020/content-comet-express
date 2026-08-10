/**
 * Single source of truth for turning Stripe objects into rows of
 * public.subscriptions. Used by the webhook AND by the reconcile path, so both
 * can never disagree about what "active" means.
 */

export type BillingLogScope = "stripe" | "webhook" | "supabase" | "reconcile";

export function billingLog(scope: BillingLogScope, message: string, extra?: unknown) {
  const payload = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.log(`[billing:${scope}] ${message}${payload}`);
}

export function billingError(scope: BillingLogScope, message: string, extra?: unknown) {
  const payload = extra === undefined ? "" : ` ${JSON.stringify(extra)}`;
  console.error(`[billing:${scope}] ${message}${payload}`);
}

export function stripeKey() {
  const key = process.env["STRIPE_LIVE_API_KEY"];
  if (!key) throw new Error("Stripe is not configured (STRIPE_LIVE_API_KEY missing).");
  return key;
}

export async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${stripeKey()}` },
  });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) {
    billingError("stripe", `GET ${path} failed`, { status: res.status, error: json.error?.message });
    throw new Error(json.error?.message ?? `Stripe request failed (${res.status})`);
  }
  return json;
}

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  items?: {
    data: {
      current_period_end?: number | null;
      price?: { recurring?: { interval?: string } | null } | null;
    }[];
  };
};

export const ACTIVE_STATUSES = ["active", "trialing", "past_due"] as const;

export function isActiveStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

export function customerId(sub: Pick<StripeSubscription, "customer">) {
  return typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
}

/** Stripe moved current_period_end onto the line items — read both shapes. */
export function periodEndIso(sub: StripeSubscription) {
  const unix = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return unix ? new Date(unix * 1000).toISOString() : null;
}

export function cycleOf(sub: StripeSubscription) {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  return interval === "year" ? "annual" : interval === "month" ? "monthly" : null;
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Stripe does not always hand us a user id. Try, in order: explicit metadata,
 * the subscription we already stored for that Stripe customer, then the auth
 * account matching the billing email.
 */
export async function resolveUserId(hints: {
  metadataUserId?: string | null;
  clientReferenceId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  email?: string | null;
}): Promise<{ userId: string | null; via: string }> {
  const direct = hints.metadataUserId || hints.clientReferenceId;
  if (direct) return { userId: direct, via: "metadata" };

  const db = await admin();

  if (hints.stripeSubscriptionId) {
    const { data } = await db
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", hints.stripeSubscriptionId)
      .maybeSingle();
    if (data?.user_id) return { userId: data.user_id, via: "db:subscription_id" };
  }

  if (hints.stripeCustomerId) {
    const { data } = await db
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", hints.stripeCustomerId)
      .maybeSingle();
    if (data?.user_id) return { userId: data.user_id, via: "db:customer_id" };
  }

  const email = hints.email?.trim().toLowerCase();
  if (email) {
    for (let page = 1; page <= 5; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data.users.length) break;
      const hit = data.users.find((u) => u.email?.toLowerCase() === email);
      if (hit) return { userId: hit.id, via: "auth:email" };
      if (data.users.length < 200) break;
    }
  }

  return { userId: null, via: "unresolved" };
}

export async function upsertSubscriptionRow(row: {
  user_id: string;
  status: string;
  cycle?: string | null;
  email?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  current_period_end?: string | null;
}) {
  const db = await admin();
  const payload = { ...row, updated_at: new Date().toISOString() };
  const { error } = await db.from("subscriptions").upsert(payload, { onConflict: "user_id" });
  if (error) {
    billingError("supabase", "subscriptions upsert failed", { user_id: row.user_id, error: error.message });
    throw new Error(error.message);
  }
  billingLog("supabase", "subscription saved", {
    user_id: row.user_id,
    status: row.status,
    subscription: row.stripe_subscription_id,
  });
}

/**
 * Ask Stripe what it knows about this user and mirror it locally. Uses the
 * customer id we already stored, then the billing email, then — last, because
 * the search index lags for up to a minute — metadata search.
 */
export async function reconcileFromStripe(userId: string, email?: string | null) {
  const db = await admin();
  const { data: existing } = await db
    .from("subscriptions")
    .select("stripe_customer_id, email")
    .eq("user_id", userId)
    .maybeSingle();

  const candidates: StripeSubscription[] = [];
  const customer = existing?.stripe_customer_id;
  const billingEmail = email ?? existing?.email ?? null;

  if (customer) {
    const list = await stripeGet<{ data: StripeSubscription[] }>(
      `subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=10`,
    );
    candidates.push(...list.data);
    billingLog("reconcile", "looked up by customer", { userId, customer, found: list.data.length });
  }

  if (!candidates.length && billingEmail) {
    const customers = await stripeGet<{ data: { id: string }[] }>(
      `customers?email=${encodeURIComponent(billingEmail)}&limit=5`,
    );
    for (const c of customers.data) {
      const list = await stripeGet<{ data: StripeSubscription[] }>(
        `subscriptions?customer=${c.id}&status=all&limit=10`,
      );
      candidates.push(...list.data);
    }
    billingLog("reconcile", "looked up by email", { userId, customers: customers.data.length });
  }

  if (!candidates.length) {
    const q = encodeURIComponent(`metadata['user_id']:'${userId}'`);
    try {
      const found = await stripeGet<{ data: StripeSubscription[] }>(
        `subscriptions/search?query=${q}&limit=5`,
      );
      candidates.push(...found.data);
      billingLog("reconcile", "looked up by metadata search", { userId, found: found.data.length });
    } catch {
      /* the search index is eventually consistent — not fatal */
    }
  }

  const sub =
    candidates.find((s) => isActiveStatus(s.status)) ??
    candidates.find((s) => s.status === "past_due") ??
    candidates[0];

  if (!sub) {
    billingLog("reconcile", "no stripe subscription for user", { userId });
    return { active: false, status: "inactive" as const, source: "stripe" as const };
  }

  await upsertSubscriptionRow({
    user_id: userId,
    status: sub.status,
    cycle: cycleOf(sub),
    email: billingEmail,
    stripe_customer_id: customerId(sub),
    stripe_subscription_id: sub.id,
    current_period_end: periodEndIso(sub),
  });

  return { active: isActiveStatus(sub.status), status: sub.status, source: "stripe" as const };
}