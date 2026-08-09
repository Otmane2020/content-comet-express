UPDATE public.content_items
SET body_md = regexp_replace(regexp_replace(body_md, '(?m)^!\[[^\]]*\]\([^\s)]+\)\s*$', '', 'g'), '\n{3,}', E'\n\n', 'g')
WHERE body_md ~ '(?m)^!\[[^\]]*\]\([^\s)]+\)\s*$';