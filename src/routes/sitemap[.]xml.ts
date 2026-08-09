import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { BLOG_POSTS } from "@/lib/blog";

const SITE = "https://autopilotgeo.com";
const STATIC = ["/", "/blog", "/about", "/privacy", "/terms"];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls: { loc: string; lastmod?: string }[] = STATIC.map((p) => ({
          loc: `${SITE}${p}`,
        }));

        for (const post of BLOG_POSTS) {
          urls.push({ loc: `${SITE}/blog/${post.slug}`, lastmod: post.publishedAt });
        }

        try {
          const supabase = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_PUBLISHABLE_KEY"]!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );
          const { data } = await supabase
            .from("articles")
            .select("slug,published_at")
            .order("published_at", { ascending: false })
            .limit(5000);
          for (const row of data ?? []) {
            urls.push({
              loc: `${SITE}/blog/${row.slug}`,
              lastmod: new Date(row.published_at).toISOString().slice(0, 10),
            });
          }
        } catch {
          // sitemap still serves the static entries
        }

        const seen = new Set<string>();
        const body = urls
          .filter((u) => (seen.has(u.loc) ? false : (seen.add(u.loc), true)))
          .map(
            (u) =>
              `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
          )
          .join("\n");

        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
          { headers: { "content-type": "application/xml; charset=utf-8" } },
        );
      },
    },
  },
});
