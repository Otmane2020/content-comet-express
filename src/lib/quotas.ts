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
    const d = raw?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    if (!d || seen.has(d) || !isRealCompetitor(d, self)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Domains that rank for everything and compete with nobody. DataForSEO returns
 * them for almost any target, and they are useless as "rivals" — pulling their
 * keywords is what produced off-topic calendars.
 */
export const BLOCKED_COMPETITOR_DOMAINS = [
  "youtube.com", "google.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "linkedin.com", "reddit.com", "pinterest.com", "tiktok.com", "quora.com", "medium.com",
  "wikipedia.org", "amazon.com", "ebay.com", "etsy.com", "apple.com", "microsoft.com",
  "github.com", "stackoverflow.com", "substack.com", "wordpress.com", "wix.com",
  "shopify.com", "notion.so", "canva.com", "hubspot.com", "g2.com", "capterra.com",
  "trustpilot.com", "producthunt.com", "crunchbase.com", "glassdoor.com", "indeed.com",
  "yelp.com", "tripadvisor.com", "booking.com", "forbes.com", "nytimes.com", "bbc.com",
  "openai.com", "gartner.com", "getapp.com", "softwareadvice.com", "slideshare.net",
  // Directories, marketplaces & social networks (SERP discovery blocklist).
  "pagesjaunes.fr", "yellowpages.com", "alibaba.com", "aliexpress.com", "cdiscount.com",
  "fnac.com", "darty.com", "leboncoin.fr", "vinted.fr", "manomano.fr", "manomano.com",
  "made.com", "wayfair.com", "wayfair.fr", "ikea.com", "houzz.com", "houzz.fr",
  "pinterest.fr", "instagram.com", "facebook.com", "tiktok.com", "blogspot.com",
  "societe.com", "verif.com", "infogreffe.fr", "kompass.com", "europages.fr", "europages.com",
  "annuaire-entreprises.data.gouv.fr", "bing.com", "yahoo.com", "yandex.com",
  "decathlon.fr", "leroymerlin.fr", "castorama.fr", "bricodepot.fr", "conforama.fr",
];

/** True when a domain is a plausible rival: not us, not a giant platform. */
export function isRealCompetitor(domain: string, self: string) {
  const d = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  const me = self.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
  if (!d || !d.includes(".")) return false;
  if (me && (d === me || d.endsWith(`.${me}`) || me.endsWith(`.${d}`))) return false;
  const root = d.split(".").slice(-2).join(".");
  return !BLOCKED_COMPETITOR_DOMAINS.some((b) => d === b || root === b || d.endsWith(`.${b}`));
}
