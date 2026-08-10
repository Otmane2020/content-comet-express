CREATE TABLE IF NOT EXISTS public.user_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  website_url text,
  business_name text,
  business_description text,
  industry text,
  country text,
  language text DEFAULT 'en',
  target_market text,
  tone text DEFAULT 'expert',
  competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected jsonb NOT NULL DEFAULT '{}'::jsonb,
  shopify_shop_domain text,
  shopify_shop_name text,
  shopify_installed boolean NOT NULL DEFAULT false,
  data_source text NOT NULL DEFAULT 'manual',
  current_step smallint NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_onboarding TO authenticated;
GRANT ALL ON public.user_onboarding TO service_role;

ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own onboarding" ON public.user_onboarding;
CREATE POLICY "Users manage their own onboarding"
  ON public.user_onboarding FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_user_onboarding_updated_at ON public.user_onboarding;
CREATE TRIGGER update_user_onboarding_updated_at
  BEFORE UPDATE ON public.user_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON public.subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_sub_idx ON public.subscriptions (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS subscriptions_email_idx ON public.subscriptions (lower(email));

INSERT INTO public.subscriptions (user_id, status, cycle, stripe_customer_id, stripe_subscription_id, updated_at)
SELECT 'e566ad06-b342-4211-89ff-d9c81219b1fe'::uuid, 'active', 'monthly', 'cus_V2gtyxCxC545Oh', 'sub_1U2bVzEfti9t9nN9Hu7mwtcy', now()
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = 'e566ad06-b342-4211-89ff-d9c81219b1fe')
ON CONFLICT (user_id) DO UPDATE SET
  status = EXCLUDED.status,
  cycle = EXCLUDED.cycle,
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
  updated_at = now();