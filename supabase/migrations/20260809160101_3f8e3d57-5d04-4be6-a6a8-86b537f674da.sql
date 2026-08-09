UPDATE public.integrations
SET config = jsonb_set(config::jsonb, '{endpoint}', to_jsonb(replace(replace(config->>'endpoint', 'https://autopilotgeo.com', 'https://www.ranki.ai'), 'https://www.autopilotgeo.com', 'https://www.ranki.ai'))),
    last_error = NULL
WHERE config->>'endpoint' ILIKE '%autopilotgeo.com%';