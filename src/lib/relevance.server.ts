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

/**
 * Asks the model ONLY for topical relevance (0-100) of each keyword to the
 * business. All SEO metrics stay DataForSEO's — the model never invents them.
 * Falls back to a neutral score when the model is unavailable.
 */
export async function scoreRelevance(
  profile: BusinessProfile,
  keywords: string[],
): Promise<Record<string, number>> {
  const list = Array.from(new Set(keywords.map((k) => k.trim()).filter(Boolean))).slice(0, 200);
  if (!list.length) return {};
  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 2000,
      system:
        "You score how topically relevant a search keyword is to a specific business. You never invent search volume, CPC or difficulty. Answer with strict JSON only.",
      user: `Business: ${profile.name ?? "unknown"}
Website: ${profile.website_url ?? "unknown"}
What it sells / category: ${profile.industry ?? "unknown"}
Audience: ${profile.audience ?? "unknown"}

Score each keyword from 0 to 100 for how closely it matches what this business actually sells.
100 = a buyer of this product would search it. 0 = unrelated industry or generic noise.

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
  } catch {
    return {};
  }
}

/**
 * Composite ranking score: relevance 40, commercial intent 25, volume 15,
 * difficulty 10, CPC 10. High volume never beats a perfectly relevant term.
 */
export function compositeScore(k: ScorableKeyword, relevance: number): number {
  const volume = Math.min(100, Math.log10((k.search_volume ?? 0) + 1) * 25);
  const intent = INTENT_WEIGHT[(k.intent ?? "").toLowerCase()] ?? 50;
  const difficulty = 100 - Math.max(0, Math.min(100, k.difficulty ?? 50));
  const cpc = Math.min(100, (k.cpc ?? 0) * 20);
  return (
    relevance * 0.4 + intent * 0.25 + volume * 0.15 + difficulty * 0.1 + cpc * 0.1
  );
}

/** Keywords below this relevance are dropped (competitor noise, wrong industry). */
export const MIN_RELEVANCE = 40;