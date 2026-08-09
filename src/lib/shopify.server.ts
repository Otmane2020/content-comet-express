import { createHmac, timingSafeEqual } from "crypto";

/** Public app credentials — the client id is public, the secret lives in env. */
export const SHOPIFY_CLIENT_ID = "a57869f9e856fc6af974670ab5dcd6a2";
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

export type ShopifyState = { userId: string; projectId: string; origin: string; ts: number };

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
};

/** Everything we need about the store to run the autopilot without asking the merchant. */
export async function fetchShopInfo(shop: string, token: string): Promise<ShopInfo> {
  const res = await fetch(`https://${shop}/admin/api/2024-10/shop.json`, {
    headers: adminHeaders(token),
  });
  if (!res.ok) throw new Error(`Could not read the Shopify store (${res.status}).`);
  const { shop: s } = (await res.json()) as {
    shop: {
      name: string;
      email?: string;
      customer_email?: string;
      domain?: string;
      myshopify_domain?: string;
      currency?: string;
      iana_timezone?: string;
      primary_locale?: string;
      country_name?: string;
      description?: string;
    };
  };
  return {
    name: s.name,
    email: s.customer_email ?? s.email ?? null,
    domain: s.domain ? `https://${s.domain}` : `https://${s.myshopify_domain ?? shop}`,
    currency: s.currency ?? null,
    timezone: s.iana_timezone ?? null,
    locale: s.primary_locale ?? null,
    country: s.country_name ?? null,
    description: s.description ?? null,
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