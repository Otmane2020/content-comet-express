-- OAuth tokens collected during a Shopify install are retained only until the
-- merchant accepts billing.  They are server-only: no browser policy can read
-- this table, so an Admin API token never reaches the embedded app.
CREATE TABLE IF NOT EXISTS public.shopify_pending_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  blog_id TEXT NOT NULL,
  store_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_plan TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_plan IN ('monthly', 'annual')),
  status TEXT NOT NULL DEFAULT 'oauth_connected' CHECK (status IN ('oauth_connected', 'billing_pending', 'active', 'declined')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.shopify_pending_installs FROM anon, authenticated;
GRANT ALL ON TABLE public.shopify_pending_installs TO service_role;
ALTER TABLE public.shopify_pending_installs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS shopify_pending_installs_expires_at_idx
  ON public.shopify_pending_installs (expires_at);

DROP TRIGGER IF EXISTS shopify_pending_installs_updated ON public.shopify_pending_installs;
CREATE TRIGGER shopify_pending_installs_updated
  BEFORE UPDATE ON public.shopify_pending_installs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
