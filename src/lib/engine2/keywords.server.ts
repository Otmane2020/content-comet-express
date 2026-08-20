import { askJson, asArray, asNumber, asString } from "./ai.server";
import { searchVolume, type VolumeRow } from "./plumbing.server";
import { RELEVANCE_FLOOR, computeOpportunityScore, type BusinessProfile, type KeywordOpportunity, type KeywordSource, type RankedKeywordInsight, type RankedKeywordStrategy, type SearchIntent, type SemanticCompetitor, type SerpOverlapDomain } from "./types";

const INTENTS: SearchIntent[] = ["informational","commercial","transactional","navigational","local"];

export async function discoverKeywords(apiKey: string, business: BusinessProfile, competitors: SemanticCompetitor[], overlap: SerpOverlapDomain[]): Promise<KeywordOpportunity[]> {
  const raw = await askJson<{ keywords?: unknown }>(apiKey, "Tu es stratège SEO. Tu proposes des requêtes réellement tapées par des humains.",
    `Entreprise: ${business.companyName} (${business.domain}) — ${business.businessType}\nProduits: ${business.products.join(", ") || "—"}\nServices: ${business.services.join(", ") || "—"}\nAudiences: ${business.audiences.join(", ") || "—"}\nSujets commerciaux: ${business.commercialTopics.join(", ") || "—"}\nSujets informationnels: ${business.informationalTopics.join(", ") || "—"}\nConcurrents sémantiques validés: ${competitors.map((c) => c.domain).join(", ") || "—"}\nDomaines en chevauchement SERP (contexte uniquement, PAS des concurrents): ${overlap.map((o) => `${o.domain}(${o.classification})`).join(", ") || "—"}\n\nPropose 40 requêtes candidates. Aucune estimation de volume : uniquement la requête, sa source et son intention.\nJSON: {"keywords":[{"keyword":string,"source":"semantic_competitor|site|serp_gap|ai_discovery","intent":"informational|commercial|transactional|navigational|local"}]}`, 3000);
  const seen = new Set<string>(); const out: KeywordOpportunity[] = [];
  for (const k of asArray<Record<string, unknown>>(raw.keywords)) {
    const keyword = asString(k["keyword"]).trim(); const key = keyword.toLowerCase(); if (!keyword || seen.has(key)) continue; seen.add(key);
    const intent = asString(k["intent"], "informational") as SearchIntent; const source = asString(k["source"], "ai_discovery") as KeywordSource;
    out.push({ keyword, source, state:"candidate", volume:null, cpc:null, competition:null, intent: INTENTS.includes(intent) ? intent : "informational", relevanceScore:0, businessValueScore:0, opportunityScore:0, validated:false });
  }
  return out;
}

export async function measureKeywords(candidates: KeywordOpportunity[], locationName: string, languageName: string): Promise<{ measured: KeywordOpportunity[]; note?: string }> {
  if (!candidates.length) return { measured: [] };
  let rows: VolumeRow[] = []; let note: string | undefined;
  try { rows = await searchVolume(candidates.map((c) => c.keyword), locationName, languageName); }
  catch (e) { note = `DataForSEO indisponible : ${(e as Error).message}. Aucune donnée de volume n'est inventée.`; }
  const map = new Map(rows.map((r) => [r.keyword.toLowerCase(), r]));
  return { note, measured: candidates.map((c) => { const r = map.get(c.keyword.toLowerCase()); return { ...c, state:"measured" as const, volume:r?.volume ?? null, cpc:r?.cpc ?? null, competition:r?.competition ?? null }; }) };
}

export async function validateKeywordRelevance(apiKey: string, business: BusinessProfile, measured: KeywordOpportunity[]): Promise<KeywordOpportunity[]> {
  if (!measured.length) return [];
  const raw = await askJson<{ keywords?: unknown }>(apiKey, "Tu évalues la pertinence business d'une requête pour une entreprise donnée.",
    `Entreprise: ${business.companyName} — ${business.businessType}\nOffre: ${[...business.products,...business.services].join(", ") || "—"}\nAudiences: ${business.audiences.join(", ") || "—"}\n\nQuestion pour chaque requête : est-ce quelque chose que le client cible pourrait réellement chercher lorsqu'il cherche une information, un produit, une solution ou un service lié à cette entreprise ?\n\nRequêtes: ${measured.map((m) => m.keyword).join(" | ")}\n\nJSON: {"keywords":[{"keyword":string,"relevanceScore":0-100,"businessValueScore":0-100,"intent":"informational|commercial|transactional|navigational|local","reason":string}]}`, 4000);
  const map = new Map(asArray<Record<string, unknown>>(raw.keywords).map((k) => [asString(k["keyword"]).toLowerCase(), k]));
  return measured.map((m) => {
    const v = map.get(m.keyword.toLowerCase()); const relevanceScore = asNumber(v?.["relevanceScore"]); const businessValueScore = asNumber(v?.["businessValueScore"]); const intent = asString(v?.["intent"], m.intent) as SearchIntent;
    return { ...m, state:"relevance_validated", intent: INTENTS.includes(intent) ? intent : m.intent, relevanceScore, businessValueScore, reason: asString(v?.["reason"]), validated: relevanceScore >= RELEVANCE_FLOOR, rejectionReason: relevanceScore >= RELEVANCE_FLOOR ? undefined : `Pertinence ${relevanceScore} < ${RELEVANCE_FLOOR}` };
  });
}
export function scoreOpportunities(validated: KeywordOpportunity[]) { return validated.map((k) => ({ ...k, state:"opportunity_scored" as const, opportunityScore: computeOpportunityScore(k) })).sort((a,b) => b.opportunityScore-a.opportunityScore); }
export function selectBestOpportunity(scored: KeywordOpportunity[]): KeywordOpportunity | null { const withDemand = scored.filter((k) => k.validated && k.volume != null && k.volume > 0); const pool = withDemand.length ? withDemand : scored.filter((k) => k.validated); const best = pool[0]; return best ? { ...best, state:"selected" } : null; }
export function analyseRankedKeywords(ranked: { keyword: string; volume: number | null }[]): RankedKeywordInsight[] { return ranked.map((r) => { let strategy: RankedKeywordStrategy = "ignore"; if ((r.volume ?? 0)>=500) strategy="protect"; else if ((r.volume ?? 0)>=100) strategy="improve"; else if ((r.volume ?? 0)>0) strategy="refresh"; else strategy="expand"; return { keyword:r.keyword, volume:r.volume, position:null, strategy }; }); }
