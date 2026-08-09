import { createHmac, timingSafeEqual } from "crypto";

export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  gmb: "openid email https://www.googleapis.com/auth/business.manage",
  gsc: "openid email https://www.googleapis.com/auth/webmasters.readonly",
};

export type GoogleService = "gmb" | "gsc";

function stateKey() {
  return process.env["SUPABASE_SERVICE_ROLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"] || "ranki";
}

export type StatePayload = {
  userId: string;
  projectId: string;
  service: GoogleService;
  origin: string;
  ts: number;
};

export function signState(payload: StatePayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
  if (Date.now() - payload.ts > 15 * 60 * 1000) return null;
  return payload;
}

export function googleClient() {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured yet.");
  return { clientId, clientSecret };
}

export function redirectUri(origin: string) {
  return `${origin.replace(/\/$/, "")}/api/public/google/callback`;
}

export function authUrl(service: GoogleService, state: string, origin: string) {
  const { clientId } = googleClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: GOOGLE_SCOPES[service],
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
};

export async function exchangeCode(code: string, origin: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleClient();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshToken(refresh: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleClient();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const part = idToken.split(".")[1];
    if (!part) return null;
    const claims = JSON.parse(Buffer.from(part, "base64url").toString()) as { email?: string };
    return claims.email ?? null;
  } catch {
    return null;
  }
}

/** Returns a valid access token for a connection, refreshing when needed. */
export async function accessTokenFor(connectionId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("google_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (error || !row) throw new Error("This Google account is not connected anymore.");
  const fresh = row.expires_at ? new Date(row.expires_at).getTime() - 60_000 > Date.now() : false;
  if (fresh && row.access_token) return row.access_token;
  if (!row.refresh_token) throw new Error("Google connection expired — reconnect it.");
  const next = await refreshToken(row.refresh_token);
  await supabaseAdmin
    .from("google_tokens")
    .update({
      access_token: next.access_token,
      expires_at: new Date(Date.now() + next.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connectionId);
  return next.access_token;
}

async function gfetch(url: string, token: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 400));
  return text ? JSON.parse(text) : {};
}

/* ---------------- Google Business Profile ---------------- */

export type GmbLocation = { name: string; title: string; address: string; storeCode: string | null };

export async function listGmbLocations(token: string): Promise<GmbLocation[]> {
  const accounts = (await gfetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    token,
  )) as { accounts?: { name: string }[] };
  const out: GmbLocation[] = [];
  for (const acc of accounts.accounts ?? []) {
    const res = (await gfetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title,storeCode,storefrontAddress&pageSize=100`,
      token,
    )) as {
      locations?: { name: string; title: string; storeCode?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }[];
    };
    for (const loc of res.locations ?? []) {
      out.push({
        name: `${acc.name}/${loc.name}`,
        title: loc.title,
        storeCode: loc.storeCode ?? null,
        address: [loc.storefrontAddress?.addressLines?.join(" "), loc.storefrontAddress?.locality]
          .filter(Boolean)
          .join(", "),
      });
    }
  }
  return out;
}

export async function createGmbPost(
  token: string,
  locationName: string,
  post: { summary: string; url?: string | null; ctaLabel?: string },
) {
  const body: Record<string, unknown> = {
    languageCode: "fr",
    summary: post.summary.slice(0, 1450),
    topicType: "STANDARD",
  };
  if (post.url) {
    body["callToAction"] = { actionType: post.ctaLabel === "BOOK" ? "BOOK" : "LEARN_MORE", url: post.url };
  }
  return gfetch(`https://mybusiness.googleapis.com/v4/${locationName}/localPosts`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ---------------- Search Console ---------------- */

export async function listGscSites(token: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const res = (await gfetch("https://www.googleapis.com/webmasters/v3/sites", token)) as {
    siteEntry?: { siteUrl: string; permissionLevel: string }[];
  };
  return (res.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser");
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function gscQuery(
  token: string,
  siteUrl: string,
  dimension: "query" | "page" | "date",
  days = 28,
): Promise<GscRow[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 864e5);
  const res = (await gfetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: [dimension],
        rowLimit: dimension === "date" ? 100 : 25,
      }),
    },
  )) as { rows?: GscRow[] };
  return res.rows ?? [];
}
