import { callOpenRouter, parseJsonLoose } from "./ai.server";
import { TYPE_META, type ContentType } from "./geo";

export type ProjectBrief = {
  name: string;
  website_url: string | null;
  industry: string | null;
  audience: string | null;
  tone: string | null;
  locale: string | null;
  keywords: string[];
};

export function briefLine(project: ProjectBrief) {
  return [
    `Business: ${project.name}`,
    project.website_url ? `Website: ${project.website_url}` : null,
    project.industry ? `Industry: ${project.industry}` : null,
    project.audience ? `Audience: ${project.audience}` : null,
    project.keywords.length ? `Target keywords: ${project.keywords.join(", ")}` : null,
    `Tone: ${project.tone ?? "expert"}`,
    `Language: ${project.locale ?? "fr"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function fallbackTopics(project: ProjectBrief, slots: { date: string; type: ContentType }[]) {
  const seeds = project.keywords.length ? project.keywords : [project.industry ?? project.name];
  return slots.map((slot, i) => ({
    ...slot,
    topic: `${TYPE_META[slot.type].label} — ${seeds[i % seeds.length]} (${project.name})`,
  }));
}

export async function planTopics(
  project: ProjectBrief,
  slots: { date: string; type: ContentType }[],
) {
  const list = slots
    .map((s, i) => `${i + 1}. ${s.date} — ${TYPE_META[s.type].label}: ${TYPE_META[s.type].blurb}`)
    .join("\n");
  const year = new Date().getUTCFullYear();

  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 2200,
      system:
        `You are a generative-engine-optimisation strategist. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Never reference a past year as if it were current: if a topic needs a year, always use ${year} (or later). You answer with strict JSON only.`,
      user: `${briefLine(project)}

Create one editorial topic per slot below. Each topic must be a concrete, specific title idea (max 90 chars) matching the slot's content type, non-duplicated, in the project's language.
Any year mentioned in a title must be ${year}. Never write ${year - 1}, ${year - 2} or older years.

Slots:
${list}

Return JSON: {"topics":[{"date":"YYYY-MM-DD","topic":"..."}]}`,
    });
    const parsed = parseJsonLoose<{ topics?: { date: string; topic: string }[] }>(raw);
    const byDate = new Map((parsed.topics ?? []).map((t) => [t.date, t.topic]));
    const fallback = fallbackTopics(project, slots);
    return slots.map((slot, i) => ({
      ...slot,
      topic: freshenYears(byDate.get(slot.date) ?? fallback[i]!.topic),
    }));
  } catch {
    return fallbackTopics(project, slots);
  }
}

export async function writeArticle(
  project: ProjectBrief,
  item: { content_type: ContentType; topic: string | null },
  extras?: { products?: { title: string; price: string | null; url: string | null; description: string | null }[] },
) {
  const products = extras?.products ?? [];
  const guidance: Record<ContentType, string> = {
    geo: "Write so that generative engines (ChatGPT, Perplexity, Gemini, AI Overviews) can quote you: crisp factual claims, statistics, named entities, and a quotable summary paragraph near the top.",
    seo: "Write a classic long-form SEO article: search intent match, H2/H3 structure, internal-link suggestions, and a keyword-rich but natural style.",
    aeo: "Answer-engine format: a direct 40-60 word answer first, then supporting sections, then a FAQ block of 4 questions with concise answers.",
    local_aeo: "Local answer-engine format: near-me and city intent, opening hours/practical details placeholders, local proof points, and a short local FAQ.",
    shopping:
      "Shopping assistant format: comparison table in markdown, buying criteria, price ranges, pros/cons, and a clear recommendation.",
  };

  const catalogBlock = products.length
    ? `\n\nReal product catalogue of this business (use ONLY these products, with their exact names, prices and links; never invent products):\n${products
        .map((p) => [p.title, p.price ? `price ${p.price}` : null, p.url, p.description].filter(Boolean).join(" — "))
        .join("\n")}\n\nBuild the comparison table and the recommendation from this catalogue, and link each product to its URL in markdown.`
    : "";

  const year = new Date().getUTCFullYear();
  const raw = await callOpenRouter({
    json: true,
    maxTokens: 3200,
    system:
      `You are a senior content writer specialised in generative engine optimisation. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Your knowledge cutoff is older than today, so never present ${year - 1} or earlier as the current year, and never label trends with a past year. You answer with strict JSON only.`,
    user: `${briefLine(project)}

Content type: ${TYPE_META[item.content_type].label}
Topic: ${item.topic ?? "choose the most valuable topic for this business"}

${guidance[item.content_type]}${catalogBlock}

Rules: 900-1400 words, markdown body (## and ### headings, bullet lists), no title duplicated inside the body, no invented client testimonials, no placeholder lorem text.
Dates: the current year is ${year}. Every "trends", "guide" or "best of" reference must say ${year}. Never mention ${year - 1}, ${year - 2} or older years as current, and do not invent precise dated statistics you cannot support.

Return JSON: {"title":"...","excerpt":"max 160 chars","body_md":"markdown article"}`,
  });

  const parsed = parseJsonLoose<{ title?: string; excerpt?: string; body_md?: string }>(raw);
  if (!parsed.body_md) throw new Error("The model returned no article body");
  return {
    title: freshenYears(parsed.title?.trim() || (item.topic ?? "Untitled")),
    excerpt: freshenYears(parsed.excerpt?.trim() ?? ""),
    body_md: freshenYears(parsed.body_md),
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