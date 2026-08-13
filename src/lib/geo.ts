export const ROTATION = ["geo", "seo", "aeo", "local_aeo", "shopping"] as const;
export type ContentType = (typeof ROTATION)[number];

/**
 * A keyword's classified search intent, reconciling classifyIntent()'s
 * output (research.server.ts — informational/transactional/commercial/
 * navigational) with the separate `origin: "local"` concept tracked on
 * picked keywords. Used to hard-gate which content format a keyword may be
 * assigned to (see angles.server.ts's formatFitsKeyword) instead of the
 * mechanical day-by-day rotation deciding the format before any keyword is
 * even considered.
 */
export type SearchIntent = "informational" | "transactional" | "commercial" | "navigational" | "local";

/** Formats every business is eligible for, regardless of model, catalogue or geography. */
export const BASE_FORMATS: ContentType[] = ["geo", "seo", "aeo"];

/**
 * The subset of a business profile the eligibility engine reads — the same
 * structured signals `buildCanonical Profile` already produces from a
 * merchant's own site (sales model, products/services, catalogue, location).
 * Structural only, so both the client (marketing/dashboard) and the server
 * (planning, diagnostics) can pass whatever project/profile shape they
 * already have. Format eligibility is derived from these fields alone — never
 * a hardcoded "if industry === X" branch — so the same engine works for any
 * domain (SaaS, e-commerce, local service, B2B wholesale, marketplace,
 * publisher, ...) without code changes.
 */
export type EligibilitySignals = {
  locations?: string[] | null;
  has_physical_location?: boolean | null;
  has_service_area?: boolean | null;
  products?: string[] | null;
  services?: string[] | null;
  sales_model?: string | null;
  primary_entity?: string | null;
};

/**
 * Local AEO ("near me", city pages) requires a genuine local signal: a
 * physical address/storefront, or a stated bounded service area. `locations`
 * alone is NOT that signal — buildCanonicalProfile's own extraction prompt
 * deliberately populates it with market/country names ("France", "Belgium")
 * even for a nationwide online-only business, precisely so has_physical_
 * location/has_service_area can stay false for that business while still
 * recording where it operates. Treating locations.length>0 as local-eligible
 * was the exact contradiction a live report caught: a marketplace with
 * locations=["France"] but has_physical_location=false and has_service_area=
 * false still got Local AEO enabled, which produces nonsense like "AI SEO
 * for Shopify near you" for a business with no real local footprint.
 */
export function isLocalEligible(signals: EligibilitySignals): boolean {
  return Boolean(signals.has_physical_location || signals.has_service_area);
}

/**
 * The commercial ("shopping") slot requires a genuine catalogue/transactional
 * signal — real products, a marked-up sales model, or a marketplace/product
 * entity — same reasoning as isLocalEligible: a pure SaaS/service business
 * with no catalogue has nothing to render a product comparison from, and
 * forcing the slot on it is what produced invented "models"/"dimensions"
 * content for businesses that don't sell a physical or listable catalogue.
 * A pricing/plans buyer question from that kind of business still gets
 * written — as a transactional-intent SEO or AEO article instead, since
 * FORMAT_INTENT_FIT (angles.server.ts) already allows transactional intent
 * on those formats.
 */
export function isShoppingEligible(signals: EligibilitySignals): boolean {
  return Boolean(
    (signals.products?.length ?? 0) > 0 ||
      signals.sales_model === "ecommerce" ||
      signals.sales_model === "wholesale" ||
      signals.primary_entity === "product" ||
      signals.primary_entity === "marketplace",
  );
}

/**
 * Which formats this business's calendar may rotate through, derived purely
 * from structured profile signals — never a business-type branch. GEO/SEO/AEO
 * are universal (every business answers buyer questions). Shopping and Local
 * AEO are each added only when their own genuine signal is present.
 */
export function getEligibleFormats(signals: EligibilitySignals): ContentType[] {
  const formats: ContentType[] = [...BASE_FORMATS];
  if (isShoppingEligible(signals)) formats.push("shopping");
  if (isLocalEligible(signals)) formats.push("local_aeo");
  return formats;
}

export type PlatformId =
  | "wordpress"
  | "woocommerce"
  | "prestashop"
  | "shopify"
  | "supabase"
  | "webhook";

export const TYPE_META: Record<
  ContentType,
  { label: string; short: string; blurb: string; tone: string }
> = {
  geo: {
    label: "GEO",
    short: "GEO",
    blurb: "Cited by ChatGPT, Perplexity & AI Overviews",
    tone: "bg-accent text-accent-foreground",
  },
  seo: {
    label: "SEO",
    short: "SEO",
    blurb: "Classic search ranking article",
    tone: "bg-success-soft text-success",
  },
  aeo: {
    label: "AEO",
    short: "AEO",
    blurb: "Direct answer to a buyer question",
    tone: "bg-gold-soft text-gold-foreground",
  },
  local_aeo: {
    label: "Local AEO",
    short: "LOCAL",
    blurb: "City & near-me intent answer",
    tone: "bg-warning-soft text-warning",
  },
  shopping: {
    label: "Shopping AEO",
    short: "SHOP",
    blurb: "Product comparison for shopping assistants",
    tone: "bg-secondary text-secondary-foreground",
  },
};

export const PLATFORM_META: Record<
  PlatformId,
  { label: string; hint: string; fields: { key: string; label: string; placeholder: string; secret?: boolean }[] }
> = {
  wordpress: {
    label: "WordPress",
    hint: "REST API with an Application Password.",
    fields: [
      { key: "site_url", label: "Site URL", placeholder: "https://monsite.com" },
      { key: "username", label: "Username", placeholder: "admin" },
      { key: "app_password", label: "Application password", placeholder: "xxxx xxxx xxxx", secret: true },
    ],
  },
  woocommerce: {
    label: "WooCommerce",
    hint: "Posts are published through the WordPress REST API of the store.",
    fields: [
      { key: "site_url", label: "Store URL", placeholder: "https://boutique.com" },
      { key: "username", label: "Username", placeholder: "admin" },
      { key: "app_password", label: "Application password", placeholder: "xxxx xxxx xxxx", secret: true },
    ],
  },
  prestashop: {
    label: "PrestaShop",
    hint: "Webservice key with content write access.",
    fields: [
      { key: "site_url", label: "Shop URL", placeholder: "https://shop.com" },
      { key: "api_key", label: "Webservice key", placeholder: "PS key", secret: true },
    ],
  },
  shopify: {
    label: "Shopify blog",
    hint: "Admin API access token + blog id.",
    fields: [
      { key: "shop", label: "Shop domain", placeholder: "mystore.myshopify.com" },
      { key: "blog_id", label: "Blog ID", placeholder: "123456789" },
      { key: "access_token", label: "Admin API token", placeholder: "shpat_...", secret: true },
    ],
  },
  webhook: {
    label: "Lovable / Bolt / Replit site",
    hint: "We POST the article JSON to your endpoint. Add a secret header if you want.",
    fields: [
      { key: "endpoint", label: "Endpoint URL", placeholder: "https://monapp.lovable.app/api/public/articles" },
      { key: "secret", label: "Shared secret (optional)", placeholder: "x-autopilot-secret", secret: true },
    ],
  },
  supabase: {
    label: "Lovable / Bolt / Replit (Supabase)",
    hint: "Simplest setup: we write each article straight into your articles table.",
    fields: [
      { key: "supabase_url", label: "Supabase project URL", placeholder: "https://xxxx.supabase.co" },
      { key: "service_role_key", label: "Service role key", placeholder: "sb_secret_… / eyJ…", secret: true },
      { key: "site_url", label: "Site URL (optional)", placeholder: "https://monapp.lovable.app" },
    ],
  },
};

export const dayKey = (d: Date) => {
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return copy.toISOString().slice(0, 10);
};

export function planWindow(start: Date, days = 30, formats: readonly ContentType[] = ROTATION) {
  const rotation = formats.length ? formats : ROTATION;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: dayKey(d), type: rotation[i % rotation.length] as ContentType, offset: i };
  });
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);
}

export const STATUS_META: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "bg-muted text-muted-foreground" },
  generating: { label: "Writing…", className: "bg-warning-soft text-warning" },
  draft: { label: "Draft ready", className: "bg-accent text-accent-foreground" },
  published: { label: "Published", className: "bg-success-soft text-success" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};