import { callOpenRouter, parseJsonLoose } from "./ai.server";

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
  const fallback = () => Object.fromEntries(list.map((domain) => [domain, MIN_COMPETITOR_RELEVANCE]));
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 1400,
    system:
      "You score how relevant a search keyword is to a specific business's buyers. You never invent search volume, CPC or difficulty. Answer with strict JSON only.",
    user: `${profileBlock(profile)}

${SCORING_RULES}

Keywords:
${list.map((k) => `- ${k}`).join("\n")}

Return JSON: {"scores":[{"keyword":"...","score":0-100}]}`,
  });
  const parsed = parseJsonLoose<{ scores?: { keyword: string; score: number }[] }>(raw);
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
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 900,
    system:
      "You build a precise business profile from a company website. Return ONLY JSON. " +
      "Never invent services, crafts, or locations that are not visible on the site. " +
      "A furniture SELLER is not a carpenter, upholsterer, or repair service. " +
      "Distinguish wholesale from retail from local service.",
    user: `${landing?.positioning ? `How the business describes itself, verbatim (SEO title, site name, meta description) — trust this over your reading of the page body:\n${landing.positioning}\n` : ""}${
      landing?.sellsToBusinesses
        ? `Wholesale/B2B wording on this page: ${(landing.b2bMarkers ?? []).join(", ") || "in the body copy"} — ${landing.b2bMentions ?? 0} mentions across the landing page. This business sells to other businesses: "sales_model" MUST be "wholesale" or "manufacturer", and "audience" must describe the professional buyer, not a consumer.\n`
        : ""
    }${landing?.schemaTypes?.length ? `schema.org types declared by the site: ${landing.schemaTypes.slice(0, 6).join(", ")}\n` : ""}${landing?.categoryLinks?.length ? `Category/product links on the page: ${landing.categoryLinks.slice(0, 15).join(", ")}\n` : ""}
Website title: ${site.title ?? ""}
Description: ${site.description ?? ""}
Headings: ${site.headings?.slice(0, 15).join(" | ") ?? ""}
Page text (truncated): ${site.text?.slice(0, 3000) ?? ""}
Hints — name: ${hints?.name ?? ""}, industry: ${hints?.industry ?? ""}, website: ${hints?.website_url ?? ""}
${hints?.audience ? `Known audience (already confirmed for this business, trust it over your own reading of the page): ${hints.audience}\nIf that audience is resellers, retailers, professionals or other businesses, "sales_model" MUST be "wholesale" or "manufacturer" — never "retail".` : ""}

Return JSON:
{
  "name": "company name",
  "description": "one sentence: sales model + products + audience + geography",
  "sales_model": "wholesale" | "retail" | "service" | "marketplace" | "manufacturer" | "other",
  "products": ["product category 1", "product category 2"],
  "services": ["service 1"],
  "locations": ["France", "Belgium"],
  "audience": "who buys this",
  "canonical": "one sentence canonical profile",
  "reliable": true/false
}

Rules:
- "products": only product categories the site actually sells. Empty array if unclear.
- "services": only services the site actually offers. Empty array for pure sellers.
- "locations": only geographic areas mentioned on the site. Empty array if national/online with no area stated.
- "reliable": false if you cannot determine what the company actually sells with confidence.
- "canonical": e.g. "Grossiste et vendeur de meubles en ligne: canapés, tables, chaises, mobilier de maison en France."
- NEVER include craft trades (menuisier, ébéniste, tapissier, décorateur) as services unless the site explicitly offers them.`,
  });
  const p = parseJsonLoose<Partial<CanonicalBusinessProfile>>(raw);
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
  return {
    name: p.name?.toString().slice(0, 120) ?? hints?.name ?? site.title,
    website_url: hints?.website_url ?? null,
    industry: hints?.industry ?? null,
    audience: p.audience?.toString().slice(0, 300) ?? null,
    description: p.description?.toString().slice(0, 400) ?? null,
    sales_model,
    products,
    services,
    locations,
    positioning: landing?.positioning || null,
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
  const sellsToBusinesses = ["wholesale", "manufacturer"].includes(
    (profile.sales_model ?? "").trim().toLowerCase(),
  );
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
        landing.bodyExcerpt ? `Landing page copy (truncated):\n${landing.bodyExcerpt.slice(0, 2500)}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 2000,
      system:
        "You turn a business's own landing page into the exact search queries its buyers type. Strict JSON only.",
      user: `${profileBlock(profile)}
${landingBlock ? `\n--- The business's actual landing page ---\n${landingBlock}\n--- end of landing page ---\n` : ""}
Propose up to ${max} distinct search queries that would bring THIS business a qualified visitor.
Ground every query in the landing page above: the vocabulary, product names and phrasing it already
uses are what this business is findable for.
Write them in the business's own language, exactly as a buyer would type them — never translated,
never a normalised or agrammatical form.

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

Return JSON: {"keywords":["...","..."]}`,
    });
    const parsed = parseJsonLoose<{ keywords?: string[] }>(raw);
    return Array.from(
      new Set(
        (parsed.keywords ?? [])
          .map((k) => String(k).trim().toLowerCase())
          .filter((k) => k.length > 2 && k.split(/\s+/).length <= 8),
      ),
    ).slice(0, max);
  } catch {
    return [];
  }
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
  const fallback = () => Object.fromEntries(list.map((domain) => [domain, MIN_COMPETITOR_RELEVANCE]));
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 1200,
    system:
      "You judge whether a website is a real business competitor of another company. Strict JSON only.",
    user: `${profileBlock(profile)}

For each domain, score 0-100 how much it is a REAL competitor: it sells a similar product to the same buyers,
or its content targets the same buyers. Score 0-20 for news sites, forums, directories, review aggregators,
generic blogs and companies from another market, even if they rank for similar words.
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
  }).catch((e) => {
    console.error("[relevance] competitor domain scoring failed", e);
    return null;
  });
  if (!raw) return fallback();
  const parsed = parseJsonLoose<{ scores?: { domain: string; score: number }[] }>(raw);
  const out: Record<string, number> = {};
  for (const s of parsed.scores ?? []) {
    if (!s?.domain) continue;
    const n = Number(s.score);
    if (Number.isFinite(n)) out[s.domain.trim().toLowerCase()] = Math.max(0, Math.min(100, n));
  }
  return Object.keys(out).length ? out : fallback();
}

/**
 * Composite ranking score. Relevance dominates and also acts as a gate:
 * an off-topic keyword can never outrank a relevant one, whatever its volume.
 * Weights: relevance 60, intent 18, volume 10, difficulty 7, CPC 5, and the
 * whole non-relevance part is scaled by relevance itself.
 */
export function compositeScore(k: ScorableKeyword, relevance: number): number {
  if (relevance < MIN_RELEVANCE) return 0;
  const volume = Math.min(100, Math.log10((k.search_volume ?? 0) + 1) * 25);
  const intent = INTENT_WEIGHT[(k.intent ?? "").toLowerCase()] ?? 50;
  const difficulty = 100 - Math.max(0, Math.min(100, k.difficulty ?? 50));
  const cpc = Math.min(100, (k.cpc ?? 0) * 20);
  const secondary = intent * 0.18 + volume * 0.1 + difficulty * 0.07 + cpc * 0.05;
  return relevance * 0.6 + secondary * (relevance / 100);
}

/** Keywords below this relevance are dropped (competitor noise, wrong industry). */
export const MIN_RELEVANCE = 60;

/** Rival domains below this business-relevance are never mined for keywords. */
export const MIN_COMPETITOR_RELEVANCE = 55;
