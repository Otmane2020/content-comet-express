import { askJson, asArray, asNumber, asString } from "./ai.server";
import { COMPETITOR_FLOOR, type BusinessProfile, type CompetitorType, type OverlapClassification, type SemanticCompetitor, type SerpOverlapDomain } from "./types";
import type { DfsCompetitor } from "./plumbing.server";

const TYPES: CompetitorType[] = ["direct","adjacent","platform","marketplace"];
const CLASSES: OverlapClassification[] = ["competitor","publisher","directory","marketplace","community","authority","unknown"];
const KNOWN: Record<string, OverlapClassification> = {
  "g2.com":"directory","capterra.com":"directory","trustpilot.com":"directory","reddit.com":"community","quora.com":"community","wikipedia.org":"authority","youtube.com":"publisher","medium.com":"publisher","substack.com":"publisher","techradar.com":"publisher","slashdot.org":"publisher","forbes.com":"publisher","amazon.com":"marketplace","etsy.com":"marketplace","ebay.com":"marketplace","linkedin.com":"community",
};

export async function discoverSemanticCompetitors(apiKey: string, business: BusinessProfile): Promise<SemanticCompetitor[]> {
  const raw = await askJson<{ competitors?: unknown }>(apiKey,
    "Tu es analyste concurrentiel. Tu ne cites que des entreprises réelles vendant une offre comparable.",
    `Entreprise: ${business.companyName} (${business.domain}), type ${business.businessType}.\nProduits: ${business.products.join(", ") || "—"}\nServices: ${business.services.join(", ") || "—"}\nAudiences: ${business.audiences.join(", ") || "—"}\nSecteurs: ${business.industries.join(", ") || "—"}\nLocalisations: ${business.locations.join(", ") || "—"}\n\nIdentifie jusqu'à 10 concurrents SÉMANTIQUES (entreprises vendant un produit/service similaire ou résolvant le même problème).\nInterdit: médias, annuaires, forums, sites d'avis, encyclopédies — sauf si l'entreprise analysée est elle-même de cette catégorie.\n\nJSON: {"competitors":[{"name":string,"domain":string,"reason":string,"competitorType":"direct|adjacent|platform|marketplace","relevanceScore":0-100}]}`);
  return asArray<Record<string, unknown>>(raw.competitors).map((c) => {
    const t = asString(c["competitorType"], "direct") as CompetitorType;
    return { name: asString(c["name"]), domain: asString(c["domain"]).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""), reason: asString(c["reason"]), competitorType: TYPES.includes(t) ? t : "adjacent", relevanceScore: asNumber(c["relevanceScore"]) };
  }).filter((c) => c.domain && c.domain !== business.domain);
}

export function validateCompetitors(competitors: SemanticCompetitor[]) {
  const validated: SemanticCompetitor[] = []; const rejected: SemanticCompetitor[] = [];
  for (const c of competitors) {
    const known = KNOWN[c.domain];
    if (known && known !== "competitor") { rejected.push({ ...c, reason: `${c.reason} — rejeté: domaine de type ${known}` }); continue; }
    (c.relevanceScore >= COMPETITOR_FLOOR ? validated : rejected).push(c);
  }
  return { validated, rejected };
}

export async function classifyOverlapDomains(apiKey: string, business: BusinessProfile, dfs: DfsCompetitor[]): Promise<SerpOverlapDomain[]> {
  if (dfs.length === 0) return [];
  const unknown = dfs.filter((d) => !KNOWN[d.domain]);
  let aiMap = new Map<string, OverlapClassification>();
  if (unknown.length > 0) {
    try {
      const raw = await askJson<{ domains?: unknown }>(apiKey, "Tu classes des domaines qui se chevauchent en SERP.", `Entreprise analysée: ${business.companyName} (${business.domain}), type ${business.businessType}.\nClasse chaque domaine: competitor | publisher | directory | marketplace | community | authority | unknown.\nDomaines: ${unknown.map((d) => d.domain).join(", ")}\nJSON: {"domains":[{"domain":string,"classification":string}]}`, 1200);
      aiMap = new Map(asArray<Record<string, unknown>>(raw.domains).map((d) => { const c = asString(d["classification"], "unknown") as OverlapClassification; return [asString(d["domain"]), CLASSES.includes(c) ? c : "unknown"]; }));
    } catch { aiMap = new Map(); }
  }
  return dfs.map((d) => ({ domain: d.domain, organicKeywords: d.organicKeywords, organicTraffic: d.organicTraffic, intersections: d.intersections, classification: KNOWN[d.domain] ?? aiMap.get(d.domain) ?? "unknown" }));
}
