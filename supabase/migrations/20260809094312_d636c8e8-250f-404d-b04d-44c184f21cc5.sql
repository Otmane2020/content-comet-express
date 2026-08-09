CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  website_url TEXT,
  industry TEXT,
  audience TEXT,
  tone TEXT DEFAULT 'expert',
  locale TEXT DEFAULT 'fr',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects" ON public.projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'connected',
  auto_publish BOOLEAN NOT NULL DEFAULT true,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
GRANT ALL ON public.integrations TO service_role;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own integrations" ON public.integrations FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.content_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  content_type TEXT NOT NULL,
  topic TEXT,
  title TEXT,
  slug TEXT,
  excerpt TEXT,
  body_md TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  published_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, scheduled_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO authenticated;
GRANT ALL ON public.content_items TO service_role;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own content" ON public.content_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.publish_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  content_item_id UUID NOT NULL REFERENCES public.content_items ON DELETE CASCADE,
  integration_id UUID REFERENCES public.integrations ON DELETE SET NULL,
  platform TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  message TEXT,
  remote_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publish_logs TO authenticated;
GRANT ALL ON public.publish_logs TO service_role;
ALTER TABLE public.publish_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logs" ON public.publish_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER integrations_updated BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER content_updated BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX content_items_project_date_idx ON public.content_items (project_id, scheduled_date);