import { callOpenRouter, parseJsonLoose } from "./ai.server";

export type BusinessProfile = {
  name?: string | null;
  website_url?: string | null;
  industry?: string | null;
  audience?: string | null;
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
  return `Business: ${profile.name ?? "unknown"}
Website: ${profile.website_url ?? "unknown"}
What it sells / category: ${profile.industry ?? "unknown"}
Audience: ${profile.audience ?? "unknown"}`;
}

const SCORING_RULES = `Scoring rules — be harsh, most keywords deserve a low score:
100 = someone searching this is looking for exactly this product/service, or for the problem it solves.
70-90 = strongly related category, comparison or buying-intent term for this product.
40-60 = adjacent topic the business could write about but that does not attract its buyers.
0-30 = different market, generic curiosity, free-tool seekers, students, unrelated meaning of a shared word.
A huge search volume is NOT a reason to score higher. Popular but off-topic terms must score under 20.
Watch for words that mean something else in another market (e.g. "citation" can mean a bibliography citation)
and score those 0 when the other meaning is what searchers want.`;

async function scoreBatch(profile: BusinessProfile, list: string[]): Promise<Record<string, number>> {
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 2500,
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
 */
export async function scoreRelevance(
  profile: BusinessProfile,
  keywords: string[],
): Promise<Record<string, number>> {
  const list = Array.from(new Set(keywords.map((k) => k.trim()).filter(Boolean))).slice(0, 240);
  if (!list.length) return {};
  const batches: string[][] = [];
  for (let i = 0; i < list.length; i += 50) batches.push(list.slice(i, i + 50));
  const results = await Promise.all(
    batches.map((b) => scoreBatch(profile, b).catch(() => ({}) as Record<string, number>)),
  );
  return Object.assign({}, ...results) as Record<string, number>;
}

/**
 * Seed terms describing what the business actually sells, in the words its
 * buyers use. Seeds only — every metric still comes from DataForSEO.
 */
export async function productSeeds(profile: BusinessProfile, max = 12): Promise<string[]> {
  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 700,
      system:
        "You turn a business description into the exact search terms its buyers type. Strict JSON only, no explanations.",
      user: `${profileBlock(profile)}

List ${max} short search terms (2-4 words) that a buyer looking for THIS product would type.
Use the product category, its common synonyms and acronyms, "<category> software/tools/platform",
and comparison or buying phrasings. No brand names other than this business's own category words.
No generic one-word terms, no unrelated markets, no student/free-tool phrasing.

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