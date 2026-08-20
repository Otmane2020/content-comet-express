import { askJson, asArray, asNumber } from "./ai.server";
import type { ArticleBrief, ArticleQuality, BusinessProfile, GeneratedArticle } from "./types";
const KEYS = ["relevance","intentMatch","factualGrounding","structure","readability","seo","geo","aeo","internalLinking","brandFit"] as const;
export async function validateArticle(apiKey: string, business: BusinessProfile, brief: ArticleBrief, article: Omit<GeneratedArticle,"quality"|"status">): Promise<ArticleQuality> {
  const plain = article.blocks.map((b) => JSON.stringify(b)).join("\n").slice(0,14000);
  const raw = await askJson<Record<string, unknown>>(apiKey, "Tu es évaluateur qualité indépendant. Tu notes sévèrement, sans complaisance.",
    `Entreprise: ${business.companyName} (${business.businessType})\nMot-clé: ${brief.targetKeyword} — intention ${brief.searchIntent} — format ${brief.format}\nTitre: ${article.title}\n\nBlocs de l'article:\n${plain}\n\nNote de 0 à 100: relevance, intentMatch, factualGrounding, structure, readability, seo, geo, aeo, internalLinking, brandFit.\nSignale toute affirmation non vérifiable comme erreur.\nJSON: {"relevance":n,"intentMatch":n,"factualGrounding":n,"structure":n,"readability":n,"seo":n,"geo":n,"aeo":n,"internalLinking":n,"brandFit":n,"errors":[string],"warnings":[string]}`, 2000);
  const scores = Object.fromEntries(KEYS.map((k) => [k, asNumber(raw[k])])) as Record<(typeof KEYS)[number], number>;
  const overall = Math.round(KEYS.reduce((s,k) => s + scores[k], 0) / KEYS.length);
  const errors = asArray<string>(raw["errors"]); const warnings = asArray<string>(raw["warnings"]);
  const hardFail = scores.relevance < 75 || scores.intentMatch < 75 || scores.factualGrounding < 80 || overall < 78;
  if (hardFail) errors.push(`Seuils non atteints — relevance ${scores.relevance}/75, intentMatch ${scores.intentMatch}/75, factualGrounding ${scores.factualGrounding}/80, overall ${overall}/78`);
  return { ...scores, overall, passed: !hardFail, errors, warnings };
}
