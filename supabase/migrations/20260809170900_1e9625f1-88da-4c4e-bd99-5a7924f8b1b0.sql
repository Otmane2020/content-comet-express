CREATE TABLE IF NOT EXISTS public.ai_mentions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mentioned BOOLEAN NOT NULL DEFAULT false,
  rank INTEGER,
  brands TEXT[] NOT NULL DEFAULT '{}',
  answer TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_mentions_unique ON public.ai_mentions (project_id, engine, prompt);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_mentions TO authenticated;
GRANT ALL ON public.ai_mentions TO service_role;
ALTER TABLE public.ai_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own AI mentions" ON public.ai_mentions;
CREATE POLICY "Users manage their own AI mentions" ON public.ai_mentions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);