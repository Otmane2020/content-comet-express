import { createHmac, timingSafeEqual } from "crypto";

export const GOOGLE_SCOPES: Record<GoogleService, string> = {
  gmb: "openid email https://www.googleapis.com/auth/business.manage",
  gsc: "openid email https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "openid email https://www.googleapis.com/auth/analytics.readonly",
  all: "openid email https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/webmasters.readonly",
};

export type GoogleService = "gmb" | "gsc" | "ga4" | "all";

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
  post: { summary: string; url?: string | null; ctaLabel?: string; imageUrl?: string | null },
) {
  // Google rejects a Standard local post without a summary, and it also refuses
  // markdown noise, so normalise the text before sending it.
  const summary = (post.summary ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*`>_~|]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!summary) throw new Error("Nothing to post: the article has no title or summary text yet.");

  const body: Record<string, unknown> = {
    languageCode: "en",
    summary: summary.slice(0, 1450),
    topicType: "STANDARD",
  };
  const url = (post.url ?? "").trim();
  if (/^https?:\/\//i.test(url)) {
    body["callToAction"] = { actionType: post.ctaLabel === "BOOK" ? "BOOK" : "LEARN_MORE", url };
  }
  const imageUrl = (post.imageUrl ?? "").trim();
  if (/^https?:\/\//i.test(imageUrl)) {
    body["media"] = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
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

/* ---------------- Google Analytics 4 (AI assistant traffic) ---------------- */

export type Ga4Property = { name: string; displayName: string; account: string };

/** All GA4 properties the connected account can read. */
export async function listGa4Properties(token: string): Promise<Ga4Property[]> {
  const res = (await gfetch(
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
    token,
  )) as {
    accountSummaries?: {
      displayName?: string;
      propertySummaries?: { property: string; displayName?: string }[];
    }[];
  };
  const out: Ga4Property[] = [];
  for (const acc of res.accountSummaries ?? []) {
    for (const p of acc.propertySummaries ?? []) {
      out.push({
        name: p.property, // "properties/123456789"
        displayName: p.displayName ?? p.property,
        account: acc.displayName ?? "",
      });
    }
  }
  return out;
}

/** Referrer / source patterns Google and the market use for AI assistants. */
const AI_SOURCES: { match: RegExp; assistant: string }[] = [
  { match: /chatgpt|openai/i, assistant: "ChatGPT" },
  { match: /perplexity/i, assistant: "Perplexity" },
  { match: /gemini|bard\.google|google\.com\/search\/ai/i, assistant: "Gemini" },
  { match: /claude|anthropic/i, assistant: "Claude" },
  { match: /copilot|bing\.com\/chat/i, assistant: "Copilot" },
  { match: /you\.com/i, assistant: "You.com" },
  { match: /grok|x\.ai/i, assistant: "Grok" },
  { match: /deepseek/i, assistant: "DeepSeek" },
  { match: /mistral|lechat/i, assistant: "Mistral" },
];

export function assistantForSource(source: string, channel?: string): string | null {
  for (const rule of AI_SOURCES) if (rule.match.test(source)) return rule.assistant;
  // GA4 now ships a dedicated channel group for recognised assistants.
  if (channel && /ai\s*assistant/i.test(channel)) return source || "AI assistant";
  return null;
}

export type AiTrafficRow = {
  assistant: string;
  source: string;
  sessions: number;
  users: number;
  engagedSessions: number;
  conversions: number;
};

/** Sessions from AI assistants over the last N days, grouped per assistant source. */
export async function ga4AiTraffic(token: string, property: string, days = 28): Promise<AiTrafficRow[]> {
  const body = (metrics: string[]) => ({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionSource" }, { name: "sessionDefaultChannelGroup" }],
    metrics: metrics.map((name) => ({ name })),
    limit: 200,
  });
  const url = `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`;
  let metricNames = ["sessions", "totalUsers", "engagedSessions", "keyEvents"];
  let res: { rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[] };
  try {
    res = (await gfetch(url, token, { method: "POST", body: JSON.stringify(body(metricNames)) })) as typeof res;
  } catch {
    // Older properties still expose "conversions" instead of "keyEvents".
    metricNames = ["sessions", "totalUsers", "engagedSessions", "conversions"];
    res = (await gfetch(url, token, { method: "POST", body: JSON.stringify(body(metricNames)) })) as typeof res;
  }

  const out = new Map<string, AiTrafficRow>();
  for (const row of res.rows ?? []) {
    const source = row.dimensionValues?.[0]?.value ?? "";
    const channel = row.dimensionValues?.[1]?.value ?? "";
    const assistant = assistantForSource(source, channel);
    if (!assistant) continue;
    const n = (i: number) => Number(row.metricValues?.[i]?.value ?? 0) || 0;
    const key = source.toLowerCase();
    const prev = out.get(key);
    const next: AiTrafficRow = {
      assistant,
      source: key,
      sessions: (prev?.sessions ?? 0) + n(0),
      users: (prev?.users ?? 0) + n(1),
      engagedSessions: (prev?.engagedSessions ?? 0) + n(2),
      conversions: (prev?.conversions ?? 0) + n(3),
    };
    out.set(key, next);
  }
  return [...out.values()].sort((a, b) => b.sessions - a.sessions);
}
