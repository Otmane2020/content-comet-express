const BASE = "https://api.dataforseo.com/v3";

/** Checks whether the DataForSEO credentials are accepted (live data available). */
export async function dfsPing(): Promise<{ live: boolean; reason: string | null }> {
  const login = process.env["DATAFORSEO_LOGIN"];
  const password = process.env["DATAFORSEO_PASSWORD"];
  if (!login || !password) return { live: false, reason: "missing" };
  try {
    const res = await fetch(`${BASE}/appendix/user_data`, {
      headers: { Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64") },
    });
    if (res.status === 401) return { live: false, reason: "unauthorized" };
    if (!res.ok) return { live: false, reason: "unreachable" };
    return { live: true, reason: null };
  } catch {
    return { live: false, reason: "unreachable" };
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

async function post<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify([payload]),
  });
  const json = (await res.json()) as {
    status_code?: number;
    status_message?: string;
    tasks?: { status_code?: number; status_message?: string; result?: unknown }[];
  };
  if (!res.ok || (json.status_code && json.status_code >= 40000)) {
    throw new Error(json.status_message ?? `DataForSEO error (${res.status})`);
  }
  const task = json.tasks?.[0];
  if (task?.status_code && task.status_code >= 40000) throw new Error(task.status_message ?? "DataForSEO task failed");
  return (task?.result ?? []) as T;
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
 * Real Google Ads metrics for keywords WE chose, in one batched request.
 *
 * This is the direction the research runs in: the AI reads the landing page and
 * proposes the candidate keywords, and DataForSEO only validates them. The
 * alternative — seeding `keyword_suggestions` and letting Google's phrase-match
 * generate the candidate space — inherits the seed's audience, which is how a
 * furniture wholesaler ended up with "canapés d'angle convertibles": consumer
 * queries expanded from a consumer seed.
 *
 * Candidates with no measured volume are dropped: an invented phrase nobody
 * searches is exactly what this call is here to catch.
 */
export async function searchVolumeFor(
  keywords: string[],
  opts: LocationOpts = {},
): Promise<KeywordRow[]> {
  // The endpoint accepts up to 1000 keywords per task; the quota caps us far
  // below that, so one request is always enough.
  const batch = Array.from(
    new Set(keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length > 1 && k.length <= 80)),
  ).slice(0, 700);
  if (!batch.length) return [];
  const result = await post<
    {
      items?: {
        keyword?: string;
        search_volume?: number | null;
        cpc?: number | null;
        competition?: number | null;
        competition_index?: number | null;
      }[];
    }[]
  >("/keywords_data/google_ads/search_volume/live", {
    keywords: batch,
    ...loc(opts),
  });
  return (result[0]?.items ?? [])
    .filter((i) => i.keyword && (i.search_volume ?? 0) > 0)
    .map((i) => ({
      keyword: i.keyword!,
      search_volume: i.search_volume ?? null,
      cpc: i.cpc ?? null,
      competition: i.competition ?? null,
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

  const organic = items
    .filter((i) => i.type === "organic" && i.domain)
    .map((i) => ({
      keyword,
      domain: (i.domain ?? "").replace(/^www\./, "").toLowerCase(),
      title: i.title ?? null,
      snippet: i.description ?? null,
      position: i.rank_absolute ?? 999,
      url: i.url ?? null,
    }));

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
