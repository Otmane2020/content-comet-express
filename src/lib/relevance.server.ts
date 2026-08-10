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
- The keyword is a LOCAL SERVICE query with a city/region NOT in the business's confirmed locations
  (e.g. "menuisier lyon" for a national online seller).
- The keyword mentions a COMPETING BRAND by name (e.g. "schmidt meuble sur mesure") unless the business
  IS that brand.
- The keyword is about REPAIR, RESTORATION, RENTAL, TRAINING, or HIRING/RECRUITMENT when the business sells
  products.`;

async function scoreBatch(profile: BusinessProfile, list: string[]): Promise<Record<string, number>> {
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
  const results = await Promise.all(
    batches.map((b) => scoreBatch(profile, b).catch(() => ({}) as Record<string, number>)),
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
  site: { title: string | null; description: string | null; headings: string[]; text: string; lang?: string | null },
  hints?: { name?: string | null; industry?: string | null; website_url?: string | null },
): Promise<CanonicalBusinessProfile> {
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 900,
    system:
      "You build a precise business profile from a company website. Return ONLY JSON. " +
      "Never invent services, crafts, or locations that are not visible on the site. " +
      "A furniture SELLER is not a carpenter, upholsterer, or repair service. " +
      "Distinguish wholesale from retail from local service.",
    user: `Website title: ${site.title ?? ""}
Description: ${site.description ?? ""}
Headings: ${site.headings?.slice(0, 15).join(" | ") ?? ""}
Page text (truncated): ${site.text?.slice(0, 3000) ?? ""}
Hints — name: ${hints?.name ?? ""}, industry: ${hints?.industry ?? ""}, website: ${hints?.website_url ?? ""}

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
  return {
    name: p.name?.toString().slice(0, 120) ?? hints?.name ?? site.title,
    website_url: hints?.website_url ?? null,
    industry: hints?.industry ?? null,
    audience: p.audience?.toString().slice(0, 300) ?? null,
    description: p.description?.toString().slice(0, 400) ?? null,
    sales_model: p.sales_model?.toString().slice(0, 40) ?? null,
    products,
    services,
    locations,
    canonical,
    reliable,
  };
}

/**
 * Seed terms describing what the business actually sells, in the words its
 * buyers use. Seeds only — every metric still comes from DataForSEO.
 * Preserves the sales model distinction (wholesaler vs retailer vs service).
 */
export async function productSeeds(profile: BusinessProfile, max = 12): Promise<string[]> {
  const salesPrefix = profile.sales_model === "wholesale" ? "grossiste " : "";
  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 700,
      system:
        "You turn a business description into the exact search terms its buyers type. Strict JSON only, no explanations.",
      user: `${profileBlock(profile)}

List ${max} short search terms (2-4 words) that a buyer looking for THIS product would type.
${salesPrefix ? `The business is a WHOLESALER — use terms like "grossiste <product>", "<product> en gros", "fournisseur <product>".` : "Use the product category, its common synonyms, comparison or buying phrasings."}
Use ONLY product categories from the confirmed products list above. Do NOT invent new product categories.
No brand names other than this business's own. No generic one-word terms. No unrelated markets.
${profile.locations?.length ? `Geographic terms only with: ${profile.locations.join(", ")}.` : "No city or region names."}

Return JSON: {"seeds":["...", "..."]}`,
    });
    const parsed = parseJsonLoose<{ seeds?: string[] }>(raw);
    return (parsed.seeds ?? [])
      .map((s) => String(s).trim().toLowerCase())
      .filter((s) => s.length > 2 && s.split(/\s+/).length <= 6)
      .slice(0, max);
  } catch {
    return [];
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
  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 1200,
      system:
        "You judge whether a website is a real business competitor of another company. Strict JSON only.",
      user: `${profileBlock(profile)}

For each domain, score 0-100 how much it is a REAL competitor: it sells a similar product to the same buyers,
or its content targets the same buyers. Score 0-20 for news sites, forums, directories, review aggregators,
generic blogs and companies from another market, even if they rank for similar words.

Domains:
${list.map((d) => `- ${d}`).join("\n")}

Return JSON: {"scores":[{"domain":"...","score":0-100}]}`,
    });
    const parsed = parseJsonLoose<{ scores?: { domain: string; score: number }[] }>(raw);
    const out: Record<string, number> = {};
    for (const s of parsed.scores ?? []) {
      if (!s?.domain) continue;
      const n = Number(s.score);
      if (Number.isFinite(n)) out[s.domain.trim().toLowerCase()] = Math.max(0, Math.min(100, n));
    }
    return out;
  } catch {
    return {};
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
