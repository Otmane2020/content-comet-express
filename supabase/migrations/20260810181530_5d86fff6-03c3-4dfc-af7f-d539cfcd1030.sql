-- Per-page signal captured by the internal site crawler (sitemap-first, falls
-- back to following homepage links): powers the "Website data" summary,
-- the imported-data browser, and gives every platform (not just Shopify)
-- real internal-link candidates for generated articles.
CREATE TABLE public.site_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  headings TEXT[] NOT NULL DEFAULT '{}',
  text_excerpt TEXT,
  images TEXT[] NOT NULL DEFAULT '{}',
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_pages TO authenticated;
GRANT ALL ON public.site_pages TO service_role;
ALTER TABLE public.site_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own site pages" ON public.site_pages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX site_pages_project_idx ON public.site_pages (project_id);
