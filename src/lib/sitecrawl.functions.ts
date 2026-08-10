import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const projectInput = z.object({ projectId: z.string().uuid() });

// site_pages is a genuinely new table (SQL migration only, generated Supabase
// types not regenerated yet) — same loose-client escape hatch used elsewhere
// in this codebase (rotation.server.ts's Sb, publish.server.ts's AnyClient).
type AnyClient = { from: (table: string) => any };
type SitePagesRow = {
  url: string;
  title: string | null;
  description: string | null;
  images: string[];
  crawled_at: string;
};

/** Crawls the project's website and refreshes its stored page inventory. */
export const syncSiteKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => projectInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const sb = supabase as unknown as AnyClient;
    const { data: project, error } = await supabase
      .from("projects")
      .select("website_url")
      .eq("id", data.projectId)
      .single();
    if (error || !project) throw new Error("Project not found");
    if (!project.website_url) throw new Error("Add your website URL in Settings first.");

    const { crawlSite } = await import("./sitecrawl.server");
    const pages = await crawlSite(project.website_url, 40);
    if (!pages.length) throw new Error("Could not read any page on that site.");

    const rows = pages.map((p) => ({
      user_id: userId,
      project_id: data.projectId,
      url: p.url,
      title: p.title,
      description: p.description,
      headings: p.headings,
      text_excerpt: p.textExcerpt,
      images: p.images,
      crawled_at: new Date().toISOString(),
    }));

    await sb.from("site_pages").delete().eq("project_id", data.projectId);
    const { error: insertError } = await sb.from("site_pages").insert(rows);
    if (insertError) throw new Error(insertError.message);

    return { pages: pages.length };
  });

/** Summary counters for the "Website data" card — never the raw crawl detail. */
export const getSiteKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => projectInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const sb = supabase as unknown as AnyClient;
    const { internalLinkTargets } = await import("./netlinking.server");

    const [{ data: pages }, { data: shopifyRow }, links] = await Promise.all([
      sb
        .from("site_pages")
        .select("images, crawled_at")
        .eq("project_id", data.projectId) as Promise<{
        data: Pick<SitePagesRow, "images" | "crawled_at">[] | null;
      }>,
      supabase
        .from("integrations")
        .select("platform, config")
        .eq("project_id", data.projectId)
        .eq("status", "connected"),
      internalLinkTargets(supabase, data.projectId),
    ]);

    const imageCount = (pages ?? []).reduce((sum, p) => sum + (p.images?.length ?? 0), 0);
    const lastScan = (pages ?? []).reduce<string | null>(
      (latest, p) => (!latest || (p.crawled_at ?? "") > latest ? (p.crawled_at ?? latest) : latest),
      null,
    );

    let productCount = 0;
    const shopify = (shopifyRow ?? []).find((r) => r.platform === "shopify");
    const shopifyConfig = shopify?.config as { products_count?: number } | null;
    if (typeof shopifyConfig?.products_count === "number") {
      productCount = shopifyConfig.products_count;
    } else {
      const { fetchCatalog, CATALOG_PLATFORMS } = await import("./catalog.server");
      const catalogRows = (shopifyRow ?? []).filter((r) =>
        (CATALOG_PLATFORMS as readonly string[]).includes(r.platform),
      );
      if (catalogRows.length) {
        productCount = (await fetchCatalog(catalogRows as never)).length;
      }
    }

    return {
      pageCount: pages?.length ?? 0,
      productCount,
      imageCount,
      linkCount: links.length,
      lastScan,
    };
  });

const importedDataInput = z.object({
  projectId: z.string().uuid(),
  type: z.enum(["pages", "products", "images"]),
  search: z.string().max(120).optional(),
});

type ImportedRow = { title: string; subtitle: string; url: string; status: "Imported" };

/** Powers the "View imported data" browser — read-only, paginated to 100 rows. */
export const getImportedData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => importedDataInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ rows: ImportedRow[] }> => {
    const { supabase } = context;
    const sb = supabase as unknown as AnyClient;
    const q = data.search?.trim().toLowerCase() ?? "";

    if (data.type === "pages") {
      let query = sb
        .from("site_pages")
        .select("url, title, description, crawled_at")
        .eq("project_id", data.projectId)
        .order("crawled_at", { ascending: false })
        .limit(100);
      if (q) query = query.ilike("title", `%${data.search}%`);
      const { data: rows } = (await query) as { data: SitePagesRow[] | null };
      return {
        rows: (rows ?? []).map((r) => ({
          title: r.title ?? r.url,
          subtitle: r.description ?? "",
          url: r.url,
          status: "Imported",
        })),
      };
    }

    if (data.type === "images") {
      const { data: rows } = (await sb
        .from("site_pages")
        .select("url, title, images")
        .eq("project_id", data.projectId)
        .limit(100)) as { data: SitePagesRow[] | null };
      const images = (rows ?? [])
        .flatMap((r) => (r.images ?? []).map((src) => ({ src, page: r.title ?? r.url })))
        .filter(
          (img) => !q || img.src.toLowerCase().includes(q) || img.page.toLowerCase().includes(q),
        )
        .slice(0, 150);
      return {
        rows: images.map((img) => ({
          title: img.page,
          subtitle: img.src,
          url: img.src,
          status: "Imported",
        })),
      };
    }

    // products
    const { data: shopifyRow } = await supabase
      .from("integrations")
      .select("platform, config")
      .eq("project_id", data.projectId)
      .eq("status", "connected");
    const shopify = (shopifyRow ?? []).find((r) => r.platform === "shopify");
    const shopifyConfig = shopify?.config as {
      products_sample?: { title?: string; url?: string; price?: string | null }[];
    } | null;

    let products: ImportedRow[] = (shopifyConfig?.products_sample ?? []).map((p) => ({
      title: p.title ?? "Untitled product",
      subtitle: p.price ? `${p.price}` : "",
      url: p.url ?? "",
      status: "Imported",
    }));

    if (!products.length) {
      const { fetchCatalog, CATALOG_PLATFORMS } = await import("./catalog.server");
      const catalogRows = (shopifyRow ?? []).filter((r) =>
        (CATALOG_PLATFORMS as readonly string[]).includes(r.platform),
      );
      if (catalogRows.length) {
        const live = await fetchCatalog(catalogRows as never);
        products = live.map((p) => ({
          title: p.title,
          subtitle: p.price ?? "",
          url: p.url ?? "",
          status: "Imported",
        }));
      }
    }

    if (q) products = products.filter((p) => p.title.toLowerCase().includes(q));
    return { rows: products.slice(0, 100) };
  });
