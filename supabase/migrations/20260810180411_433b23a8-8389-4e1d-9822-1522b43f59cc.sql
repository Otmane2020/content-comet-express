-- Structured FAQ pairs generated alongside aeo/local_aeo articles, kept
-- separate from body_md so we can render matching FAQPage JSON-LD without
-- fragile markdown parsing.
ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS faq jsonb;
