CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL UNIQUE,
  excerpt text,
  markdown text,
  html text,
  cover_url text,
  keywords text[] DEFAULT '{}',
  content_type text,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.articles TO anon, authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Articles are public" ON public.articles FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX articles_published_at_idx ON public.articles (published_at DESC);