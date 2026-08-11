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

/**
 * Comparable form of a keyword, used only for grouping — never displayed.
 *
 * DataForSEO Labs returns Google Ads' normalized forms, so the same query comes
 * back as several near-identical rows ("lits coffre" / "lits coffres") and
 * acronyms arrive split into single letters ("meubles t v"). Folding accents,
 * plurals and split acronyms makes those collapse onto one key.
 */
export function canonicalKeyword(keyword: string): string {
  return keyword
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reduce<string[]>((acc, token) => {
      // "t v" -> "tv": glue a single letter onto a preceding short fragment.
      const prev = acc[acc.length - 1];
      if (token.length === 1 && prev && prev.length <= 2 && /^[a-z]+$/.test(prev) && /^[a-z]$/.test(token)) {
        acc[acc.length - 1] = prev + token;
        return acc;
      }
      acc.push(token);
      return acc;
    }, [])
    // Fold one trailing plural mark: "-s", and the French "-aux/-eaux" whose
    // singular ends in "-au". Length-guarded, and "-x" only after "u", so
    // "bas" and "prix" survive intact.
    .map((token) => {
      if (token.length <= 3) return token;
      if (token.endsWith("s")) return token.slice(0, -1);
      if (token.endsWith("ux")) return token.slice(0, -1);
      return token;
    })
    .join(" ");
}

/** A single-letter token is DataForSEO's mangled acronym, never a real query. */
function isWellFormed(keyword: string) {
  return !keyword.trim().split(/\s+/).some((token) => token.length === 1);
}

/** Of two forms of the same query, the better-written then shorter one wins. */
function preferred<T extends { keyword: string }>(a: T, b: T): T {
  const qa = isWellFormed(a.keyword) ? 1 : 0;
  const qb = isWellFormed(b.keyword) ? 1 : 0;
  if (qa !== qb) return qa > qb ? a : b;
  return a.keyword.length <= b.keyword.length ? a : b;
}

const isSubsetOf = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

/**
 * Near-duplicate collapse + hard cap, applied before anything is stored.
 *
 * Two passes. The first folds spelling variants onto `canonicalKeyword`. The
 * second catches Google "close variants": when a longer query reports the exact
 * same non-zero search volume as a query whose words it contains, that volume
 * was borrowed from the shorter head term rather than measured — keeping both
 * is what put three identical-volume rows in front of the merchant.
 */
export function dedupeKeywords<T extends { keyword: string; search_volume?: number | null }>(
  rows: T[],
  max: number,
): T[] {
  const byCanonical = new Map<string, T>();
  const order: string[] = [];
  for (const row of rows) {
    if (!row?.keyword?.trim()) continue;
    const key = canonicalKeyword(row.keyword);
    if (!key) continue;
    const held = byCanonical.get(key);
    if (!held) {
      byCanonical.set(key, row);
      order.push(key);
      continue;
    }
    byCanonical.set(key, preferred(row, held));
  }

  const kept: { row: T; tokens: Set<string> }[] = [];
  for (const key of order) {
    const row = byCanonical.get(key)!;
    const tokens = new Set(key.split(" "));
    const volume = row.search_volume ?? null;
    const twin =
      volume && volume > 0
        ? kept.findIndex(
            (k) =>
              (k.row.search_volume ?? null) === volume &&
              (isSubsetOf(tokens, k.tokens) || isSubsetOf(k.tokens, tokens)),
          )
        : -1;
    if (twin >= 0) {
      const winner = preferred(row, kept[twin]!.row);
      kept[twin] = { row: winner, tokens: new Set(canonicalKeyword(winner.keyword).split(" ")) };
      continue;
    }
    kept.push({ row, tokens });
    if (kept.length >= max) break;
  }
  return kept.map((k) => k.row);
}

/**
 * DataForSEO occasionally answers in English even when another language was
 * requested. Do not let that pollute a non-English publishing calendar.
 *
 * Deliberately generic: an earlier version listed furniture words ("sofa",
 * "chair"), which also occur in Italian, Spanish and German and would have
 * dropped legitimate keywords. Topical filtering is `scoreRelevance`'s job.
 */
export function matchesRequestedLanguage(keyword: string, locale: string | null | undefined) {
  if (!locale || locale.toLowerCase().startsWith("en")) return true;
  return !/\b(and|with|for|the|best|cheap|buy|shop|sale|near me|how to|what is)\b/i.test(keyword);
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
