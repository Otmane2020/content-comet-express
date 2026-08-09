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
        if (!secret) return new Response("Not configured", { status: 500 });
        const body = await request.text();
        if (!verify(body, request.headers.get("stripe-signature"), secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, any> } };
        const obj = event.data.object;
        const userId: string | undefined =
          obj["client_reference_id"] ?? obj["metadata"]?.user_id ?? undefined;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (event.type === "checkout.session.completed" && userId) {
          await supabaseAdmin.from("subscriptions").upsert(
            {
              user_id: userId,
              status: "active",
              email: obj["customer_details"]?.email ?? obj["customer_email"] ?? null,
              stripe_customer_id: obj["customer"] ?? null,
              stripe_subscription_id: obj["subscription"] ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        }

        if (event.type.startsWith("customer.subscription.")) {
          const status = event.type === "customer.subscription.deleted" ? "canceled" : obj["status"];
          const periodEnd = obj["current_period_end"]
            ? new Date(Number(obj["current_period_end"]) * 1000).toISOString()
            : null;
          const interval = obj["items"]?.data?.[0]?.price?.recurring?.interval;
          if (userId) {
            await supabaseAdmin.from("subscriptions").upsert(
              {
                user_id: userId,
                status,
                cycle: interval === "year" ? "annual" : interval === "month" ? "monthly" : null,
                stripe_customer_id: obj["customer"] ?? null,
                stripe_subscription_id: obj["id"] ?? null,
                current_period_end: periodEnd,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            );
          } else if (obj["id"]) {
            await supabaseAdmin
              .from("subscriptions")
              .update({ status, current_period_end: periodEnd, updated_at: new Date().toISOString() })
              .eq("stripe_subscription_id", obj["id"]);
          }
        }

        return new Response("ok");
      },
    },
  },
});