import { createServerFn } from "@tanstack/react-start";

export const createCheckout = createServerFn({ method: "POST" })
  .inputValidator((input: { cycle: "monthly" | "annual"; origin: string }) => {
    if (input.cycle !== "monthly" && input.cycle !== "annual") throw new Error("Invalid cycle");
    if (!/^https?:\/\//.test(input.origin)) throw new Error("Invalid origin");
    return input;
  })
  .handler(async ({ data }) => {
    const key = process.env["STRIPE_LIVE_API_KEY"];
    if (!key) throw new Error("Stripe is not configured");

    const annual = data.cycle === "annual";
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: `${data.origin}/app?checkout=success`,
      cancel_url: `${data.origin}/#pricing`,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": annual ? "9590" : "999",
      "line_items[0][price_data][recurring][interval]": annual ? "year" : "month",
      "line_items[0][price_data][product_data][name]": "AutopilotGEO",
      "line_items[0][price_data][product_data][description]": annual
        ? "Full autopilot — billed yearly (20% off)"
        : "Full autopilot — billed monthly",
      allow_promotion_codes: "true",
    });

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`Stripe checkout failed [${res.status}]: ${text}`);
      throw new Error(`Stripe checkout failed [${res.status}]: ${text}`);
    }
    const session = (await res.json()) as { url?: string };
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { url: session.url };
  });
