export const ROTATION = ["geo", "seo", "aeo", "local_aeo", "shopping"] as const;
export type ContentType = (typeof ROTATION)[number];

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
};

export const dayKey = (d: Date) => {
  const copy = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return copy.toISOString().slice(0, 10);
};

export function planWindow(start: Date, days = 30) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: dayKey(d), type: ROTATION[i % ROTATION.length] as ContentType, offset: i };
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