import { callOpenRouter, parseJsonLoose } from "./ai.server";
import { TYPE_META, type ContentType } from "./geo";
import { LANGUAGES } from "./industries";

export type ProjectBrief = {
  name: string;
  website_url: string | null;
  industry: string | null;
  audience: string | null;
  tone: string | null;
  locale: string | null;
  keywords: string[];
  locations?: string[] | null;
  /** Verified business signals used to keep topics and formats grounded in
   * what this business actually is — never a generic industry guess. */
  profile?: CanonicalProfileFacts | null;
};

/** The six publishing templates. Content type selects structure, never topic. */
export const CONTENT_TEMPLATES = {
  geo: "H1 → direct answer (50-90 words) → verified key facts → question-led sections → 5 FAQs → concise CTA.",
  seo: "SEO title/meta → natural H1 → intent-led introduction → semantic H2/H3 coverage → useful FAQ → CTA.",
  aeo: "Exact-question H1 → direct answer (40-70 words) → 3-5 quick facts → concise steps → related questions.",
  local_aeo: "Local-intent H1 → direct local answer → verified local facts → availability, area, process and local FAQ.",
  gbp: "Short Google Business Profile post: local benefit, verified offer/service, proof, location when verified and CTA.",
  commercial: "Product/service/software answer → verified facts → suitability → features/selection → real related offers → FAQ and CTA.",
} as const;

const META_MARKETING = /\b(?:geo|seo|aeo|chatgpt|gemini|perplexity|ai visibility|generative engines?|moteurs? g[ée]n[ée]ratifs?|optimis.{0,12}(?:ia|geo|chatgpt))\b/i;
const MARKETING_QUERY = /\b(?:geo|seo|aeo|marketing|r[ée]f[ée]rencement|chatgpt|gemini|perplexity|visibilit[ée]\s+ia)\b/i;

/**
 * English name of the project's writing language.
 *
 * Built from LANGUAGES — the same list the onboarding selector offers — because
 * a hardcoded 6-entry map silently told Polish, Swedish, Japanese and eight
 * other projects to "write exclusively in English".
 */
export function languageName(locale: string | null | undefined): string {
  const code = (locale ?? "fr").slice(0, 2).toLowerCase();
  return LANGUAGES.find((l) => l.code === code)?.label ?? "English";
}

/** Section heading appended after the article body, in the article's language. */
const FAQ_HEADING: Record<string, string> = {
  en: "Frequently asked questions",
  fr: "Questions fréquentes",
  es: "Preguntas frecuentes",
  de: "Häufige Fragen",
  it: "Domande frequenti",
  nl: "Veelgestelde vragen",
  pt: "Perguntas frequentes",
  pl: "Najczęstsze pytania",
  sv: "Vanliga frågor",
  da: "Ofte stillede spørgsmål",
  no: "Ofte stilte spørsmål",
  fi: "Usein kysytyt kysymykset",
  ro: "Întrebări frecvente",
  tr: "Sıkça sorulan sorular",
  ja: "よくある質問",
  ko: "자주 묻는 질문",
  ar: "الأسئلة الشائعة",
};

export function briefLine(project: ProjectBrief) {
  const language = languageName(project.locale);
  return [
    `Business: ${project.name}`,
    project.website_url ? `Website: ${project.website_url}` : null,
    project.industry ? `Industry: ${project.industry}` : null,
    project.audience ? `Audience: ${project.audience}` : null,
    project.keywords.length ? `Target keywords: ${project.keywords.join(", ")}` : null,
    `Tone: ${project.tone ?? "expert"}`,
    `Language: ${project.locale ?? "fr"}. Write every title, excerpt and article exclusively in ${language}; never fall back to English.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Used when the topic-planning call fails. It still ships as the published
 * article title, so it has to read like one: the previous form emitted the
 * internal debug label `GEO — meubles t v (Sweet Deco)`.
 */
/**
 * Wording for the commercial ("shopping") slot, keyed by what this business
 * actually sells. This is the sole reason "buying criteria for
 * professionals" used to appear under a SaaS keyword: the old fallback had
 * one shopping template for every business, product catalogue or not.
 */
function commercialFallbackTopic(seed: string, entity: ReturnType<typeof resolveCommercialEntity>, fr: boolean): string {
  if (fr) {
    return {
      product: `${seed} : modèles, prix et comment choisir`,
      software: `${seed} : combien ça coûte et que faut-il regarder ?`,
      service: `${seed} : ce que ça comprend et comment choisir un prestataire`,
      marketplace: `${seed} : comment comparer les offres`,
    }[entity];
  }
  return {
    product: `${seed}: models, prices and how to choose`,
    software: `${seed}: how much it costs and what to look for`,
    service: `${seed}: what's included and how to choose a provider`,
    marketplace: `${seed}: how to compare offers`,
  }[entity];
}

export function fallbackTopics(project: ProjectBrief, slots: { date: string; type: ContentType; keyword?: string | null }[]) {
  const seeds = project.keywords.length ? project.keywords : [project.industry ?? project.name];
  const fr = (project.locale ?? "fr").slice(0, 2).toLowerCase() === "fr";
  const entity = resolveCommercialEntity(project.profile, false);
  return slots.map((slot, i) => {
    // A slot's target is authoritative. Falling back to a modulo-indexed seed
    // used to create a valid title for the *next* keyword, while storing the
    // current target beside it in the calendar.
    const seed = slot.keyword ?? seeds[i % seeds.length] ?? project.name;
    const formats: Record<ContentType, string> = fr
      ? {
          geo: `Qu'est-ce que ${seed} et comment ça fonctionne ?`,
          seo: `${seed} : le guide complet`,
          aeo: `Comment fonctionne ${seed} ?`,
          local_aeo: `${seed} près de chez vous : comment bien choisir`,
          shopping: commercialFallbackTopic(seed, entity, true),
        }
      : {
          geo: `What is ${seed} and how does it work?`,
          seo: `${seed}: the complete guide`,
          aeo: `How does ${seed} work?`,
          local_aeo: `${seed} near you: how to choose the right option`,
          shopping: commercialFallbackTopic(seed, entity, false),
        };
    return {
      ...slot,
      topic: formats[slot.type],
    };
  });
}

const CITY_WORDS = /\b(paris|lyon|marseille|bordeaux|lille|toulouse|nice|nantes|strasbourg|montpellier|rennes)\b/i;
const GENERIC_KEYWORD_WORDS = new Set([
  "acheter", "achat", "grossiste", "fournisseur", "professionnel", "professionnels", "pour", "avec", "dans", "des", "les", "une", "en", "gros", "france", "guide", "prix", "b2b",
]);

const normalise = (text: string) =>
  text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function significantTerms(keyword: string) {
  return normalise(keyword)
    .split(" ")
    .filter((word) => word.length > 3 && !GENERIC_KEYWORD_WORDS.has(word));
}

/** A generated title is accepted only if it still represents its exact slot. */
export function validateCalendarTopic(project: ProjectBrief, slot: { type: ContentType; keyword?: string | null }, topic: string) {
  const topicTerms = new Set(normalise(topic).split(" "));
  const terms = significantTerms(slot.keyword ?? "");
  const requiredMatches = terms.length <= 1 ? terms.length : Math.min(2, terms.length);
  const keywordAligned = !terms.length || terms.filter((term) => topicTerms.has(term)).length >= requiredMatches;
  const confirmedLocations = (project.locations ?? []).map(normalise).filter(Boolean);
  const hasConfirmedLocation = confirmedLocations.some((location) => normalise(topic).includes(location));
  const hasUnknownCity = CITY_WORDS.test(topic) && !hasConfirmedLocation;
  const keywordRequestsLocation = confirmedLocations.some((location) => normalise(slot.keyword ?? "").includes(location));
  // A city or region is useful on a Local AEO day. On every other day it
  // creates an accidental local page unless the buyer's query itself asked
  // for that place (for example, "grossiste meubles France").
  const injectedLocationOutsideLocal =
    slot.type !== "local_aeo" && hasConfirmedLocation && !keywordRequestsLocation;
  const localIntent = /\b(pr[èe]s|proximite|zone|local|near|nearby|area)\b/i.test(topic);
  // The commercial slot only owes a catalogue vocabulary (models, dimensions,
  // finishes…) when it is actually rendering a product comparison. A SaaS or
  // service commercial topic is judged on general commercial intent instead —
  // requiring catalogue wording there is what forced "buying criteria for
  // professionals" onto every business regardless of what it sells.
  const commercialEntity = resolveCommercialEntity(project.profile, false);
  const contentTypeAligned =
    slot.type === "local_aeo"
      ? hasConfirmedLocation || localIntent
      : slot.type === "aeo"
        ? /\?|^(comment|quel|quelle|quels|quelles|ou|where|which|how)\b/i.test(topic.trim())
        : slot.type === "shopping"
          ? commercialEntity === "product"
            ? /\b(mod[eè]les?|selection|dimensions?|finitions?|catalogue|models?|selection|dimensions?|finishes|products?)\b/i.test(topic)
            : /\b(co[uû]te?|prix|tarifs?|abonnement|fonctionnalit|inclus|prestataire|offres?|comparer|choisir|logiciel|plateforme|outil|service|cost|price|pricing|plan|feature|include|provider|offer|compare|choose|software|platform|tool|subscription)\b/i.test(topic)
          : true;
  return { keywordAligned, contentTypeAligned, locationValid: !hasUnknownCity && !injectedLocationOutsideLocal };
}

export async function planTopics(
  project: ProjectBrief,
  slots: { date: string; type: ContentType; keyword?: string | null }[],
) {
  const list = slots
    .map(
      (s, i) =>
        `${i + 1}. ${s.date} — ${TYPE_META[s.type].label}: ${TYPE_META[s.type].blurb}` +
        (s.keyword ? ` | target keyword: "${s.keyword}"` : ""),
    )
    .join("\n");
  const year = new Date().getUTCFullYear();
  const commercialEntity = resolveCommercialEntity(project.profile, false);
  const commercialRule: Record<ReturnType<typeof resolveCommercialEntity>, string> = {
    product: `This business sells physical or cataloguable products. Shopping topics must use catalogue categories plus models, dimensions, finishes or selection language; never a generic "best offers" comparison.`,
    software: `This business sells software (a SaaS/app/platform), not a physical catalogue. Shopping-slot topics must be about pricing, plans, features, integrations or how to choose this kind of software — never invent a product catalogue, "models" or "dimensions" it does not have.`,
    service: `This business sells a service, not a physical catalogue. Shopping-slot topics must be about what the service includes, pricing, or how to choose a provider — never invent a product catalogue, "models" or "dimensions" it does not have.`,
    marketplace: `This business is a marketplace of other sellers' offers, not its own catalogue. Shopping-slot topics must be about how offers/listings compare or what to check before choosing one — never invent a specific product line it does not sell itself.`,
  };

  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 2200,
      system:
        `You are a generative-engine-optimisation strategist. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Never reference a past year as if it were current: if a topic needs a year, always use ${year} (or later). You answer with strict JSON only.`,
      user: `${briefLine(project)}

Create one editorial topic per slot below. Each topic must be a concrete, specific title idea (max 90 chars) matching the slot's content type, non-duplicated, in the project's language.
When a slot has a target keyword, the topic must cover that keyword's search intent. Keyword data arrives in Google's normalised form, which is often agrammatical ("meubles t v", "canapés d angle") — write the correct, natural form of the phrase in the title, never the normalised spelling.
Any year mentioned in a title must be ${year}. Never write ${year - 1}, ${year - 2} or older years.
Topics must be about what this business sells and the problems its buyers search for — never about the internal operations of the industries its customers belong to.

CRITICAL AUDIENCE RULE: never turn the target business into the reader. If the company is a furniture wholesaler and the keyword is "grossiste meubles", write for a professional buyer looking for a furniture wholesaler, not for a wholesaler learning marketing.

CONTENT TYPE RULE: GEO, SEO, AEO, Local AEO and Shopping describe HOW Ranki structures content. They are never the subject by themselves. Do not put GEO, SEO, AEO, AI visibility, ChatGPT, generative engines or "how to rank" in a title unless the target keyword is explicitly about marketing/search.

NO RIGID FORMULAS: never reuse the same sentence template across topics (e.g. always "Which X should you choose?", always "X: a guide for professional buyers", always "How do you choose X?"). Build each title from the keyword's real search intent, this business's model and audience, and the slot's format — a direct question for AEO, a natural search-friendly phrase for SEO, a definitional or comparative angle for GEO. Vary sentence structure across the list.

For commercial or transactional keywords, choose supplier-selection questions, product/category offers, comparisons, buying guides or buyer FAQs. ${commercialRule[commercialEntity]} Local topics need a real place/service-area signal and must use ONLY the confirmed locations below. Never invent Paris, Lyon, Marseille, Bordeaux, Lille or any other city.
Confirmed locations: ${(project.locations ?? []).join(", ") || "none — use only a generic near-me/local intent, never a city"}.

Slots:
${list}

Return JSON: {"topics":[{"date":"YYYY-MM-DD","keyword":"copy the slot target exactly","contentType":"copy the slot type exactly","topic":"..."}]}`,
    });
    const parsed = parseJsonLoose<{ topics?: { date: string; keyword?: string; contentType?: string; topic: string }[] }>(raw);
    const byDate = new Map((parsed.topics ?? []).map((t) => [t.date, t]));
    const fallback = fallbackTopics(project, slots);
    return slots.map((slot, i) => {
      const generated = byDate.get(slot.date);
      const candidate = freshenYears(generated?.topic ?? fallback[i]!.topic);
      const isMarketingKeyword = MARKETING_QUERY.test(slot.keyword ?? "");
      const checks = validateCalendarTopic(project, slot, candidate);
      const identityAligned =
        !generated ||
        (normalise(generated.keyword ?? "") === normalise(slot.keyword ?? "") && generated.contentType === slot.type);
      return {
        ...slot,
        topic: (!isMarketingKeyword && META_MARKETING.test(candidate)) || !identityAligned || !checks.keywordAligned || !checks.contentTypeAligned || !checks.locationValid
          ? fallback[i]!.topic
          : candidate,
      };
    });
  } catch {
    return fallbackTopics(project, slots);
  }
}

export type LocalInfo = {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

const FAQ_TYPES = new Set<ContentType>(["aeo", "local_aeo"]);
const GEO_HEADINGS: Record<string, { answer: string; facts: string }> = {
  fr: { answer: "Réponse directe", facts: "Points clés" },
  en: { answer: "Direct answer", facts: "Key facts" },
  es: { answer: "Respuesta directa", facts: "Puntos clave" },
  de: { answer: "Direkte Antwort", facts: "Wichtige Fakten" },
  it: { answer: "Risposta diretta", facts: "Punti chiave" },
  nl: { answer: "Direct antwoord", facts: "Belangrijke punten" },
  pt: { answer: "Resposta direta", facts: "Pontos principais" },
};

function removeCompetitorMentions(text: string, rivals: { domain: string }[]) {
  const aliases = rivals.flatMap((rival) => {
    const host = rival.domain.replace(/^www\./i, "").split(".")[0] ?? "";
    return [rival.domain, host, host.replace(/[-_]+/g, " ")];
  }).filter((name) => name.length > 2);
  if (!aliases.length) return text;
  const pattern = aliases.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`\\b(?:${pattern})\\b`, "gi"), "another supplier");
}

/**
 * The canonical profile the AI built from the merchant's own site. It already
 * gates keyword research, but never reached the writer — which only ever saw
 * the coarse English `industry` label and had to guess what is actually sold.
 */
export type CanonicalProfileFacts = {
  description?: string | null;
  sales_model?: string | null;
  products?: string[] | null;
  services?: string[] | null;
  locations?: string[] | null;
  primary_entity?: "product" | "software" | "service" | "marketplace" | null;
};

/**
 * What the commercial ("shopping") slot should actually render for this
 * business. A verified product catalogue always wins (real catalogue data
 * beats a stale profile guess); otherwise the profile's own classification is
 * used, falling back to "service" — the most generic template — rather than
 * presuming a product catalogue or software that isn't there.
 */
export function resolveCommercialEntity(
  profile: CanonicalProfileFacts | null | undefined,
  hasCatalog: boolean,
): "product" | "software" | "service" | "marketplace" {
  if (hasCatalog) return "product";
  if (profile?.primary_entity) return profile.primary_entity;
  if ((profile?.products?.length ?? 0) > 0) return "product";
  if (profile?.sales_model === "marketplace") return "marketplace";
  if (profile?.sales_model === "service" || (profile?.services?.length ?? 0) > 0) return "service";
  return "service";
}

function profileFactsBlock(profile: CanonicalProfileFacts | null | undefined) {
  if (!profile) return "";
  const facts = [
    profile.description ? `What the business does: ${profile.description}` : null,
    profile.sales_model ? `Sales model: ${profile.sales_model}` : null,
    profile.products?.length ? `Products sold: ${profile.products.slice(0, 15).join(", ")}` : null,
    profile.services?.length ? `Services: ${profile.services.slice(0, 10).join(", ")}` : null,
    profile.locations?.length ? `Serves: ${profile.locations.slice(0, 10).join(", ")}` : null,
  ].filter(Boolean);
  return facts.length
    ? `\n\nVerified facts about this business, taken from its own website — write for this business, not for the generic industry:\n${facts.join("\n")}`
    : "";
}

export async function writeArticle(
  project: ProjectBrief,
  item: { content_type: ContentType; topic: string | null },
  extras?: {
    products?: { title: string; price: string | null; url: string | null; description: string | null }[];
    links?: { title: string; url: string }[];
    localInfo?: LocalInfo | undefined;
    profile?: CanonicalProfileFacts | null;
    competitors?: { domain: string; positioning: string; headings: string[] }[];
  },
) {
  const products = extras?.products ?? [];
  const links = extras?.links ?? [];
  const wantsFaq = item.content_type === "geo" || FAQ_TYPES.has(item.content_type);
  // The commercial slot renders a different template depending on what this
  // business actually sells — a product catalogue only when one is verified,
  // never a comparison table invented for a SaaS or service.
  const commercialEntity = resolveCommercialEntity(extras?.profile, products.length > 0);
  const COMMERCIAL_GUIDANCE: Record<ReturnType<typeof resolveCommercialEntity>, string> = {
    product:
      "Shopping/product template: start with a direct answer, then factual attributes (price, material, dimensions, features, availability only if supplied), suitability, selection criteria, real related products, buyer FAQ and a clear CTA. Build the comparison table only from the real catalogue supplied below; never invent a product.",
    software:
      "Software commercial template: start with a direct answer to the buyer's question, then software facts only (what it automates, core features, integrations, pricing model, who it's for) taken strictly from the verified context — never invent a price, plan name or integration that isn't supplied. Cover selection criteria for this category of software, suitability, a factual brand section, buyer FAQ and a clear CTA. No product comparison table.",
    service:
      "Service commercial template: start with a direct answer, then what the service includes, how it works, who it's for, selection criteria for choosing a provider, verified proof points only when supplied, buyer FAQ and a clear CTA. Never invent pricing, delivery times or availability that isn't supplied. No product comparison table.",
    marketplace:
      "Marketplace/offer template: start with a direct answer, then how offers or listings work on this platform, what to check before choosing one, verified categories or sellers only when supplied, buyer FAQ and a clear CTA. Never invent a specific listing, seller or price.",
  };
  const guidance: Record<ContentType, string> = {
    geo: "GEO is an invisible writing method, never the subject. Return a standalone 50-80 word answer_block first: answer the buyer query directly and connect the business name, audience, verified product categories and verified market/location only when supplied. Then return 4-6 key_facts taken strictly from the verified context. The article must use independently understandable, question-led sections. Do not discuss GEO, AI visibility, ChatGPT or how the business should rank unless the topic explicitly asks about them.",
    seo: "Write a classic long-form SEO article: match search intent, open the first 100 words around the primary keyword, use an H2/H3 structure, and keep a keyword-rich but natural style.",
    aeo: "Answer-engine format: a direct 40-60 word answer first, then supporting sections. Do NOT write an FAQ section in the body — the FAQ is returned separately as structured data.",
    local_aeo:
      "Local answer-engine format: near-me and city intent, local proof points. Do NOT write an FAQ section in the body — the FAQ is returned separately as structured data.",
    shopping: COMMERCIAL_GUIDANCE[commercialEntity],
  };
  guidance.seo = "SEO template: provide a natural search-result title and a 140-160 character excerpt. Start with a 100-150 word intent-led introduction; cover definition, who it is for, how to choose or use it, 3-4 decision criteria, a useful secondary topic, mistakes to avoid, verified conditions only when supplied, and a factual brand section. Use semantic H2/H3 coverage, never keyword stuffing.";
  guidance.aeo = "AEO template: H1 is the exact buyer question. Begin with a 40-70 word direct answer, then 3-5 quick facts, a concise how-it-works section, criteria or steps, a factual brand section when relevant, and related buyer questions. Do NOT write an FAQ section in the body; the FAQ is returned separately as structured data.";
  guidance.local_aeo = "Local AEO template: activate only for real local intent. Begin with a 40-80 word local answer covering what, for whom, where and verified availability. Then use local facts, availability in that area, selection criteria, served area and the real order/contact process. Never invent a city, address, hours or service area. Do NOT write an FAQ section in the body; the FAQ is returned separately as structured data.";

  // What the pages already ranking (and already cited by the AI answer) for
  // these queries actually put on the page. Given as ground to beat, never as
  // material to copy.
  const rivals = extras?.competitors ?? [];
  const rivalsBlock = rivals.length
    ? `\n\nPages currently winning these queries, read from their own landing pages:\n${rivals
        .slice(0, 5)
        .map((r) => `${r.domain} — ${r.positioning.slice(0, 180)}${r.headings.length ? ` | sections: ${r.headings.slice(0, 6).join(", ")}` : ""}`)
        .join("\n")}\n\nCompetitor research is PRIVATE context, research_only — never source material. Cover what they cover, then go further using only the merchant's verified facts. NEVER mention competitor names, brands, domains, URLs, claims or numbers in the published content, and NEVER copy a competitor's features, services, prices, locations, claims or products into this business's own claims. Every brand-specific commercial statement about this business must come from its own verified facts above, never from competitor research.`
    : "";

  const catalogBlock = products.length
    ? `\n\nReal product catalogue of this business (use ONLY these products, with their exact names, prices and links; never invent products):\n${products
        .map((p) => [p.title, p.price ? `price ${p.price}` : null, p.url, p.description].filter(Boolean).join(" — "))
        .join("\n")}\n\nBuild the comparison table and the recommendation from this catalogue, and link each product to its URL in markdown.`
    : "";

  const linksBlock = links.length
    ? `\n\nReal internal pages of this business, for internal linking (use ONLY these exact URLs, never invent or alter one):\n${links
        .map((l) => `${l.title} — ${l.url}`)
        .join("\n")}\n\nPick 2-4 that are genuinely relevant to this topic and weave them into the body as natural markdown links [anchor text](url) — never a dumped list, never a link that isn't in this exact list.`
    : "";

  // Real business facts only — inventing hours/address/phone would put false
  // information on the merchant's own site and actively hurts local trust.
  const localFacts = extras?.localInfo
    ? [
        extras.localInfo.address ? `Address: ${extras.localInfo.address}` : null,
        extras.localInfo.city ? `City: ${extras.localInfo.city}` : null,
        extras.localInfo.country ? `Country: ${extras.localInfo.country}` : null,
        extras.localInfo.phone ? `Phone: ${extras.localInfo.phone}` : null,
      ].filter(Boolean)
    : [];
  const localBlock =
    item.content_type === "local_aeo"
      ? localFacts.length
        ? `\n\nReal business details (use ONLY these, never invent hours, an address or a phone number that isn't listed here):\n${localFacts.join("\n")}`
        : `\n\nNo verified address, phone or opening hours are available for this business. Do NOT invent any — write about city/service-area intent and local proof points without specific hours, address or phone.`
      : "";

  const year = new Date().getUTCFullYear();
  const geoSchema = item.content_type === "geo" ? `,"answer_block":"50-80 words","key_facts":["verified fact"]` : "";
  const faqSchema = wantsFaq ? `,"faq":[{"question":"...","answer":"..."}]` : "";
  const faqRule = wantsFaq
    ? `\nReturn exactly 5 FAQ pairs in "faq": real, specific questions a buyer would ask, with concise 40-80 word standalone answers. Do not repeat the FAQ content inside body_md.`
    : "";
  // GEO/AEO/Local AEO are answer-first formats for AI assistants and answer
  // engines: a "why this matters" standfirst before the answer is exactly the
  // SEO-style throat-clearing they exist to avoid. Only SEO and the
  // commercial slot get the magazine-style editorial opening.
  const ANSWER_FIRST_TYPES = new Set<ContentType>(["geo", "aeo", "local_aeo"]);
  const editorialFormat = ANSWER_FIRST_TYPES.has(item.content_type)
    ? `Editorial format: this is an answer-first format for AI assistants and answer engines. Do NOT open with a standfirst, context, history or a "why this matters" paragraph — go straight from the direct answer into the next concrete, question-led section. Short readable paragraphs, independently understandable subheadings, concrete factual detail. Keep the article buyer-focused and natural in the site's language.`
    : `Editorial format: write this as a polished specialist-magazine article, not a keyword list or a dry report. Start with a short compelling standfirst (2-3 sentences) that answers why the buyer should care. Use a clear editorial angle, short readable paragraphs, useful ##/### subheadings, concrete selection advice and a confident but factual closing. Keep the article buyer-focused and natural in the site's language.`;

  const raw = await callOpenRouter({
    json: true,
    maxTokens: 3200,
    system:
      `You are a senior content writer specialised in generative engine optimisation. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Your knowledge cutoff is older than today, so never present ${year - 1} or earlier as the current year, and never label trends with a past year. You answer with strict JSON only.`,
    user: `${briefLine(project)}

Content type: ${TYPE_META[item.content_type].label}
Topic: ${item.topic ?? "choose the most valuable topic for this business"}

${guidance[item.content_type]}${profileFactsBlock(extras?.profile)}${rivalsBlock}${catalogBlock}${linksBlock}${localBlock}

${editorialFormat}
Rules: 900-1400 words, markdown body (## and ### headings, bullet lists where they genuinely clarify), title max 65 characters (it is a search-result headline), no title duplicated inside the body, no invented client testimonials, no placeholder lorem text.
Audience safety: write for the person searching the target keyword. Never teach this business how to market, rank, use AI, GEO, SEO or advertising unless that is explicitly the search topic.
Fact safety: use only facts supplied above about this business/catalogue. Never claim that the business is cited by AI, a leader, the best, frequently recommended, has a delivery time, stock level, price, number of references, review score or result unless that exact fact is supplied above. Competitor research is private and competitor names must never appear in title, excerpt, article or FAQ.
Dates: the current year is ${year}. Every "trends", "guide" or "best of" reference must say ${year}. Never mention ${year - 1}, ${year - 2} or older years as current, and do not invent precise dated statistics you cannot support.${faqRule}

Return JSON: {"title":"...","excerpt":"max 160 chars","body_md":"markdown article"${geoSchema}${faqSchema}}`,
  });

  const parsed = parseJsonLoose<{
    title?: string;
    excerpt?: string;
    body_md?: string;
    answer_block?: string;
    key_facts?: string[];
    faq?: { question?: string; answer?: string }[];
  }>(raw);
  if (!parsed.body_md) throw new Error("The model returned no article body");
  const faq = wantsFaq
    ? (parsed.faq ?? [])
        .filter((f): f is { question: string; answer: string } => Boolean(f.question && f.answer))
        .map((f) => ({ question: removeCompetitorMentions(freshenYears(f.question), rivals), answer: removeCompetitorMentions(freshenYears(f.answer), rivals) }))
        .slice(0, 6)
    : [];

  const locale = (project.locale ?? "fr").slice(0, 2).toLowerCase();
  const geoHeadings = GEO_HEADINGS[locale] ?? GEO_HEADINGS.en;
  let body_md = freshenYears(parsed.body_md);
  if (item.content_type === "geo") {
    const answer = freshenYears(parsed.answer_block?.trim() ?? "");
    const facts = (parsed.key_facts ?? []).map((fact) => freshenYears(String(fact).trim())).filter(Boolean).slice(0, 6);
    const directAnswer = answer || `This guide explains how professional buyers can evaluate ${item.topic ?? project.name} using verified business information.`;
    const factBlock = facts.length ? `\n\n## ${geoHeadings.facts}\n\n${facts.map((fact) => `- ${fact}`).join("\n")}` : "";
    body_md = `## ${geoHeadings.answer}\n\n${directAnswer}${factBlock}\n\n${body_md}`;
  }
  if (faq.length) {
    const heading = FAQ_HEADING[locale] ?? FAQ_HEADING["en"];
    body_md += `\n\n## ${heading}\n\n${faq
      .map((f) => `### ${f.question}\n\n${f.answer}`)
      .join("\n\n")}`;
  }

  return {
    title: removeCompetitorMentions(freshenYears(parsed.title?.trim() || (item.topic ?? "Untitled")).slice(0, 70), rivals),
    excerpt: removeCompetitorMentions(freshenYears(parsed.excerpt?.trim() ?? ""), rivals),
    body_md: removeCompetitorMentions(body_md, rivals),
    faq: faq.length ? faq : null,
  };
}

/**
 * Models are trained on older data and keep writing "trends 2024".
 * Rewrite any stale year from the last few years to the current one.
 */
export function freshenYears(text: string): string {
  const year = new Date().getUTCFullYear();
  const stale = Array.from({ length: 6 }, (_, i) => year - 1 - i);
  return text.replace(/\b(20\d{2})\b/g, (m, y) => (stale.includes(Number(y)) ? String(year) : m));
}

/** Google Business Profile is a short local post, never a recycled article. */
export async function writeGmbPost(
  project: ProjectBrief,
  topic: string,
  extras?: { profile?: CanonicalProfileFacts | null; localInfo?: LocalInfo },
) {
  const year = new Date().getUTCFullYear();
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 700,
    system: `You write concise Google Business Profile posts. Today is ${year}. Return strict JSON only.`,
    user: `${briefLine(project)}

Template: Google Business Profile post, not an article. Choose a suitable type among update, product, service, offer or event based only on verified context. Write a short benefit-led title and an 80-180 word summary: opening benefit, verified product/service, who it helps, verified local context only when supplied, one concrete verified fact, then a natural CTA (call, book, order, request a quote, learn more or visit). Never mention SEO, GEO, AI, competitors, invented price, stock, availability, address, hours, review or delivery promise.
Topic: ${topic}${profileFactsBlock(extras?.profile)}${extras?.localInfo ? `\nVerified local details: ${[extras.localInfo.address, extras.localInfo.city, extras.localInfo.country, extras.localInfo.phone].filter(Boolean).join(" | ")}` : ""}

Return JSON: {"type":"update|product|service|offer|event","title":"...","summary":"80-180 words","cta":"CALL|BOOK|ORDER|QUOTE|LEARN_MORE|VISIT"}`,
  });
  const parsed = parseJsonLoose<{ type?: string; title?: string; summary?: string; cta?: string }>(raw);
  if (!parsed.summary?.trim()) throw new Error("The model returned no Google Business Profile summary.");
  return {
    type: ["update", "product", "service", "offer", "event"].includes(parsed.type ?? "") ? parsed.type! : "update",
    title: freshenYears(parsed.title?.trim() || topic).slice(0, 58),
    summary: freshenYears(parsed.summary.trim()).slice(0, 1200),
    cta: ["CALL", "BOOK", "ORDER", "QUOTE", "LEARN_MORE", "VISIT"].includes(parsed.cta ?? "") ? parsed.cta! : "LEARN_MORE",
  };
}
