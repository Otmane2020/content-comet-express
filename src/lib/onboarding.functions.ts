import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const draftSchema = z.object({
  website_url: z.string().max(300).optional(),
  business_name: z.string().max(200).optional(),
  business_description: z.string().max(4000).optional(),
  industry: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  language: z.string().max(20).optional(),
  target_market: z.string().max(400).optional(),
  tone: z.string().max(40).optional(),
  competitors: z.array(z.string().max(200)).max(50).optional(),
  keywords: z.array(z.string().max(200)).max(200).optional(),
  detected: z.record(z.string(), z.unknown()).optional(),
  data_source: z.string().max(40).optional(),
  current_step: z.number().int().min(0).max(5).optional(),
});

/** Server-side onboarding state so a run can be interrupted and resumed. */
export const getOnboarding = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_onboarding")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) console.error(`[onboarding] read failed: ${error.message}`);

    // A project already exists ⇒ onboarding is effectively done, even for
    // accounts created before this table existed.
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    return {
      draft: data ?? null,
      completed: Boolean(data?.completed) || Boolean(project?.id),
      projectId: (data?.project_id as string | null) ?? project?.id ?? null,
    };
  });

export const saveOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    const { error } = await supabase
      .from("user_onboarding")
      .upsert({ user_id: userId, ...clean }, { onConflict: "user_id" });
    if (error) {
      console.error(`[onboarding] save failed: ${error.message}`);
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_onboarding").upsert(
      {
        user_id: userId,
        project_id: data.projectId,
        completed: true,
        completed_at: new Date().toISOString(),
        current_step: 3,
      },
      { onConflict: "user_id" },
    );
    if (error) console.error(`[onboarding] complete failed: ${error.message}`);
    return { ok: true };
  });

/**
 * Persist the onboarding market scan (step 2) into the same `competitors` and
 * `keyword_research` tables the app's Research dashboard reads. Without this,
 * the DataForSEO data shown during onboarding was discarded — the dashboard
 * opened empty and silently re-ran (and re-billed) the exact same scan, which
 * also wiped out onboarding-picked competitors because they carried no
 * `last_checked_at` and looked stale to the cache guard.
 */
export const saveMarketResearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        competitors: z.array(z.string().max(200)).max(50),
        keywords: z
          .array(
            z.object({
              keyword: z.string().min(1).max(120),
              volume: z.number().nullable().optional(),
              difficulty: z.number().nullable().optional(),
            }),
          )
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.competitors.length) {
      const { error } = await supabase.from("competitors").upsert(
        data.competitors.map((domain) => ({
          user_id: userId,
          project_id: data.projectId,
          domain,
          last_checked_at: new Date().toISOString(),
        })),
        { onConflict: "project_id,domain" },
      );
      if (error) console.error(`[onboarding] competitor save failed: ${error.message}`);
    }

    if (data.keywords.length) {
      // These rows have already passed the canonical-profile relevance gate in
      // runLiveMarketResearch. Persist that verdict verbatim: rescoring with a
      // partial onboarding draft is how qualified B2B terms were discarded
      // before the calendar and article generator could consume them.
      const { error } = await supabase.from("keyword_research").upsert(
        data.keywords.map((keyword) => ({
          user_id: userId,
          project_id: data.projectId,
          keyword: keyword.keyword,
          search_volume: keyword.volume ?? null,
          difficulty: keyword.difficulty ?? null,
          cpc: null,
          competition: null,
          intent: null,
          origin: "seed",
          relevance_score: 100,
          used: false,
        })),
        { onConflict: "project_id,keyword" },
      );
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * If the account arrived through the Shopify app install, reuse everything the
 * store already told us instead of asking the merchant to retype it.
 */
export const getShopifyPrefill = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("integrations")
      .select("config")
      .eq("user_id", userId)
      .eq("platform", "shopify")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) console.error(`[onboarding] shopify prefill read failed: ${error.message}`);
    const cfg = (data?.config ?? null) as Record<string, any> | null;
    if (!cfg || !cfg["shop"]) return { connected: false as const };

    // The Shopify sync stores the sample under `products_sample` (top 10) plus
    // the real totals under `products_count`/`product_types` — reading a
    // nonexistent `products` key silently produced 0 products every time.
    const productsSample = Array.isArray(cfg["products_sample"]) ? cfg["products_sample"] : [];
    const collections = Array.isArray(cfg["collections"]) ? cfg["collections"] : [];
    const pages = Array.isArray(cfg["pages"]) ? cfg["pages"] : [];
    const productTypes = Array.isArray(cfg["product_types"]) ? cfg["product_types"] : [];
    const types = productTypes.length
      ? productTypes.slice(0, 5)
      : [...new Set(productsSample.map((p: any) => p?.productType).filter(Boolean))].slice(0, 5);

    return {
      connected: true as const,
      shop: String(cfg["shop"]),
      business_name: (cfg["shop_name"] ?? cfg["name"] ?? null) as string | null,
      website_url: (cfg["primary_domain"] ?? cfg["shop"] ?? null) as string | null,
      business_description: (cfg["description"] ?? null) as string | null,
      industry: (types[0] ?? null) as string | null,
      country: (cfg["country"] ?? cfg["country_code"] ?? null) as string | null,
      language: ((cfg["locale"] as string | undefined)?.slice(0, 2) ?? null) as string | null,
      productCount: (typeof cfg["products_count"] === "number" ? cfg["products_count"] : productsSample.length) as number,
      blogConnected: Boolean(cfg["blog_id"]),
      collectionTitles: collections.map((c: any) => c?.title).filter(Boolean).slice(0, 10) as string[],
      products: productsSample
        .slice(0, 6)
        .map((p: Record<string, unknown>) => ({
          title: (p?.["title"] ?? null) as string | null,
          url: (p?.["url"] ?? null) as string | null,
          image: (Array.isArray(p?.["images"]) ? (p["images"] as unknown[])[0] : null) as string | null,
        }))
        .filter((p) => p.title),
      pages: pages
        .map((p: Record<string, unknown>) => ({ title: (p?.["title"] ?? null) as string | null, url: (p?.["url"] ?? null) as string | null }))
        .filter((p) => p.title)
        .slice(0, 8),
    };
  });
