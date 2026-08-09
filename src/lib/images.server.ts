import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Generate one editorial image with Cloudflare Workers AI (Flux). Returns raw JPEG bytes. */
export async function generateImageBytes(prompt: string): Promise<Uint8Array> {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  if (!accountId || !token) throw new Error("Cloudflare image credentials missing");

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 1800), steps: 4 }),
    },
  );
  const json = (await res.json()) as { result?: { image?: string }; errors?: { message: string }[] };
  if (!res.ok || !json.result?.image) {
    throw new Error(json.errors?.[0]?.message ?? `Cloudflare image failed (${res.status})`);
  }
  return b64ToBytes(json.result.image);
}

/** Canonical public origin used when an image must be absolute (external CMS). */
export const SITE_ORIGIN = (process.env["PUBLIC_SITE_URL"] || "https://www.ranki.ai").replace(/\/$/, "");

/** Make a stored image path absolute for platforms that cannot resolve relative URLs. */
export function absoluteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${SITE_ORIGIN}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Store bytes in the article-images bucket and return a domain-independent URL.
 * We keep it relative so images keep working when the app domain changes.
 */
export async function storeImage(userId: string, key: string, bytes: Uint8Array, _origin?: string) {
  const path = `${userId}/${key}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("article-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return `/api/public/img/${path}`;
}

/**
 * Text keeps appearing because the model is handed a headline ("Top 10 SEO
 * Strategies…") and words like "magazine cover" — it then paints a poster.
 * So we never send the title: we distill it into a plain scene subject and
 * ask for a documentary photograph of surfaces with nothing printed on them.
 */
const STOPWORDS = new Set([
  "the","a","an","and","or","for","to","of","in","on","with","your","you","how","why","what",
  "best","top","guide","tips","strategies","ultimate","complete","ways","things","must",
  "should","need","know","2024","2025","2026","2027","vs","using","use","get","make",
]);

/** Turn a headline into a short, neutral visual subject (no numbers, no headline words). */
export function visualSubject(topic: string, industry?: string | null): string {
  const words = topic
    .toLowerCase()
    .replace(/["“”'’:|—–\-()]/g, " ")
    .replace(/\d+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const subject = words.slice(0, 4).join(" ").trim();
  return subject || (industry ? industry.toLowerCase() : "modern business workspace");
}

const NO_TEXT =
  "The scene contains no writing at all: blank signs, blank screens, blank packaging, blank paper, no books or posters, no logos, no numbers, no letters, no watermark, no captions, no UI text. Every surface is plain and unprinted.";

const STYLE =
  "Photorealistic documentary photograph, 35mm lens, natural window light, shallow depth of field, muted editorial color grade, no graphic design elements, no illustration, no collage, no border, no frame.";

export function coverPrompt(topic: string, industry: string | null) {
  const subject = visualSubject(topic, industry);
  const setting = industry ? ` in a ${industry.toLowerCase()} environment` : "";
  return `A real-world scene of ${subject}${setting}, photographed candidly. ${STYLE} ${NO_TEXT}`;
}

export function sectionPrompt(heading: string, topic: string) {
  const subject = visualSubject(`${heading} ${topic}`);
  return `A real-world scene of ${subject}, photographed candidly. ${STYLE} ${NO_TEXT}`;
}

/** Remove inline markdown images (we keep exactly one cover image per article). */
export function stripInlineImages(md: string): string {
  return md
    .replace(/^!\[[^\]]*\]\([^\s)]+\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Insert image markdown after the first few H2 sections of an article. */
export function injectImages(md: string, images: { heading: string; url: string }[]): string {
  let out = md;
  for (const img of images) {
    const re = new RegExp(`(^##\\s+${img.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$)`, "m");
    if (re.test(out)) out = out.replace(re, `$1\n\n![${img.heading}](${img.url})`);
  }
  return out;
}

export function headings(md: string): string[] {
  return [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
}
