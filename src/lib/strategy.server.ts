/**
 * Makes format-eligibility reasoning inspectable instead of a bare boolean
 * array. This does NOT reimplement eligibility logic — isShoppingEligible()/
 * isLocalEligible() (geo.ts) stay the single source of truth; this module
 * only narrates their result into a structured, loggable object, so a live
 * report can show WHY a format was enabled, not just which ones were. That
 * "why" is exactly what would have caught the Vends-Le contradiction
 * (Local AEO enabled with has_physical_location=false, has_service_area=
 * false) before it shipped, instead of only being visible in reviewed output.
 */
import { ROTATION, isLocalEligible, isShoppingEligible, type ContentType, type EligibilitySignals } from "./geo";

export type FormatDecision = { eligible: boolean; confidence: number; reasons: string[] };
export type ContentStrategy = {
  formats: Record<ContentType, FormatDecision>;
  contentGoals: ("education" | "commercial_discovery" | "transaction_support" | "local_discovery")[];
};

// Mirrors isShoppingEligible() (geo.ts) exactly — kept in sync manually since
// this only narrates that function's decision. `primary_entity ===
// "marketplace"` was removed from both after Trust Avis (a reviews
// marketplace, zero products) showed reasons=["primary_entity=marketplace"]
// while eligible=false: this function had drifted out of sync with the
// predicate it's supposed to be explaining.
function shoppingReasons(signals: EligibilitySignals): string[] {
  const reasons: string[] = [];
  if ((signals.products?.length ?? 0) > 0) reasons.push("confirmed products");
  if (signals.sales_model === "ecommerce") reasons.push("sales_model=ecommerce");
  if (signals.sales_model === "wholesale") reasons.push("sales_model=wholesale");
  if (signals.primary_entity === "product") reasons.push("primary_entity=product");
  return reasons;
}

function localReasons(signals: EligibilitySignals): string[] {
  const reasons: string[] = [];
  if (signals.has_physical_location) reasons.push("has_physical_location=true");
  if (signals.has_service_area) reasons.push("has_service_area=true");
  return reasons;
}

/**
 * Narrates isShoppingEligible/isLocalEligible's result — never a second,
 * independent decision. A format is only ever eligible here if its
 * corresponding geo.ts predicate says so, and `reasons` is always non-empty
 * exactly when `eligible` is true (both derived from the same signal checks).
 */
export function buildContentStrategy(signals: EligibilitySignals): ContentStrategy {
  const shoppingEligible = isShoppingEligible(signals);
  const localEligible = isLocalEligible(signals);

  const formats = {} as Record<ContentType, FormatDecision>;
  for (const type of ROTATION) {
    if (type === "shopping") {
      formats[type] = { eligible: shoppingEligible, confidence: shoppingEligible ? 1 : 0, reasons: shoppingReasons(signals) };
    } else if (type === "local_aeo") {
      formats[type] = { eligible: localEligible, confidence: localEligible ? 1 : 0, reasons: localReasons(signals) };
    } else {
      formats[type] = { eligible: true, confidence: 1, reasons: ["universal — every business answers buyer questions"] };
    }
  }

  const contentGoals: ContentStrategy["contentGoals"] = ["education"];
  contentGoals.push("commercial_discovery");
  if (shoppingEligible) contentGoals.push("transaction_support");
  if (localEligible) contentGoals.push("local_discovery");

  return { formats, contentGoals };
}
