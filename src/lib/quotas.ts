/**
 * DataForSEO cost guardrails.
 *
 * Every live SEO call is metered, so each research pass is capped, batched
 * (one request per endpoint, never one request per keyword), deduplicated
 * before writing, and cached in the database for `RESEARCH_CACHE_HOURS`.
 */
export type PlanTier = "starter" | "growth" | "scale";

export type ResearchQuota = {
  /** Competitor domains kept per scan. */
  competitors: number;
  /** Seed keyword ideas kept per scan. */
  keywords: number;
  /** Keywords pulled from each competitor domain. */
  keywordsPerCompetitor: number;
  /** Hard ceiling of unique keywords stored per scan. */
  totalKeywords: number;
  /** Seed terms sent in the single batched keyword-ideas request. */
  seeds: number;
};

export const PLAN_QUOTAS: Record<PlanTier, ResearchQuota> = {
  starter: { competitors: 3, keywords: 20, keywordsPerCompetitor: 10, totalKeywords: 30, seeds: 10 },
  growth: { competitors: 5, keywords: 30, keywordsPerCompetitor: 10, totalKeywords: 50, seeds: 10 },
  scale: { competitors: 10, keywords: 100, keywordsPerCompetitor: 20, totalKeywords: 150, seeds: 20 },
};

export const DEFAULT_TIER: PlanTier = "growth";

/** Quota applied to onboarding scans and dashboard refreshes. */
export const QUOTA = PLAN_QUOTAS[DEFAULT_TIER];

/** Skip a live re-scan when the stored data is younger than this. */
export const RESEARCH_CACHE_HOURS = 24 * 7;

export function isFresh(iso: string | null | undefined, hours = RESEARCH_CACHE_HOURS) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < hours * 3600_000;
}

/** Case-insensitive dedupe + hard cap, applied before anything is stored. */
export function dedupeKeywords<T extends { keyword: string }>(rows: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = row.keyword?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

export function dedupeDomains(domains: string[], self: string, max: number) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of domains) {
    const d = raw?.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (!d || d === self.toLowerCase() || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}
