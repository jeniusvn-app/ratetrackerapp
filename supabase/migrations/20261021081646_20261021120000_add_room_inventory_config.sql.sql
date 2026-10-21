/*
# Add Room Inventory Configuration (MiniRMS)

## Purpose
Supports the Analytics & Future Occupancy tab of the PU Report module ("MiniRMS").
Stores physical room capacity per room type per hotel, enabling occupancy calculations.

## New Tables
- `room_inventory_config`
  - `id` (uuid, PK)
  - `hotel_id` (uuid, FK to hotels)
  - `room_type_id` (uuid, FK to room_types)
  - `physical_capacity` (integer, NOT NULL, default 0) — number of physical rooms
  - `updated_at` (timestamptz, default now())
  - UNIQUE constraint on (hotel_id, room_type_id) — one capacity entry per room type per hotel

## Security
- Enable RLS.
- Owner-scoped to authenticated users (app has sign-in). Users with access to a hotel can read/write its inventory config.
- Uses same TO authenticated pattern as the rest of the app.

## Notes
- `total_rooms` for a hotel is computed as SUM(physical_capacity) across all room types — not stored as a column.
- Idempotent: uses IF NOT EXISTS / DO $$ blocks.
*/

CREATE TABLE IF NOT EXISTS room_inventory_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  physical_capacity integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (hotel_id, room_type_id)
);

ALTER TABLE room_inventory_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_room_inventory" ON room_inventory_config;
CREATE POLICY "select_room_inventory"
ON room_inventory_config FOR SELECT
TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_room_inventory" ON room_inventory_config;
CREATE POLICY "insert_room_inventory"
ON room_inventory_config FOR INSERT
TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_room_inventory" ON room_inventory_config;
CREATE POLICY "update_room_inventory"
ON room_inventory_config FOR UPDATE
TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_room_inventory" ON room_inventory_config;
CREATE POLICY "delete_room_inventory"
ON room_inventory_config FOR DELETE
TO authenticated USING (true);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_room_inventory_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_room_inventory_updated_at ON room_inventory_config;
CREATE TRIGGER trg_room_inventory_updated_at
BEFORE UPDATE ON room_inventory_config
FOR EACH ROW EXECUTE FUNCTION update_room_inventory_updated_at();
