ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS target_keyword text;
CREATE INDEX IF NOT EXISTS content_items_target_keyword_idx ON public.content_items (project_id, target_keyword);