CREATE TABLE public.keyword_research (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  search_volume INTEGER,
  cpc NUMERIC,
  competition NUMERIC,
  difficulty INTEGER,
  intent TEXT,
  source TEXT NOT NULL DEFAULT 'dataforseo',
  competitor_domain TEXT,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX keyword_research_project_idx ON public.keyword_research(project_id, search_volume DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.keyword_research TO authenticated;
GRANT ALL ON public.keyword_research TO service_role;
ALTER TABLE public.keyword_research ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own keyword rows" ON public.keyword_research FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.competitors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, domain)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitors TO authenticated;
GRANT ALL ON public.competitors TO service_role;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own competitor rows" ON public.competitors FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);