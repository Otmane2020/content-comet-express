const BASE = "https://api.dataforseo.com/v3";

/**
 * Carries the real DataForSEO status_code/status_message through to callers
 * and logs, instead of collapsing every failure into a generic "Too many
 * requests." or "DataForSEO error (429)" string that loses which endpoint,
 * which DataForSEO status_code, and how many retries were already spent.
 */
export class DataForSeoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | null,
    public readonly httpStatus: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

// DataForSEO's own rate-limit signals — the ONLY codes this module retries.
// 40202 = "Too Many Requests", 40209 = "Simultaneous connections limit
// reached". Both mean the task was rejected before running, never billed, so
// retrying never duplicates a paid task. Every other 4xx (bad request,
// unauthorized, invalid field, task-level business error) is a real failure
// and must surface immediately, not be silently retried into a bigger bill.
const RETRYABLE_DFS_CODES = new Set([40202, 40209]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

/** Exponential backoff with jitter — jitter prevents every queued request
 * that got 429'd together from retrying in the exact same instant and
 * immediately re-tripping the rate limit. */
function backoffDelayMs(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return exp + Math.random() * exp * 0.3;
}

/**
 * Every DataForSEO request in this app goes through this single shared
 * limiter — never more than MAX_CONCURRENCY in flight at once, regardless of
 * how many callers (keyword research, SERP, competitor discovery, local
 * market) fire Promise.all-style in parallel. This is what was missing:
 * individual endpoints already batched their own keyword lists, but nothing
 * capped how many *separate* DataForSEO requests (search volume + keyword
 * ideas + N competitor SERP calls + N competitor domain calls, all from one
 * pipeline run) could be in flight at the same time, which is what tripped
 * DataForSEO's own rate limit ("Too many requests.") under normal use.
 */
const MAX_CONCURRENCY = 4;
let activeRequests = 0;
const waiters: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENCY) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter; activeRequests unchanged
  else activeRequests--;
}

/**
 * Checks whether the DataForSEO credentials are accepted (live data available).
 *
 * "missing" and "unreachable" used to collapse into the exact same generic
 * "add your credentials" message — which is actively misleading when the
 * variables are already configured (as they were in production here) and the
 * real cause is a transient network failure or a non-401 error from
 * DataForSEO (e.g. rate limiting). `detail` carries the actual status/body so
 * the thrown error says what really happened instead of "add your login".
 */
export async function dfsPing(): Promise<{ live: boolean; reason: string | null; detail?: string }> {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) return { live: false, reason: "missing" };
  await acquireSlot();
  try {
    const res = await fetch(`${BASE}/appendix/user_data`, {
      headers: { Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64") },
      // A hung connection (DataForSEO accepting the TCP connection but never
      // responding, rather than erroring) used to block this fetch forever —
      // three consecutive /test "keywords" runs each burned the entire 300s
      // Vercel function timeout here, before candidateKeywords' own AI call
      // ever ran, with no log line and no diagnosable error. A ping has no
      // reason to take longer than this.
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return { live: false, reason: "unauthorized" };
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { live: false, reason: "unreachable", detail: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { live: true, reason: null };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      live: false,
      reason: "unreachable",
      detail: timedOut ? "Ping to DataForSEO timed out after 15s (no response)." : error instanceof Error ? error.message : String(error),
    };
  } finally {
    releaseSlot();
  }
}

function authHeader() {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) {
    throw new Error("DataForSEO is not connected yet — add your DataForSEO login and password.");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

/**
 * All DataForSEO POST calls funnel through here: one shared concurrency
 * limiter (acquireSlot/releaseSlot, above) and one retry policy. A request
 * only ever retries on a rate-limit signal (HTTP 429, or DataForSEO
 * status_code 40202/40209) — every other failure (auth, bad request, a real
 * task-level business error) throws immediately on the first attempt, never
 * silently retried.
 */
async function post<T>(path: string, payload: unknown): Promise<T> {
  await acquireSlot();
  try {
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      // Same reasoning as dfsPing's timeout: an unresponsive (not merely slow)
      // DataForSEO connection must fail loudly well before Vercel's 300s
      // function limit kills the whole batch with no error to show for it.
      // 60s is well above this endpoint's normal response time even for a
      // 40-keyword batch.
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify([payload]),
        signal: AbortSignal.timeout(60_000),
      });
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      console.info("[dataforseo] request", {
        endpoint: path,
        attempt,
        concurrency: activeRequests,
        httpStatus: res.status,
        rateLimitRemaining: res.headers.get("x-ratelimit-remaining") ?? res.headers.get("x-rate-limit-remaining") ?? null,
        rateLimitLimit: res.headers.get("x-ratelimit-limit") ?? res.headers.get("x-rate-limit-limit") ?? null,
        retryAfterHeader: res.headers.get("retry-after"),
      });

      // A 429 with no JSON body worth parsing — DataForSEO rejected the
      // request before it ever ran, so this never duplicates a paid task.
      if (res.status === 429) {
        if (attempt <= MAX_RETRIES) {
          const delay = retryAfterMs ?? backoffDelayMs(attempt);
          console.warn("[dataforseo] 429, retrying", { endpoint: path, attempt, delayMs: Math.round(delay) });
          await sleep(delay);
          continue;
        }
        throw new DataForSeoError(`DataForSEO rate limit (HTTP 429) after ${MAX_RETRIES} retries on ${path}`, 429, 429, true);
      }

      const json = (await res.json()) as {
        status_code?: number;
        status_message?: string;
        tasks?: { status_code?: number; status_message?: string; result?: unknown }[];
      };

      if (!res.ok || (json.status_code && json.status_code >= 40000)) {
        const code = json.status_code ?? null;
        const message = `DataForSEO error ${code ?? res.status}: ${json.status_message ?? `HTTP ${res.status}`} (${path})`;
        if (code !== null && RETRYABLE_DFS_CODES.has(code) && attempt <= MAX_RETRIES) {
          const delay = retryAfterMs ?? backoffDelayMs(attempt);
          console.warn("[dataforseo] retryable status_code, retrying", { endpoint: path, attempt, code, delayMs: Math.round(delay) });
          await sleep(delay);
          continue;
        }
        throw new DataForSeoError(message, code, res.status, false);
      }

      const task = json.tasks?.[0];
      if (task?.status_code && task.status_code >= 40000) {
        const message = `DataForSEO task error ${task.status_code}: ${task.status_message ?? "task failed"} (${path})`;
        if (RETRYABLE_DFS_CODES.has(task.status_code) && attempt <= MAX_RETRIES) {
          const delay = retryAfterMs ?? backoffDelayMs(attempt);
          console.warn("[dataforseo] retryable task status_code, retrying", { endpoint: path, attempt, code: task.status_code, delayMs: Math.round(delay) });
          await sleep(delay);
          continue;
        }
        throw new DataForSeoError(message, task.status_code, res.status, false);
      }

      return (task?.result ?? []) as T;
    }
    // Unreachable — the loop always returns or throws — but keeps TypeScript
    // satisfied that every path returns T.
    throw new DataForSeoError(`DataForSEO request exhausted retries on ${path}`, null, null, false);
  } finally {
    releaseSlot();
  }
}

export type KeywordRow = {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
  competitor_domain?: string | null;
};

type LocationOpts = { locationName?: string; languageCode?: string };

const loc = (o: LocationOpts) => ({
  location_name: o.locationName ?? "France",
  language_code: o.languageCode ?? "fr",
});

/**
 * Keep only a buyer's actual query before sending it to Google Ads. LLMs
 * occasionally append editorial notes such as "(if mentioned)"; one such
 * value makes DataForSEO reject the entire batch, not only that row.
 */
export function cleanKeywordForDataForSeo(value: string) {
  return value
    .normalize("NFC")
    .replace(/[\(\[\{][^\)\]\}]{0,100}[\)\]\}]/g, " ")
    .replace(/[^\p{L}\p{N}\s'’\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/**
 * Real Google Ads metrics for keywords WE chose, in one batched request.
 *
 * This is the direction the research runs in: the AI reads the landing page and
 * proposes the candidate keywords, and DataForSEO only validates them. The
 * alternative — seeding `keyword_suggestions` and letting Google's phrase-match
 * generate the candidate space — inherits the seed's audience, which is how a
 * furniture wholesaler ended up with "canapés d'angle convertibles": consumer
 * queries expanded from a consumer seed.
 *
 * A response row is still useful when Google Ads reports a zero volume: it
 * confirms that DataForSEO understood the candidate and lets the SERP decide
 * whether the long-tail B2B query has live competitors. Only missing rows are
 * rejected as unmeasurable candidates.
 */
export async function searchVolumeFor(
  keywords: string[],
  opts: LocationOpts = {},
): Promise<KeywordRow[]> {
  // The endpoint accepts up to 1000 keywords per task; the quota caps us far
  // below that, so one request is always enough.
  const batch = Array.from(
    new Set(keywords.map((k) => cleanKeywordForDataForSeo(k).toLowerCase()).filter((k) => k.length > 1)),
  ).slice(0, 700);
  if (!batch.length) return [];
  // Google Ads Search Volume differs from Labs endpoints: `result` itself is
  // the array of keyword rows. It has no `result[0].items` wrapper.
  const result = await post<
    {
      keyword?: string;
      search_volume?: number | null;
      cpc?: number | null;
      competition?: string | null;
      competition_index?: number | null;
    }[]
  >("/keywords_data/google_ads/search_volume/live", {
    keywords: batch,
    ...loc(opts),
  });
  return result
    .filter((i) => i.keyword)
    .map((i) => ({
      keyword: i.keyword!,
      search_volume: i.search_volume ?? null,
      cpc: i.cpc ?? null,
      competition: i.competition_index ?? null,
      // This endpoint carries Ads metrics only; difficulty and intent come from
      // Labs, and stay null rather than being guessed here.
      difficulty: null,
      intent: null,
    }));
}

/**
 * Keyword ideas + volumes for a list of seed keywords.
 * All seeds go out in ONE batched request — never one request per keyword.
 */
export async function keywordIdeas(
  seeds: string[],
  opts: LocationOpts = {},
  limit = 30,
): Promise<KeywordRow[]> {
  const batch = Array.from(new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean))).slice(0, 20);
  if (!batch.length) return [];
  const result = await post<
    { items?: { keyword: string; keyword_info?: { search_volume?: number; cpc?: number; competition?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } }[] }[]
  >("/dataforseo_labs/google/keyword_ideas/live", {
    keywords: batch,
    ...loc(opts),
    limit,
    order_by: ["keyword_info.search_volume,desc"],
  });
  return (result[0]?.items ?? []).map((i) => ({
    keyword: i.keyword,
    search_volume: i.keyword_info?.search_volume ?? null,
    cpc: i.keyword_info?.cpc ?? null,
    competition: i.keyword_info?.competition ?? null,
    difficulty: i.keyword_properties?.keyword_difficulty ?? null,
    intent: i.search_intent_info?.main_intent ?? null,
  }));
}

/**
 * Phrase-match suggestions for ONE seed: every keyword returned contains the
 * seed, so the list stays on-topic instead of drifting to whatever has the
 * biggest global volume (which is what `keyword_ideas` does).
 */
export async function keywordSuggestions(
  seed: string,
  opts: LocationOpts = {},
  limit = 12,
): Promise<KeywordRow[]> {
  const keyword = seed.trim().toLowerCase();
  if (!keyword) return [];
  const result = await post<
    { items?: { keyword: string; keyword_info?: { search_volume?: number; cpc?: number; competition?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } }[] }[]
  >("/dataforseo_labs/google/keyword_suggestions/live", {
    keyword,
    ...loc(opts),
    limit,
    include_seed_keyword: true,
    order_by: ["keyword_info.search_volume,desc"],
  });
  return (result[0]?.items ?? [])
    .map((i) => ({
      keyword: i.keyword,
      search_volume: i.keyword_info?.search_volume ?? null,
      cpc: i.keyword_info?.cpc ?? null,
      competition: i.keyword_info?.competition ?? null,
      difficulty: i.keyword_properties?.keyword_difficulty ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
    }))
    .filter((k) => k.keyword);
}

/** Keywords a competitor domain already ranks for. */
export async function keywordsForSite(
  domain: string,
  opts: LocationOpts = {},
  limit = 30,
): Promise<KeywordRow[]> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const call = (order_by: string[]) =>
    post<
      { items?: { keyword: string; keyword_info?: { search_volume?: number; cpc?: number; competition?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } }[] }[]
    >("/dataforseo_labs/google/keywords_for_site/live", {
      target: clean,
      ...loc(opts),
      limit,
      include_serp_info: false,
      order_by,
    });
  let result: Awaited<ReturnType<typeof call>>;
  try {
    result = await call(["relevance,desc"]);
  } catch {
    result = await call(["keyword_info.search_volume,desc"]);
  }
  return (result[0]?.items ?? [])
    .map((i) => ({
      keyword: i.keyword,
      search_volume: i.keyword_info?.search_volume ?? null,
      cpc: i.keyword_info?.cpc ?? null,
      competition: i.keyword_info?.competition ?? null,
      difficulty: i.keyword_properties?.keyword_difficulty ?? null,
      intent: i.search_intent_info?.main_intent ?? null,
    }))
    .filter((k) => k.keyword);
}

/** Keywords a competitor domain already ranks for. */
export async function competitorKeywords(
  domain: string,
  opts: LocationOpts = {},
  limit = 10,
): Promise<KeywordRow[]> {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const result = await post<
    { items?: { keyword_data?: { keyword: string; keyword_info?: { search_volume?: number; cpc?: number; competition?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } }; ranked_serp_element?: { serp_item?: { rank_absolute?: number } } }[] }[]
  >("/dataforseo_labs/google/ranked_keywords/live", {
    target: clean,
    ...loc(opts),
    limit,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
  return (result[0]?.items ?? []).map((i) => ({
    keyword: i.keyword_data?.keyword ?? "",
    search_volume: i.keyword_data?.keyword_info?.search_volume ?? null,
    cpc: i.keyword_data?.keyword_info?.cpc ?? null,
    competition: i.keyword_data?.keyword_info?.competition ?? null,
    difficulty: i.keyword_data?.keyword_properties?.keyword_difficulty ?? null,
    intent: i.keyword_data?.search_intent_info?.main_intent ?? null,
    competitor_domain: clean,
  })).filter((k) => k.keyword);
}

/** Domains competing with the project's own site. */
export async function competitorDomains(domain: string, opts: LocationOpts = {}, limit = 5) {
  const clean = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const result = await post<
    { items?: { domain: string; avg_position?: number; sum_position?: number; intersections?: number; full_domain_metrics?: { organic?: { count?: number; etv?: number } } }[] }[]
  >("/dataforseo_labs/google/competitors_domain/live", {
    target: clean,
    ...loc(opts),
    limit,
    // Amazon/Cdiscount-class domains rank for everything and rival nobody.
    // Callers still apply isRealCompetitor, but excluding them here means the
    // `limit` is spent on real rivals instead of being filled with giants.
    exclude_top_domains: true,
    order_by: ["intersections,desc"],
  });
  return (result[0]?.items ?? []).map((i) => ({
    domain: i.domain,
    intersections: i.intersections ?? 0,
    avg_position: i.avg_position ?? null,
    organic_keywords: i.full_domain_metrics?.organic?.count ?? null,
    organic_traffic: i.full_domain_metrics?.organic?.etv ?? null,
  }));
}

export type SerpOrganicResult = {
  keyword: string;
  domain: string;
  title: string | null;
  snippet: string | null;
  position: number;
  url: string | null;
};

/** A business returned by the real Google Maps local results. */
export type GoogleMapsResult = {
  keyword: string;
  name: string;
  domain: string | null;
  placeId: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  position: number;
  city: string | null;
};

/**
 * Google Maps is deliberately queried separately from the organic SERP: a
 * business can dominate the Local Pack while having no meaningful SEO domain.
 * The advanced endpoint provides the real map rank, category and review data.
 */
export async function googleMapsSearch(
  keyword: string,
  opts: LocationOpts = {},
  depth = 10,
): Promise<GoogleMapsResult[]> {
  const result = await post<
    {
      items?: {
        type?: string;
        title?: string;
        domain?: string;
        url?: string;
        place_id?: string;
        cid?: string;
        category?: string;
        rating?: { value?: number; votes_count?: number } | number;
        reviews_count?: number;
        rank_group?: number;
        rank_absolute?: number;
        address?: string;
      }[];
    }[]
  >("/serp/google/maps/live/advanced", {
    keyword,
    ...loc(opts),
    depth,
  });
  return (result[0]?.items ?? [])
    .filter((item) => item.type === "maps_search" && item.title)
    .map((item) => {
      const rating = typeof item.rating === "number" ? item.rating : item.rating?.value ?? null;
      const reviewCount = item.reviews_count ?? (typeof item.rating === "object" ? item.rating?.votes_count ?? null : null);
      let domain = item.domain ?? null;
      if (!domain && item.url) {
        try {
          domain = new URL(item.url).hostname.replace(/^www\./i, "").toLowerCase();
        } catch {
          domain = null;
        }
      }
      return {
        keyword,
        name: item.title!.trim(),
        domain,
        placeId: item.place_id ?? item.cid ?? null,
        category: item.category ?? null,
        rating,
        reviewCount,
        position: item.rank_group ?? item.rank_absolute ?? 99,
        city: item.address?.split(",").map((part) => part.trim()).filter(Boolean).at(-2) ?? null,
      };
    });
}

/**
 * Real Google organic SERP results for one query (live advanced endpoint).
 * Used for competitor discovery: who actually ranks for the buyer's queries,
 * never an AI guess.
 */
export async function serpOrganicSearch(
  keyword: string,
  opts: LocationOpts = {},
  depth = 20,
): Promise<SerpOrganicResult[]> {
  return (await serpWithAiSignals(keyword, opts, depth)).organic;
}

/**
 * What an AI assistant answers for a query, taken from the same SERP response.
 *
 * This is the whole point of a GEO product: a keyword whose SERP carries an AI
 * Overview is a keyword where an assistant is already answering instead of the
 * merchant, and `citedDomains` names who it quotes. Both were being thrown
 * away — the old code filtered the response down to `type === "organic"` and
 * dropped every AI and answer feature we had already paid for.
 */
export type SerpAiSignals = {
  keyword: string;
  hasAiOverview: boolean;
  aiOverviewText: string | null;
  /** Domains the AI answer cites — the rivals that matter for GEO. */
  citedDomains: string[];
  hasFeaturedSnippet: boolean;
  hasPeopleAlsoAsk: boolean;
  /** Every SERP feature type present, for diagnostics. */
  featureTypes: string[];
};

type SerpItem = {
  type?: string;
  rank_absolute?: number;
  domain?: string;
  title?: string;
  description?: string;
  url?: string;
  text?: string;
  items?: SerpItem[];
  references?: { domain?: string; url?: string }[];
};

/** Collects text and cited domains from an AI Overview's nested structure. */
function readAiOverview(node: SerpItem, out: { text: string[]; domains: string[] }) {
  if (typeof node.text === "string" && node.text.trim()) out.text.push(node.text.trim());
  for (const ref of node.references ?? []) {
    const d = (ref.domain ?? "").replace(/^www\./, "").toLowerCase();
    if (d) out.domains.push(d);
  }
  for (const child of node.items ?? []) readAiOverview(child, out);
}

export async function serpWithAiSignals(
  keyword: string,
  opts: LocationOpts = {},
  depth = 20,
): Promise<{ organic: SerpOrganicResult[]; ai: SerpAiSignals }> {
  let result: { items?: SerpItem[] }[];
  try {
    result = await post<{ items?: SerpItem[] }[]>("/serp/google/organic/live/advanced", {
      keyword,
      ...loc(opts),
      device: "desktop",
      depth,
    });
  } catch (error) {
    const { hasSerpApi, serpApiGoogle } = await import("./serpapi.server");
    console.error("[serp] DataForSEO request failed", {
      keyword,
      location: opts.locationName ?? "France",
      error: error instanceof Error ? error.message : String(error),
      serpApiFallback: hasSerpApi(),
    });
    if (!hasSerpApi()) throw error;
    const organic = await serpApiGoogle(keyword, opts, depth);
    console.info("[serp] DataForSEO unavailable; used SerpApi fallback", { keyword, results: organic.length });
    return {
      organic,
      ai: {
        keyword,
        hasAiOverview: false,
        aiOverviewText: null,
        citedDomains: [],
        hasFeaturedSnippet: false,
        hasPeopleAlsoAsk: false,
        featureTypes: ["serpapi_google"],
      },
    };
  }
  const items = result[0]?.items ?? [];

  const dataForSeoOrganic = items
    .filter((i) => i.type === "organic" && i.domain)
    .map((i) => ({
      keyword,
      domain: (i.domain ?? "").replace(/^www\./, "").toLowerCase(),
      title: i.title ?? null,
      snippet: i.description ?? null,
      position: i.rank_absolute ?? 999,
      url: i.url ?? null,
    }));

  // SerpApi is the primary organic-Google source when configured. Its result
  // is based on the exact buyer query derived from title, meta, categories and
  // landing-page copy. DataForSEO still supplies keyword metrics and the AI
  // Overview signal, but cannot inject broad organic candidates into a B2B
  // competitor list.
  let organic = dataForSeoOrganic;
  const { hasSerpApi, serpApiGoogle } = await import("./serpapi.server");
  if (hasSerpApi()) {
    try {
      const serpApiOrganic = await serpApiGoogle(keyword, opts, depth);
      organic = serpApiOrganic.length ? serpApiOrganic : dataForSeoOrganic;
      console.info("[serp] selected organic Google source", {
        keyword,
        dataForSeo: dataForSeoOrganic.length,
        serpApi: serpApiOrganic.length,
        source: serpApiOrganic.length ? "serpapi" : "dataforseo",
      });
    } catch (error) {
      console.warn("[serp] SerpApi cross-check failed; keeping DataForSEO results", { keyword, error });
    }
  }

  const collected = { text: [] as string[], domains: [] as string[] };
  for (const item of items) {
    if (item.type === "ai_overview" || item.type === "ai_overview_element") readAiOverview(item, collected);
  }
  const featureTypes = Array.from(new Set(items.map((i) => i.type ?? "").filter(Boolean)));

  return {
    organic,
    ai: {
      keyword,
      hasAiOverview: featureTypes.includes("ai_overview"),
      aiOverviewText: collected.text.length ? collected.text.join(" ").slice(0, 1200) : null,
      citedDomains: Array.from(new Set(collected.domains)),
      hasFeaturedSnippet: featureTypes.includes("featured_snippet"),
      hasPeopleAlsoAsk: featureTypes.includes("people_also_ask"),
      featureTypes,
    },
  };
}
