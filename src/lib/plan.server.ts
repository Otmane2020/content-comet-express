import { callOpenRouter, parseJsonLoose } from "./ai.server";
import { TYPE_META, isLocalEligible, type ContentType, type SearchIntent } from "./geo";
import { LANGUAGES } from "./industries";
import { angleFitsIntent, formatFitsKeyword, isTitleUniqueAndNatural, type EditorialAngle } from "./angles.server";

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
 * Used when the topic-planning call fails or produces an invalid/duplicate
 * topic. It still ships as the published article title, so it has to read
 * like one: the previous form emitted the internal debug label
 * `GEO — meubles t v (Sweet Deco)`.
 *
 * Several phrasings per (type, language) so a keyword that recurs across the
 * month — inevitable once the calendar has more days than qualified
 * keywords — gets a different angle each time instead of the exact same
 * template ("X: the complete guide" twice, or "How does how to rank on
 * ChatGPT work?" from blindly reapplying the AEO template to an
 * already-question-shaped keyword). Each angle still satisfies
 * validateCalendarTopic's content-type check (an AEO angle ends in "?", a
 * shopping/software angle contains "pricing"/"plan"/etc.).
 */
/** Does this keyword already read as a question? Reused from classifyIntent's
 * own detection style so a "how to rank on ChatGPT"-shaped keyword never gets
 * wrapped in a second, outer question. */
function isQuestionSeed(seed: string): boolean {
  const trimmed = seed.trim();
  return /^(how|what|why|when|where|which|who|is|does|do|comment|pourquoi|quand|o[uù]|quel|quelle|quels|quelles|qu'est-ce|est-ce)\b/i.test(trimmed) || trimmed.endsWith("?");
}
const questionify = (seed: string) => (seed.trim().endsWith("?") ? seed.trim() : `${seed.trim()}?`);
const capitalise = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * One title template per editorial angle, in the article's language. A
 * keyword that already reads as a question (frequent — Google Ads keyword
 * data is full of "how to X" phrases) is restated as-is instead of being
 * nested inside another question shape, which is what produced "How does
 * how to rank on ChatGPT work?" from the old per-format templates.
 */
const ANGLE_TEMPLATES: Record<EditorialAngle, { en: (seed: string) => string; fr: (seed: string) => string }> = {
  definition: {
    en: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `What is ${seed}?`),
    fr: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `Qu'est-ce que ${seed} ?`),
  },
  how_to: {
    en: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `How does ${seed} work?`),
    fr: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `Comment fonctionne ${seed} ?`),
  },
  guide: {
    en: (seed) => `${capitalise(seed)}: the complete guide`,
    fr: (seed) => `${capitalise(seed)} : le guide complet`,
  },
  comparison: {
    en: (seed) => `${capitalise(seed)}: how to compare your options`,
    fr: (seed) => `${capitalise(seed)} : comment comparer vos options`,
  },
  mistakes: {
    en: (seed) => `${capitalise(seed)}: common mistakes to avoid`,
    fr: (seed) => `${capitalise(seed)} : les erreurs courantes à éviter`,
  },
  checklist: {
    en: (seed) => `${capitalise(seed)}: a practical checklist`,
    fr: (seed) => `${capitalise(seed)} : la checklist pratique`,
  },
  pricing: {
    en: (seed) => `${capitalise(seed)}: how much it costs and what to look for`,
    fr: (seed) => `${capitalise(seed)} : combien ça coûte et que faut-il regarder`,
  },
  alternatives: {
    en: (seed) => `${capitalise(seed)}: the best alternatives to consider`,
    fr: (seed) => `${capitalise(seed)} : les meilleures alternatives à considérer`,
  },
  buyer_guide: {
    en: (seed) => `${capitalise(seed)}: a buyer's guide`,
    fr: (seed) => `${capitalise(seed)} : le guide de l'acheteur`,
  },
  faq: {
    en: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `${capitalise(seed)}: your questions answered`),
    fr: (seed) => (isQuestionSeed(seed) ? capitalise(questionify(seed)) : `${capitalise(seed)} : vos questions, nos réponses`),
  },
  use_cases: {
    en: (seed) => `${capitalise(seed)}: real use cases`,
    fr: (seed) => `${capitalise(seed)} : cas d'usage concrets`,
  },
  examples: {
    en: (seed) => `${capitalise(seed)}: real examples`,
    fr: (seed) => `${capitalise(seed)} : des exemples concrets`,
  },
  strategy: {
    en: (seed) => `${capitalise(seed)}: a practical strategy`,
    fr: (seed) => `${capitalise(seed)} : une stratégie concrète`,
  },
  best_for: {
    en: (seed) => `${capitalise(seed)}: who it's best for`,
    fr: (seed) => `${capitalise(seed)} : à qui ça s'adresse`,
  },
  evaluation: {
    en: (seed) => `${capitalise(seed)}: how to evaluate your options`,
    fr: (seed) => `${capitalise(seed)} : comment évaluer vos options`,
  },
  features: {
    en: (seed) => `${capitalise(seed)}: key features to look for`,
    fr: (seed) => `${capitalise(seed)} : les fonctionnalités à surveiller`,
  },
  workflow: {
    en: (seed) => `${capitalise(seed)}: how it fits into your workflow`,
    fr: (seed) => `${capitalise(seed)} : comment l'intégrer à votre flux de travail`,
  },
  cost_breakdown: {
    en: (seed) => `${capitalise(seed)}: a full cost breakdown`,
    fr: (seed) => `${capitalise(seed)} : le détail des coûts`,
  },
  plans: {
    en: (seed) => `${capitalise(seed)}: comparing the available plans`,
    fr: (seed) => `${capitalise(seed)} : comparer les formules disponibles`,
  },
  value: {
    en: (seed) => `${capitalise(seed)}: what you actually get for the price`,
    fr: (seed) => `${capitalise(seed)} : ce que vous obtenez réellement pour ce prix`,
  },
  purchase_decision: {
    en: (seed) => `${capitalise(seed)}: what to know before you buy`,
    fr: (seed) => `${capitalise(seed)} : ce qu'il faut savoir avant d'acheter`,
  },
  trial: {
    en: (seed) => `${capitalise(seed)}: what to expect from a free trial`,
    fr: (seed) => `${capitalise(seed)} : à quoi s'attendre avec un essai gratuit`,
  },
  local_intent: {
    en: (seed) => `${capitalise(seed)} near you: how to choose`,
    fr: (seed) => `${capitalise(seed)} près de chez vous : comment choisir`,
  },
  service_area: {
    en: (seed) => `Finding ${seed} in your area`,
    fr: (seed) => `Trouver ${seed} dans votre zone`,
  },
  near_me: {
    en: (seed) => `${capitalise(seed)} near me: how to choose`,
    fr: (seed) => `${capitalise(seed)} près de moi : comment choisir`,
  },
  local_faq: {
    en: (seed) => `${capitalise(seed)}: local questions answered`,
    fr: (seed) => `${capitalise(seed)} : vos questions locales`,
  },
};

/**
 * One topic per slot, picking a different editorial angle each time a
 * (type, keyword) pair recurs — inevitable once the calendar has more days
 * than qualified keywords — via angleFitsIntent's allowed set for this
 * slot's (intent, format), instead of a per-format template blind to intent.
 */
export function fallbackTopics(
  project: ProjectBrief,
  slots: { date: string; type: ContentType; keyword?: string | null; intent?: SearchIntent | null }[],
) {
  const seeds = project.keywords.length ? project.keywords : [project.industry ?? project.name];
  const lang: "en" | "fr" = (project.locale ?? "fr").slice(0, 2).toLowerCase() === "fr" ? "fr" : "en";
  const pairOccurrence = new Map<string, number>();
  return slots.map((slot, i) => {
    // A slot's target is authoritative. Falling back to a modulo-indexed seed
    // used to create a valid title for the *next* keyword, while storing the
    // current target beside it in the calendar.
    const seed = slot.keyword ?? seeds[i % seeds.length] ?? project.name;
    const intent: SearchIntent = slot.intent ?? "commercial";
    const allowed = angleFitsIntent(intent, slot.type);
    const key = `${slot.type}:${normalise(seed)}`;
    const occurrence = pairOccurrence.get(key) ?? 0;
    pairOccurrence.set(key, occurrence + 1);
    // allowed is empty only if this (intent, format) pair reached title
    // generation despite assignKeywordsToSlots' hard gate (theoretically
    // unreachable — ANGLE_FIT covers every pair FORMAT_INTENT_FIT allows).
    // Never invent an angle to fill the gap: use the bare seed as the title.
    const angle = allowed.length ? allowed[occurrence % allowed.length]! : null;
    return { ...slot, angle, topic: angle ? ANGLE_TEMPLATES[angle][lang](seed) : capitalise(seed), generationSource: "fallback" as const };
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

/**
 * A generated title is accepted only if it still represents its exact slot.
 *
 * The source of truth for "does this title's shape fit this slot" is the
 * STRUCTURED data — intent, assigned format, assigned editorial angle —
 * never the title's wording. This used to also regex-match the title text
 * itself (AEO required a literal "?" or question word; Shopping required a
 * hardcoded pricing/comparison vocabulary list) and rejected perfectly valid
 * structurally-aligned titles like a commercial/geo/comparison slot's "Geo
 * seo: how to compare your options" just because its words didn't match that
 * list — a false positive, not a real mismatch. formatFit/angleFit are now
 * the only content-type checks; only genuinely text-level quality checks
 * (non-empty, no nested double question) remain on the wording itself.
 */
export function validateCalendarTopic(
  project: ProjectBrief,
  slot: { type: ContentType; keyword?: string | null; intent?: SearchIntent | null; angle?: EditorialAngle | null },
  topic: string,
) {
  const intent: SearchIntent = slot.intent ?? "commercial";
  const formatFit = formatFitsKeyword(intent, slot.type);
  const angleFit = !slot.angle || angleFitsIntent(intent, slot.type).includes(slot.angle);
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
  // for that place (for example, "grossiste meubles France"). This stays a
  // structural check (confirmed locations vs. what the keyword itself asked
  // for), not a title-wording inference.
  //
  // Gated on a REAL local footprint, for the same reason isLocalEligible is:
  // `locations` also carries the markets a nationwide online business serves
  // ("France", "Belgique", "Suisse"), and naming your own market in a title is
  // not an accidental local page. Ungated, this rejected 60% of otherwise valid
  // AI titles for a France/Belgium/Switzerland marketplace
  // (scripts/verify-topic-reconciliation.ts, case 3). A genuinely local
  // business — one with a confirmed address or service area — is still held to
  // the original rule.
  const injectedLocationOutsideLocal =
    slot.type !== "local_aeo" &&
    isLocalEligible(project.profile ?? {}) &&
    hasConfirmedLocation &&
    !keywordRequestsLocation;
  const titleNonEmpty = topic.trim().length > 0;
  // Reject a genuinely malformed nested question ("How does X? work?" has 2
  // question marks) — a text-quality check, not a format-inference one.
  const titleNatural = (topic.match(/\?/g) ?? []).length <= 1;
  return {
    keywordAligned,
    formatFit,
    angleFit,
    titleNonEmpty,
    titleNatural,
    locationValid: !hasUnknownCity && !injectedLocationOutsideLocal,
  };
}

/**
 * Final anti-duplication pass over the whole 30-slot list, run after either
 * the AI response or the fallback template has already picked a topic per
 * slot. With only ~8-14 qualified keywords for 30 days, the same
 * (type, keyword) pair recurring is inevitable — this is what catches it
 * regardless of which path produced the collision (the AI repeating itself
 * across two different slots, or the fallback reapplying the same template)
 * and swaps in the next unused angle instead of shipping a literal duplicate
 * topic like "ai search optimization tool: the complete guide" twice.
 */
function dedupeTopics(
  project: ProjectBrief,
  planned: { date: string; type: ContentType; keyword?: string | null; intent?: SearchIntent | null; angle?: EditorialAngle | null; topic: string; generationSource: "ai" | "fallback"; fallbackReason?: FallbackReason | null }[],
) {
  const lang: "en" | "fr" = (project.locale ?? "fr").slice(0, 2).toLowerCase() === "fr" ? "fr" : "en";
  const usedPairs = new Set<string>();
  const usedTitles = new Set<string>();
  return planned.map((item) => {
    const seed = item.keyword ?? project.name;
    const intent: SearchIntent = item.intent ?? "commercial";
    const allowed = angleFitsIntent(intent, item.type);
    let angle = item.angle ?? (allowed[0] ?? null);
    let topic = item.topic;
    let generationSource = item.generationSource;
    let fallbackReason = item.fallbackReason ?? null;
    if (!angle || !isTitleUniqueAndNatural(seed, angle, topic, usedPairs, usedTitles)) {
      const alt = allowed
        .map((candidate) => ({ candidate, candidateTopic: freshenYears(ANGLE_TEMPLATES[candidate][lang](seed)) }))
        .find(({ candidate, candidateTopic }) => isTitleUniqueAndNatural(seed, candidate, candidateTopic, usedPairs, usedTitles));
      if (alt) {
        angle = alt.candidate;
        topic = alt.candidateTopic;
        // The substitute came from ANGLE_TEMPLATES, not the AI response. Keep
        // the original reason when the slot was already a fallback, so a
        // downstream dedup swap never masks why the AI title was rejected.
        if (generationSource === "ai") fallbackReason = "dedupe_replaced";
        generationSource = "fallback";
      } else if (angle && usedTitles.has(normalise(topic))) {
        // Every angle in the allowed set is exhausted (a keyword recurring far
        // more than the angle library covers) — guarantee uniqueness rather
        // than silently ship a duplicate; the date suffix keeps the title
        // truthful about why it differs from the earlier one on the same topic.
        topic = `${topic} (${item.date})`;
      }
    }
    usedPairs.add(`${normalise(seed)}:${angle ?? "none"}`);
    usedTitles.add(normalise(topic));
    return { ...item, angle, topic, generationSource, fallbackReason };
  });
}

/**
 * Does the model's echoed contentType identify the same format as the slot?
 *
 * A strict `===` against the raw enum used to reject every AI title ever
 * generated, on every business: the prompt only ever showed the model
 * TYPE_META's LABEL ("GEO", "Shopping AEO"), never the enum value it was then
 * compared against, so "GEO" === "geo" was false 30 times out of 30. Proven by
 * scripts/verify-topic-reconciliation.ts, where the label and enum cases differ
 * by nothing but letter case and produce 0/30 vs 30/30.
 *
 * The prompt now states the enum explicitly, and this accepts either the enum
 * or its label, case-insensitively — a model echoing back what it was shown is
 * obeying the instruction, not failing it, and identity should not hinge on
 * capitalisation.
 */
function sameContentType(generatedContentType: string | undefined, slotType: ContentType): boolean {
  const echoed = (generatedContentType ?? "").trim().toLowerCase();
  if (!echoed) return false;
  return echoed === slotType.toLowerCase() || echoed === TYPE_META[slotType].label.toLowerCase();
}

/**
 * Why a slot shipped a deterministic template instead of the AI's own title.
 * Every value maps to exactly one branch of the acceptance chain in
 * reconcileTopics below, so a 100%-fallback calendar names its cause instead of
 * being indistinguishable from a calendar where the AI simply wasn't called.
 */
export type FallbackReason =
  | "provider_error"
  | "parse_failed"
  | "missing_topic"
  | "identity_format_mismatch"
  | "identity_keyword_mismatch"
  | "marketing_leak"
  | "keyword_unaligned"
  | "location_invalid"
  | "format_unfit"
  | "angle_unfit"
  | "title_empty"
  | "title_unnatural"
  | "dedupe_replaced";

export type PlannedTopic = {
  date: string;
  type: ContentType;
  keyword?: string | null;
  intent?: SearchIntent | null;
  angle: EditorialAngle | null;
  topic: string;
  generationSource: "ai" | "fallback";
  fallbackReason: FallbackReason | null;
};

/**
 * Reconciles the model's returned topics against the slots that were asked for,
 * accepting a title only when it still represents its exact slot. Extracted from
 * planTopics as a PURE function so the accept/reject decision can be exercised
 * with a simulated response at zero API cost — the decision path is otherwise
 * only reachable through a billed call, which is why a 100% rejection rate went
 * unnoticed across four different businesses.
 */
export function reconcileTopics(
  project: ProjectBrief,
  slots: { date: string; type: ContentType; keyword?: string | null; intent?: SearchIntent | null }[],
  parsedTopics: { date: string; keyword?: string; contentType?: string; topic: string }[],
): PlannedTopic[] {
  const byDate = new Map(parsedTopics.map((t) => [t.date, t]));
  const fallback = fallbackTopics(project, slots);
  return slots.map((slot, i) => {
    const generated = byDate.get(slot.date);
    const angle = fallback[i]!.angle;
    const templateTopic = fallback[i]!.topic;
    const useTemplate = (reason: FallbackReason): PlannedTopic => ({
      ...slot,
      angle,
      topic: templateTopic,
      generationSource: "fallback",
      fallbackReason: reason,
    });

    // The model skipped this date entirely. The old code let this through as
    // `identityAligned` (it short-circuits on `!generated`) and then validated
    // the TEMPLATE, which passes — so a skipped slot was counted as an AI title
    // while actually shipping a template. It is a fallback, and says so.
    if (!generated) return useTemplate("missing_topic");

    const candidate = freshenYears(generated.topic ?? "");
    // The deterministic angle computed for this slot is the assigned angle
    // regardless of which title wins — the AI isn't asked to echo back which
    // angle it picked, so this is the one source of truth to validate against.
    const checks = validateCalendarTopic(project, { ...slot, angle }, candidate);
    const isMarketingKeyword = MARKETING_QUERY.test(slot.keyword ?? "");

    if (!isMarketingKeyword && META_MARKETING.test(candidate)) return useTemplate("marketing_leak");
    if (normalise(generated.keyword ?? "") !== normalise(slot.keyword ?? "")) return useTemplate("identity_keyword_mismatch");
    if (!sameContentType(generated.contentType, slot.type)) return useTemplate("identity_format_mismatch");
    if (!checks.keywordAligned) return useTemplate("keyword_unaligned");
    if (!checks.locationValid) return useTemplate("location_invalid");
    if (!checks.formatFit) return useTemplate("format_unfit");
    if (!checks.angleFit) return useTemplate("angle_unfit");
    if (!checks.titleNonEmpty) return useTemplate("title_empty");
    if (!checks.titleNatural) return useTemplate("title_unnatural");

    return { ...slot, angle, topic: candidate, generationSource: "ai", fallbackReason: null };
  });
}

/** Aggregate counters for the /test stage summary and server logs. */
export function summariseTopicGeneration(topics: PlannedTopic[]) {
  const byReason: Record<string, number> = {};
  for (const t of topics) {
    if (t.fallbackReason) byReason[t.fallbackReason] = (byReason[t.fallbackReason] ?? 0) + 1;
  }
  const fallbackUsed = topics.filter((t) => t.generationSource === "fallback").length;
  return {
    aiRequested: topics.length,
    aiAccepted: topics.length - fallbackUsed,
    fallbackUsed,
    fallbackRate: topics.length ? fallbackUsed / topics.length : 0,
    byReason,
  };
}

export async function planTopics(
  project: ProjectBrief,
  slots: { date: string; type: ContentType; keyword?: string | null; intent?: SearchIntent | null }[],
) {
  const lang: "en" | "fr" = (project.locale ?? "fr").slice(0, 2).toLowerCase() === "fr" ? "fr" : "en";
  const list = slots
    .map((s, i) => {
      const intent: SearchIntent = s.intent ?? "commercial";
      const allowed = angleFitsIntent(intent, s.type);
      const angle = allowed[0] ?? null;
      return (
        // The raw enum is stated explicitly because the reconciliation step
        // compares against it. Showing only the human label ("GEO") while
        // asking the model to "copy the slot type exactly" is what made every
        // echoed value fail the identity check.
        `${i + 1}. ${s.date} — ${TYPE_META[s.type].label} (contentType: ${s.type}): ${TYPE_META[s.type].blurb}` +
        (s.keyword ? ` | target keyword: "${s.keyword}" | search intent: ${intent}` : "") +
        (angle ? ` | suggested angle: ${angle}` : "")
      );
    })
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

Each slot below states its search intent and a suggested editorial angle (informational: definition, how_to, guide, checklist, mistakes, examples, faq, strategy, use_cases; commercial: comparison, alternatives, buyer_guide, best_for, evaluation, use_cases, features, workflow; transactional: pricing, cost_breakdown, plans, value, purchase_decision, trial; local: local_intent, service_area, near_me, local_faq). Match that angle's framing — a "comparison" angle contrasts options, "checklist" implies a list, "pricing" implies cost — never impose pricing/comparison language on a definition/how_to angle. If the target keyword already reads as a question, restate it naturally; never nest it inside another question ("How does how to rank on ChatGPT work?" is wrong). Never repeat the same angle on the same keyword twice, and never repeat or closely paraphrase an earlier title in this list.

For commercial or transactional keywords, choose supplier-selection questions, product/category offers, comparisons, buying guides or buyer FAQs. ${commercialRule[commercialEntity]} Local topics need a real place/service-area signal and must use ONLY the confirmed locations below. Never invent Paris, Lyon, Marseille, Bordeaux, Lille or any other city.
Confirmed locations: ${(project.locations ?? []).join(", ") || "none — use only a generic near-me/local intent, never a city"}.

Slots:
${list}

Return JSON: {"topics":[{"date":"YYYY-MM-DD","keyword":"copy the slot target keyword exactly","contentType":"copy the slot's contentType value exactly, lowercase (geo|seo|aeo|local_aeo|shopping)","topic":"..."}]}`,
    });
    const parsed = parseJsonLoose<{ topics?: { date: string; keyword?: string; contentType?: string; topic: string }[] }>(raw);
    return dedupeTopics(project, reconcileTopics(project, slots, parsed.topics ?? []));
  } catch (error) {
    // The whole batch never produced a usable response. Tag every slot with the
    // reason so a 100%-fallback calendar can be told apart from one where the
    // call succeeded and each title was individually rejected downstream — the
    // two are byte-identical in the output otherwise.
    const reason: FallbackReason =
      error instanceof Error && /complete JSON value|JSON/i.test(error.message) ? "parse_failed" : "provider_error";
    console.error("[planTopics] AI topic generation failed for the whole batch", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return dedupeTopics(
      project,
      fallbackTopics(project, slots).map((slot) => ({ ...slot, fallbackReason: reason })),
    );
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

/**
 * Turns raw competitor headings into two small anonymised label sets — never
 * sentence-shaped, so there is nothing for the writer to paraphrase into a
 * brand claim. `topicsObserved` is a deduped list of each heading's leading
 * significant terms (reusing the same significantTerms() already used for
 * keyword-alignment checks); `recurringSections` keeps only the terms that
 * recur across at least 2 different competitor domains, i.e. genuinely
 * structural labels (pricing, features, faq…) rather than one competitor's
 * one-off phrasing.
 */
function abstractMarketResearch(rivals: { domain: string; positioning?: string; headings: string[] }[]) {
  const topicCounts = new Map<string, number>();
  const domainsByTerm = new Map<string, Set<string>>();
  for (const rival of rivals) {
    for (const heading of rival.headings) {
      const terms = significantTerms(heading);
      const phrase = terms.slice(0, 3).join(" ");
      if (phrase) topicCounts.set(phrase, (topicCounts.get(phrase) ?? 0) + 1);
      for (const term of terms) {
        if (!domainsByTerm.has(term)) domainsByTerm.set(term, new Set());
        domainsByTerm.get(term)!.add(rival.domain);
      }
    }
  }
  const topicsObserved = [...topicCounts.keys()].slice(0, 12);
  const recurringSections = [...domainsByTerm.entries()]
    .filter(([, domains]) => domains.size >= 2)
    .map(([term]) => term)
    .slice(0, 8);
  return { topicsObserved, recurringSections };
}

/**
 * Second, independent line of defense against brand/competitor contamination:
 * scans the generated text for any 4+-word run also present in the RAW
 * competitor headings/positioning (never sent to the model — see
 * abstractMarketResearch above) and redacts it. Catches a model that drifts
 * back toward a competitor phrase it was never shown verbatim in this call
 * but may have picked up elsewhere, without costing an extra AI call.
 */
function stripLeakedCompetitorPhrases(text: string, rivals: { headings: string[]; positioning?: string }[]): string {
  const grams = new Set<string>();
  for (const rival of rivals) {
    for (const source of [...rival.headings, rival.positioning ?? ""]) {
      const words = normalise(source).split(" ").filter(Boolean);
      for (let i = 0; i + 4 <= words.length; i++) grams.add(words.slice(i, i + 4).join(" "));
    }
  }
  if (!grams.size) return text;
  let result = text;
  for (const gram of grams) {
    const pattern = new RegExp(gram.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "gi");
    result = result.replace(pattern, "");
  }
  return result;
}

/**
 * profile.name is immutable — competitor scrubbing must never be able to
 * mutate the client's own brand identity. A rival alias (its domain, host,
 * or hyphen-split host) that happens to overlap with the client's own name
 * used to still enter the replacement regex — a rival sharing a short
 * substring with the brand ("Vends-Le" vs. a rival host containing "vends")
 * corrupted the client's own name into "another supplier-Le.fr" in one live
 * report. Any alias that overlaps the brand name either direction is now
 * dropped before the regex is built, regardless of why the overlap exists
 * upstream (a genuinely similar competitor name, or the client's own domain
 * leaking into the rivals list).
 */
function removeCompetitorMentions(text: string, rivals: { domain: string }[], brandName?: string | null) {
  const brandNorm = (brandName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const aliases = rivals
    .flatMap((rival) => {
      const host = rival.domain.replace(/^www\./i, "").split(".")[0] ?? "";
      return [rival.domain, host, host.replace(/[-_]+/g, " ")];
    })
    .filter((name) => name.length > 2)
    .filter((name) => {
      if (!brandNorm) return true;
      const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return !norm || !(brandNorm.includes(norm) || norm.includes(brandNorm));
    });
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
  /** buildCanonicalProfile has always returned these two (relevance.server.ts)
   * — they were simply missing from this type, so the planner could not tell a
   * genuine local footprint from a `locations` list that merely names the
   * markets a nationwide online business serves. */
  has_physical_location?: boolean | null;
  has_service_area?: boolean | null;
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

/**
 * Removes an FAQ-shaped section the model wrote inside body_md, so the
 * structured `faq` can be appended exactly once. Structural, not wording-based
 * beyond the heading: a `##` section qualifies when its heading matches the
 * article language's own FAQ heading, OR when it contains 3+ `###`
 * sub-headings of which most are questions — which IS an FAQ regardless of what
 * the model titled it, in any language.
 */
export function stripModelFaqSection(body: string, faqHeading: string): string {
  const lines = body.split("\n");
  const headings: number[] = [];
  lines.forEach((line, i) => {
    if (/^##(?!#)\s+\S/.test(line)) headings.push(i);
  });
  if (!headings.length) return body;

  const target = normalise(faqHeading);
  const drop = new Set<number>();
  for (let h = 0; h < headings.length; h += 1) {
    const start = headings[h]!;
    const end = h + 1 < headings.length ? headings[h + 1]! : lines.length;
    const headingText = normalise(lines[start]!.replace(/^##\s+/, ""));
    const subs = lines.slice(start + 1, end).filter((l) => /^###\s+\S/.test(l));
    const questionSubs = subs.filter((l) => l.trim().endsWith("?"));
    const isFaqSection =
      (target.length > 0 && headingText.includes(target)) ||
      (subs.length >= 3 && questionSubs.length >= Math.ceil(subs.length * 0.6));
    if (isFaqSection) for (let i = start; i < end; i += 1) drop.add(i);
  }
  if (!drop.size) return body;
  return lines
    .filter((_, i) => !drop.has(i))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function writeArticle(
  project: ProjectBrief,
  item: { content_type: ContentType; topic: string | null; angle?: EditorialAngle | null },
  extras?: {
    products?: { title: string; price: string | null; url: string | null; description: string | null }[];
    links?: { title: string; url: string }[];
    localInfo?: LocalInfo | undefined;
    profile?: CanonicalProfileFacts | null;
    competitors?: { domain: string; positioning: string; headings: string[] }[];
    qualityMode?: "throw" | "report";
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

  // Raw competitor headings/positioning never reach the prompt as sentences —
  // only an abstracted set of topic/section labels does (abstractMarketResearch,
  // below). The raw text is kept in `rivals` purely for the post-generation
  // anti-copy scan (stripLeakedCompetitorPhrases). This is what stops a
  // competitor's marketing sentence ("you don't need to become a prompt
  // engineer") from being handed to the model as material to paraphrase in
  // the first place, rather than relying on an instruction not to.
  const rivals = extras?.competitors ?? [];
  const comparisonRequested =
    item.angle === "comparison" ||
    /\b(?:compar(?:e|ed|ison)|versus|vs\.?|which (?:one|tool|platform|software)|best (?:tool|platform|software))\b/i.test(item.topic ?? "");
  const { topicsObserved, recurringSections } = abstractMarketResearch(rivals);
  const comparisonRivalsBlock = comparisonRequested && rivals.length
    ? `\n\nVerified comparison candidates. You MAY name these businesses only in this comparison article. Use only the supplied landing-page evidence; do not invent features, prices, integrations or results:\n${rivals
        .map((rival) => `- ${rival.domain} — ${rival.positioning || "positioning not confirmed"}${rival.headings.length ? ` — page sections: ${rival.headings.slice(0, 6).join(", ")}` : ""} — official source: https://${rival.domain}`)
        .join("\n")}\n\nComparison contract: name at least two candidates, define at least three explicit decision criteria, include a Markdown comparison table, and finish with a ## Sources section containing Markdown links to at least two official candidate websites. If evidence does not support a cell, write "Not verified" instead of guessing.`
    : "";
  const rivalsBlock = !comparisonRequested && (topicsObserved.length || recurringSections.length)
    ? `\n\nAbstracted competitive research — anonymised topic/structure signals only, NOT source material, NOT phrases to reuse or rephrase:\nTopics observed across competing pages: ${topicsObserved.join(", ") || "none"}\nRecurring page sections across competitors: ${recurringSections.join(", ") || "none"}\n\nUse this only to decide what ground to cover, then go further using only the merchant's verified facts below. NEVER mention competitor names, brands, domains or URLs in the published content, and NEVER build a sentence out of the labels above — they are anonymised keyword fragments, not wording to echo. Every brand-specific claim describing what this business does, offers or automates must be traceable word-for-word to "Verified facts about this business" above; if a capability, integration or process is not listed there, do not attribute it to this business even if a competitor covers something similar.`
    : comparisonRivalsBlock;

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

  const callWriter = () =>
    callOpenRouter({
      json: true,
      // 900-1400 words of body_md, plus a title/excerpt, plus for GEO an
      // answer_block+key_facts, plus for AEO/local_aeo/geo up to 5 FAQ pairs —
      // this is the largest schema of any AI call in the pipeline, and the
      // one call with no fallback if it fails: an article can't be templated
      // the way a topic or a keyword score can. 3200 tokens routinely cut the
      // response short of its closing brace on a full-length article with a
      // full FAQ block (see buildCanonicalProfile for the same bug).
      maxTokens: 4200,
      system:
        `You are a senior content writer specialised in generative engine optimisation. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Your knowledge cutoff is older than today, so never present ${year - 1} or earlier as the current year, and never label trends with a past year. You answer with strict JSON only.`,
      user: `${briefLine(project)}

Content type: ${TYPE_META[item.content_type].label}
Topic: ${item.topic ?? "choose the most valuable topic for this business"}

${guidance[item.content_type]}${profileFactsBlock(extras?.profile)}${rivalsBlock}${catalogBlock}${linksBlock}${localBlock}

${editorialFormat}
Rules: 900-1400 words, markdown body (## and ### headings, bullet lists where they genuinely clarify), title max 65 characters (it is a search-result headline), no title duplicated inside the body, no invented client testimonials, no placeholder lorem text.
Audience safety: write for the person searching the target keyword. Never teach this business how to market, rank, use AI, GEO, SEO or advertising unless that is explicitly the search topic.
Fact safety: use only facts supplied above about this business/catalogue. Never claim that the business is cited by AI, a leader, the best, frequently recommended, has a delivery time, stock level, price, number of references, review score or result unless that exact fact is supplied above. Never invent a capability not listed in the verified facts — common failure modes to avoid specifically: claiming the product auto-updates or re-optimises already-published content, claiming "industry-standard" or unspecified security/compliance measures, claiming a support channel or response time, or claiming an industry-specific adaptation (healthcare, real estate, etc.) — unless each is explicitly present in the verified facts above. A broad service label from the verified facts (e.g. "social content automation", "AI video generation") describes WHAT the business does, not HOW — never expand it into invented specific mechanisms (a scheduling system, direct social-platform publishing, style/template selection, a particular workflow or step count) unless those specifics are themselves separately listed in the verified facts. When explaining a capability the verified facts only name broadly, describe it at the same level of generality the facts gave you, or explain the general concept without attributing the specific mechanism to this business. ${comparisonRequested ? "This is a comparison article: competitor names are required, but every competitor-specific statement must be supported by supplied official landing evidence and linked in Sources." : "Competitor research is private and competitor names must never appear in title, excerpt, article or FAQ."}
Dates: the current year is ${year}. Every "trends", "guide" or "best of" reference must say ${year}. Never mention ${year - 1}, ${year - 2} or older years as current, and do not invent precise dated statistics you cannot support.${faqRule}

Return JSON: {"title":"...","excerpt":"max 160 chars","body_md":"markdown article"${geoSchema}${faqSchema}}`,
    });

  type ArticleJson = {
    title?: string;
    excerpt?: string;
    body_md?: string;
    answer_block?: string;
    key_facts?: string[];
    faq?: { question?: string; answer?: string }[];
  };
  let parsed: ArticleJson;
  try {
    parsed = parseJsonLoose<ArticleJson>(await callWriter());
  } catch (error) {
    // Truncated-but-successful is the common case here (see
    // buildCanonicalProfile); retry once before giving up on the whole
    // article, since there is nothing to gracefully degrade to.
    console.error("[writeArticle] response was truncated, retrying once", error instanceof Error ? error.message : error);
    parsed = parseJsonLoose<ArticleJson>(await callWriter());
  }
  if (!parsed.body_md) throw new Error("The model returned no article body");
  const faq = wantsFaq
    ? (parsed.faq ?? [])
        .filter((f): f is { question: string; answer: string } => Boolean(f.question && f.answer))
        .map((f) => ({
          question: stripLeakedCompetitorPhrases(removeCompetitorMentions(freshenYears(f.question), rivals, project.name), rivals),
          answer: stripLeakedCompetitorPhrases(removeCompetitorMentions(freshenYears(f.answer), rivals, project.name), rivals),
        }))
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
    // The prompt already says not to repeat the FAQ inside body_md, and models
    // routinely ignore it — a live article shipped the same five Q&As twice,
    // once as the model's own "Questions fréquentes sur…" section and once
    // appended from the structured `faq`. Instruction is not enforcement:
    // strip any FAQ-shaped section the model wrote before appending the
    // canonical one, so the article carries it exactly once.
    body_md = stripModelFaqSection(body_md, heading!);
    body_md += `\n\n## ${heading}\n\n${faq
      .map((f) => `### ${f.question}\n\n${f.answer}`)
      .join("\n\n")}`;
  }

  const protect = (value: string) => comparisonRequested
    ? value
    : stripLeakedCompetitorPhrases(removeCompetitorMentions(value, rivals, project.name), rivals);
  const article = {
    // Never character-slice a headline: that produced "...and Perplex".
    title: protect(freshenYears(parsed.title?.trim() || (item.topic ?? "Untitled"))),
    excerpt: protect(freshenYears(parsed.excerpt?.trim() ?? "")),
    body_md: protect(body_md),
    faq: faq.length ? faq : null,
  };
  const quality = validateArticleQuality(item, article, rivals);
  if (!quality.ok && extras?.qualityMode !== "report") {
    throw new Error(`ARTICLE_QUALITY_FAILED: ${quality.failures.join("; ")}`);
  }
  return { ...article, quality };
}

export type ArticleQuality = { ok: boolean; comparisonRequested: boolean; failures: string[] };

/** Refuses content that does not fulfil the editorial promise in its title. */
export function validateArticleQuality(
  item: { topic: string | null; angle?: EditorialAngle | null },
  article: { title: string; body_md: string },
  rivals: { domain: string }[],
): ArticleQuality {
  const failures: string[] = [];
  const comparisonRequested =
    item.angle === "comparison" ||
    /\b(?:compar(?:e|ed|ison)|versus|vs\.?|which (?:one|tool|platform|software)|best (?:tool|platform|software))\b/i.test(item.topic ?? article.title);
  const title = article.title.trim();
  if (title.length > 140) failures.push("article title exceeds 140 characters");
  if (/\b(?:and|or|with|for|to|of|the|a|an|perplex)$/i.test(title) || /[,:;\\/-]$/.test(title)) {
    failures.push("article title appears truncated or incomplete");
  }
  if (comparisonRequested) {
    const text = article.body_md.toLowerCase();
    const named = rivals.filter((rival) => {
      const domain = rival.domain.toLowerCase();
      const brand = domain.replace(/^www\./, "").split(".")[0] ?? domain;
      return text.includes(domain) || (brand.length >= 4 && text.includes(brand));
    });
    if (named.length < 2) failures.push("comparison names fewer than two supplied competitors");
    if (!/^\|.+\|\s*\n\|?\s*:?-{3,}/m.test(article.body_md)) failures.push("comparison has no Markdown comparison table");
    const criteria = ["feature", "capabilit", "pricing", "cost", "integration", "workflow", "automation", "publishing", "setup", "ease of use", "use case"];
    if (criteria.filter((term) => text.includes(term)).length < 3) failures.push("comparison has fewer than three explicit decision criteria");
    const officialLinks = rivals.filter((rival) => text.includes(`https://${rival.domain.toLowerCase()}`));
    if (!/^##\s+Sources\b/im.test(article.body_md) || officialLinks.length < 2) {
      failures.push("comparison lacks a Sources section with two official competitor links");
    }
  }
  return { ok: failures.length === 0, comparisonRequested, failures };
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
  const callWriter = () =>
    callOpenRouter({
      json: true,
      maxTokens: 700,
      system: `You write concise Google Business Profile posts. Today is ${year}. Return strict JSON only.`,
      user: `${briefLine(project)}

Template: Google Business Profile post, not an article. Choose a suitable type among update, product, service, offer or event based only on verified context. Write a short benefit-led title and an 80-180 word summary: opening benefit, verified product/service, who it helps, verified local context only when supplied, one concrete verified fact, then a natural CTA (call, book, order, request a quote, learn more or visit). Never mention SEO, GEO, AI, competitors, invented price, stock, availability, address, hours, review or delivery promise.
Topic: ${topic}${profileFactsBlock(extras?.profile)}${extras?.localInfo ? `\nVerified local details: ${[extras.localInfo.address, extras.localInfo.city, extras.localInfo.country, extras.localInfo.phone].filter(Boolean).join(" | ")}` : ""}

Return JSON: {"type":"update|product|service|offer|event","title":"...","summary":"80-180 words","cta":"CALL|BOOK|ORDER|QUOTE|LEARN_MORE|VISIT"}`,
    });
  type GmbJson = { type?: string; title?: string; summary?: string; cta?: string };
  let parsed: GmbJson;
  try {
    parsed = parseJsonLoose<GmbJson>(await callWriter());
  } catch (error) {
    console.error("[writeGmbPost] response was truncated, retrying once", error instanceof Error ? error.message : error);
    parsed = parseJsonLoose<GmbJson>(await callWriter());
  }
  if (!parsed.summary?.trim()) throw new Error("The model returned no Google Business Profile summary.");
  return {
    type: ["update", "product", "service", "offer", "event"].includes(parsed.type ?? "") ? parsed.type! : "update",
    title: freshenYears(parsed.title?.trim() || topic).slice(0, 58),
    summary: freshenYears(parsed.summary.trim()).slice(0, 1200),
    cta: ["CALL", "BOOK", "ORDER", "QUOTE", "LEARN_MORE", "VISIT"].includes(parsed.cta ?? "") ? parsed.cta! : "LEARN_MORE",
  };
}
