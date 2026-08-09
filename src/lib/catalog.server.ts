/**
 * Reads the product catalogue of the connected store platforms so Shopping
 * articles compare real products instead of invented ones.
 */
export type CatalogProduct = {
  title: string;
  price: string | null;
  url: string | null;
  description: string | null;
};

export const CATALOG_PLATFORMS = ["shopify", "woocommerce", "prestashop"] as const;

const clean = (url: string) => url.replace(/\/+$/, "");
const strip = (html: string | null | undefined) =>
  (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) || null;

async function shopifyProducts(config: Record<string, string | undefined>): Promise<CatalogProduct[]> {
  const shop = config["shop"];
  const token = config["access_token"];
  if (!shop || !token) return [];
  const host = clean(shop).replace(/^https?:\/\//, "");
  const res = await fetch(`https://${host}/admin/api/2024-10/products.json?limit=20`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    products?: { title: string; handle?: string; body_html?: string; variants?: { price?: string }[] }[];
  };
  return (data.products ?? []).map((p) => ({
    title: p.title,
    price: p.variants?.[0]?.price ?? null,
    url: p.handle ? `https://${host}/products/${p.handle}` : null,
    description: strip(p.body_html),
  }));
}

async function wooProducts(config: Record<string, string | undefined>): Promise<CatalogProduct[]> {
  const site = config["site_url"];
  if (!site) return [];
  // Store API is public and needs no key; falls back silently when disabled.
  const res = await fetch(`${clean(site)}/wp-json/wc/store/v1/products?per_page=20`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    name: string;
    permalink?: string;
    short_description?: string;
    prices?: { price?: string; currency_code?: string };
  }[];
  return (Array.isArray(data) ? data : []).map((p) => ({
    title: p.name,
    price: p.prices?.price ? `${p.prices.price} ${p.prices.currency_code ?? ""}`.trim() : null,
    url: p.permalink ?? null,
    description: strip(p.short_description),
  }));
}

async function prestashopProducts(config: Record<string, string | undefined>): Promise<CatalogProduct[]> {
  const site = config["site_url"];
  const key = config["api_key"];
  if (!site || !key) return [];
  const res = await fetch(`${clean(site)}/api/products?display=[id,name,price]&limit=20&output_format=JSON`, {
    headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { products?: { id: number; name: string; price?: string }[] };
  return (data.products ?? []).map((p) => ({
    title: typeof p.name === "string" ? p.name : String(p.name),
    price: p.price ?? null,
    url: `${clean(site)}/index.php?id_product=${p.id}&controller=product`,
    description: null,
  }));
}

/** Returns up to 25 products across every connected store platform. */
export async function fetchCatalog(
  integrations: { platform: string; config: Record<string, string | undefined> | null }[],
): Promise<CatalogProduct[]> {
  const out: CatalogProduct[] = [];
  for (const integration of integrations) {
    const config = integration.config ?? {};
    try {
      if (integration.platform === "shopify") out.push(...(await shopifyProducts(config)));
      else if (integration.platform === "woocommerce") out.push(...(await wooProducts(config)));
      else if (integration.platform === "prestashop") out.push(...(await prestashopProducts(config)));
    } catch {
      /* a store that refuses the read simply contributes no products */
    }
  }
  return out.filter((p) => p.title).slice(0, 25);
}

export function catalogLines(products: CatalogProduct[]) {
  return products
    .map((p) =>
      [p.title, p.price ? `price ${p.price}` : null, p.url, p.description].filter(Boolean).join(" — "),
    )
    .join("\n");
}