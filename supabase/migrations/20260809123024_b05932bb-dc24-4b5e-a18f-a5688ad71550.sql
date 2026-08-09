ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS publish_hour smallint NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_publish_hour_range CHECK (publish_hour >= 0 AND publish_hour <= 23);

SELECT cron.alter_job(1, schedule := '0 * * * *');