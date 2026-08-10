-- Store the real SERP evidence (title/snippet/appearances/best position)
-- behind each competitor domain discovered from live Google SERP data.
ALTER TABLE public.competitors
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS snippet TEXT,
  ADD COLUMN IF NOT EXISTS appearances INTEGER,
  ADD COLUMN IF NOT EXISTS best_position INTEGER;

-- Columns inherit the table's existing GRANTs and RLS policies (no new
-- policy needed: "own competitor rows" already covers all columns).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitors TO authenticated;
GRANT ALL ON public.competitors TO service_role;
