DELETE FROM public.keyword_research
WHERE used = false
  AND (relevance_score IS NULL OR relevance_score < 60);