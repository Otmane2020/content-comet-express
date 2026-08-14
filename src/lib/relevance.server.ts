import { callOpenRouter, parseJsonLoose } from "./ai.server";
import { cleanKeywordForDataForSeo } from "./dataforseo.server";

/**
 * Canonical business profile — the single source of truth for what a company
 * actually sells, to whom, and where.  Built from verified site content, never
 * from generic category labels.  Every SEO research step must consult it.
 */
export type BusinessProfile = {
  name?: string | null;
  website_url?: string | null;
  industry?: string | null;
  audience?: string | null;
  /** Free-form description: "Grossiste et vendeur de meubles en ligne: canapés, tables, chaises…" */
  description?: string | null;
  /** "wholesale" | "retail" | "service" | "marketplace" | "manufacturer" | "other" */
  sales_model?: string | null;
  /** Product categories confirmed on the site, e.g. ["canapés","tables","chaises"]. */
  products?: string[] | null;
  /** Services confirmed on the site (empty for pure sellers). */
  services?: string[] | null;
  /** Geographic areas confirmed on the site. */
  locations?: string[] | null;
  /**
   * What the commercial format should render for this business: physical or
   * shippable goods, a SaaS/app/platform, a professional or manual service,
   * or a marketplace of other sellers' listings. Drives which commercial
   * content template is used — never a product comparison for a business
   * with nothing to catalogue.
   */
  primary_entity?: "product" | "software" | "service" | "marketplace" | null;
  /** True only when the site shows a real street address or storefront. */
  has_physical_location?: boolean | null;
  /**
   * True only when the site states it serves a bounded local area (a city, a
   * region, or "we cover X and Y") — false for a national or worldwide/
   * online-only business even if it names a country it ships to.
   */
  has_service_area?: boolean | null;
  /**
   * The merchant's own positioning, verbatim: the SEO <title> and meta
   * description of the landing page. These are the words the business chose to
   * describe itself, already in its language and already aimed at its real
   * buyer — sweet-deco.fr's title is literally "Grossiste de Meubles
   * Professionnels". Keyword seeds should be built from this, not from a
   * paraphrase of it.
   */
  positioning?: string | null;
};

export type CanonicalBusinessProfile = BusinessProfile & {
  /** One-sentence canonical summary used in every AI prompt. */
  canonical: string;
  /** True when the profile is precise enough to drive keyword research. */
  reliable: boolean;
};

export type ScorableKeyword = {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  difficulty: number | null;
  intent: string | null;
};

const INTENT_WEIGHT: Record<string, number> = {
  transactional: 100,
  commercial: 85,
  informational: 55,
  navigational: 25,
};

function profileBlock(profile: BusinessProfile) {
  const lines = [
    `Business: ${profile.name ?? "unknown"}`,
    `Website: ${profile.website_url ?? "unknown"}`,
    `What it sells / category: ${profile.industry ?? "unknown"}`,
    `Audience: ${profile.audience ?? "unknown"}`,
  ];
  // First, and verbatim: these are the merchant's own words about who they are.
  if (profile.positioning) lines.push(`Own positioning (SEO title + meta description): ${profile.positioning}`);
  if (profile.description) lines.push(`Description: ${profile.description}`);
  if (profile.sales_model) lines.push(`Sales model: ${profile.sales_model}`);
  if (profile.products?.length) lines.push(`Products: ${profile.products.join(", ")}`);
  if (profile.services?.length) lines.push(`Services: ${profile.services.join(", ")}`);
  if (profile.locations?.length) lines.push(`Locations: ${profile.locations.join(", ")}`);
  return lines.join("\n");
}

/** Hard language gate before any paid keyword measurement. */
export function keywordMatchesLocale(keyword: string, locale: string | null | undefined): boolean {
  const code = (locale ?? "").slice(0, 2).toLowerCase();
  const text = ` ${keyword.toLowerCase()} `;
  if (code === "en") {
    return !/[àâçéèêëîïôùûüÿœ]/i.test(text) &&
      !/\b(?:ia|outil|logiciel|référencement|visibilité|rédaction|automatisation|comparatif|meilleur|prix|avis|pour|avec|comment)\b/i.test(text);
  }
  if (code === "fr") {
    return !/\b(?:tool|software|pricing|reviews?|best|how|what|automation|visibility|writing|for|with)\b/i.test(text);
  }
  return true;
}

/** Locale consistency gate for profile/article prose, not just short keywords. */
export function textMatchesLocale(value: string, locale: string | null | undefined): boolean {
  const code = (locale ?? "").slice(0, 2).toLowerCase();
  const text = value.toLowerCase();
  if (!text.trim()) return true;
  if (code === "en") {
    const frenchSignals = text.match(/\b(?:logiciel|outil|plateforme|visibilité|rédaction|automatisation|entreprises|agences|équipes|pour|avec|améliorer|génération)\b/g) ?? [];
    return frenchSignals.length < 2;
  }
  if (code === "fr") {
    const englishSignals = text.match(/\b(?:software|tool|platform|visibility|writing|automation|businesses|agencies|teams|for|with|improve|generation)\b/g) ?? [];
    return englishSignals.length < 2;
  }
  return true;
}

function keepCandidateLanguage(keywords: string[], locale: string | null | undefined) {
  return keywords.filter((keyword) => keywordMatchesLocale(keyword, locale));
}

const SCORING_RULES = `Scoring rules — be harsh, most keywords deserve a low score:
100 = someone searching this is looking for exactly this product/service, or for the problem it solves.
70-90 = strongly related category, comparison or buying-intent term for this product.
40-60 = adjacent topic the business could write about but that does not attract its buyers.
0-30 = different market, generic curiosity, free-tool seekers, students, unrelated meaning of a shared word.
A huge search volume is NOT a reason to score higher. Popular but off-topic terms must score under 20.
Watch for words that mean something else in another market (e.g. "citation" can mean a bibliography citation)
and score those 0 when the other meaning is what searchers want.

STRICT INTENT RULES — score 0 regardless of volume when any of these apply:
- The keyword describes a DIFFERENT PROFESSION than the business (e.g. "menuisier" for a furniture seller,
  "tapissier" for a wholesaler, "décapage" for a retailer). Services and crafts are not product purchases.
- The keyword implies an INCOMPATIBLE SALES MODEL (e.g. "repair", "rental", "sur mesure", "devis" for a
  wholesaler; "grossiste" for a local service provider).
- The keyword targets the WRONG BUYER: the product/service category matches, but the person behind that
  search is not who this business sells to, per its stated sales_model and audience. This applies to any
  business type, not just retail vs wholesale — examples:
  · wholesaler/manufacturer selling only to professionals/resellers → score down a single-unit,
    personal/home-use consumer search ("tables de chevet" for a furniture wholesaler).
  · consumer retailer → score down a bulk/professional B2B search ("grossiste tables" for a home-decor shop).
  · B2B service or logistics company serving businesses → score down a personal/individual-use search
    ("suivre mon colis" for a freight-logistics company, "assurance auto particulier" for a fleet insurer).
  · factory/manufacturer that only supplies distributors/brands → score down a direct-to-consumer purchase
    search for the finished product ("acheter [produit] en ligne" for a contract manufacturer).
  The underlying test is always the same: would THIS business's actual customer type be the one typing this
  search? If not, score low regardless of category match.
- The keyword is a LOCAL SERVICE query with a city/region NOT in the business's confirmed locations
  (e.g. "menuisier lyon" for a national online seller).
- The keyword mentions a COMPETING BRAND by name (e.g. "schmidt meuble sur mesure") unless the business
  IS that brand.
- The keyword is about REPAIR, RESTORATION, RENTAL, TRAINING, or HIRING/RECRUITMENT when the business sells
  products.`;

async function scoreBatch(profile: BusinessProfile, list: string[]): Promise<Record<string, number>> {
  const call = () =>
    callOpenRouter({
      temperature: 0,
      json: true,
      maxTokens: 2000,
      system:
        "You score how relevant a search keyword is to a specific business's buyers. You never invent search volume, CPC or difficulty. Answer with strict JSON only.",
      user: `${profileBlock(profile)}

${SCORING_RULES}

Keywords:
${list.map((k) => `- ${k}`).join("\n")}

Return JSON: {"scores":[{"keyword":"...","score":0-100}]}`,
    });
  // scoreRelevance deliberately re-throws a batch failure rather than masking
  // it as "0 relevant keywords" (see below) — but a truncated-JSON response is
  // not a real failure, it is this same call succeeding with an answer cut
  // short of its closing brace (see buildCanonicalProfile for the identical
  // bug). One retry absorbs that case; a second genuine failure still throws,
  // which is the behaviour scoreRelevance's callers rely on.
  let parsed: { scores?: { keyword: string; score: number }[] };
  try {
    parsed = parseJsonLoose<{ scores?: { keyword: string; score: number }[] }>(await call());
  } catch (error) {
    console.error("[relevance] scoring batch response was truncated, retrying once", error instanceof Error ? error.message : error);
    parsed = parseJsonLoose<{ scores?: { keyword: string; score: number }[] }>(await call());
  }
  const out: Record<string, number> = {};
  for (const s of parsed.scores ?? []) {
    if (!s?.keyword) continue;
    const n = Number(s.score);
    if (Number.isFinite(n)) out[s.keyword.trim().toLowerCase()] = Math.max(0, Math.min(100, n));
  }
  return out;
}

/**
 * Asks the model ONLY for topical relevance (0-100) of each keyword to the
 * business. All SEO metrics stay DataForSEO's — the model never invents them.
 * Scored in small batches so long lists are never truncated mid-answer (an
 * unscored keyword used to slip through with a passing default score).
 *
 * FAIL-CLOSED: if the model returns no scores at all, every keyword is treated
 * as irrelevant (score 0). No keyword is ever saved without a positive score.
 */
export async function scoreRelevance(
  profile: BusinessProfile,
  keywords: string[],
): Promise<Record<string, number>> {
  const list = Array.from(new Set(keywords.map((k) => k.trim()).filter(Boolean))).slice(0, 240);
  if (!list.length) return {};
  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += 25) batches.push(list.slice(i, i + 25));
  // Do NOT swallow batch failures into an empty score map: that used to turn
  // a transient API error into a silent "0 relevant keywords" result
  // indistinguishable from a real fail-closed verdict. Let it throw so the
  // caller shows an actual error instead of a misleading empty list.
  const results = await Promise.all(
    batches.map((b) =>
      scoreBatch(profile, b).catch((e) => {
        console.error("[relevance] keyword scoring batch failed", e);
        throw e;
      }),
    ),
  );
  const merged = Object.assign({}, ...results) as Record<string, number>;
  // Fail-closed: unscored keywords get 0, never a passing default.
  for (const kw of list) {
    const key = kw.toLowerCase();
    if (merged[key] === undefined) merged[key] = 0;
  }
  return merged;
}

/**
 * Builds a canonical business profile from a scraped site snapshot.
 * Only includes products, services, and locations that are actually visible
 * on the site — never infers adjacent activities (e.g. a furniture seller
 * is NOT a carpenter, upholsterer, or repair service).
 */
export async function buildCanonicalProfile(
  site: {
    title: string | null;
    description: string | null;
    headings: string[];
    text: string;
    lang?: string | null;
    landing?: import("./scrape.server").LandingProfile;
  },
  hints?: { name?: string | null; industry?: string | null; website_url?: string | null; audience?: string | null },
): Promise<CanonicalBusinessProfile> {
  const landing = site.landing;
  const websiteLanguage = (landing?.lang ?? site.lang ?? "").slice(0, 2).toLowerCase();
  const industryExamples = websiteLanguage === "fr"
    ? "Logiciel SEO et GEO, Grossiste de meubles, Plateforme d’avis clients"
    : "SEO and GEO software, Furniture wholesaler, Customer review platform";
  const canonicalExample = websiteLanguage === "fr"
    ? "Grossiste et vendeur de meubles en ligne pour les professionnels en France."
    : "AI search visibility software for businesses and marketing teams.";
  const buildPrompt = () => `${landing?.positioning ? `How the business describes itself, verbatim (SEO title, site name, meta description) — trust this over your reading of the page body:\n${landing.positioning}\n` : ""}${
      landing?.sellsToBusinesses
        ? `Wholesale/B2B wording on this page: ${(landing.b2bMarkers ?? []).join(", ") || "in the body copy"} — ${landing.b2bMentions ?? 0} mentions across the landing page. This business sells to other businesses: "sales_model" MUST be "wholesale" or "manufacturer", and "audience" must describe the professional buyer, not a consumer.\n`
        : ""
    }${landing?.schemaTypes?.length ? `schema.org types declared by the site: ${landing.schemaTypes.slice(0, 6).join(", ")}\n` : ""}${landing?.categoryLinks?.length ? `Category/product links on the page: ${landing.categoryLinks.slice(0, 15).join(", ")}\n` : ""}
Website title: ${site.title ?? ""}
Description: ${site.description ?? ""}
Headings: ${site.headings?.slice(0, 15).join(" | ") ?? ""}
Page text (truncated): ${site.text?.slice(0, 6000) ?? ""}
Hints — name: ${hints?.name ?? ""}, industry: ${hints?.industry ?? ""}, website: ${hints?.website_url ?? ""}
${hints?.audience ? `Known audience (already confirmed for this business, trust it over your own reading of the page): ${hints.audience}\nIf that audience is resellers, retailers, professionals or other businesses, "sales_model" MUST be "wholesale" or "manufacturer" — never "retail".` : ""}

Write every human-readable JSON value (especially "industry", "description", "audience" and "canonical") in the website's own language: ${landing?.lang ?? site.lang ?? "the language used by the website"}. Do not translate it into a different language.

Return JSON:
{
  "name": "company name",
  "industry": "concise business category in the website language",
  "description": "one sentence: sales model + products + audience + geography",
  "sales_model": "wholesale" | "retail" | "service" | "marketplace" | "manufacturer" | "other",
  "products": ["product category 1", "product category 2"],
  "services": ["service 1", "service 2", "service 3", "..."],
  "locations": ["France", "Belgium"],
  "audience": "who buys this",
  "canonical": "one sentence canonical profile",
  "reliable": true/false,
  "primary_entity": "product" | "software" | "service" | "marketplace",
  "has_physical_location": true/false,
  "has_service_area": true/false
}

Rules:
- "industry": a concise, human-readable category that completes “Industry”, grounded in the site (for example ${industryExamples}). Never leave it blank when the business is reliable.
- "products": only product categories the site actually sells. Empty array if unclear.
- "services": list EVERY distinct capability, feature or offering described on the page as its own array item — do not fold them into one summary sentence. For a SaaS/software product this means each major feature separately (e.g. "keyword research", "competitor analysis", "AI content generation", "image generation", "CMS publishing", "Google Business Profile posting", "Search Console integration" — not one item like "content platform"). For a service business, list each distinct service offered. Include named integrations, platforms or destinations the page states it works with (e.g. "WordPress", "Shopify", "WooCommerce") as their own items when they are a real, distinguishable part of what's offered, not marketing filler. Empty array only for a pure product seller with no services at all.
- "locations": only geographic areas mentioned on the site. Empty array if national/online with no area stated.
- "reliable": false if you cannot determine what the company actually sells with confidence.
- "canonical": e.g. "${canonicalExample}"
- NEVER include craft trades (menuisier, ébéniste, tapissier, décorateur) as services unless the site explicitly offers them.
- "primary_entity": the thing actually sold. "product" for physical/shippable goods, "software" for a SaaS/app/platform/tool (e.g. an AI content or SEO automation product), "service" for a professional or manual service performed for the buyer, "marketplace" for a platform that lists other sellers' offers.
- "has_physical_location": true only if a real street address or storefront appears on the site.
- "has_service_area": true only if the site states it serves a bounded local area (a city, a region, or "we cover X and Y"). A national or worldwide/online-only business is false even when it names a country it ships to or operates in.`;

  const system =
    "You build a precise business profile from a company website. Return ONLY JSON. " +
    "Never invent services, crafts, or locations that are not visible on the site. " +
    "A furniture SELLER is not a carpenter, upholsterer, or repair service. " +
    "Distinguish wholesale from retail from local service.";

  // The schema below returns three fields (primary_entity, has_physical_location,
  // has_service_area) on top of the original one, but the token budget was never
  // raised to match — the model routinely got cut off mid-object writing
  // "canonical"/"reliable" last, and parseJsonLoose threw "did not contain a
  // complete JSON value" for every business, onboarding and /test alike (the
  // HTTP call itself succeeds — only the JSON is truncated, so the failure has
  // to be caught around parseJsonLoose, not just around the network call). One
  // retry also absorbs an occasional truncated response instead of failing the
  // whole scan outright, the same resilience candidateKeywords already has.
  let p: Partial<CanonicalBusinessProfile>;
  try {
    const raw = await callOpenRouter({ json: true, maxTokens: 1800, system, user: buildPrompt() });
    p = parseJsonLoose<Partial<CanonicalBusinessProfile>>(raw);
  } catch (error) {
    console.error("[canonical-profile] first attempt failed", error instanceof Error ? error.message : error);
    const raw = await callOpenRouter({ json: true, maxTokens: 1800, system, user: buildPrompt() });
    p = parseJsonLoose<Partial<CanonicalBusinessProfile>>(raw);
  }
  const profileLocale = landing?.lang ?? site.lang ?? null;
  const profileLanguageText = () => [p.industry, p.description, p.audience, p.canonical, ...(p.products ?? []), ...(p.services ?? [])]
    .filter(Boolean).join(" ");
  if (!textMatchesLocale(profileLanguageText(), profileLocale)) {
    console.warn("[canonical-profile] language mismatch; normalising profile", { expected: profileLocale });
    const targetLanguage = (profileLocale ?? "en").slice(0, 2).toLowerCase() === "fr" ? "French" : "English";
    const strictRaw = await callOpenRouter({
      json: true,
      maxTokens: 1800,
      system: "You normalise the language of an existing business-profile JSON object. Return ONLY valid JSON. Preserve every fact and enum exactly; do not add, remove, infer, or reinterpret business information.",
      user: `Rewrite ONLY the human-readable values of this JSON in ${targetLanguage}: industry, description, products, services, locations, audience and canonical. Keep name, website_url, sales_model, reliable, primary_entity, has_physical_location and has_service_area unchanged. Brand names and official product names may remain untranslated.\n\n${JSON.stringify(p)}`,
    });
    p = parseJsonLoose<Partial<CanonicalBusinessProfile>>(strictRaw);
    if (!textMatchesLocale(profileLanguageText(), profileLocale)) {
      throw new Error(`PROFILE_LANGUAGE_MISMATCH: generated profile does not match website locale ${profileLocale ?? "unknown"}.`);
    }
  }
  const products = Array.isArray(p.products) ? p.products.map((s) => String(s).trim()).filter(Boolean).slice(0, 20) : [];
  const services = Array.isArray(p.services) ? p.services.map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : [];
  const locations = Array.isArray(p.locations) ? p.locations.map((s) => String(s).trim()).filter(Boolean).slice(0, 10) : [];
  const canonical =
    p.canonical?.toString().slice(0, 400) ??
    p.description?.toString().slice(0, 400) ??
    `${p.sales_model ?? ""} ${products.join(", ")}`.trim();
  const reliable = Boolean(p.reliable) && (products.length > 0 || services.length > 0);
  // The page's own wording wins over the model's reading of it. sweet-deco.fr
  // says "Grossiste de Meubles Professionnels" in its <title>, yet was being
  // classified as retail — and that single field decides whether the whole
  // keyword set targets resellers or shoppers.
  const modelSaysB2B = ["wholesale", "manufacturer"].includes((p.sales_model ?? "").trim().toLowerCase());
  const sales_model =
    landing?.sellsToBusinesses && !modelSaysB2B ? "wholesale" : (p.sales_model?.toString().slice(0, 40) ?? null);
  const PRIMARY_ENTITIES = new Set(["product", "software", "service", "marketplace"]);
  // A safety net for malformed model output only — the model is asked to
  // classify this directly. Defaults to "service", the most generic template,
  // rather than presuming a product catalogue or software that isn't there.
  const primary_entity: "product" | "software" | "service" | "marketplace" = PRIMARY_ENTITIES.has(
    (p.primary_entity ?? "").toString(),
  )
    ? (p.primary_entity as "product" | "software" | "service" | "marketplace")
    : products.length > 0
      ? "product"
      : sales_model === "marketplace"
        ? "marketplace"
        : "service";
  return {
    name: p.name?.toString().slice(0, 120) ?? hints?.name ?? site.title,
    website_url: hints?.website_url ?? null,
    industry:
      p.industry?.toString().trim().slice(0, 120) ||
      hints?.industry?.trim() ||
      products[0] ||
      services[0] ||
      null,
    audience: p.audience?.toString().slice(0, 300) ?? null,
    description: p.description?.toString().slice(0, 400) ?? null,
    sales_model,
    products,
    services,
    locations,
    positioning: landing?.positioning || null,
    primary_entity,
    has_physical_location: Boolean(p.has_physical_location),
    has_service_area: Boolean(p.has_service_area),
    canonical,
    reliable,
  };
}

/**
 * Seed terms describing what the business actually sells, in the words its
 * buyers use. Seeds only — every metric still comes from DataForSEO.
 * Preserves the sales model distinction (wholesaler vs retailer vs service).
 */
/**
 * Candidate search queries proposed by the AI from the landing page itself.
 *
 * This is the entry point of the research: the model reads the merchant's own
 * positioning and product taxonomy and writes the queries their buyer would
 * type. DataForSEO then measures those candidates (`searchVolumeFor`) and
 * anything with no real volume is dropped.
 *
 * The order matters. Letting DataForSEO generate the candidate space instead —
 * phrase-match expansion from a seed — makes every result inherit the seed's
 * audience, which is how a wholesaler's scan filled up with consumer queries.
 * Here the audience is decided before a single metric is fetched.
 */
export async function candidateKeywords(
  profile: BusinessProfile,
  landing?: import("./scrape.server").LandingProfile | null,
  max = 120,
): Promise<string[]> {
  const websiteLocale = landing?.lang?.slice(0, 2).toLowerCase() ?? null;
  const sellsToBusinesses = ["wholesale", "manufacturer"].includes(
    (profile.sales_model ?? "").trim().toLowerCase(),
  );
  // A model response is useful enrichment, not a single point of failure. The
  // canonical profile is already derived from the site's own title, copy and
  // taxonomy, so it can safely provide a small, auditable set of candidates
  // when the model returns malformed/empty JSON.
  const deterministicFallback = () => {
    const compactSeoPhrase = (value: string) =>
      value
        .replace(/\s+/g, " ")
        .split(/[|—–:]/)[0]!
        .trim()
        .split(/\s+/)
        .slice(0, 6)
        .join(" ")
        .toLowerCase();
    // Confirmed offering categories first: what this fallback is actually
    // for. Marketing copy (title, meta description, positioning) is a last
    // resort ONLY when there is no product/service data at all — it used to
    // be mixed in unconditionally, so a business with one real service
    // ("AI SEO & GEO automation") still got "ranki.ai", "rank higher on
    // google & ai" and a meta-description fragment templated into fake
    // buyer queries alongside it, because the SEO title is not a thing
    // anyone shops for.
    const offerings = [...(profile.products ?? []), ...(profile.services ?? []), ...(landing?.categoryLinks ?? [])];
    const rawTerms = offerings.length
      ? offerings
      : [profile.positioning ?? "", profile.description ?? "", landing?.title ?? "", landing?.pageTitle ?? "", landing?.metaDescription ?? ""];
    const terms = Array.from(
      new Set(
        rawTerms
          .map((term) => compactSeoPhrase(String(term)))
          .filter((term) => term.length > 2 && term.length <= 60 && term.split(/\s+/).length <= 6)
          .filter((term) => !/^(home|accueil|blog|contact|shop|products?|collections?)$/i.test(term)),
      ),
    ).slice(0, 8);
    const looksFrench =
      landing?.lang?.toLowerCase().startsWith("fr") ||
      /\b(grossiste|fournisseur|meuble|mobilier|professionnel|france)\b/i.test(
        [landing?.title, landing?.metaDescription, profile.positioning, profile.description].filter(Boolean).join(" "),
      );
    // "Buy X" / "X price" is ecommerce framing — meaningless for a service or
    // software business, which is exactly what turned "AI SEO & GEO
    // automation" into "buy ai seo & geo automation". Mirrors the same
    // sales_model branch already used for the onboarding preview card.
    const isServiceOrSoftware = !["wholesale", "retail", "manufacturer", "marketplace"].includes(
      (profile.sales_model ?? "").trim().toLowerCase(),
    );
    const candidates = terms.flatMap((term) => {
      if (sellsToBusinesses) {
        return looksFrench
          ? [`grossiste ${term}`, `fournisseur ${term}`, `${term} professionnel`]
          : [`${term} wholesale`, `${term} supplier`, `${term} for professionals`];
      }
      if (isServiceOrSoftware) {
        return looksFrench
          ? [term, `comment fonctionne ${term}`, `${term} tarif`]
          : [term, `how does ${term} work`, `${term} pricing`];
      }
      return looksFrench ? [term, `acheter ${term}`, `${term} prix`] : [term, `buy ${term}`, `${term} price`];
    });
    return Array.from(new Set(candidates)).slice(0, max);
  };
  const normaliseCandidates = (raw: string) => {
    const parsed = parseJsonLoose<{ keywords?: unknown }>(raw);
    const values = Array.isArray(parsed.keywords) ? parsed.keywords : [];
    return Array.from(
      new Set(
        values
          .map((k) => cleanKeywordForDataForSeo(String(k)).toLowerCase())
          .filter((k) => k.length > 2 && k.split(/\s+/).length <= 6),
      ),
    ).slice(0, max);
  };
  // The page itself, not a paraphrase of it. The SEO <title> and the visible
  // page title are given separately because they are frequently written for
  // different readers, and the SEO one is where the business model shows up.
  const landingBlock = landing
    ? [
        landing.title ? `SEO title (<title>): ${landing.title}` : null,
        landing.pageTitle && landing.pageTitle !== landing.title ? `Page title: ${landing.pageTitle}` : null,
        landing.metaDescription ? `Meta description: ${landing.metaDescription}` : null,
        landing.h2.length || landing.h3.length
          ? `Section headings: ${[...landing.h2, ...landing.h3].slice(0, 15).join(" | ")}`
          : null,
        landing.categoryLinks.length ? `Categories on the page: ${landing.categoryLinks.slice(0, 15).join(", ")}` : null,
        landing.bodyExcerpt ? `Landing page copy (truncated):\n${landing.bodyExcerpt.slice(0, 4000)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  try {
    const raw = await callOpenRouter({
      temperature: 0,
      json: true,
      maxTokens: 2000,
      system:
        `You turn a business's own landing page into buyer search queries. The website language code is ${websiteLocale ?? "unknown"}; every query MUST use that language. Strict JSON only.`,
      user: `${profileBlock(profile)}
${landingBlock ? `\n--- The business's actual landing page ---\n${landingBlock}\n--- end of landing page ---\n` : ""}
Propose up to ${max} distinct search queries that would bring THIS business a qualified visitor.
Ground every query in the landing page above: the vocabulary, product names and phrasing it already
uses are what this business is findable for.
Website language code: ${websiteLocale ?? "unknown"}. Write EVERY query in that exact language, exactly as a buyer would type it — never translated,
never a normalised or agrammatical form.

Real buyers type SHORT phrases, almost never full descriptive product names. Prefer 1-4 words per query;
use 5+ words only for a genuine natural question ("how does X work", "how much does X cost"). Never chain
two or more feature/product names together into one query, and never reproduce a marketing tagline or
full product description as a search term — nobody searches for the business's own sentence about itself.

BAD (do not produce queries shaped like these):
- "generative search content automation platform" (a feature-name mashup, not a real search)
- "ai powered seo and geo content generation software" (a product description, not a query)
- "automated multi-channel content optimization suite" (marketing copy, not something a buyer types)

GOOD shapes: the bare category ("project management software"), category + one buyer-intent modifier
("project management software pricing", "best project management software"), or a real natural-language
question ("how does project management software work").

${
  sellsToBusinesses
    ? `This business sells to OTHER BUSINESSES — resellers, retailers, professional buyers.
Every query must be one a PROFESSIONAL BUYER types when sourcing: the local-language equivalents of
"fournisseur <product>", "grossiste <product>", "<product> en gros", "<product> professionnel",
"acheter <product> en volume", "<product> pour revendeur".
NEVER a single-unit consumer query: "canapé d'angle convertible" matches the product but brings a
shopper, not a reseller — that is the wrong audience and must not appear.`
    : `These are consumers buying for themselves. Mix head terms, buying-intent queries and
comparison queries.`
}

Cover the range: category queries, buying-intent queries, and questions a buyer asks before choosing
a supplier. Use ONLY the products and services confirmed above — invent no new product category.
${profile.locations?.length ? `Geographic terms only with: ${profile.locations.join(", ")}.` : "No city or region names."}

Return exactly JSON: {"keywords":["...","..."]}. The array MUST contain at least 12 grounded buyer queries; never return an empty array.`,
    });
    const rawCandidates = normaliseCandidates(raw);
    const aiCandidates = keepCandidateLanguage(rawCandidates, websiteLocale);
    console.info("[keyword-candidates] AI response", { count: aiCandidates.length, rejectedWrongLanguage: rawCandidates.length - aiCandidates.length, websiteLocale, hasLandingEvidence: Boolean(landingBlock) });
    // The prompt itself demands "at least 12" — but that instruction was
    // never enforced in code, only checked for the total-failure case
    // (empty array). A response of 3 candidates passed straight through,
    // silently becoming the entire keyword pool for a 30-day calendar (this
    // is what produced Ranki.ai's "3 proposed" scans). Retry whenever the
    // count is short of that floor, not just when it's zero, and keep BOTH
    // batches (deduped) rather than discarding the first attempt — a retry
    // that also falls short still adds distinct candidates on top of it.
    const MIN_AI_CANDIDATES = 12;
    let merged = aiCandidates;
    // Exactly one retry (never a third attempt — that just reintroduces the
    // same cost/latency problem in a different shape) and it asks for
    // exactly what's missing instead of redoing the whole request: a first
    // batch of 17 is real, usable research, not something to discard because
    // it fell short of the target. Telling the model what it already gave
    // also stops it from re-deriving the same handful of obvious queries.
    if (merged.length < MIN_AI_CANDIDATES) {
      const missing = Math.min(Math.max(MIN_AI_CANDIDATES - merged.length, 12), Math.max(max - merged.length, 1));
      const retry = await callOpenRouter({
      temperature: 0,
        json: true,
        maxTokens: 1600,
        system: `Return strict JSON only. Derive buyer search queries from the evidence. Every query MUST use language code ${websiteLocale ?? "unknown"}.`,
        user: `${profileBlock(profile)}\n${landingBlock}\n\nYou already found these buyer queries — do not repeat any of them:\n${merged.length ? merged.map((k) => `- ${k}`).join("\n") : "(none yet)"}\n\nGenerate ${missing} additional, DISTINCT buyer queries in the site language, grounded in the evidence above. Keep them short (1-4 word) queries, not longer descriptive phrases — see the bad-example shapes above; do not repeat the pattern of your first batch if it produced long compound phrases. Return exactly {"keywords":["..."]}.`,
      });
      const retryCandidates = keepCandidateLanguage(normaliseCandidates(retry), websiteLocale);
      console.info("[keyword-candidates] AI retry response", { count: retryCandidates.length, hasLandingEvidence: Boolean(landingBlock) });
      merged = Array.from(new Set([...merged, ...retryCandidates])).slice(0, max);
    }
    if (merged.length >= MIN_AI_CANDIDATES) return merged;
    const safeFallback = keepCandidateLanguage(deterministicFallback(), websiteLocale);
    if (safeFallback.length >= 2) return Array.from(new Set([...merged, ...safeFallback])).slice(0, max);
    throw new Error(`KEYWORD_LANGUAGE_MISMATCH: expected ${websiteLocale ?? "website language"}, received too few valid candidates`);
  } catch (error) {
    console.error("[keyword-candidates] AI candidate generation failed", {
      error: error instanceof Error ? error.message : String(error),
      hasLandingEvidence: Boolean(landingBlock),
    });
    const safeFallback = keepCandidateLanguage(deterministicFallback(), websiteLocale);
    if (safeFallback.length >= 2) return safeFallback;
    throw error;
  }
}

const GENERIC_TOPIC_WORDS = new Set([
  "pour", "avec", "dans", "les", "des", "une", "and", "the", "for", "with", "your", "our",
]);

function significantTopicTerms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 3 && !GENERIC_TOPIC_WORDS.has(word));
}

/**
 * Deterministic, no-cost safety net for `keyword_ideas`-sourced candidates
 * (see runLiveMarketResearch): DataForSEO's keyword graph expands from a seed
 * to whatever has the biggest global volume, which can drift off-topic in a
 * way a seed alone doesn't guard against — this is the exact failure mode
 * `candidateKeywords`'s docblock above describes from an earlier version of
 * this pipeline ("a wholesaler's scan filled up with consumer queries").
 * Requires real vocabulary overlap with the business's own confirmed
 * products/services/industry before a result ever reaches the paid AI
 * relevance-scoring call.
 */
export function isOnTopicForProfile(keyword: string, profile: BusinessProfile): boolean {
  const keywordTerms = new Set(significantTopicTerms(keyword));
  if (!keywordTerms.size) return false;
  const vocabulary = [
    ...(profile.products ?? []),
    ...(profile.services ?? []),
    profile.industry ?? "",
  ].flatMap((term) => significantTopicTerms(term));
  if (!vocabulary.length) return true; // nothing confirmed to check against — don't block on missing data
  return vocabulary.some((term) => keywordTerms.has(term));
}

export async function productSeeds(profile: BusinessProfile, max = 12): Promise<string[]> {
  // Wholesalers and manufacturers sell to businesses. The distinction decides
  // the whole keyword set, so it is read once here and drives both the seed
  // instruction and whether bare categories are seeded at all.
  const sellsToBusinesses = ["wholesale", "manufacturer"].includes(
    (profile.sales_model ?? "").trim().toLowerCase(),
  );
  // The bare product categories (e.g. "meubles design") are the highest-volume
  // anchor terms available: short, unmodified, exactly what most buyers type.
  // Phrase-match keyword expansion can only ever get as broad as its seed, so
  // if every seed already carries a buyer-intent modifier, every suggestion
  // inherits that same narrow long tail. Seeding with the bare category first
  // fixes that — but ONLY for a business whose buyer is the person typing it.
  // For a wholesaler the bare category is a shopper's query, and seeding it
  // guarantees a page of consumer long-tail ("canapés d'angle convertibles")
  // for a business that sells pallets to resellers.
  const bareSeeds = (profile.products ?? [])
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 2 && p.split(/\s+/).length <= 4);
  try {
    const raw = await callOpenRouter({
      temperature: 0,
      json: true,
      maxTokens: 700,
      system:
        "You turn a business description into the exact search terms its buyers type. Strict JSON only, no explanations.",
      user: `${profileBlock(profile)}

List ${max} short search terms (2-4 words) that a buyer looking for THIS product would type.
Write them in the language of the business described above, never translated to English.
${
  sellsToBusinesses
    ? `This business sells to OTHER BUSINESSES — resellers, retailers and professional buyers — not to consumers.
Every term must be one a PROFESSIONAL BUYER types when SOURCING this product: the local-language
equivalents of "fournisseur <product>", "grossiste <product>", "<product> en gros",
"<product> professionnel", "<product> b2b", "acheter <product> en volume".
Do NOT return a bare consumer product category on its own, and never a single-unit shopper phrasing:
a query like "canapé d'angle convertible" matches the product but brings the wrong audience entirely.`
    : `Mix the terms: about half should be the bare product category alone or with a common synonym
(the highest-volume, most generic phrasing a buyer would type), and the other half can carry
buying-intent modifiers such as comparison or buying phrasings.`
}
Use ONLY product categories from the confirmed products list above. Do NOT invent new product categories.
No brand names other than this business's own. No generic one-word terms. No unrelated markets.
${profile.locations?.length ? `Geographic terms only with: ${profile.locations.join(", ")}.` : "No city or region names."}

Return JSON: {"seeds":["...", "..."]}`,
    });
    const parsed = parseJsonLoose<{ seeds?: string[] }>(raw);
    const aiSeeds = (parsed.seeds ?? [])
      .map((s) => String(s).trim().toLowerCase())
      .filter((s) => s.length > 2 && s.split(/\s+/).length <= 6);
    // For a B2B seller the bare categories are deliberately left out: they are
    // the consumer phrasing, and phrase-match would inherit it.
    return Array.from(new Set([...(sellsToBusinesses ? [] : bareSeeds), ...aiSeeds])).slice(0, max);
  } catch {
    // Last resort only. For a B2B seller these are the wrong audience, but no
    // seeds at all would leave the scan with nothing to expand from.
    return bareSeeds.slice(0, max);
  }
}

/**
 * Business-relevance of candidate rival domains. A domain that merely shares
 * generic keywords (news sites, directories, unrelated SaaS) is not a rival.
 */
export async function scoreCompetitorDomains(
  profile: BusinessProfile,
  domains: string[],
): Promise<Record<string, number>> {
  const list = Array.from(new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean))).slice(0, 40);
  if (!list.length) return {};
  // Fail closed: accepting every domain exactly at the threshold when the AI
  // scorer fails turns blogs, agencies and listicles into "confirmed rivals".
  const fallback = () => Object.fromEntries(list.map((domain) => [domain, 0]));
  const call = () => callOpenRouter({
      temperature: 0,
    json: true,
    maxTokens: 1600,
    system:
      "You judge whether a website is a real business competitor of another company. Strict JSON only.",
    user: `${profileBlock(profile)}

For each domain, score 0-100 how much it is a REAL competitor: it sells a similar product to the same buyers,
and has an identifiable commercial product page for a substantially similar product. Score 0-20 for news
sites, forums, directories, review aggregators, generic blogs, agencies, consultancies and comparison/listicle
publishers, even if they rank for similar words. Content audience overlap alone is never enough.
The buyer match matters as much as the product/service match, for any business type: a site targeting a
different customer type than this business's own sales_model/audience is NOT a real competitor even if it
ranks for the same searches — score it 0-20. This isn't only about wholesale vs retail: a B2B logistics
company isn't competing with a consumer parcel-tracking app, a contract manufacturer isn't competing with
a direct-to-consumer brand it might supply, a fleet-insurance broker isn't competing with a personal-auto
insurance comparator. Judge it the same way every time: does this domain sell to the SAME buyer as this
business, not just the same category?

Domains:
${list.map((d) => `- ${d}`).join("\n")}

Return JSON: {"scores":[{"domain":"...","score":0-100}]}`,
  });
  // A truncated-but-successful response (see buildCanonicalProfile) has to be
  // retried before this falls back to a flat default score for every domain —
  // otherwise a mid-JSON cutoff silently degrades competitor discovery instead
  // of ever getting a real answer.
  let parsed: { scores?: { domain: string; score: number }[] } | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    try {
      parsed = parseJsonLoose<{ scores?: { domain: string; score: number }[] }>(await call());
    } catch (e) {
      console.error("[relevance] competitor domain scoring failed", e);
    }
  }
  if (!parsed) return fallback();
  const out: Record<string, number> = {};
  for (const s of parsed.scores ?? []) {
    if (!s?.domain) continue;
    const n = Number(s.score);
    if (Number.isFinite(n)) out[s.domain.trim().toLowerCase()] = Math.max(0, Math.min(100, n));
  }
  return Object.keys(out).length ? out : fallback();
}

/**
 * Confirms direct competitors from what their product landing pages actually
 * sell. SERP overlap alone only proves topic overlap and commonly admits
 * publishers, broad suites, plugins and analytics products.
 */
export async function scoreCompetitorLandings(
  profile: BusinessProfile,
  candidates: { domain: string; positioning: string; headings: string[]; categories: string[] }[],
): Promise<Record<string, number>> {
  if (!candidates.length) return {};
  const fallback = () => Object.fromEntries(candidates.map((candidate) => [candidate.domain.toLowerCase(), 0]));
  try {
    const raw = await callOpenRouter({
      temperature: 0,
      json: true,
      maxTokens: 1800,
      system: "You verify direct product competitors from landing-page evidence. Return strict JSON only.",
      user: `${profileBlock(profile)}

Score each candidate from 0-100 as a DIRECT competitor. A direct competitor must sell substantially the same core product, solve the same primary job, target the same buyer, and use a comparable delivery model. Shared SEO keywords are not enough.

Scoring:
- 85-100: direct substitute a buyer could choose instead of this product.
- 65-84: partially overlapping or broader platform with a genuinely comparable core module.
- 30-64: adjacent analytics, plugin, agency, content tool, broad marketing suite, or only one shared feature.
- 0-29: publisher, blog, directory, course, community, unrelated product, or no commercial evidence.

Landing-page evidence:
${candidates.map((candidate) => `DOMAIN: ${candidate.domain}\nPOSITIONING: ${candidate.positioning}\nHEADINGS: ${candidate.headings.slice(0, 12).join(" | ")}\nCATEGORIES: ${candidate.categories.slice(0, 8).join(" | ")}`).join("\n\n")}

Return JSON: {"scores":[{"domain":"...","score":0-100,"reason":"short evidence-based reason"}]}`,
    });
    const parsed = parseJsonLoose<{ scores?: { domain: string; score: number }[] }>(raw);
    const out: Record<string, number> = {};
    for (const item of parsed.scores ?? []) {
      const domain = item.domain?.trim().toLowerCase();
      const score = Number(item.score);
      if (domain && Number.isFinite(score)) out[domain] = Math.max(0, Math.min(100, score));
    }
    return Object.keys(out).length ? out : fallback();
  } catch (error) {
    console.error("[relevance] competitor landing scoring failed", error);
    return fallback();
  }
}

/**
 * Composite ranking score. Relevance dominates and also acts as a gate:
 * an off-topic keyword can never outrank a relevant one, whatever its volume.
 * Weights: relevance 60, intent 18, volume 10, difficulty 7, CPC 5, and the
 * whole non-relevance part is scaled by relevance itself.
 */
export function compositeScore(k: ScorableKeyword, relevance: number): number {
  if (relevance < MIN_RELEVANCE) return 0;
  // Null is unknown, not a neutral metric. Unmeasured terms may remain as
  // discovery leads, but must not outrank a buyer query with live data.
  const measuredFields = [k.search_volume, k.intent, k.difficulty, k.cpc].filter((value) => value != null).length;
  const confidence = measuredFields / 4;
  const volume = k.search_volume == null ? 0 : Math.min(100, Math.log10(k.search_volume + 1) * 25);
  const intent = k.intent == null ? 0 : (INTENT_WEIGHT[k.intent.toLowerCase()] ?? 35);
  const difficulty = k.difficulty == null ? 0 : 100 - Math.max(0, Math.min(100, k.difficulty));
  const cpc = k.cpc == null ? 0 : Math.min(100, k.cpc * 20);
  const secondary = intent * 0.18 + volume * 0.1 + difficulty * 0.07 + cpc * 0.05;
  return (relevance * 0.6 + secondary * (relevance / 100)) * (0.35 + confidence * 0.65);
}

/**
 * How many buyer-query candidates to request from the AI per scan. A run
 * that requested 120 candidates timed out at Vercel's 300s function limit
 * measuring all of them through DataForSEO in one go — 40 is enough headroom
 * to clear MIN_QUALIFIED_KEYWORDS even when only a fraction have real
 * Google Ads volume, without the cost or latency of scoring/measuring three
 * times that many candidates that were always going to be discarded.
 */
export const TARGET_CANDIDATES = 40;

/** Keywords below this relevance are dropped (competitor noise, wrong industry). */
export const MIN_RELEVANCE = 75;

/** Rival domains below this business-relevance are never mined for keywords. */
export const MIN_COMPETITOR_RELEVANCE = 75;

/**
 * Below this, a scan is a hard failure — there is essentially no market
 * signal to plan anything from.
 */
export const MIN_USABLE_KEYWORDS = 2;

/**
 * The comfortable target: a calendar built from at least this many distinct
 * keywords never has to reuse a (type, keyword) pair more than ~4 times in a
 * 30-day window. Below it the scan still proceeds — planTopics'
 * FALLBACK_ANGLES/dedupeTopics were built precisely to keep 30 topics unique
 * even from a handful of keywords — but the caller gets a warning so a thin
 * scan is visible instead of looking identical to a healthy one.
 */
export const MIN_QUALIFIED_KEYWORDS = 8;

/** True only for a keyword DataForSEO actually returned demand data for. `null` means no data, not zero demand — it must not be treated as validated. */
export function hasMeasurableDemand(row: { search_volume?: number | null }): boolean {
  return row.search_volume !== null && row.search_volume !== undefined;
}
