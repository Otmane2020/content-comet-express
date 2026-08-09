CREATE POLICY "insert own search metrics" ON public.search_metrics FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own search metrics" ON public.search_metrics FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_metrics TO authenticated;
GRANT ALL ON public.search_metrics TO service_role;