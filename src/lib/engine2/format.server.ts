import { askJson, asArray, asString } from "./ai.server";
import type { ArticleBlock, BusinessProfile, ContentFormat, FormatDecision, KeywordOpportunity } from "./types";
const FORMATS: ContentFormat[] = ["SEO","GEO","AEO","LOCAL_AEO","SHOPPING"];
const SELLS: BusinessProfile["businessType"][] = ["ecommerce","marketplace","manufacturer","wholesaler"];
function planBlocks(format: ContentFormat, signals: { comparison:boolean; steps:boolean; products:boolean; location:boolean }): ArticleBlock["type"][] {
  const plan: ArticleBlock["type"][] = ["hero"];
  if (format === "AEO" || format === "GEO" || format === "LOCAL_AEO") plan.push("answer");
  if (format === "GEO" || format === "SEO") plan.push("keyTakeaways");
  if (format === "LOCAL_AEO") plan.push("locationCard");
  if (format === "SHOPPING") plan.push("productGrid");
  plan.push("heading","paragraph");
  if (signals.comparison || format === "SHOPPING" || format === "GEO") plan.push("comparisonTable");
  if (signals.steps) plan.push("numberedList");
  if (format === "GEO") plan.push("callout");
  if (signals.products && format !== "SHOPPING") plan.push("bulletList");
  plan.push("faq","ctaInline");
  return plan;
}
export async function selectContentFormat(apiKey: string, business: BusinessProfile, keyword: KeywordOpportunity): Promise<FormatDecision> {
  const localAllowed = business.locations.length > 0;
  const shoppingAllowed = SELLS.includes(business.businessType) || business.products.length > 0;
  const raw = await askJson<Record<string, unknown>>(apiKey, "Tu choisis un format de contenu unique et justifié.",
    `Requête: "${keyword.keyword}" (intention ${keyword.intent}).\nEntreprise: ${business.companyName} — ${business.businessType}.\nProduits: ${business.products.join(", ") || "—"}\nLocalisations réelles: ${business.locations.join(", ") || "aucune"}\n\nFormats autorisés: SEO, GEO, AEO${localAllowed ? ", LOCAL_AEO" : ""}${shoppingAllowed ? ", SHOPPING" : ""}.\n${localAllowed ? "" : "LOCAL_AEO est INTERDIT (aucune localisation réelle établie)."}\n${shoppingAllowed ? "" : "SHOPPING est INTERDIT (le site ne vend pas de produits identifiés)."}\n\nSignale aussi la nature du contenu attendu.\nJSON: {"format":string,"reason":string,"needsComparison":boolean,"needsSteps":boolean,"needsProducts":boolean}`, 800);
  let format = asString(raw["format"], "SEO").toUpperCase() as ContentFormat;
  if (!FORMATS.includes(format)) format = "SEO";
  if (format === "LOCAL_AEO" && !localAllowed) format = "AEO";
  if (format === "SHOPPING" && !shoppingAllowed) format = "SEO";
  const signals = { comparison: raw["needsComparison"] === true, steps: raw["needsSteps"] === true, products: raw["needsProducts"] === true && shoppingAllowed, location: format === "LOCAL_AEO" };
  return { format, reason: asString(raw["reason"]), blockPlan: planBlocks(format, signals) };
}
export function formatNotes(decision: FormatDecision) { return asArray<string>([]).concat(decision.blockPlan); }
