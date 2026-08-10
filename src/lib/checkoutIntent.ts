/**
 * Remembers a "Start now" click made from the marketing page by a visitor
 * who isn't signed in yet, so /auth can send them straight to Stripe
 * checkout once they finish signing up instead of dropping them in the
 * empty dashboard.
 */
const KEY = "ranki_checkout_intent";

export type BillingCycle = "monthly" | "annual";

export function setCheckoutIntent(cycle: BillingCycle) {
  try {
    localStorage.setItem(KEY, cycle);
  } catch {
    /* private browsing / storage disabled — checkout still works, just not resumed */
  }
}

export function takeCheckoutIntent(): BillingCycle | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== "monthly" && v !== "annual") return null;
    localStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
