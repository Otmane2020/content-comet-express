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
