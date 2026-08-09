select cron.unschedule('daily-autopilot') where exists (select 1 from cron.job where jobname='daily-autopilot');
select cron.unschedule(jobid) from cron.job where command like '%daily-autopilot%';
select cron.unschedule(jobid) from cron.job where command like '%refill-calendar%';

select cron.schedule(
  'daily-autopilot',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://project--dfeac1f6-a086-4004-85f3-ea1de4cf794f.lovable.app/api/public/hooks/daily-autopilot',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_B7XVvfH0XRSODCmmocwJoQ_Jd1Bzw0Q"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 240000
  );
  $$
);

select cron.schedule(
  'refill-calendar',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://project--dfeac1f6-a086-4004-85f3-ea1de4cf794f.lovable.app/api/public/hooks/refill-calendar',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_B7XVvfH0XRSODCmmocwJoQ_Jd1Bzw0Q"}'::jsonb,
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);