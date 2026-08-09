import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type IngestedArticle = {
  slug: string;
  title: string;
  excerpt: string | null;
  html: string | null;
  markdown: string | null;
  cover_url: string | null;
  keywords: string[] | null;
  content_type: string | null;
  published_at: string;
};

function publicClient() {
  return createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

const COLUMNS =
  "slug,title,excerpt,html,markdown,cover_url,keywords,content_type,published_at";

export const listArticles = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await publicClient()
    .from("articles")
    .select(COLUMNS)
    .order("published_at", { ascending: false })
    .limit(200);
  return (data ?? []) as IngestedArticle[];
});

export const getArticleBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => ({ slug: String(data.slug) }))
  .handler(async ({ data }) => {
    const { data: row } = await publicClient()
      .from("articles")
      .select(COLUMNS)
      .eq("slug", data.slug)
      .maybeSingle();
    return (row ?? null) as IngestedArticle | null;
  });
