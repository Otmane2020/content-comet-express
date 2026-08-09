UPDATE public.content_items
SET cover_image_url = '/api/public/img/' || split_part(cover_image_url, '/api/public/img/', 2)
WHERE cover_image_url LIKE 'http%/api/public/img/%';

UPDATE public.content_items
SET body_md = regexp_replace(body_md, 'https?://[^)\s]+/api/public/img/', '/api/public/img/', 'g')
WHERE body_md LIKE '%/api/public/img/%';