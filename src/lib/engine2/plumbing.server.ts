import { scrapeCompetitorEvidence } from "../scrape.server";
import { competitorDomains, keywordsForSite, searchVolumeFor } from "../dataforseo.server";

export type PageInfo = {
  url: string;
  title: string;
  metaDescription: string;
  h1: string;
  headings: string[];
  topTerms: string[];
  text: string;
};
export type ScrapedEngineSite = { domain: string; lang: string; pages: PageInfo[]; text: string };
export type VolumeRow = { keyword: string; volume: number | null; cpc: number | null; competition: number | null };
export type DfsCompetitor = { domain: string; organicKeywords: number | null; organicTraffic: number | null; intersections: number | null };

function terms(text: string) {
  const stop = new Set(["avec","dans","pour","from","that","this","your","vous","des","les","une","the","and","www","http","https"]);
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9-]{4,}/g) ?? []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0,20).map(([word]) => word);
}

export async function scrapeForEngine(rawUrl: string): Promise<ScrapedEngineSite> {
  const evidence = await scrapeCompetitorEvidence(rawUrl, 5);
  const pages = evidence.pages.map((p) => ({
    url: p.url,
    title: p.title ?? "",
    metaDescription: p.description ?? "",
    h1: p.headings[0] ?? "",
    headings: p.headings,
    topTerms: terms(`${p.title ?? ""} ${p.description ?? ""} ${p.headings.join(" ")} ${p.text}`),
    text: p.text,
  }));
  return {
    domain: evidence.domain,
    lang: evidence.lang?.slice(0,2).toLowerCase() || (evidence.domain.endsWith(".fr") ? "fr" : "en"),
    pages,
    text: pages.map((p) => p.text).join("\n").slice(0,24000),
  };
}

function locale(locationName: string, languageName: string) {
  const languageCode = /^fr/i.test(languageName) ? "fr" : /^es/i.test(languageName) ? "es" : /^de/i.test(languageName) ? "de" : /^it/i.test(languageName) ? "it" : "en";
  return { locationName, languageCode };
}

export async function searchVolume(keywords: string[], locationName: string, languageName: string): Promise<VolumeRow[]> {
  const rows = await searchVolumeFor(keywords, locale(locationName, languageName));
  return rows.map((r) => ({ keyword: r.keyword, volume: r.search_volume, cpc: r.cpc, competition: r.competition }));
}

export async function competitorsForDomain(domain: string, locationName: string, languageName: string): Promise<DfsCompetitor[]> {
  const rows = await competitorDomains(domain, locale(locationName, languageName), 10);
  return rows.map((r: any) => ({
    domain: r.domain,
    organicKeywords: r.organic_keywords ?? r.organicKeywords ?? r.count ?? null,
    organicTraffic: r.organic_traffic ?? r.organicTraffic ?? r.etv ?? null,
    intersections: r.intersections ?? null,
  }));
}

export async function rankedKeywords(domain: string, locationName: string, languageName: string): Promise<{ keyword: string; volume: number | null }[]> {
  const rows = await keywordsForSite(domain, locale(locationName, languageName), 30);
  return rows.map((r) => ({ keyword: r.keyword, volume: r.search_volume }));
}
