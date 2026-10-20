/*
# PU Report — pickup tables + can_access_pu_report flag

1. New Tables
- `pickup_import_logs` (audit trail for pickup report imports):
  - id (uuid PK), user_id (FK->app_users ON DELETE SET NULL),
    user_email, file_name, total_rows, imported_at
- `pickup_records` (raw reservation rows — APPEND ONLY):
  - id (uuid PK), import_id (FK->pickup_import_logs ON DELETE CASCADE),
    booking_id, source, arrival_date, departure_date, room_type,
    room_rate, nights, room_revenue, status, booked_datetime, created_at

2. Modified Tables
- `app_users`: add `can_access_pu_report` boolean NOT NULL DEFAULT false.
  Controls whether a non-admin user sees the PU Report page. Admins always
  have access (enforced in the app layer).

3. Security
- RLS enabled on both new tables. Policies TO anon, authenticated matching
  existing tables. Visibility enforced in app layer.

4. Notes
- Append-only logic enforced in application: every import inserts new rows.
- Indexes on arrival_date, import_id, created_at DESC, imported_at DESC.
*/

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS can_access_pu_report boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS pickup_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  user_email text,
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pickup_import_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_sel_pickup_import_logs" ON pickup_import_logs;
CREATE POLICY "anon_sel_pickup_import_logs" ON pickup_import_logs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_ins_pickup_import_logs" ON pickup_import_logs;
CREATE POLICY "anon_ins_pickup_import_logs" ON pickup_import_logs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_upd_pickup_import_logs" ON pickup_import_logs;
CREATE POLICY "anon_upd_pickup_import_logs" ON pickup_import_logs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_del_pickup_import_logs" ON pickup_import_logs;
CREATE POLICY "anon_del_pickup_import_logs" ON pickup_import_logs FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS pickup_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES pickup_import_logs(id) ON DELETE CASCADE,
  booking_id text,
  source text,
  arrival_date date,
  departure_date date,
  room_type text,
  room_rate numeric,
  nights integer,
  room_revenue numeric,
  status text,
  booked_datetime timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pickup_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_sel_pickup_records" ON pickup_records;
CREATE POLICY "anon_sel_pickup_records" ON pickup_records FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_ins_pickup_records" ON pickup_records;
CREATE POLICY "anon_ins_pickup_records" ON pickup_records FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_upd_pickup_records" ON pickup_records;
CREATE POLICY "anon_upd_pickup_records" ON pickup_records FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_del_pickup_records" ON pickup_records;
CREATE POLICY "anon_del_pickup_records" ON pickup_records FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS pickup_records_arrival_date_idx ON pickup_records(arrival_date);
CREATE INDEX IF NOT EXISTS pickup_records_import_id_idx ON pickup_records(import_id);
CREATE INDEX IF NOT EXISTS pickup_records_created_at_idx ON pickup_records(created_at DESC);
CREATE INDEX IF NOT EXISTS pickup_import_logs_imported_at_idx ON pickup_import_logs(imported_at DESC);