/** Lightweight Google SERP fallback for the SerpApi free allowance.
 * Kept server-only: SERPAPI_API_KEY must never be exposed to the browser. */
export type SerpApiOrganic = {
  keyword: string;
  domain: string;
  title: string | null;
  snippet: string | null;
  position: number;
  url: string | null;
};

type LocationOpts = { locationName?: string; languageCode?: string };

export function hasSerpApi() {
  return Boolean(process.env["SERPAPI_API_KEY"]?.trim());
}

const countryFor = (location: string) => {
  const normalized = location.toLowerCase();
  if (normalized.includes("france")) return "fr";
  if (normalized.includes("spain")) return "es";
  if (normalized.includes("germany")) return "de";
  if (normalized.includes("italy")) return "it";
  if (normalized.includes("netherlands")) return "nl";
  if (normalized.includes("portugal")) return "pt";
  return "us";
};

/** Fetches one real Google result page. No request is made without the key. */
export async function serpApiGoogle(
  keyword: string,
  opts: LocationOpts = {},
  depth = 20,
): Promise<SerpApiOrganic[]> {
  const key = process.env["SERPAPI_API_KEY"]?.trim();
  if (!key) throw new Error("SerpApi is not configured.");
  const location = opts.locationName ?? "France";
  const params = new URLSearchParams({
    engine: "google",
    q: keyword,
    api_key: key,
    hl: opts.languageCode ?? "fr",
    gl: countryFor(location),
    location,
    num: String(Math.min(Math.max(depth, 1), 100)),
  });
  const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
  const json = (await res.json()) as {
    error?: string;
    organic_results?: { position?: number; link?: string; title?: string; snippet?: string }[];
  };
  if (!res.ok || json.error) throw new Error(json.error ?? `SerpApi error (${res.status})`);
  return (json.organic_results ?? [])
    .map((item) => {
      let domain = "";
      try { domain = new URL(item.link ?? "").hostname.replace(/^www\./, "").toLowerCase(); } catch { /* discard */ }
      return {
        keyword,
        domain,
        title: item.title ?? null,
        snippet: item.snippet ?? null,
        position: item.position ?? 999,
        url: item.link ?? null,
      };
    })
    .filter((item) => Boolean(item.domain));
}
