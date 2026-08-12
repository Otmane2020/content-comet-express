import { googleMapsSearch, searchVolumeFor, type GoogleMapsResult } from "./dataforseo.server";
import { localeOpts, type KwRow } from "./research.server";

export type LocalCompetitor = {
  identity: string;
  name: string;
  domain: string | null;
  placeId: string | null;
  country: string;
  city: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  queriesFoundFor: string[];
  localPackPositions: number[];
  recurrenceScore: number;
  localScore?: number;
  websiteAnalysis?: {
    categories: string[];
    topics: string[];
    commercialTerms: string[];
  };
};

export type LocalQuery = {
  keyword: string;
  location: string;
  results: { name: string; domain: string | null; position: number }[];
};

export type LocalMarket = {
  location: { country: string; city: string | null; source: "onboarding" | "website" | "country" };
  queries: string[];
  localQueries: LocalQuery[];
  competitors: LocalCompetitor[];
  opportunities: KwRow[];
  gaps: { topic: string; competitorCoverage: number }[];
};

type LocalBusiness = {
  industry?: string | null;
  sales_model?: string | null;
  products?: string[] | null;
  services?: string[] | null;
  locations?: string[] | null;
};

const unique = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

function locationTerms(business: LocalBusiness, country: string) {
  return unique((business.locations ?? []).filter((location) => location.toLowerCase() !== country.toLowerCase())).slice(0, 3);
}

function localQueries(business: LocalBusiness, buyerKeywords: string[], country: string) {
  const terms = unique([
    ...buyerKeywords,
    ...(business.products ?? []).map((product) =>
      business.sales_model === "wholesale" ? `grossiste ${product}` : product,
    ),
    ...(business.services ?? []),
    business.industry ?? "",
  ]).slice(0, 5);
  const locations = locationTerms(business, country);
  // Query both the core buyer phrase and confirmed service-area versions. We
  // never fabricate Paris or another city which the merchant has not supplied.
  return unique([
    ...terms,
    ...locations.flatMap((location) => terms.slice(0, 4).map((term) => `${term} ${location}`)),
  ]).slice(0, 9);
}

function mapsLocations(business: LocalBusiness, country: string) {
  const confirmed = locationTerms(business, country);
  // DataForSEO Maps geolocates from `location_name`. Country-only is a valid
  // fallback, but a confirmed city/region must be queried independently — a
  // Paris Local Pack is not the same market as France-wide organic results.
  return confirmed.length
    ? confirmed.map((location) =>
        location.toLowerCase().includes(country.toLowerCase()) ? location : `${location}, ${country}`,
      )
    : [country];
}

function resolveLocation(business: LocalBusiness, country: string) {
  const city = locationTerms(business, country)[0] ?? null;
  return { country, city, source: city ? "website" as const : "country" as const };
}

async function analyseLocalWebsite(domain: string) {
  const { scrapeLandingProfile } = await import("./scrape.server");
  const page = await scrapeLandingProfile(domain);
  return {
    categories: [...page.categoryLinks, ...page.schemaNames].slice(0, 20),
    topics: [...page.h2, ...page.h3].slice(0, 20),
    commercialTerms: page.b2bMarkers.slice(0, 12),
  };
}

function categoryMatch(row: GoogleMapsResult, business: LocalBusiness) {
  const haystack = `${row.name} ${row.category ?? ""}`.toLowerCase();
  const terms = [business.industry ?? "", ...(business.products ?? []), ...(business.services ?? [])]
    .flatMap((term) => term.toLowerCase().split(/\s+/))
    .filter((term) => term.length > 3);
  return terms.length ? Math.min(1, terms.filter((term) => haystack.includes(term)).length / Math.min(3, terms.length)) : 0.5;
}

/**
 * The local branch of the primary research pipeline. Google Maps is sampled
 * over several real buyer queries, then ranks businesses by recurrence,
 * placement, category relevance and review authority rather than a single #1.
 */
export async function researchLocalMarket(input: {
  business: LocalBusiness;
  locale: string | null;
  targetCountry: string;
  buyerKeywords: string[];
  limit?: number;
}): Promise<LocalMarket> {
  const opts = localeOpts(input.locale, input.targetCountry);
  const queries = localQueries(input.business, input.buyerKeywords, opts.locationName);
  const location = resolveLocation(input.business, opts.locationName);
  if (!queries.length) return { location, queries: [], localQueries: [], competitors: [], opportunities: [], gaps: [] };

  const mapLocations = mapsLocations(input.business, opts.locationName);
  // For Local GEO, the top three Maps/GBP results for each real location are
  // the signal. Fetching ten results adds noise and weakens recurrence.
  const mapTasks = mapLocations.flatMap((locationName) =>
    queries.map((keyword) => ({ keyword, location: locationName })),
  );
  const mapBatches = await Promise.all(
    mapTasks.map(({ keyword, location: locationName }) => googleMapsSearch(keyword, { languageCode: opts.languageCode, locationName }, 3).catch(() => [])),
  );
  const rows = mapBatches.flat();
  console.info("[local-market] Google Maps scan", {
    targetCountry: opts.locationName,
    language: opts.languageCode,
    queries,
    mapLocations,
    batches: mapBatches.map((batch) => batch.length),
    results: rows.length,
  });
  const totalQueries = queries.length * mapLocations.length;
  const grouped = new Map<string, GoogleMapsResult[]>();
  for (const row of rows) {
    const identity = (row.placeId || row.domain || `${row.name}|${row.city ?? ""}`).toLowerCase();
    grouped.set(identity, [...(grouped.get(identity) ?? []), row]);
  }
  const localQueryResults = mapTasks.map((task, index) => ({
    keyword: task.keyword,
    location: task.location,
    results: mapBatches[index]!.map((row) => ({ name: row.name, domain: row.domain, position: row.position })),
  }));
  const competitors = [...grouped.entries()]
    .map(([identity, found]): LocalCompetitor => {
      const first = found[0]!;
      const recurrence = found.length / totalQueries;
      const averagePosition = found.reduce((sum, row) => sum + row.position, 0) / found.length;
      const positionScore = Math.max(0, 1 - (averagePosition - 1) / 9);
      const reviewAuthority = Math.min(1, Math.log10((first.reviewCount ?? 0) + 1) / 4);
      const score = recurrence * 0.4 + positionScore * 0.3 + categoryMatch(first, input.business) * 0.2 + reviewAuthority * 0.1;
      return {
        identity,
        name: first.name,
        domain: first.domain,
        placeId: first.placeId,
        country: opts.locationName,
        city: first.city,
        category: first.category,
        rating: first.rating,
        reviewCount: first.reviewCount,
        queriesFoundFor: unique(found.map((row) => row.keyword)),
        localPackPositions: found.map((row) => row.position).sort((a, b) => a - b),
        recurrenceScore: Number((recurrence * 100).toFixed(2)),
        localScore: Number((score * 100).toFixed(2)),
      };
    })
    .sort((a, b) => (b.localScore ?? 0) - (a.localScore ?? 0))
    .slice(0, input.limit ?? 8);

  // Read only the strongest local businesses. A Maps entry without a website
  // remains valuable for recurrence/review evidence, but is never invented
  // into a crawlable domain.
  const enriched = await Promise.all(
    competitors.slice(0, 5).map(async (competitor) => {
      if (!competitor.domain) return competitor;
      try {
        return { ...competitor, websiteAnalysis: await analyseLocalWebsite(competitor.domain) };
      } catch {
        return competitor;
      }
    }),
  );
  const clientTerms = new Set([...(input.business.products ?? []), ...(input.business.services ?? [])].map((term) => term.toLowerCase()));
  const gapCounts = new Map<string, number>();
  for (const competitor of enriched) {
    for (const topic of new Set(competitor.websiteAnalysis?.categories ?? [])) {
      const key = topic.trim().toLowerCase();
      if (key.length > 2 && !clientTerms.has(key)) gapCounts.set(topic, (gapCounts.get(topic) ?? 0) + 1);
    }
  }
  const gaps = [...gapCounts.entries()]
    .filter(([, competitorCoverage]) => competitorCoverage >= 2)
    .map(([topic, competitorCoverage]) => ({ topic, competitorCoverage }))
    .sort((a, b) => b.competitorCoverage - a.competitorCoverage)
    .slice(0, 12);

  // Validate city/area variants before the calendar uses them. They become
  // `origin: local` only after a real Maps result has proved local demand.
  const localTerms = unique([
    ...locationTerms(input.business, opts.locationName).flatMap((location) => input.buyerKeywords.slice(0, 5).map((keyword) => `${keyword} ${location}`)),
    ...queries.filter((query) => locationTerms(input.business, opts.locationName).some((location) => query.toLowerCase().includes(location.toLowerCase()))),
  ]).slice(0, 15);
  const opportunities = localTerms.length ? await searchVolumeFor(localTerms, opts).catch(() => [] as KwRow[]) : [];
  return {
    location,
    queries,
    localQueries: localQueryResults,
    competitors: enriched,
    opportunities: opportunities.map((row) => ({ ...row, origin: "local" as const })),
    gaps,
  };
}
