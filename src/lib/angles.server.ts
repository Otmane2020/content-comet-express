/**
 * Generic intent -> format -> angle engine, applying to every business type
 * (SaaS, e-commerce, local service, wholesale/B2B, etc.) — nothing here is
 * Ranki.ai-specific. This is the layer between "a qualified keyword with a
 * classified intent" (frozen, upstream — see research.server.ts's
 * classifyIntent and relevance.server.ts's keyword pipeline) and "a natural
 * editorial title" (plan.server.ts's planTopics).
 */
import type { ContentType, SearchIntent } from "./geo";

export type EditorialAngle =
  | "definition"
  | "how_to"
  | "guide"
  | "checklist"
  | "mistakes"
  | "examples"
  | "faq"
  | "strategy"
  | "use_cases"
  | "comparison"
  | "alternatives"
  | "buyer_guide"
  | "best_for"
  | "evaluation"
  | "features"
  | "workflow"
  | "pricing"
  | "cost_breakdown"
  | "plans"
  | "value"
  | "purchase_decision"
  | "trial"
  | "local_intent"
  | "service_area"
  | "near_me"
  | "local_faq";

/** One planned day: a format, the keyword (if any) claimed for it, its
 * classified intent, and the editorial angle chosen for the title. */
export type CalendarSlot = {
  date: string;
  type: ContentType;
  keyword: string | null;
  intent: SearchIntent | null;
  angle: EditorialAngle | null;
};

/** Maps a picked keyword's raw intent/origin fields to the SearchIntent this
 * engine reasons about. `origin: "local"` always wins — a keyword sourced
 * from local-market research is a local-intent query regardless of what its
 * generic intent classifier said. */
export function resolveSlotIntent(keyword: { intent?: string | null; origin?: string | null } | null | undefined): SearchIntent {
  if (!keyword) return "commercial";
  if (keyword.origin === "local") return "local";
  const intent = (keyword.intent ?? "").toLowerCase();
  if (intent === "informational" || intent === "transactional" || intent === "commercial" || intent === "navigational" || intent === "local") {
    return intent;
  }
  return "commercial"; // matches classifyIntent()'s own default
}

/**
 * Hard fit: which content formats a keyword of this intent may ever be
 * assigned to. Tighter than the old soft INTENT_FIT preference table this
 * replaces — local_aeo now requires a genuine "local" intent instead of
 * accepting anything once the intent-matching pool ran dry.
 */
const FORMAT_INTENT_FIT: Record<ContentType, SearchIntent[]> = {
  geo: ["informational", "commercial", "navigational"],
  seo: ["informational", "commercial", "transactional"],
  aeo: ["informational", "commercial"],
  local_aeo: ["local"],
  shopping: ["transactional", "commercial"],
};

export function formatFitsKeyword(intent: SearchIntent, format: ContentType): boolean {
  return FORMAT_INTENT_FIT[format].includes(intent);
}

/**
 * Which editorial angles suit a search intent, independent of business
 * domain — a "comparison" angle is exactly as valid for a SaaS's competing
 * tools as for a furniture wholesaler's competing suppliers. Kept generous
 * (8-9 angles per intent) precisely so 30 days of content on a handful of
 * qualified keywords doesn't collapse into "comparison"/"guide" on repeat —
 * angleFitsIntent below still narrows this by format (e.g. local angles only
 * ever apply to local_aeo).
 */
const ANGLES_BY_INTENT: Record<SearchIntent, EditorialAngle[]> = {
  informational: ["definition", "how_to", "guide", "checklist", "mistakes", "examples", "faq", "strategy", "use_cases"],
  commercial: ["comparison", "alternatives", "buyer_guide", "best_for", "evaluation", "use_cases", "features", "workflow"],
  transactional: ["pricing", "cost_breakdown", "plans", "value", "purchase_decision", "trial"],
  navigational: ["definition", "guide"],
  local: ["local_intent", "service_area", "near_me", "local_faq"],
};

/**
 * Empty means no natural angle exists for this (intent, format) pair —
 * callers must change format/keyword, never fabricate a fallback angle.
 * Angle selection itself is intent-driven (ANGLES_BY_INTENT, above); the
 * only format-level narrowing is that a "local" intent's angles only ever
 * fit the local_aeo format, and local_aeo never carries any other intent —
 * matching formatFitsKeyword's own local_aeo: ["local"] gate.
 */
export function angleFitsIntent(intent: SearchIntent, format: ContentType): EditorialAngle[] {
  const angles = ANGLES_BY_INTENT[intent] ?? [];
  if (format === "local_aeo") return intent === "local" ? angles : [];
  if (intent === "local") return [];
  return angles;
}

const normaliseForDedup = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Two-tier, both deterministic — no AI/embedding call per title, matching
 * this session's cost discipline of deterministic pre-filters over extra AI
 * calls. `usedPairs`/`usedTitles` are mutated in place (checked, then
 * recorded by the caller once a title is finally accepted for a slot) so a
 * single pass over the 30-slot list can validate incrementally.
 */
export function isTitleUniqueAndNatural(
  keyword: string,
  angle: EditorialAngle,
  title: string,
  usedPairs: Set<string>,
  usedTitles: Set<string>,
): boolean {
  const pairKey = `${normaliseForDedup(keyword)}:${angle}`;
  if (usedPairs.has(pairKey)) return false; // same keyword+angle = same article idea, even with different wording
  if (usedTitles.has(normaliseForDedup(title))) return false; // literal accidental repeat
  return true;
}
