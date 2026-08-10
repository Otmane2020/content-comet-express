/*
# Add business_profile column to projects

1. Changes
- Adds `business_profile` jsonb column to `projects` table.
- Stores the canonical business profile built from website analysis:
  sales model, products, services, locations, audience, canonical summary.
- Used by all SEO research functions to constrain keyword suggestions
  to the business's actual products and intent.
- Backfilled automatically for existing projects on first research run.

2. Security
- No RLS changes — the column inherits the existing project ownership policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'business_profile'
  ) THEN
    ALTER TABLE projects ADD COLUMN business_profile jsonb DEFAULT NULL;
  END IF;
END $$;
