import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const createCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    cycle: "monthly" | "annual";
    origin: string;
    next?: string | undefined;
    onboardingId?: string | undefined;
    shopDomain?: string | undefined;
  }) => {
    if (input.cycle !== "monthly" && input.cycle !== "annual") throw new Error("Invalid cycle");
    if (!/^https?:\/\//.test(input.origin)) throw new Error("Invalid origin");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { billingLog, billingError, stripeKey, reconcileFromStripe } = await import("./billing.server");
    const userId = context.userId;
    const email = (context.claims as { email?: string } | null)?.email ?? undefined;

    // Never send a paying customer back to Checkout.
    const { data: current } = await context.supabase
      .from("subscriptions")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();
    let active = current?.status === "active" || current?.status === "trialing";
    if (!active) {
      const synced = await reconcileFromStripe(userId, email).catch(() => null);
      active = synced?.active ?? false;
    }
    if (active) {
      billingLog("stripe", "checkout skipped — subscription already active", { userId });
      return { url: null, alreadyActive: true as const };
    }

    const annual = data.cycle === "annual";
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: `${data.origin}${data.next ?? "/app"}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${data.origin}${data.next ?? "/app"}?checkout=cancelled`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": annual ? "9590" : "999",
      "line_items[0][price_data][recurring][interval]": annual ? "year" : "month",
      "line_items[0][price_data][product_data][name]": "Ranki.ai",
      "line_items[0][price_data][product_data][description]": annual
        ? "Full autopilot — billed yearly (20% off)"
        : "Full autopilot — billed monthly",
      allow_promotion_codes: "true",
      client_reference_id: userId,
      "metadata[user_id]": userId,
      "subscription_data[metadata][user_id]": userId,
    });
    if (email) body.set("customer_email", email);
    if (data.onboardingId) {
      body.set("metadata[onboarding_id]", data.onboardingId);
      body.set("subscription_data[metadata][onboarding_id]", data.onboardingId);
    }
    if (data.shopDomain) {
      body.set("metadata[shop_domain]", data.shopDomain);
      body.set("subscription_data[metadata][shop_domain]", data.shopDomain);
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      billingError("stripe", "checkout session creation failed", { status: res.status, text: text.slice(0, 400) });
      throw new Error(`Stripe checkout failed [${res.status}]`);
    }
    const session = (await res.json()) as { id?: string; url?: string };
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    billingLog("stripe", "checkout session created", { userId, session: session.id, cycle: data.cycle });
    return { url: session.url, alreadyActive: false as const };
  });

/** Database is the source of truth; the frontend never trusts the Stripe redirect. */
export const getSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, cycle, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) console.error(`[billing:supabase] subscription read failed: ${error.message}`);
    const status = data?.status ?? "inactive";
    return {
      active: status === "active" || status === "trialing",
      status,
      cycle: data?.cycle ?? null,
      currentPeriodEnd: data?.current_period_end ?? null,
      source: "database" as const,
    };
  });

/** Fallback when the webhook is late or was never delivered: ask Stripe directly. */
export const syncSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { reconcileFromStripe } = await import("./billing.server");
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    return reconcileFromStripe(context.userId, email);
  });
