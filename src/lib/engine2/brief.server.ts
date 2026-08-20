import { askJson, asArray, asNumber, asString } from "./ai.server";
import { TITLE_FLOOR, type ArticleBrief, type BusinessProfile, type FormatDecision, type KeywordOpportunity, type SemanticCompetitor, type TitleValidation } from "./types";
import type { PageInfo } from "./plumbing.server";

export async function generateArticleBrief(apiKey: string, business: BusinessProfile, keyword: KeywordOpportunity, decision: FormatDecision, pages: PageInfo[], competitors: SemanticCompetitor[]): Promise<ArticleBrief> {
  const raw = await askJson<Record<string, unknown>>(apiKey, "Tu es rédacteur en chef SEO/GEO. Tu produis un brief opérationnel.",
    `Mot-clé cible: "${keyword.keyword}" (intention ${keyword.intent}${keyword.volume != null ? `, volume mesuré ${keyword.volume}` : ", volume non mesuré"}).\nFormat imposé: ${decision.format} — ${decision.reason}\nEntreprise: ${business.companyName} (${business.domain}) — ${business.businessType}\nOffre: ${[...business.products,...business.services].join(", ") || "—"}\nAudiences: ${business.audiences.join(", ") || "—"}\nEntités: ${business.entities.join(", ") || "—"}\nConcurrents validés: ${competitors.map((c) => `${c.name} (${c.domain})`).join(", ") || "—"}\nPages internes disponibles pour maillage: ${pages.map((p) => `${p.url} — ${p.title}`).join(" | ")}\n\nJSON:\n{"targetKeyword":string,"secondaryKeywords":[string],"searchIntent":string,"title":string,"angle":string,"targetAudience":string,\n "questions":[string],"entities":[string],\n "outline":[{"heading":string,"goal":string}],\n "internalLinks":[{"url":string,"anchorSuggestion":string}],\n "competitorInsights":[string],\n "conversionGoal":string,\n "wordCountTarget":{"min":number,"max":number}}`, 3000);
  return {
    targetKeyword: asString(raw["targetKeyword"], keyword.keyword), secondaryKeywords: asArray<string>(raw["secondaryKeywords"]), format: decision.format,
    searchIntent: asString(raw["searchIntent"], keyword.intent), title: asString(raw["title"]), angle: asString(raw["angle"]), targetAudience: asString(raw["targetAudience"]),
    questions: asArray<string>(raw["questions"]), entities: asArray<string>(raw["entities"]),
    outline: asArray<Record<string, unknown>>(raw["outline"]).map((o) => ({ heading: asString(o["heading"]), goal: asString(o["goal"]) })),
    internalLinks: asArray<Record<string, unknown>>(raw["internalLinks"]).map((l) => ({ url: asString(l["url"]), anchorSuggestion: asString(l["anchorSuggestion"]) })).filter((l) => pages.some((p) => p.url === l.url)),
    competitorInsights: asArray<string>(raw["competitorInsights"]), conversionGoal: asString(raw["conversionGoal"]),
    wordCountTarget: { min: asNumber((raw["wordCountTarget"] as Record<string, unknown>)?.["min"]) || 900, max: asNumber((raw["wordCountTarget"] as Record<string, unknown>)?.["max"]) || 1600 },
  };
}
async function validateTitle(apiKey: string, business: BusinessProfile, brief: ArticleBrief): Promise<{ score:number; reason:string }> {
  const raw = await askJson<Record<string, unknown>>(apiKey, "Tu évalues sévèrement la qualité d'un titre éditorial.",
    `Titre: "${brief.title}"\nMot-clé: "${brief.targetKeyword}" — intention: ${brief.searchIntent}\nEntreprise: ${business.companyName} (${business.businessType})\n\nCritères: satisfait l'intention, représente clairement le sujet, non générique, non mécanique, ne concatène pas simplement le mot-clé, ne cite pas de concurrent non lié.\nJSON: {"valid":boolean,"score":0-100,"reason":string}`, 600);
  return { score: asNumber(raw["score"]), reason: asString(raw["reason"]) };
}
export async function validateBrief(apiKey: string, business: BusinessProfile, brief: ArticleBrief): Promise<{ brief:ArticleBrief; validation:TitleValidation }> {
  let current = brief; let last = { score:0, reason:"Non évalué" };
  for (let attempt=1; attempt<=3; attempt++) {
    last = await validateTitle(apiKey, business, current);
    if (last.score >= TITLE_FLOOR) return { brief: current, validation: { valid:true, score:last.score, reason:last.reason, attempts:attempt } };
    if (attempt === 3) break;
    const retry = await askJson<Record<string, unknown>>(apiKey, "Tu réécris un titre éditorial de haute qualité.", `Titre refusé: "${current.title}"\nRaison du refus: ${last.reason}\nMot-clé cible: "${current.targetKeyword}" — intention ${current.searchIntent}\nFormat: ${current.format}\nPropose un titre nettement meilleur, spécifique et naturel.\nJSON: {"title":string}`, 400);
    current = { ...current, title: asString(retry["title"], current.title) };
  }
  return { brief: current, validation: { valid:false, score:last.score, reason:last.reason, attempts:3 } };
}
