DELETE FROM public.keyword_research kr
USING public.competitors c
WHERE kr.competitor_domain IS NOT NULL
  AND lower(regexp_replace(kr.competitor_domain, '^www\.', '')) = ANY (ARRAY['youtube.com','google.com','facebook.com','instagram.com','x.com','twitter.com','linkedin.com','reddit.com','pinterest.com','tiktok.com','quora.com','medium.com','wikipedia.org','amazon.com','ebay.com','etsy.com','apple.com','microsoft.com','github.com','stackoverflow.com','substack.com','wordpress.com','wix.com','shopify.com','notion.so','canva.com','hubspot.com','g2.com','capterra.com','trustpilot.com','producthunt.com','crunchbase.com','glassdoor.com','indeed.com','yelp.com','tripadvisor.com','booking.com','forbes.com','nytimes.com','bbc.com','openai.com','gartner.com','getapp.com','softwareadvice.com','slideshare.net'])
  AND c.project_id = kr.project_id;

DELETE FROM public.keyword_research
WHERE competitor_domain IS NOT NULL
  AND lower(regexp_replace(competitor_domain, '^www\.', '')) = ANY (ARRAY['youtube.com','google.com','facebook.com','instagram.com','x.com','twitter.com','linkedin.com','reddit.com','pinterest.com','tiktok.com','quora.com','medium.com','wikipedia.org','amazon.com','ebay.com','etsy.com','apple.com','microsoft.com','github.com','stackoverflow.com','substack.com','wordpress.com','wix.com','shopify.com','notion.so','canva.com','hubspot.com','g2.com','capterra.com','trustpilot.com','producthunt.com','crunchbase.com','glassdoor.com','indeed.com','yelp.com','tripadvisor.com','booking.com','forbes.com','nytimes.com','bbc.com','openai.com','gartner.com','getapp.com','softwareadvice.com','slideshare.net']);

DELETE FROM public.competitors
WHERE lower(regexp_replace(domain, '^www\.', '')) = ANY (ARRAY['youtube.com','google.com','facebook.com','instagram.com','x.com','twitter.com','linkedin.com','reddit.com','pinterest.com','tiktok.com','quora.com','medium.com','wikipedia.org','amazon.com','ebay.com','etsy.com','apple.com','microsoft.com','github.com','stackoverflow.com','substack.com','wordpress.com','wix.com','shopify.com','notion.so','canva.com','hubspot.com','g2.com','capterra.com','trustpilot.com','producthunt.com','crunchbase.com','glassdoor.com','indeed.com','yelp.com','tripadvisor.com','booking.com','forbes.com','nytimes.com','bbc.com','openai.com','gartner.com','getapp.com','softwareadvice.com','slideshare.net']);

DELETE FROM public.competitors c
USING public.projects p
WHERE c.project_id = p.id
  AND p.website_url IS NOT NULL
  AND lower(regexp_replace(c.domain, '^www\.', '')) = lower(regexp_replace(regexp_replace(regexp_replace(p.website_url, '^https?://', ''), '/.*$', ''), '^www\.', ''));