ALTER TABLE public.google_connections DROP CONSTRAINT IF EXISTS google_connections_service_check;
ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_service_check CHECK (service IN ('gmb','gsc','ga4'));

CREATE TABLE public.ai_traffic (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assistant TEXT NOT NULL,
  source TEXT NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0,
  engaged_sessions INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, source)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_traffic TO authenticated;
GRANT ALL ON public.ai_traffic TO service_role;
ALTER TABLE public.ai_traffic ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ai traffic" ON public.ai_traffic FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert own ai traffic" ON public.ai_traffic FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own ai traffic" ON public.ai_traffic FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own ai traffic" ON public.ai_traffic FOR DELETE TO authenticated USING (auth.uid() = user_id);