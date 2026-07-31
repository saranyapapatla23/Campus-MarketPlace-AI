-- 006: Storage bucket for product images.
--
-- The Sell Product page was never actually uploading to Supabase Storage -
-- it read files as base64 data URLs with FileReader and stored those
-- strings directly in products.images (a text[] column). That works for a
-- demo with one tiny image, but breaks down for real use: every product
-- row balloons by ~33% over the original file size per image, there's no
-- CDN caching, and the Postgres/PostgREST request size limits get hit fast
-- with multiple photos. This creates a real bucket with sane RLS so the
-- client can upload real files and store lightweight public URLs instead.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880, -- 5MB per file (client also compresses before upload)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Public read - product photos need to be visible to every visitor,
-- signed-in or not, same as the products table's own public select policy.
CREATE POLICY "product_images_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'product-images');

-- Authenticated users may only upload into a folder prefixed with their
-- own user id (e.g. "<user_id>/<filename>.jpg"), preventing one user from
-- writing into another user's path.
CREATE POLICY "product_images_own_folder_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'product-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "product_images_own_folder_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "product_images_own_folder_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'product-images' AND (storage.foldername(name))[1] = auth.uid()::text);
