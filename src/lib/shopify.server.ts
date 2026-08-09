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