import { askJson, asArray, asString } from "./ai.server";
import { slugify, type ArticleBlock, type ArticleBrief, type BusinessProfile, type FormatDecision, type GeneratedArticle, type Grounding, type KeywordOpportunity, type SemanticCompetitor, type SerpOverlapDomain } from "./types";
import type { PageInfo } from "./plumbing.server";

const GROUNDINGS: Grounding[] = ["FACT_FROM_WEBSITE","FACT_FROM_DATAFORSEO","FACT_FROM_SERP","GENERAL_KNOWLEDGE","UNVERIFIED"];
function grounding(v: unknown): Grounding { const s = asString(v, "GENERAL_KNOWLEDGE") as Grounding; return GROUNDINGS.includes(s) ? s : "GENERAL_KNOWLEDGE"; }
function normaliseBlocks(raw: unknown): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  for (const b of asArray<Record<string, unknown>>(raw)) {
    const type = asString(b["type"]);
    switch (type) {
      case "hero": out.push({ type:"hero", eyebrow:asString(b["eyebrow"]), title:asString(b["title"]), subtitle:asString(b["subtitle"]), readingTime:asString(b["readingTime"]) }); break;
      case "answer": out.push({ type:"answer", text:asString(b["text"]), grounding:grounding(b["grounding"]) }); break;
      case "keyTakeaways": out.push({ type:"keyTakeaways", items:asArray<string>(b["items"]) }); break;
      case "heading": out.push({ type:"heading", level:b["level"]===3 ? 3 : 2, text:asString(b["text"]) }); break;
      case "paragraph": out.push({ type:"paragraph", text:asString(b["text"]), grounding:grounding(b["grounding"]) }); break;
      case "bulletList": out.push({ type:"bulletList", items:asArray<string>(b["items"]) }); break;
      case "numberedList": out.push({ type:"numberedList", items:asArray<string>(b["items"]) }); break;
      case "quote": out.push({ type:"quote", text:asString(b["text"]), source:asString(b["source"]) }); break;
      case "stat": out.push({ type:"stat", value:asString(b["value"]), label:asString(b["label"]), grounding:grounding(b["grounding"]) }); break;
      case "comparisonTable": out.push({ type:"comparisonTable", caption:asString(b["caption"]), columns:asArray<string>(b["columns"]), rows:asArray<string[]>(b["rows"]).map((r) => asArray<string>(r)) }); break;
      case "productGrid": out.push({ type:"productGrid", items:asArray<Record<string, unknown>>(b["items"]).map((i) => ({ name:asString(i["name"]), description:asString(i["description"]), priceNote:asString(i["priceNote"]) })) }); break;
      case "callout": out.push({ type:"callout", tone:(["info","warning","ai"] as const).includes(b["tone"] as "info") ? (b["tone"] as "info"|"warning"|"ai") : "info", title:asString(b["title"]), text:asString(b["text"]) }); break;
      case "image": out.push({ type:"image", url:asString(b["url"]), alt:asString(b["alt"]), caption:asString(b["caption"]) }); break;
      case "faq": out.push({ type:"faq", items:asArray<Record<string, unknown>>(b["items"]).map((i) => ({ question:asString(i["question"]), answer:asString(i["answer"]) })) }); break;
      case "ctaInline": out.push({ type:"ctaInline", text:asString(b["text"]), label:asString(b["label"]), href:asString(b["href"]) }); break;
      case "locationCard": out.push({ type:"locationCard", location:asString(b["location"]), serviceArea:asArray<string>(b["serviceArea"]), note:asString(b["note"]) }); break;
      default: break;
    }
  }
  return out;
}

export async function generateStructuredArticle(apiKey: string, business: BusinessProfile, keyword: KeywordOpportunity, decision: FormatDecision, brief: ArticleBrief, context: { pages:PageInfo[]; competitors:SemanticCompetitor[]; overlap:SerpOverlapDomain[] }): Promise<Omit<GeneratedArticle,"quality"|"status">> {
  const relevantPages = context.pages.filter((p) => brief.internalLinks.some((l) => l.url === p.url) || p.topTerms.some((t) => brief.targetKeyword.toLowerCase().includes(t))).slice(0,4);
  const pagesForWriter = (relevantPages.length ? relevantPages : context.pages.slice(0,3)).map((p) => `- ${p.url} | ${p.title} | ${p.metaDescription}`).join("\n");
  const raw = await askJson<Record<string, unknown>>(apiKey, "Tu es rédacteur expert. Tu écris un article structuré en blocs JSON, sans Markdown, sans remplissage.",
    `Format: ${decision.format}\nPlan de blocs imposé (ordre indicatif, adapte au contenu réel): ${decision.blockPlan.join(" > ")}\nMot-clé cible: "${brief.targetKeyword}" (${keyword.volume != null ? `volume mesuré ${keyword.volume}` : "volume non mesuré — n'annonce aucun chiffre de recherche"})\nTitre validé: ${brief.title}\nAngle: ${brief.angle}\nAudience: ${brief.targetAudience}\nQuestions à couvrir: ${brief.questions.join(" | ")}\nEntités: ${brief.entities.join(", ")}\nPlan: ${brief.outline.map((o) => `${o.heading} (${o.goal})`).join(" | ")}\nObjectif de conversion: ${brief.conversionGoal}\nLongueur cible: ${brief.wordCountTarget.min}-${brief.wordCountTarget.max} mots\nEntreprise: ${business.companyName} — ${business.businessType}; offre: ${[...business.products,...business.services].join(", ") || "—"}\nPages internes utilisables:\n${pagesForWriter}\nInsights concurrents: ${brief.competitorInsights.join(" | ") || "—"}\n\nRÈGLES ABSOLUES\n- Aucune statistique, prix, avis, certification, nombre de clients ou résultat chiffré inventé.\n- Chaque bloc paragraph/answer/stat porte un champ "grounding": FACT_FROM_WEBSITE | FACT_FROM_DATAFORSEO | FACT_FROM_SERP | GENERAL_KNOWLEDGE | UNVERIFIED.\n- Ne transforme jamais un UNVERIFIED en affirmation factuelle : reformule ou supprime.\n- Le premier bloc "answer" doit répondre seul à la requête (40-80 mots pour AEO).\n\nTypes de blocs disponibles: hero, answer, keyTakeaways, heading, paragraph, bulletList, numberedList, quote, stat, comparisonTable, productGrid, callout, faq, ctaInline, locationCard.\n\nJSON:\n{"title":string,"excerpt":string,"seo":{"title":string,"description":string},"blocks":[ ... ],"faq":[{"question":string,"answer":string}],"citedEntities":[string]}`, 8000);
  const blocks = normaliseBlocks(raw["blocks"]); const faq = asArray<Record<string, unknown>>(raw["faq"]).map((f) => ({ question:asString(f["question"]), answer:asString(f["answer"]) }));
  const title = asString(raw["title"], brief.title); const seo = (raw["seo"] ?? {}) as Record<string, unknown>;
  return { id:crypto.randomUUID(), title, slug:slugify(title), targetKeyword:brief.targetKeyword, format:decision.format, excerpt:asString(raw["excerpt"]), blocks, faq, internalLinks:brief.internalLinks.map((l) => l.url), citedEntities:asArray<string>(raw["citedEntities"]), seo:{ title:asString(seo["title"], title), description:asString(seo["description"]) } };
}

function esc(value: string) { return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function attr(value?: string) { return esc(value ?? ""); }
export function renderBlocksToHtml(blocks: ArticleBlock[]): string {
  return blocks.map((b) => {
    switch (b.type) {
      case "hero": return `<header><p>${esc(b.eyebrow)}</p><h1>${esc(b.title)}</h1><p>${esc(b.subtitle)}</p><small>${esc(b.readingTime)}</small></header>`;
      case "answer": return `<section class="ranki-answer"><p>${esc(b.text)}</p></section>`;
      case "keyTakeaways": return `<section><h2>Key takeaways</h2><ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></section>`;
      case "heading": return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
      case "paragraph": return `<p>${esc(b.text)}</p>`;
      case "bulletList": return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      case "numberedList": return `<ol>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
      case "quote": return `<blockquote><p>${esc(b.text)}</p>${b.source ? `<cite>${esc(b.source)}</cite>` : ""}</blockquote>`;
      case "stat": return `<aside class="ranki-stat"><strong>${esc(b.value)}</strong><span>${esc(b.label)}</span></aside>`;
      case "comparisonTable": return `<figure>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}<table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></figure>`;
      case "productGrid": return `<section class="ranki-product-grid">${b.items.map((i) => `<article><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p>${i.priceNote ? `<p>${esc(i.priceNote)}</p>` : ""}</article>`).join("")}</section>`;
      case "callout": return `<aside class="ranki-callout ranki-callout-${b.tone}"><strong>${esc(b.title)}</strong><p>${esc(b.text)}</p></aside>`;
      case "image": return `<figure><img src="${attr(b.url)}" alt="${attr(b.alt)}" loading="lazy">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
      case "faq": return `<section class="ranki-faq"><h2>FAQ</h2><dl>${b.items.map((i) => `<dt>${esc(i.question)}</dt><dd>${esc(i.answer)}</dd>`).join("")}</dl></section>`;
      case "ctaInline": return `<aside class="ranki-cta"><p>${esc(b.text)}</p>${b.href ? `<a href="${attr(b.href)}">${esc(b.label)}</a>` : `<strong>${esc(b.label)}</strong>`}</aside>`;
      case "locationCard": return `<aside class="ranki-location"><h3>${esc(b.location)}</h3><p>${esc(b.note)}</p>${b.serviceArea.length ? `<ul>${b.serviceArea.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</aside>`;
    }
  }).join("\n");
}
