import { callOpenRouter, parseJsonLoose } from "./ai.server";

export type MentionEngine = "chatgpt" | "perplexity" | "gemini";

/** Models used to emulate each generative answer engine through OpenRouter. */
export const ENGINE_MODELS: Record<MentionEngine, string> = {
  chatgpt: "openai/gpt-4o-mini",
  perplexity: "perplexity/sonar",
  gemini: "google/gemini-2.0-flash-001",
};

export const ENGINE_LABELS: Record<MentionEngine, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
};

/** Build the buyer-intent questions we ask each AI engine. */
export function mentionPrompts(input: {
  brand: string;
  industry?: string | null;
  city?: string | null;
  keywords?: string[] | null;
}): string[] {
  const niche = input.industry?.trim() || input.brand;
  const place = input.city?.trim();
  const seed = (input.keywords ?? []).filter(Boolean).slice(0, 1)[0];
  const list = [
    `What are the best ${niche} companies${place ? ` in ${place}` : ""} in 2026?`,
    `Which ${niche} provider should I choose and why?`,
    seed ? `Who is the best option for ${seed}?` : `Top recommended ${niche} brands right now`,
  ];
  return list.filter(Boolean).slice(0, 3);
}

type EngineAnswer = { brands: string[]; answer: string };

/** Ask one engine a question and extract the brands it recommends. */
export async function askEngine(engine: MentionEngine, prompt: string): Promise<EngineAnswer> {
  const raw = await callOpenRouter({
    model: ENGINE_MODELS[engine],
    json: true,
    maxTokens: 700,
    system:
      "You answer like a consumer-facing AI assistant. Reply with JSON only: " +
      '{"answer": "2-3 sentence recommendation", "brands": ["Brand 1", "Brand 2", ...]} ' +
      "where brands are, in order, the companies you would actually recommend. Max 8 brands.",
    user: prompt,
  });
  const parsed = parseJsonLoose<{ answer?: string; brands?: unknown }>(raw);
  const brands = Array.isArray(parsed.brands)
    ? parsed.brands.map((b) => String(b).trim()).filter(Boolean).slice(0, 8)
    : [];
  return { brands, answer: (parsed.answer ?? "").slice(0, 1200) };
}

/** 1-based position of the brand inside the recommended list, or null. */
export function findBrandRank(brands: string[], brand: string, domain?: string | null): number | null {
  const needles = [brand, domain?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]]
    .filter((v): v is string => Boolean(v && v.length > 2))
    .map((v) => v.toLowerCase());
  const idx = brands.findIndex((b) => needles.some((n) => b.toLowerCase().includes(n) || n.includes(b.toLowerCase())));
  return idx === -1 ? null : idx + 1;
}
