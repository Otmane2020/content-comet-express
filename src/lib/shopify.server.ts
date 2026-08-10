import { createHmac, timingSafeEqual } from "crypto";
import { SHOPIFY_CLIENT_ID } from "./shopify.constants";

export { SHOPIFY_CLIENT_ID };
export const SHOPIFY_SCOPES = "read_content,write_content,read_products";

export function shopifySecret() {
  const secret = process.env["SHOPIFY_ACCESS_TOKEN"];
  if (!secret) throw new Error("Shopify app secret is not configured.");
  return secret;
}

/** mystore.myshopify.com — anything else is rejected. */
export function normalizeShop(input: string | null | undefined) {
  if (!input) return null;
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host) ? host : null;
}

export type ShopifyState = {
  userId: string;
  projectId: string;
  origin: string;
  ts: number;
  shop?: string;
};

export function signState(payload: ShopifyState) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", shopifySecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string | null): ShopifyState | null {
  if (!state) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", shopifySecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ShopifyState;
  if (Date.now() - payload.ts > 30 * 60 * 1000) return null;
  return payload;
}

/** Shopify signs every redirect it makes to us. */
export function verifyRequestHmac(url: URL) {
  const params = new URLSearchParams(url.search);
  const hmac = params.get("hmac");
  if (!hmac) return false;
  params.delete("hmac");
  params.delete("signature");
  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = createHmac("sha256", shopifySecret()).update(message).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verifies an App Bridge session token (window.shopify.idToken()): a JWT
 * signed HS256 with the app's client secret. Confirms the signature, the
 * audience (our client id) and the expiry, then returns the shop it was
 * issued for. https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
 */
export function verifyShopifySessionToken(token: string): { shop: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", shopifySecret())
    .update(`${header}.${payload}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: { aud?: string; dest?: string; exp?: number; nbf?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
  if (claims.aud !== SHOPIFY_CLIENT_ID) return null;
  const now = Date.now() / 1000;
  if (typeof claims.exp !== "number" || claims.exp < now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now) return null;

  const shop = normalizeShop(claims.dest ?? null);
  return shop ? { shop } : null;
}

export function redirectUri(origin: string) {
  return `${origin.replace(/\/$/, "")}/api/public/shopify/callback`;
}

export function authorizeUrl(shop: string, state: string, origin: string) {
  const params = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: SHOPIFY_SCOPES,
    redirect_uri: redirectUri(origin),
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(shop: string, code: string) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: SHOPIFY_CLIENT_ID, client_secret: shopifySecret(), code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed (${res.status})`);
  return (await res.json()) as { access_token: string; scope?: string };
}

/** The blog we publish into — first one found, created on the fly if none exists. */
export async function resolveBlogId(shop: string, token: string) {
  const headers = { "X-Shopify-Access-Token": token, "content-type": "application/json" };
  const res = await fetch(`https://${shop}/admin/api/2024-10/blogs.json?limit=1`, { headers });
  if (res.ok) {
    const data = (await res.json()) as { blogs?: { id: number; title: string }[] };
    const blog = data.blogs?.[0];
    if (blog) return String(blog.id);
  }
  const created = await fetch(`https://${shop}/admin/api/2024-10/blogs.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ blog: { title: "News" } }),
  });
  if (!created.ok) throw new Error("Could not read or create a Shopify blog.");
  const data = (await created.json()) as { blog?: { id: number } };
  if (!data.blog) throw new Error("Could not read or create a Shopify blog.");
  return String(data.blog.id);
}

const adminHeaders = (token: string) => ({
  "X-Shopify-Access-Token": token,
  "content-type": "application/json",
});

export type ShopInfo = {
  name: string;
  email: string | null;
  domain: string | null;
  currency: string | null;
  timezone: string | null;
  locale: string | null;
  country: string | null;
  description: string | null;
  /** Richer fields captured from shop.json, additive — existing callers keep working. */
  shopId: string | null;
  myshopifyDomain: string | null;
  primaryDomain: string | null;
  countryCode: string | null;
  countryName: string | null;
  phone: string | null;
  city: string | null;
  address1: string | null;
  planName: string | null;
};

/** Everything we need about the store to run the autopilot without asking the merchant. */
export async function fetchShopInfo(shop: string, token: string): Promise<ShopInfo> {
  const res = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(`Could not read the Shopify store (${res.status}).`);
  const { shop: s } = (await res.json()) as {
    shop: {
      id?: number;
      name: string;
      email?: string;
      customer_email?: string;
      domain?: string;
      myshopify_domain?: string;
      currency?: string;
      iana_timezone?: string;
      primary_locale?: string;
      country_name?: string;
      country_code?: string;
      description?: string;
      phone?: string;
      city?: string;
      address1?: string;
      plan_name?: string;
      plan_display_name?: string;
    };
  };
  const primaryDomain = s.domain ? `https://${s.domain}` : `https://${s.myshopify_domain ?? shop}`;
  return {
    name: s.name,
    email: s.customer_email ?? s.email ?? null,
    domain: primaryDomain,
    currency: s.currency ?? null,
    timezone: s.iana_timezone ?? null,
    locale: s.primary_locale ?? null,
    country: s.country_name ?? null,
    description: s.description ?? null,
    shopId: s.id != null ? String(s.id) : null,
    myshopifyDomain: s.myshopify_domain ?? shop,
    primaryDomain,
    countryCode: s.country_code ?? null,
    countryName: s.country_name ?? null,
    phone: s.phone ?? null,
    city: s.city ?? null,
    address1: s.address1 ?? null,
    planName: s.plan_display_name ?? s.plan_name ?? null,
  };
}

/** Product snapshot stored on the connection so shopping articles have real data immediately. */
export async function fetchProductSnapshot(shop: string, token: string) {
  const res = await fetch(
    `https://${shop}/admin/api/2024-10/products.json?limit=50&fields=id,title,product_type,tags,handle`,
    { headers: adminHeaders(token) },
  );
  if (!res.ok) return { count: 0, types: [] as string[], titles: [] as string[] };
  const data = (await res.json()) as {
    products?: { title: string; product_type?: string; tags?: string }[];
  };
  const products = data.products ?? [];
  const types = [...new Set(products.map((p) => p.product_type).filter(Boolean) as string[])].slice(0, 12);
  return { count: products.length, types, titles: products.slice(0, 20).map((p) => p.title) };
}

/* ---------------------------- Store content ---------------------------- */

export type ShopifyVariant = {
  id: string;
  title: string;
  price: string | null;
  sku: string | null;
  inventoryQuantity: number | null;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  bodyHtml: string | null;
  url: string;
  images: string[];
  variants: ShopifyVariant[];
};

export type ShopifyCollection = {
  id: string;
  title: string;
  handle: string;
  url: string;
  kind: "custom" | "smart";
};

export type ShopifyPage = {
  id: string;
  title: string;
  handle: string;
  url: string;
};

export type ShopifyPolicy = {
  title: string;
  handle: string;
  url: string | null;
};

export type ShopifyStoreContent = {
  products: ShopifyProduct[];
  collections: ShopifyCollection[];
  pages: ShopifyPage[];
  policies: ShopifyPolicy[];
};

const PRODUCT_FIELDS =
  "id,title,handle,product_type,vendor,tags,body_html,images,variants";

/** Products (with variants/images), collections and pages — capped so installs stay fast. */
export async function fetchStoreContent(
  shop: string,
  token: string,
  opts: { productLimit?: number; pageLimit?: number } = {},
): Promise<ShopifyStoreContent> {
  const headers = adminHeaders(token);
  const productLimit = Math.min(opts.productLimit ?? 30, 100);
  const base = `https://${shop}/admin/api/2024-10`;
  const siteUrl = `https://${shop}`;

  const safeJson = async <T,>(url: string): Promise<T | null> => {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  };

  const [productsRes, customRes, smartRes, pagesRes, policiesRes] = await Promise.all([
    safeJson<{
      products?: {
        id: number;
        title: string;
        handle: string;
        product_type?: string;
        vendor?: string;
        tags?: string;
        body_html?: string;
        images?: { src: string }[];
        variants?: { id: number; title: string; price?: string; sku?: string; inventory_quantity?: number }[];
      }[];
    }>(`${base}/products.json?limit=${productLimit}&fields=${PRODUCT_FIELDS}`),
    safeJson<{ custom_collections?: { id: number; title: string; handle: string }[] }>(
      `${base}/custom_collections.json?limit=50`,
    ),
    safeJson<{ smart_collections?: { id: number; title: string; handle: string }[] }>(
      `${base}/smart_collections.json?limit=50`,
    ),
    safeJson<{ pages?: { id: number; title: string; handle: string }[] }>(
      `${base}/pages.json?limit=${opts.pageLimit ?? 20}`,
    ),
    safeJson<{ policies?: { title: string; handle: string; url?: string }[] }>(`${base}/policies.json`),
  ]);

  const products: ShopifyProduct[] = (productsRes?.products ?? []).map((p) => ({
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    productType: p.product_type ?? null,
    vendor: p.vendor ?? null,
    tags: (p.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    bodyHtml: p.body_html ?? null,
    url: `${siteUrl}/products/${p.handle}`,
    images: (p.images ?? []).map((i) => i.src).slice(0, 5),
    variants: (p.variants ?? []).map((v) => ({
      id: String(v.id),
      title: v.title,
      price: v.price ?? null,
      sku: v.sku ?? null,
      inventoryQuantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
    })),
  }));

  const collections: ShopifyCollection[] = [
    ...(customRes?.custom_collections ?? []).map((c) => ({
      id: String(c.id),
      title: c.title,
      handle: c.handle,
      url: `${siteUrl}/collections/${c.handle}`,
      kind: "custom" as const,
    })),
    ...(smartRes?.smart_collections ?? []).map((c) => ({
      id: String(c.id),
      title: c.title,
      handle: c.handle,
      url: `${siteUrl}/collections/${c.handle}`,
      kind: "smart" as const,
    })),
  ];

  const pages: ShopifyPage[] = (pagesRes?.pages ?? []).map((p) => ({
    id: String(p.id),
    title: p.title,
    handle: p.handle,
    url: `${siteUrl}/pages/${p.handle}`,
  }));

  const policies: ShopifyPolicy[] = (policiesRes?.policies ?? []).map((p) => ({
    title: p.title,
    handle: p.handle,
    url: p.url ?? null,
  }));

  return { products, collections, pages, policies };
}

/* --------------------------- Onboarding profile -------------------------- */

export type ShopifyOnboardingProfile = {
  source: "shopify";
  business_name: string;
  website_url: string | null;
  business_description: string | null;
  industry: string | null;
  country: string | null;
  language: string | null;
  currency: string | null;
  products_summary: string | null;
  collections_summary: string | null;
};

/** Normalized snapshot another agent can use to prefill onboarding without re-asking the merchant. */
export function buildShopifyOnboardingProfile(
  info: ShopInfo,
  content: Pick<ShopifyStoreContent, "products" | "collections">,
): ShopifyOnboardingProfile {
  const productTypes = [
    ...new Set(content.products.map((p) => p.productType).filter(Boolean) as string[]),
  ].slice(0, 5);
  return {
    source: "shopify",
    business_name: info.name,
    website_url: info.primaryDomain ?? info.domain,
    business_description: info.description,
    industry: productTypes[0] ?? null,
    country: info.countryName ?? info.country,
    language: info.locale,
    currency: info.currency,
    products_summary:
      content.products.length > 0
        ? `${content.products.length} products, categories: ${productTypes.join(", ") || "n/a"}`
        : null,
    collections_summary:
      content.collections.length > 0
        ? content.collections.map((c) => c.title).slice(0, 10).join(", ")
        : null,
  };
}

/* ------------------------------- Billing ------------------------------- */

export const SHOPIFY_PLAN = { name: "Ranki.ai — Autopilot", amount: 9.99, currency: "USD", trialDays: 7 };

async function graphql<T>(shop: string, token: string, query: string, variables: unknown) {
  const res = await fetch(`https://${shop}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!res.ok || json.errors?.length) throw new Error(json.errors?.[0]?.message ?? `Shopify API error (${res.status})`);
  if (!json.data) throw new Error("Empty Shopify response.");
  return json.data;
}

/** Merchants pay through Shopify, not Stripe: recurring app subscription. */
export async function createAppSubscription(shop: string, token: string, returnUrl: string) {
  const query = `
    mutation Create($name: String!, $returnUrl: URL!, $trialDays: Int!, $amount: Decimal!, $currency: CurrencyCode!, $test: Boolean!) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
        lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: $amount, currencyCode: $currency }, interval: EVERY_30_DAYS } } }]
      ) {
        confirmationUrl
        appSubscription { id status }
        userErrors { message }
      }
    }`;
  const data = await graphql<{
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      appSubscription: { id: string; status: string } | null;
      userErrors: { message: string }[];
    };
  }>(shop, token, query, {
    name: SHOPIFY_PLAN.name,
    returnUrl,
    trialDays: SHOPIFY_PLAN.trialDays,
    amount: SHOPIFY_PLAN.amount,
    currency: SHOPIFY_PLAN.currency,
    test: process.env["SHOPIFY_BILLING_TEST"] === "1",
  });
  const result = data.appSubscriptionCreate;
  if (result.userErrors?.length) throw new Error(result.userErrors[0]!.message);
  if (!result.confirmationUrl) throw new Error("Shopify did not return a billing confirmation URL.");
  return { confirmationUrl: result.confirmationUrl, id: result.appSubscription?.id ?? null };
}

/** ACTIVE (or trialing) app subscription currently installed on the shop, if any. */
export async function activeAppSubscription(shop: string, token: string) {
  const data = await graphql<{
    currentAppInstallation: {
      activeSubscriptions: { id: string; status: string; currentPeriodEnd: string | null }[];
    };
  }>(
    shop,
    token,
    `query { currentAppInstallation { activeSubscriptions { id status currentPeriodEnd } } }`,
    {},
  );
  const sub = data.currentAppInstallation?.activeSubscriptions?.[0];
  return sub && (sub.status === "ACTIVE" || sub.status === "ACCEPTED") ? sub : null;
}