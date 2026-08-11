import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Input = { website: string; locale?: string; seeds?: string[] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const excluded = /(^|\.)(google|facebook|instagram|pinterest|youtube|linkedin|wikipedia)\./i;
const englishInFrench = /\b(and|with|for|the|best|cheap|sofa|sofas|chair|chairs|furniture|table set)\b/i;

function domainOf(website: string) {
  const value = website.trim().match(/^https?:\/\//i) ? website.trim() : `https://${website.trim()}`;
  const host = new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  if (!host.includes(".")) throw new Error("A valid website domain is required.");
  return host;
}

function localeFor(domain: string, supplied?: string) {
  const byTld: Record<string, string> = { fr: "fr", es: "es", de: "de", it: "it", nl: "nl", pt: "pt" };
  const tld = domain.split(".").at(-1) ?? "";
  return byTld[tld] ?? supplied?.slice(0, 2).toLowerCase() ?? "en";
}

function marketFor(locale: string) {
  const markets: Record<string, string> = { fr: "France", es: "Spain", de: "Germany", it: "Italy", nl: "Netherlands", pt: "Portugal", en: "United States" };
  return markets[locale] ?? "United States";
}

async function dataForSeo(path: string, body: Record<string, unknown>) {
  const login = Deno.env.get("DATAFORSEO_LOGIN");
  const password = Deno.env.get("DATAFORSEO_PASSWORD");
  if (!login || !password) throw new Error("DataForSEO secrets are not configured in Supabase.");
  const response = await fetch(`https://api.dataforseo.com/v3${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify([body]),
  });
  const payload = await response.json();
  const task = payload?.tasks?.[0];
  if (!response.ok || payload?.status_code >= 40000 || task?.status_code >= 40000) {
    throw new Error(task?.status_message ?? payload?.status_message ?? "DataForSEO request failed.");
  }
  return task?.result?.[0]?.items ?? [];
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const auth = request.headers.get("Authorization");
    if (!auth) return json({ error: "Authentication required" }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authError } = await userClient.auth.getUser();
    if (authError || !claims.user) return json({ error: "Authentication required" }, 401);

    const input = await request.json() as Input;
    const domain = domainOf(input.website);
    const locale = localeFor(domain, input.locale);
    const market = marketFor(locale);
    const common = { location_name: market, language_code: locale };
    const [rawCompetitors, rawKeywords] = await Promise.all([
      dataForSeo("/dataforseo_labs/google/competitors_domain/live", { target: domain, ...common, limit: 20, exclude_top_domains: true, order_by: ["intersections,desc"] }),
      dataForSeo("/dataforseo_labs/google/keywords_for_site/live", { target: domain, ...common, limit: 50, include_serp_info: false, order_by: ["relevance,desc"] }),
    ]);
    const competitors = rawCompetitors
      .map((item: any) => ({ domain: String(item.domain ?? "").toLowerCase(), intersections: Number(item.intersections ?? 0), traffic: Number(item.full_domain_metrics?.organic?.etv ?? 0) }))
      .filter((item: { domain: string }) => item.domain && item.domain !== domain && !excluded.test(item.domain))
      .sort((a: { intersections: number; traffic: number }, b: { intersections: number; traffic: number }) => b.intersections - a.intersections || b.traffic - a.traffic)
      .slice(0, 8);
    const keywords = rawKeywords
      .map((item: any) => ({ keyword: String(item.keyword ?? "").trim(), volume: item.keyword_info?.search_volume ?? null, difficulty: item.keyword_properties?.keyword_difficulty ?? null }))
      .filter((item: { keyword: string }) => item.keyword && (locale !== "fr" || !englishInFrench.test(item.keyword)))
      .slice(0, 30);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey);
      await admin.from("market_scan_runs").insert({ user_id: claims.user.id, website_url: input.website, locale, competitors_count: competitors.length, keywords_count: keywords.length, diagnostics: { domain, market, source: "dataforseo_labs" } });
    }
    return json({ source: "dataforseo", locale, market, competitors, keywords, diagnostics: { domain, rawCompetitors: rawCompetitors.length, rawKeywords: rawKeywords.length } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Market scan failed" }, 400);
  }
});
