import { extractPageSignals, normalizeUrl } from "./scrape.server";

export type CrawledPage = {
  url: string;
  title: string | null;
  description: string | null;
  headings: string[];
  textExcerpt: string;
  images: string[];
};

const UA = { "user-agent": "Mozilla/5.0 (compatible; Ranki.ai/1.0; +https://www.ranki.ai)" };

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow", signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Real page inventory, straight from the site's own sitemap — the standard, respectful way to discover every page. */
async function discoverSitemapUrls(origin: string, cap: number): Promise<string[]> {
  const xml = await fetchText(`${origin}/sitemap.xml`);
  if (!xml) return [];

  const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]!.trim());
  if (!locs.length) return [];

  // A sitemap index lists child sitemaps instead of pages — fetch a few and merge.
  if (/<sitemapindex/i.test(xml)) {
    const childSitemaps = locs.slice(0, 5);
    const out: string[] = [];
    for (const child of childSitemaps) {
      const childXml = await fetchText(child);
      if (!childXml) continue;
      out.push(...Array.from(childXml.matchAll(/<loc>([^<]+)<\/loc>/gi)).map((m) => m[1]!.trim()));
      if (out.length >= cap) break;
    }
    return out.slice(0, cap);
  }

  return locs.slice(0, cap);
}

/** Fallback when there's no sitemap: same-domain links found on the homepage itself. */
function discoverHomepageLinks(origin: string, html: string, cap: number): string[] {
  const host = new URL(origin).hostname;
  const found = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["']/gi)) {
    const href = m[1]!.trim();
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const u = new URL(href, origin);
      if (u.hostname !== host) continue;
      u.hash = "";
      found.add(u.toString());
    } catch {
      /* skip malformed hrefs */
    }
    if (found.size >= cap) break;
  }
  return Array.from(found);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Crawls up to `maxPages` pages of a site — sitemap.xml first (comprehensive,
 * respectful), falling back to the homepage's own links — extracting the
 * same detail level as the single-page scan (title, headings, text, images)
 * for every page instead of just the homepage.
 */
export async function crawlSite(websiteUrl: string, maxPages = 40): Promise<CrawledPage[]> {
  const homepage = normalizeUrl(websiteUrl);
  const origin = new URL(homepage).origin;

  let urls = await discoverSitemapUrls(origin, maxPages);
  if (!urls.length) {
    const html = await fetchText(homepage);
    urls = html ? discoverHomepageLinks(origin, html, maxPages) : [];
  }
  if (!urls.includes(homepage)) urls = [homepage, ...urls];
  urls = Array.from(new Set(urls)).slice(0, maxPages);

  const pages = await mapWithConcurrency(urls, 5, async (url): Promise<CrawledPage | null> => {
    const html = await fetchText(url);
    if (!html) return null;
    const signals = extractPageSignals(html.slice(0, 400_000), url);
    return {
      url,
      title: signals.title,
      description: signals.description,
      headings: signals.headings,
      textExcerpt: signals.text.slice(0, 2000),
      images: signals.images,
    };
  });

  return pages.filter((p): p is CrawledPage => Boolean(p));
}
