/*
# Create menu-images storage bucket

Creates a public storage bucket for menu item images so the Manager can upload
product photos and the Cashier can display them.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "anon_upload_menu_images" ON storage.objects;
CREATE POLICY "anon_upload_menu_images" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "anon_read_menu_images" ON storage.objects;
CREATE POLICY "anon_read_menu_images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "anon_update_menu_images" ON storage.objects;
CREATE POLICY "anon_update_menu_images" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'menu-images') WITH CHECK (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "anon_delete_menu_images" ON storage.objects;
CREATE POLICY "anon_delete_menu_images" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'menu-images');
