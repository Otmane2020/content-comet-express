import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Real internal-link targets offered to the writer so generated articles can
 * link to the merchant's own pages instead of only suggesting links in prose.
 */
export type LinkTarget = { title: string; url: string };

type ShopifyConfig = { collections?: unknown; pages?: unknown; products_sample?: unknown } | null;

/**
 * Shopify collections + pages + product pages captured at install/refresh
 * (buildShopifyConfig — products_sample is up to 10 products with title/url,
 * refreshed on every paid billing return). Product pages used to be entirely
 * absent from this list: every article, on every content type, could only
 * ever link to a collection or a static page, never to the actual product a
 * buyer question was about. Reads the already-cached config — no extra API
 * call, no added cost.
 */
export function shopifyLinkTargets(config: ShopifyConfig): LinkTarget[] {
  if (!config) return [];
  const fromRows = (rows: unknown) =>
    (Array.isArray(rows) ? rows : [])
      .map((r) => r as { title?: unknown; url?: unknown })
      .filter(
        (r): r is { title: string; url: string } =>
          typeof r.title === "string" && typeof r.url === "string" && !!r.title && !!r.url,
      )
      .map((r) => ({ title: r.title, url: r.url }));
  return [...fromRows(config.collections), ...fromRows(config.pages), ...fromRows(config.products_sample)];
}

/** Already-published articles of the same project, for article-to-article linking. */
export function publishedArticleLinkTargets(
  items: { title: string | null; published_url: string | null }[],
): LinkTarget[] {
  return items
    .filter((i): i is { title: string; published_url: string } =>
      Boolean(i.title && i.published_url),
    )
    .map((i) => ({ title: i.title, url: i.published_url }));
}

export function dedupeLinkTargets(targets: LinkTarget[], limit = 12): LinkTarget[] {
  const seen = new Set<string>();
  const out: LinkTarget[] = [];
  for (const t of targets) {
    const key = t.url.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The connected Shopify store's own collections/pages plus this project's
 * already-published articles, ready to hand to writeArticle's `links` extra.
 */
/** site_pages is migration-only (not in the generated Supabase types yet) — same loose-client cast used elsewhere. */
type AnyClient = { from: (table: string) => any };

export async function internalLinkTargets(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<LinkTarget[]> {
  const sb = supabase as unknown as AnyClient;
  // The item currently being generated is never in this set: it can't be
  // "published" yet while it's still being written.
  const [{ data: stores }, { data: published }, { data: crawled }] = await Promise.all([
    supabase
      .from("integrations")
      .select("config")
      .eq("project_id", projectId)
      .eq("platform", "shopify"),
    supabase
      .from("content_items")
      .select("title, published_url")
      .eq("project_id", projectId)
      .eq("status", "published")
      .not("published_url", "is", null)
      .limit(20),
    sb.from("site_pages").select("title, url").eq("project_id", projectId).limit(40) as Promise<{
      data: { title: string | null; url: string }[] | null;
    }>,
  ]);
  return dedupeLinkTargets([
    ...(stores ?? []).flatMap((r) => shopifyLinkTargets(r.config as never)),
    ...publishedArticleLinkTargets((published ?? []) as never),
    ...(crawled ?? [])
      .filter((p): p is { title: string; url: string } => Boolean(p.title))
      .map((p) => ({ title: p.title, url: p.url })),
  ]);
}
