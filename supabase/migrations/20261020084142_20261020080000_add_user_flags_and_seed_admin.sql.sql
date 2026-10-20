/*
# Add user status flags + seed admin account and price matrix data

1. Modified Tables
- `app_users`: add `is_active` boolean NOT NULL DEFAULT true — controls
  whether a user account is enabled (disabled users cannot log in).
- `app_users`: add `can_upload_pu_only` boolean NOT NULL DEFAULT false —
  restricts a user to only uploading PU reports (no other page access).
  Admin gets false (full access).

2. Seed Data
- Default admin account: username 'admin', password 'admin123',
  role='admin', can_access_pu_report=true, can_upload_pu_only=false,
  is_active=true, allowed_hotel_ids='["*"]'.
- Re-seed price_matrix with BAR/PEAK/BREAKFAST rate codes using live UUIDs
  (the original 0002 migration used hardcoded UUIDs from a different project
  instance, so daily_rates seed had no effect).
- Seed 14 days of daily_rates for D'Lecia Superior Double BAR 1 using live UUIDs.

3. Security
- No RLS policy changes. New columns governed by existing policies.

4. Notes
- The admin password is plaintext, matching the existing custom auth model
  (app_users.password). Change it immediately after first login via the
  "Đổi mật khẩu" button.
- All inserts are idempotent (WHERE NOT EXISTS guards).
*/

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS can_upload_pu_only boolean NOT NULL DEFAULT false;

-- ---------- Seed: Admin account ----------
INSERT INTO app_users (username, password, email, role, allowed_hotel_ids, can_access_pu_report, can_upload_pu_only, is_active)
SELECT 'admin', 'admin123', 'admin@ratetracker.ai', 'admin', '["*"]'::jsonb, true, false, true
WHERE NOT EXISTS (SELECT 1 FROM app_users WHERE username = 'admin');

-- ---------- Seed: price_matrix (using live UUIDs) ----------
INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BAR 1', 990000, 841500, 760000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name IN ('Superior Double','Standard Double','Cosy Room')
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BAR 1');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BAR 3', 1100000, 935000, 850000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name IN ('Deluxe Twin','Deluxe Double','Grand Room')
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BAR 3');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'PEAK 1', 2150000, 1827500, 1650000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE rt.name = 'Executive Suite'
AND NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='PEAK 1');

INSERT INTO price_matrix (hotel_id, room_type_id, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, 'BREAKFAST', 150000, 127500, 110000
FROM hotels h JOIN room_types rt ON rt.hotel_id = h.id
WHERE NOT EXISTS (SELECT 1 FROM price_matrix pm WHERE pm.hotel_id=h.id AND pm.room_type_id=rt.id AND pm.rate_code='BREAKFAST');

-- ---------- Seed: 14 days daily_rates for D'Lecia Superior Double BAR 1 ----------
INSERT INTO daily_rates (hotel_id, room_type_id, date, rate_code, selling_price, net_price, cms_price)
SELECT h.id, rt.id, d::date, 'BAR 1', 990000, 841500, 760000
FROM hotels h
JOIN room_types rt ON rt.hotel_id = h.id
CROSS JOIN generate_series(
  date_trunc('day', now())::date,
  (date_trunc('day', now())::date + interval '13 days')::date,
  interval '1 day'
) AS t(d)
WHERE h.name = 'D''Lecia Hotel' AND rt.name = 'Superior Double'
AND NOT EXISTS (
  SELECT 1 FROM daily_rates dr
  WHERE dr.hotel_id = h.id
    AND dr.room_type_id = rt.id
    AND dr.date = d::date
    AND dr.rate_code = 'BAR 1'
);