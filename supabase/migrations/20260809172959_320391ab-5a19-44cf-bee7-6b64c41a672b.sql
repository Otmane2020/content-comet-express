ALTER TABLE public.keyword_research
  ADD COLUMN IF NOT EXISTS relevance_score NUMERIC,
  ADD COLUMN IF NOT EXISTS origin TEXT;

DELETE FROM public.keyword_research a
USING public.keyword_research b
WHERE a.project_id = b.project_id
  AND lower(a.keyword) = lower(b.keyword)
  AND a.ctid > b.ctid;

ALTER TABLE public.keyword_research
  ADD CONSTRAINT keyword_research_project_keyword_unique UNIQUE (project_id, keyword);

CREATE INDEX IF NOT EXISTS keyword_research_relevance_idx
  ON public.keyword_research(project_id, relevance_score DESC NULLS LAST);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS target_country TEXT;