import { scrapeForEngine, competitorsForDomain, rankedKeywords } from "./plumbing.server";
import { understandBusiness } from "./business.server";
import { classifyOverlapDomains, discoverSemanticCompetitors, validateCompetitors } from "./competitors.server";
import { analyseRankedKeywords, discoverKeywords, measureKeywords, scoreOpportunities, selectBestOpportunity, validateKeywordRelevance } from "./keywords.server";
import { selectContentFormat } from "./format.server";
import { generateArticleBrief, validateBrief } from "./brief.server";
import { generateStructuredArticle } from "./article.server";
import { validateArticle } from "./quality.server";
import type { BusinessProfile, KeywordOpportunity, SemanticCompetitor, SerpOverlapDomain } from "./types";
import type { PageInfo } from "./plumbing.server";

export type MarketResearchResult = {
  site: { domain:string; lang:string; pages:PageInfo[]; text:string };
  business: BusinessProfile;
  semanticCompetitors: SemanticCompetitor[];
  rejectedCompetitors: SemanticCompetitor[];
  serpOverlap: SerpOverlapDomain[];
  opportunities: KeywordOpportunity[];
  rejectedKeywords: KeywordOpportunity[];
  selected: KeywordOpportunity;
  rankedInsights: ReturnType<typeof analyseRankedKeywords>;
  notes: string[];
};

function marketNames(lang: string) {
  if (lang.startsWith("fr")) return { locationName:"France", languageName:"French" };
  if (lang.startsWith("de")) return { locationName:"Germany", languageName:"German" };
  if (lang.startsWith("es")) return { locationName:"Spain", languageName:"Spanish" };
  if (lang.startsWith("it")) return { locationName:"Italy", languageName:"Italian" };
  return { locationName:"United States", languageName:"English" };
}

export async function runMarketResearch(apiKey: string, rawUrl: string): Promise<MarketResearchResult> {
  const notes: string[] = [];
  const site = await scrapeForEngine(rawUrl);
  const business = await understandBusiness(apiKey, site);
  const proposed = await discoverSemanticCompetitors(apiKey, business);
  const { validated: semanticCompetitors, rejected: rejectedCompetitors } = validateCompetitors(proposed);
  const market = marketNames(site.lang);
  const dfs = await competitorsForDomain(site.domain, market.locationName, market.languageName).catch((e: Error) => {
    notes.push(`Chevauchement SERP DataForSEO indisponible : ${e.message}`);
    return [];
  });
  const serpOverlap = await classifyOverlapDomains(apiKey, business, dfs);
  const candidates = await discoverKeywords(apiKey, business, semanticCompetitors, serpOverlap);
  if (!candidates.length) throw new Error("Aucun mot-clé candidat généré.");
  const { measured, note } = await measureKeywords(candidates, market.locationName, market.languageName);
  if (note) notes.push(note);
  const relevanceChecked = await validateKeywordRelevance(apiKey, business, measured);
  const passed = relevanceChecked.filter((k) => k.validated);
  const rejectedKeywords = relevanceChecked.filter((k) => !k.validated);
  if (!passed.length) throw new Error("Aucun mot-clé n'atteint le seuil de pertinence (65).");
  const opportunities = scoreOpportunities(passed);
  const selected = selectBestOpportunity(opportunities);
  if (!selected) throw new Error("Aucune opportunité sélectionnable.");
  const ranked = await rankedKeywords(site.domain, market.locationName, market.languageName).catch(() => []);
  return { site, business, semanticCompetitors, rejectedCompetitors, serpOverlap, opportunities, rejectedKeywords, selected, rankedInsights: analyseRankedKeywords(ranked), notes };
}

export async function runArticleFromOpportunity(apiKey: string, research: Pick<MarketResearchResult,"site"|"business"|"semanticCompetitors"|"serpOverlap">, opportunity: KeywordOpportunity) {
  const decision = await selectContentFormat(apiKey, research.business, opportunity);
  const draftBrief = await generateArticleBrief(apiKey, research.business, opportunity, decision, research.site.pages, research.semanticCompetitors);
  const { brief, validation } = await validateBrief(apiKey, research.business, draftBrief);
  if (!validation.valid) throw new Error(`QUALITY_FAILED — titre refusé : ${validation.reason}`);
  const draft = await generateStructuredArticle(apiKey, research.business, opportunity, decision, brief, { pages:research.site.pages, competitors:research.semanticCompetitors, overlap:research.serpOverlap });
  const quality = await validateArticle(apiKey, research.business, brief, draft);
  const article = { ...draft, quality, status: quality.passed ? "draft" as const : "failed" as const };
  if (!quality.passed) throw new Error(`QUALITY_FAILED — ${quality.errors.join("; ")}`);
  return { formatDecision:decision, brief, titleValidation:validation, article };
}
