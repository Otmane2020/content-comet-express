/** Minimal internal website scraper: fetches a page and extracts readable signals. */
export type SiteSnapshot = {
  url: string;
  title: string | null;
  description: string | null;
  lang: string | null;
  headings: string[];
  text: string;
};

function pick(html: string, re: RegExp) {
  const m = html.match(re);
  return m?.[1]?.trim().slice(0, 300) ?? null;
}

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function normalizeUrl(input: string) {
  const raw = input.trim();
  if (!raw) throw new Error("Website URL is required");
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export async function scrapeSite(input: string): Promise<SiteSnapshot> {
  const url = normalizeUrl(input);
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; AutopilotGEO/1.0; +https://autopilotgeo.com)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Could not read ${url} (HTTP ${res.status})`);
  const html = (await res.text()).slice(0, 400_000);

  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((m) => decode((m[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 2)
    .slice(0, 25);

  const text = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  return {
    url,
    title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    lang: pick(html, /<html[^>]+lang=["']([a-zA-Z-]{2,5})["']/i),
    headings,
    text,
  };
}