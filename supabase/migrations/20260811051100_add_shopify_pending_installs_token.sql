-- A merchant installing from Shopify lands on our own /shopify/setup page
-- before we create their account (standalone flow) — that page is public
-- (no session yet) and needs an unguessable lookup key, since the shop
-- domain alone is visible in the URL/referrer and shouldn't double as one.
ALTER TABLE public.shopify_pending_installs
  ADD COLUMN IF NOT EXISTS pending_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_claimed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS shopify_pending_installs_pending_token_idx
  ON public.shopify_pending_installs (pending_token);
