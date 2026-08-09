UPDATE public.projects
SET industry = 'SEO & GEO software',
    audience = 'E-commerce stores, local businesses, SaaS companies and agencies that want to rank on Google and be recommended by AI assistants',
    keywords = ARRAY['GEO tools','AI search optimization','AI visibility tracking','brand mentions in ChatGPT','SEO content automation','answer engine optimization','automated content publishing','local AEO']
WHERE website_url ILIKE '%ranki.ai%';