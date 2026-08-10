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

  try {
    const raw = await callOpenRouter({
      json: true,
      maxTokens: 2200,
      system:
        `You are a generative-engine-optimisation strategist. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Never reference a past year as if it were current: if a topic needs a year, always use ${year} (or later). You answer with strict JSON only.`,
      user: `${briefLine(project)}

Create one editorial topic per slot below. Each topic must be a concrete, specific title idea (max 90 chars) matching the slot's content type, non-duplicated, in the project's language.
When a slot has a target keyword, the topic must be built around that exact keyword and read naturally.
Any year mentioned in a title must be ${year}. Never write ${year - 1}, ${year - 2} or older years.
Topics must be about what this business sells and the problems its buyers search for — never about the internal operations of the industries its customers belong to.

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

export type LocalInfo = {
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

const FAQ_TYPES = new Set<ContentType>(["aeo", "local_aeo"]);

export async function writeArticle(
  project: ProjectBrief,
  item: { content_type: ContentType; topic: string | null },
  extras?: {
    products?: { title: string; price: string | null; url: string | null; description: string | null }[];
    links?: { title: string; url: string }[];
    localInfo?: LocalInfo | undefined;
  },
) {
  const products = extras?.products ?? [];
  const links = extras?.links ?? [];
  const wantsFaq = FAQ_TYPES.has(item.content_type);
  const guidance: Record<ContentType, string> = {
    geo: "Write so that generative engines (ChatGPT, Perplexity, Gemini, AI Overviews) can quote you: crisp factual claims, statistics, named entities, and a quotable summary paragraph near the top.",
    seo: "Write a classic long-form SEO article: match search intent, open the first 100 words around the primary keyword, use an H2/H3 structure, and keep a keyword-rich but natural style.",
    aeo: "Answer-engine format: a direct 40-60 word answer first, then supporting sections. Do NOT write an FAQ section in the body — the FAQ is returned separately as structured data.",
    local_aeo:
      "Local answer-engine format: near-me and city intent, local proof points. Do NOT write an FAQ section in the body — the FAQ is returned separately as structured data.",
    shopping:
      "Shopping assistant format: comparison table in markdown, buying criteria, price ranges, pros/cons, and a clear recommendation.",
  };

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
  const faqSchema = wantsFaq ? `,"faq":[{"question":"...","answer":"..."}]` : "";
  const faqRule = wantsFaq
    ? `\nReturn exactly 4 FAQ pairs in "faq": real, specific questions a buyer would ask, with concise (2-3 sentence) answers. Do not repeat the FAQ content inside body_md.`
    : "";

  const raw = await callOpenRouter({
    json: true,
    maxTokens: 3200,
    system:
      `You are a senior content writer specialised in generative engine optimisation. Today is ${new Date().toISOString().slice(0, 10)} and the current year is ${year}. Your knowledge cutoff is older than today, so never present ${year - 1} or earlier as the current year, and never label trends with a past year. You answer with strict JSON only.`,
    user: `${briefLine(project)}

Content type: ${TYPE_META[item.content_type].label}
Topic: ${item.topic ?? "choose the most valuable topic for this business"}

${guidance[item.content_type]}${catalogBlock}${linksBlock}${localBlock}

Rules: 900-1400 words, markdown body (## and ### headings, bullet lists), title max 65 characters (it is a search-result headline), no title duplicated inside the body, no invented client testimonials, no placeholder lorem text.
Dates: the current year is ${year}. Every "trends", "guide" or "best of" reference must say ${year}. Never mention ${year - 1}, ${year - 2} or older years as current, and do not invent precise dated statistics you cannot support.${faqRule}

Return JSON: {"title":"...","excerpt":"max 160 chars","body_md":"markdown article"${faqSchema}}`,
  });

  const parsed = parseJsonLoose<{
    title?: string;
    excerpt?: string;
    body_md?: string;
    faq?: { question?: string; answer?: string }[];
  }>(raw);
  if (!parsed.body_md) throw new Error("The model returned no article body");
  const faq = wantsFaq
    ? (parsed.faq ?? [])
        .filter((f): f is { question: string; answer: string } => Boolean(f.question && f.answer))
        .map((f) => ({ question: freshenYears(f.question), answer: freshenYears(f.answer) }))
        .slice(0, 6)
    : [];

  let body_md = freshenYears(parsed.body_md);
  if (faq.length) {
    body_md += `\n\n## Frequently asked questions\n\n${faq
      .map((f) => `### ${f.question}\n\n${f.answer}`)
      .join("\n\n")}`;
  }

  return {
    title: freshenYears(parsed.title?.trim() || (item.topic ?? "Untitled")).slice(0, 70),
    excerpt: freshenYears(parsed.excerpt?.trim() ?? ""),
    body_md,
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