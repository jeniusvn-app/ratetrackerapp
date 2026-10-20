/*
# Storage policies for pickup-reports bucket

1. Purpose
- Allow the anon-key frontend to upload, read, and list Excel/CSV files
  in the 'pickup-reports' bucket. This app uses custom auth (app_users),
  not Supabase Auth, so the frontend always operates as the anon role.

2. Policies
- SELECT (read/list): allow anon + authenticated
- INSERT (upload): allow anon + authenticated
- UPDATE: allow anon + authenticated
- DELETE: allow anon + authenticated

3. Notes
- The bucket itself is public (files readable via public URL).
- File size limit 10MB, MIME types restricted to Excel/CSV.
*/

DROP POLICY IF EXISTS "anon_sel_pickup_reports" ON storage.objects;
CREATE POLICY "anon_sel_pickup_reports" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'pickup-reports');

DROP POLICY IF EXISTS "anon_ins_pickup_reports" ON storage.objects;
CREATE POLICY "anon_ins_pickup_reports" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'pickup-reports');

DROP POLICY IF EXISTS "anon_upd_pickup_reports" ON storage.objects;
CREATE POLICY "anon_upd_pickup_reports" ON storage.objects
  FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'pickup-reports')
  WITH CHECK (bucket_id = 'pickup-reports');

DROP POLICY IF EXISTS "anon_del_pickup_reports" ON storage.objects;
CREATE POLICY "anon_del_pickup_reports" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'pickup-reports');