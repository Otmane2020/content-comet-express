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

/** Store bytes in the private article-images bucket and return a public app URL. */
export async function storeImage(userId: string, key: string, bytes: Uint8Array, origin: string) {
  const path = `${userId}/${key}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from("article-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  return `${origin.replace(/\/$/, "")}/api/public/img/${path}`;
}

const NO_TEXT =
  "Absolutely no text of any kind: no words, no letters, no numbers, no captions, no titles, no headlines, no typography, no signage, no labels, no packaging text, no book or magazine covers with writing, no handwriting, no subtitles, no watermark, no logo, no brand name, no UI or screen text. Pure photographic image only.";

export function coverPrompt(topic: string, industry: string | null) {
  return `Editorial magazine cover photograph illustrating: ${topic}. ${
    industry ? `Industry: ${industry}. ` : ""
  }Cinematic natural light, shallow depth of field, premium interior-magazine aesthetic. ${NO_TEXT}`;
}

export function sectionPrompt(heading: string, topic: string) {
  return `Editorial magazine photograph for the section "${heading}" of an article about ${topic}. Natural light, realistic, premium lifestyle photography. ${NO_TEXT}`;
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
