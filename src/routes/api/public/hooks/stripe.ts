import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

function verify(payload: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.split("=") as [string, string]),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["STRIPE_WEBHOOK_SECRET"];
        const {
          billingLog,
          billingError,
          resolveUserId,
          upsertSubscriptionRow,
          cycleOf,
          periodEndIso,
          customerId,
          stripeGet,
        } = await import("@/lib/billing.server");

        if (!secret) {
          billingError("webhook", "STRIPE_WEBHOOK_SECRET is missing — event dropped");
          return new Response("Not configured", { status: 500 });
        }
        const body = await request.text();
        if (!verify(body, request.headers.get("stripe-signature"), secret)) {
          billingError("webhook", "signature rejected", { bytes: body.length });
          return new Response("Invalid signature", { status: 401 });
        }

        const event = JSON.parse(body) as {
          id: string;
          type: string;
          data: { object: Record<string, any> };
        };
        const obj = event.data.object;
        billingLog("webhook", "event received", { id: event.id, type: event.type });

        try {
          if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
          ) {
            const email = obj["customer_details"]?.email ?? obj["customer_email"] ?? null;
            const { userId, via } = await resolveUserId({
              metadataUserId: obj["metadata"]?.user_id ?? null,
              clientReferenceId: obj["client_reference_id"] ?? null,
              stripeCustomerId: obj["customer"] ?? null,
              stripeSubscriptionId: obj["subscription"] ?? null,
              email,
            });
            if (!userId) {
              billingError("webhook", "checkout completed but no user could be resolved", {
                session: obj["id"],
                email,
              });
              return new Response("ok");
            }
            billingLog("webhook", "checkout completed", { userId, via, session: obj["id"] });

            // Read the real subscription so status/cycle/period come from Stripe,
            // not from an optimistic assumption.
            let status = "active";
            let cycle: string | null = null;
            let periodEnd: string | null = null;
            if (obj["subscription"]) {
              try {
                const sub = await stripeGet<any>(`subscriptions/${obj["subscription"]}`);
                status = sub.status;
                cycle = cycleOf(sub);
                periodEnd = periodEndIso(sub);
              } catch (e) {
                billingError("webhook", "could not read subscription after checkout", {
                  subscription: obj["subscription"],
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            }

            await upsertSubscriptionRow({
              user_id: userId,
              status,
              cycle,
              email,
              stripe_customer_id: obj["customer"] ?? null,
              stripe_subscription_id: obj["subscription"] ?? null,
              current_period_end: periodEnd,
            });
            return new Response("ok");
          }

          if (event.type.startsWith("customer.subscription.")) {
            const status = event.type === "customer.subscription.deleted" ? "canceled" : obj["status"];
            const { userId, via } = await resolveUserId({
              metadataUserId: obj["metadata"]?.user_id ?? null,
              stripeCustomerId: customerId(obj as any),
              stripeSubscriptionId: obj["id"] ?? null,
            });
            if (!userId) {
              billingError("webhook", "subscription event with no known user", {
                subscription: obj["id"],
                type: event.type,
              });
              return new Response("ok");
            }
            billingLog("webhook", "subscription event", { userId, via, status, type: event.type });
            await upsertSubscriptionRow({
              user_id: userId,
              status,
              cycle: cycleOf(obj as any),
              stripe_customer_id: customerId(obj as any),
              stripe_subscription_id: obj["id"] ?? null,
              current_period_end: periodEndIso(obj as any),
            });
            return new Response("ok");
          }

          if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
            const subscriptionId =
              obj["subscription"] ??
              obj["parent"]?.subscription_details?.subscription ??
              obj["lines"]?.data?.[0]?.parent?.subscription_item_details?.subscription ??
              null;
            const { userId, via } = await resolveUserId({
              stripeCustomerId: obj["customer"] ?? null,
              stripeSubscriptionId: subscriptionId,
              email: obj["customer_email"] ?? null,
            });
            if (!userId) {
              billingError("webhook", "invoice event with no known user", {
                invoice: obj["id"],
                type: event.type,
              });
              return new Response("ok");
            }

            let status = event.type === "invoice.paid" ? "active" : "past_due";
            let cycle: string | null = null;
            let periodEnd: string | null = null;
            if (subscriptionId) {
              try {
                const sub = await stripeGet<any>(`subscriptions/${subscriptionId}`);
                status = sub.status;
                cycle = cycleOf(sub);
                periodEnd = periodEndIso(sub);
              } catch {
                /* keep the inferred status */
              }
            }
            billingLog("webhook", "invoice event", { userId, via, status, type: event.type });
            await upsertSubscriptionRow({
              user_id: userId,
              status,
              cycle,
              email: obj["customer_email"] ?? null,
              stripe_customer_id: obj["customer"] ?? null,
              stripe_subscription_id: subscriptionId,
              current_period_end: periodEnd,
            });
            return new Response("ok");
          }

          billingLog("webhook", "event ignored", { type: event.type });
          return new Response("ok");
        } catch (e) {
          // 500 makes Stripe retry, which is what we want on a transient DB error.
          billingError("webhook", "handler threw", {
            type: event.type,
            error: e instanceof Error ? e.message : String(e),
          });
          return new Response("handler error", { status: 500 });
        }
      },
    },
  },
});