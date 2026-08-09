ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
DROP POLICY IF EXISTS "Users read own article images" ON storage.objects;
CREATE POLICY "Users read own article images" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'article-images' AND (storage.foldername(name))[1] = auth.uid()::text);