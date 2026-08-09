select cron.schedule(
  'autopilotgeo-refill-calendar',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://project--dfeac1f6-a086-4004-85f3-ea1de4cf794f.lovable.app/api/public/hooks/refill-calendar',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_B7XVvfH0XRSODCmmocwJoQ_Jd1Bzw0Q"}'::jsonb,
    body := '{"source":"cron"}'::jsonb
  );
  $$
);