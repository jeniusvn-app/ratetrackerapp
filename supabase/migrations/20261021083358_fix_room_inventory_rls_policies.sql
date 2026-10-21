/*
# Fix RLS policies on room_inventory_config

## Problem
The `room_inventory_config` table has RLS enabled, but all four policies
(select, insert, update, delete) are scoped to `TO authenticated` only.
This app uses custom auth (app_users table, not Supabase Auth), so the
frontend talks to Supabase with the anon key. The `anon` role has no
matching policies, so every read/write is blocked by RLS — the
"Cấu hình Phòng Vật Lý" section cannot load or save.

## Fix
Drop the four existing `authenticated`-only policies and recreate them
with `TO anon, authenticated` so the anon-key frontend can operate,
matching the pattern used by every other table in this schema.

## Security
- RLS remains enabled on `room_inventory_config`.
- Policies are intentionally permissive (`USING (true)`) because this
  is a single-tenant app with no Supabase Auth — the same pattern used
  on all other tables (app_users, daily_rates, hotels, etc.).
*/

ALTER TABLE room_inventory_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_room_inventory" ON room_inventory_config;
CREATE POLICY "select_room_inventory"
ON room_inventory_config FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_room_inventory" ON room_inventory_config;
CREATE POLICY "insert_room_inventory"
ON room_inventory_config FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_room_inventory" ON room_inventory_config;
CREATE POLICY "update_room_inventory"
ON room_inventory_config FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_room_inventory" ON room_inventory_config;
CREATE POLICY "delete_room_inventory"
ON room_inventory_config FOR DELETE
TO anon, authenticated USING (true);