/** Minimal internal website scraper: fetches a page and extracts readable signals. */
export type SiteSnapshot = {
  url: string;
  title: string | null;
  description: string | null;
  lang: string | null;
  headings: string[];
  text: string;
  /** Everything the landing page states about itself — see LandingProfile. */
  landing?: LandingProfile;
};

export type PageSignals = {
  title: string | null;
  description: string | null;
  lang: string | null;
  headings: string[];
  text: string;
  images: string[];
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

const BROWSER_HEADERS = {
  // Many storefront CDNs drop a request made by an obvious crawler UA. This
  // still identifies Ranki in the URL, while looking like a normal document
  // navigation at the HTTP layer.
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Ranki.ai/1.0 (+https://www.ranki.ai)",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
};

type FetchedHtml = { html: string; url: string };

function fetchCandidates(url: string) {
  const candidates = [url];
  const parsed = new URL(url);
  // Some hosts publish only one of apex/www. Trying the other canonical host
  // is safe and frequently recovers a storefront behind an older CDN.
  if (!parsed.hostname.startsWith("www.")) {
    parsed.hostname = `www.${parsed.hostname}`;
    candidates.push(parsed.toString());
  }
  return candidates;
}

function fetchErrorDetail(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "request timed out";
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause && typeof cause === "object" && "code" in cause) return String((cause as { code?: unknown }).code);
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetch a public landing page without allowing an intermittent network error
 * to take down the complete research pipeline. The final error deliberately
 * includes the attempted hosts and error codes: it is actionable in /test.
 */
async function fetchHtml(input: string): Promise<FetchedHtml> {
  const attempts: string[] = [];
  for (const candidate of fetchCandidates(input)) {
    for (let retry = 0; retry < 2; retry += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(candidate, {
          headers: BROWSER_HEADERS,
          redirect: "follow",
          signal: controller.signal,
        });
        if (!response.ok) {
          attempts.push(`${new URL(candidate).hostname}: HTTP ${response.status}`);
          break;
        }
        const html = (await response.text()).slice(0, 400_000);
        if (!html.trim()) {
          attempts.push(`${new URL(candidate).hostname}: empty response`);
          break;
        }
        return { html, url: response.url || candidate };
      } catch (error) {
        attempts.push(`${new URL(candidate).hostname}: ${fetchErrorDetail(error)}`);
        if (retry === 0) await new Promise((resolve) => setTimeout(resolve, 350));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw new Error(`Could not reach this public website after retrying (${attempts.join("; ")}). Check that the site allows HTTPS requests from Ranki.`);
}

/** Parses one already-fetched HTML document into the signals we reuse everywhere (single scan + crawl). */
export function extractPageSignals(html: string, pageUrl: string): PageSignals {
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((m) =>
      decode((m[1] ?? "").replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    )
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

  const base = (() => {
    try {
      return new URL(pageUrl);
    } catch {
      return null;
    }
  })();
  const images = Array.from(html.matchAll(/<img[^>]+src=["']([^"'>]+)["']/gi))
    .map((m) => m[1]!.trim())
    .filter(Boolean)
    .map((src) => {
      if (/^https?:\/\//i.test(src)) return src;
      if (!base) return null;
      try {
        return new URL(src, base).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u))
    .filter((u) => !/\.svg(\?|$)/i.test(u))
    .slice(0, 8);

  return {
    title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description:
      pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
      pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    lang: pick(html, /<html[^>]+lang=["']([a-zA-Z-]{2,5})["']/i),
    headings,
    text,
    images: Array.from(new Set(images)),
  };
}

/**
 * Everything the landing page states about itself.
 *
 * The homepage <title>, meta description, nav taxonomy and JSON-LD are the
 * merchant's own positioning: already in their language, already aimed at the
 * buyer they actually sell to. sweet-deco.fr's title is literally "Grossiste de
 * Meubles Professionnels" — yet the scan seeded DataForSEO from an AI paraphrase
 * of the page and returned consumer keywords ("canapés d'angle convertibles")
 * for a wholesaler. This captures those signals verbatim so seeding, the sales
 * model and the language can be driven by what the page says rather than by
 * what a model inferred from it.
 */
export type LandingProfile = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  siteName: string | null;
  metaKeywords: string[];
  lang: string | null;
  h1: string[];
  h2: string[];
  /** Real pages often ship no H1 at all — sweet-deco.fr has zero — and put the
   * merchandising in h3. Captured so the taxonomy survives that. */
  h3: string[];
  /** Menu / category labels — the merchant's own product taxonomy. */
  navLabels: string[];
  /**
   * Category labels taken from links whose URL is a category/collection route.
   * Real menus are often rendered by JS or built without a <nav>, so matching
   * the href pattern recovers the taxonomy when navLabels only finds the
   * footer's legal links — which is exactly what happens on sweet-deco.fr.
   */
  categoryLinks: string[];
  /** schema.org @type values found in JSON-LD (Organization, OnlineStore, Product…). */
  schemaTypes: string[];
  /** Product and category names declared in JSON-LD. */
  schemaNames: string[];
  currency: string | null;
  /** Wholesale/B2B markers matched in the page's own copy, with what matched. */
  b2bMarkers: string[];
  /**
   * How often those markers appear across the whole landing copy, and how many
   * distinct ones. A merchant whose <title> is generic can still say
   * "grossiste" twenty times in the body — sweet-deco.fr says it 24 times —
   * so the header alone is not a safe place to decide who the buyer is.
   */
  b2bMentions: number;
  b2bDistinct: number;
  /** True when the page states it sells to businesses, resellers or professionals. */
  sellsToBusinesses: boolean;
  /** Title + meta description, verbatim — the raw material for keyword seeds. */
  positioning: string;
  /**
   * The page's own visible title, as distinct from the SEO <title>: the H1 when
   * there is one, else og:site_name. The two are often written for different
   * audiences — sweet-deco.fr's SEO title says "Grossiste de Meubles
   * Professionnels" — so both are kept.
   */
  pageTitle: string | null;
  /** Readable landing copy, trimmed — what the page actually says. */
  bodyExcerpt: string;
};

/**
 * Words a business uses when its buyer is another business. Deliberately
 * multilingual and matched against the page's own copy, so the wholesale/retail
 * call is deterministic evidence rather than an AI guess — the single decision
 * that sets the audience for every keyword downstream.
 */
const B2B_MARKERS =
  /grossiste?s?|demi[-\s]gros|en\s+gros|revendeurs?|wholesale[rs]?|bulk\s+(?:order|buy|purchas)|b2b|business[-\s]to[-\s]business|fournisseurs?|distributeurs?|mayorista|venta\s+al\s+por\s+mayor|gro[sß]handel|ingrosso|hurtown\w*|professionnels?|tarifs?\s+pro|prix\s+pro|compte\s+pro|trade\s+(?:account|price|customer)|reseller|dropshipp\w*/gi;

// A consumer retailer can mention a "professional" programme. Only signals
// explicitly describing wholesale, sourcing or distribution prove B2B.
const STRONG_B2B_MARKERS =
  /grossiste?s?|demi[-\s]gros|en\s+gros|revendeurs?|wholesale[rs]?|bulk\s+(?:order|buy|purchas)|b2b|business[-\s]to[-\s]business|fournisseurs?|distributeurs?|mayorista|venta\s+al\s+por\s+mayor|gro[sÃŸ]handel|ingrosso|hurtown\w*|tarifs?\s+pro|prix\s+pro|compte\s+pro|trade\s+(?:account|price|customer)|reseller|dropshipp\w*/gi;

const PROFESSIONAL_BUYER_MARKERS = /\b(?:agencies|agency|businesses|companies|teams|enterprise|enterprises|e-?commerce (?:brands|teams|businesses)|marketing teams|for business|for teams)\b/gi;

function metaContent(html: string, attr: "name" | "property", key: string) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`,
    "i",
  );
  const m = html.match(re);
  const value = (m?.[1] ?? m?.[2] ?? "").trim();
  return value ? decode(value).slice(0, 400) : null;
}

function headings(html: string, level: 1 | 2 | 3) {
  return Array.from(html.matchAll(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, "gi")))
    .map((m) => decode((m[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 1 && t.length < 160)
    // Unrendered template placeholders ({{{ name }}}, ${title}, <%= x %>) are
    // common on real storefronts and are not content — made-in-meubles.com
    // serves one in an h3.
    .filter((t) => !/\{\{|\}\}|\$\{|<%/.test(t))
    .slice(0, 12);
}

/** Parses one already-fetched landing page. Pure, so it can be tested offline. */
export function extractLandingProfile(html: string, pageUrl: string): LandingProfile {
  const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    metaContent(html, "name", "description") ?? metaContent(html, "property", "og:description");
  const ogTitle = metaContent(html, "property", "og:title");
  const siteName = metaContent(html, "property", "og:site_name");
  const metaKeywords = (metaContent(html, "name", "keywords") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 1)
    .slice(0, 20);

  // Nav labels: the merchant's own taxonomy, usually their real product
  // categories in their real wording.
  const navBlocks = Array.from(html.matchAll(/<nav[^>]*>([\s\S]{0,20000}?)<\/nav>/gi))
    .map((m) => m[1] ?? "")
    .join(" ");
  const navLabels = Array.from(navBlocks.matchAll(/<a[^>]*>([\s\S]{0,200}?)<\/a>/gi))
    .map((m) => decode((m[1] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 2 && t.length < 60 && !/^https?:/i.test(t))
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 30);

  const categoryLinks = Array.from(
    html.matchAll(
      /<a[^>]+href=["'][^"']*\/(?:collections?|categorie|categories|category|rayon|boutique|shop|produits?|products?)\/([^"'?#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi,
    ),
  )
    .map((m) => {
      const label = decode((m[2] ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      // Fall back to the slug when the anchor wraps only an image.
      return label || decode((m[1] ?? "").replace(/[-_]+/g, " ")).trim();
    })
    .filter((t) => t.length > 2 && t.length < 60 && !/^\d+$/.test(t))
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, 30);

  const schemaTypes: string[] = [];
  const schemaNames: string[] = [];
  let currency: string | null = null;
  for (const block of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== "object") return;
        const o = node as Record<string, unknown>;
        const type = o["@type"];
        if (typeof type === "string") schemaTypes.push(type);
        else if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && schemaTypes.push(t));
        if (typeof o["name"] === "string" && o["name"].length < 120) schemaNames.push(o["name"]);
        if (!currency && typeof o["priceCurrency"] === "string") currency = o["priceCurrency"];
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse((block[1] ?? "").trim()));
    } catch {
      /* a malformed JSON-LD block is not a reason to lose the whole page */
    }
  }

  const h1 = headings(html, 1);
  const h2 = headings(html, 2);
  const h3 = headings(html, 3);

  // Body copy, tags stripped — the same treatment extractPageSignals gives it.
  const bodyText = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
  const bodyHits = bodyText.match(B2B_MARKERS) ?? [];
  const b2bMentions = bodyHits.length;
  const b2bDistinct = new Set(bodyHits.map((m) => m.toLowerCase())).size;
  const strongBodyHits = bodyText.match(STRONG_B2B_MARKERS) ?? [];
  const professionalBuyerHits = bodyText.match(PROFESSIONAL_BUYER_MARKERS) ?? [];
  const professionalBuyerDistinct = new Set(professionalBuyerHits.map((m) => m.toLowerCase())).size;

  // Match markers only against copy the merchant wrote about itself, never the
  // full page text: a single "professionnels" in a footer link would otherwise
  // reclassify every retailer as a wholesaler.
  const selfDescription = [title, metaDescription, ogTitle, siteName, ...h1, ...categoryLinks.slice(0, 15)]
    .filter(Boolean)
    .join(" · ");
  const b2bMarkers = Array.from(new Set((selfDescription.match(B2B_MARKERS) ?? []).map((m) => m.toLowerCase())));
  const strongB2bMarkers = selfDescription.match(STRONG_B2B_MARKERS) ?? [];

  return {
    url: pageUrl,
    title,
    metaDescription,
    ogTitle,
    siteName,
    metaKeywords,
    lang: pick(html, /<html[^>]+lang=["']([a-zA-Z-]{2,5})["']/i),
    h1,
    h2,
    h3,
    navLabels,
    categoryLinks,
    schemaTypes: Array.from(new Set(schemaTypes)).slice(0, 12),
    schemaNames: Array.from(new Set(schemaNames)).slice(0, 25),
    currency,
    b2bMarkers,
    b2bMentions,
    b2bDistinct,
    // Either the merchant says it in the header, or the body says it
    // repeatedly and in more than one way. The second test needs both a volume
    // and a variety floor: one word repeated by a menu template is not a
    // business model, whereas "grossiste" + "revendeurs" + "en gros" across
    // thirty mentions is unambiguous.
    sellsToBusinesses: strongB2bMarkers.length > 0 || strongBodyHits.length >= 3 || professionalBuyerDistinct >= 2,
    pageTitle: h1[0] ?? siteName ?? null,
    bodyExcerpt: bodyText.trim().slice(0, 4000),
    // og:site_name earns its place: sweet-deco.fr's is "Grossiste de Meubles en
    // France - Mobilier pour les Pros", a second, independent statement of who
    // the business sells to.
    positioning: Array.from(new Set([title, siteName, metaDescription].filter(Boolean) as string[])).join(" — "),
  };
}

/** Fetches the landing page and returns everything it states about itself. */
export async function scrapeLandingProfile(input: string): Promise<LandingProfile> {
  const url = normalizeUrl(input);
  const page = await fetchHtml(url);
  return extractLandingProfile(page.html, page.url);
}

export async function scrapeSite(input: string): Promise<SiteSnapshot> {
  const url = normalizeUrl(input);
  const page = await fetchHtml(url);
  const signals = extractPageSignals(page.html, page.url);

  // Parsed from the same fetch, so the richer landing signals cost nothing.
  return { url: page.url, ...signals, landing: extractLandingProfile(page.html, page.url) };
}
