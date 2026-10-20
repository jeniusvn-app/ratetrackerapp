/*
# RateTracker AI by Jenius — initial schema

1. Purpose
   Hotel Rate Management System with multi-tenant hotel-scoped permissions.
   Uses a custom `app_users` table (not Supabase Auth) because the spec defines
   fixed username/password accounts with role + allowed_hotel_ids. The frontend
   authenticates against `app_users` and enforces hotel visibility client-side.

2. New Tables
   - `hotels`            (id, name, created_at)
   - `room_types`        (id, hotel_id, name, display_order, created_at)
   - `price_matrix`      (id, hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
   - `daily_rates`       (id, hotel_id, room_type_id, date, rate_code, selling_price, net_price, cms_price)
   - `master_price_list` (id, hotel_name, ota_channel, room_type, rate_plan, rate_code, ref_selling_price, ref_net_price, approval_date; UNIQUE composite key)
   - `rate_change_requests` (id, hotel_id, start_date, end_date, rate_code, status, created_by_user_id, user_email, created_at)
   - `app_users`         (id, username UNIQUE, password, email, role, allowed_hotel_ids JSONB, created_at)

3. Security
   - RLS enabled on every table.
   - The app uses a custom auth model (app_users) rather than Supabase Auth, so
     policies are scoped `TO anon, authenticated` — the anon-key frontend must be
     able to read/write. Hotel-level visibility is enforced in the app layer
     based on the logged-in user's `allowed_hotel_ids` (["*"] for admin).

4. Seed Data
   - 3 hotels: D'Lecia Hotel, Nam Dat Hotel, Suzu Saigon
   - 2 users: admin (all hotels) and dlecia.gm (only D'Lecia)
   - Sample room types for each hotel (display_order populated)

5. Notes
   - `cms_price` column exists on price_matrix & daily_rates but is NEVER shown
     on Page 1 (Lookup Calendar) per spec — enforced in the frontend.
   - `rate_code` matching in the app normalizes via `.trim().toUpperCase()`.
*/

-- ---------- hotels ----------
CREATE TABLE IF NOT EXISTS hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_rw_hotels" ON hotels;
CREATE POLICY "anon_rw_hotels" ON hotels FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_hotels" ON hotels FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_hotels" ON hotels FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_hotels" ON hotels FOR DELETE TO anon, authenticated USING (true);

-- ---------- room_types ----------
CREATE TABLE IF NOT EXISTS room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE room_types ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS room_types_hotel_order_idx ON room_types(hotel_id, display_order);

DROP POLICY IF EXISTS "anon_rw_room_types" ON room_types;
CREATE POLICY "anon_rw_room_types" ON room_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_room_types" ON room_types FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_room_types" ON room_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_room_types" ON room_types FOR DELETE TO anon, authenticated USING (true);

-- ---------- price_matrix ----------
CREATE TABLE IF NOT EXISTS price_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  rate_code text NOT NULL,
  selling_price numeric NOT NULL DEFAULT 0,
  net_price numeric NOT NULL DEFAULT 0,
  cms_price numeric NOT NULL DEFAULT 0
);
ALTER TABLE price_matrix ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS price_matrix_lookup_idx ON price_matrix(hotel_id, room_type_id, rate_code);

DROP POLICY IF EXISTS "anon_rw_price_matrix" ON price_matrix;
CREATE POLICY "anon_rw_price_matrix" ON price_matrix FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_price_matrix" ON price_matrix FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_price_matrix" ON price_matrix FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_price_matrix" ON price_matrix FOR DELETE TO anon, authenticated USING (true);

-- ---------- daily_rates ----------
CREATE TABLE IF NOT EXISTS daily_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  rate_code text NOT NULL,
  selling_price numeric NOT NULL DEFAULT 0,
  net_price numeric NOT NULL DEFAULT 0,
  cms_price numeric NOT NULL DEFAULT 0
);
ALTER TABLE daily_rates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS daily_rates_lookup_idx ON daily_rates(hotel_id, date, room_type_id);

DROP POLICY IF EXISTS "anon_rw_daily_rates" ON daily_rates;
CREATE POLICY "anon_rw_daily_rates" ON daily_rates FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_daily_rates" ON daily_rates FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_daily_rates" ON daily_rates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_daily_rates" ON daily_rates FOR DELETE TO anon, authenticated USING (true);

-- ---------- master_price_list ----------
CREATE TABLE IF NOT EXISTS master_price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_name text NOT NULL,
  ota_channel text NOT NULL,
  room_type text NOT NULL,
  rate_plan text NOT NULL,
  rate_code text NOT NULL,
  ref_selling_price numeric NOT NULL DEFAULT 0,
  ref_net_price numeric NOT NULL DEFAULT 0,
  approval_date date,
  CONSTRAINT master_price_list_unique UNIQUE (hotel_name, ota_channel, room_type, rate_plan, rate_code)
);
ALTER TABLE master_price_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_rw_master_price_list" ON master_price_list;
CREATE POLICY "anon_rw_master_price_list" ON master_price_list FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_master_price_list" ON master_price_list FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_master_price_list" ON master_price_list FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_master_price_list" ON master_price_list FOR DELETE TO anon, authenticated USING (true);

-- ---------- rate_change_requests ----------
CREATE TABLE IF NOT EXISTS rate_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  rate_code text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  created_by_user_id uuid,
  user_email text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE rate_change_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rate_change_requests_status_idx ON rate_change_requests(status, created_at);

DROP POLICY IF EXISTS "anon_rw_rate_change_requests" ON rate_change_requests;
CREATE POLICY "anon_rw_rate_change_requests" ON rate_change_requests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_rate_change_requests" ON rate_change_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_rate_change_requests" ON rate_change_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_rate_change_requests" ON rate_change_requests FOR DELETE TO anon, authenticated USING (true);

-- ---------- app_users ----------
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  password text NOT NULL,
  email text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  allowed_hotel_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_rw_app_users" ON app_users;
CREATE POLICY "anon_rw_app_users" ON app_users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_ins_app_users" ON app_users FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "anon_upd_app_users" ON app_users FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon_del_app_users" ON app_users FOR DELETE TO anon, authenticated USING (true);

-- ---------- Seed: Hotels ----------
INSERT INTO hotels (name)
SELECT 'D''Lecia Hotel'
WHERE NOT EXISTS (SELECT 1 FROM hotels WHERE name = 'D''Lecia Hotel');

INSERT INTO hotels (name)
SELECT 'Nam Dat Hotel'
WHERE NOT EXISTS (SELECT 1 FROM hotels WHERE name = 'Nam Dat Hotel');

INSERT INTO hotels (name)
SELECT 'Suzu Saigon'
WHERE NOT EXISTS (SELECT 1 FROM hotels WHERE name = 'Suzu Saigon');

-- ---------- Seed: Room Types (ordered) ----------
DO $$
DECLARE
  dlecia_id uuid;
  namdat_id uuid;
  suzu_id uuid;
BEGIN
  SELECT id INTO dlecia_id FROM hotels WHERE name = 'D''Lecia Hotel';
  SELECT id INTO namdat_id FROM hotels WHERE name = 'Nam Dat Hotel';
  SELECT id INTO suzu_id   FROM hotels WHERE name = 'Suzu Saigon';

  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT dlecia_id, 'Superior Double', 1
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = dlecia_id AND name = 'Superior Double');
  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT dlecia_id, 'Deluxe Twin', 2
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = dlecia_id AND name = 'Deluxe Twin');
  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT dlecia_id, 'Executive Suite', 3
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = dlecia_id AND name = 'Executive Suite');

  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT namdat_id, 'Standard Double', 1
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = namdat_id AND name = 'Standard Double');
  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT namdat_id, 'Deluxe Double', 2
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = namdat_id AND name = 'Deluxe Double');

  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT suzu_id, 'Cosy Room', 1
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = suzu_id AND name = 'Cosy Room');
  INSERT INTO room_types (hotel_id, name, display_order)
  SELECT suzu_id, 'Grand Room', 2
  WHERE NOT EXISTS (SELECT 1 FROM room_types WHERE hotel_id = suzu_id AND name = 'Grand Room');
END $$;

-- ---------- app_users ----------
-- No seed accounts. The system starts with a clean app_users table.
-- Admin and user accounts are created dynamically via Page 5
-- (System Administration → User Management) or direct Supabase Auth sign-up.
