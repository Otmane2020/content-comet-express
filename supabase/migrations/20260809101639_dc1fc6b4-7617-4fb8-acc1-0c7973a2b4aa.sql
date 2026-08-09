CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.google_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('gmb','gsc')),
  account_email TEXT,
  resource_id TEXT,
  resource_name TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  last_error TEXT,
  auto_publish BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, service)
);
GRANT SELECT, UPDATE, DELETE ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own google connections" ON public.google_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "update own google connections" ON public.google_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own google connections" ON public.google_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.google_tokens (
  connection_id UUID PRIMARY KEY REFERENCES public.google_connections(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  scope TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.google_tokens TO service_role;
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.search_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('query','page','date','location')),
  label TEXT NOT NULL,
  clicks NUMERIC NOT NULL DEFAULT 0,
  impressions NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  position NUMERIC,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, dimension, label)
);
GRANT SELECT, DELETE ON public.search_metrics TO authenticated;
GRANT ALL ON public.search_metrics TO service_role;
ALTER TABLE public.search_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own search metrics" ON public.search_metrics FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "delete own search metrics" ON public.search_metrics FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER google_connections_updated_at BEFORE UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();