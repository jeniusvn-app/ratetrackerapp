/*
# Add unique constraint to price_matrix (hotel_id, room_type_id, rate_code)

1. Purpose
- Enables `upsert` bulk imports on Tab 2 (Rate Matrix Configuration).
- The unique key [hotel_id + room_type_id + rate_code] lets Excel imports
  match existing rows and update their prices in place, instead of
  inserting duplicates.

2. Changes
- Drops the existing non-unique lookup index (no longer needed once the
  unique constraint covers the same columns).
- Creates a UNIQUE constraint named `price_matrix_hotel_room_code_key`
  on (hotel_id, room_type_id, rate_code).

3. Data Safety
- Non-destructive schema change. No columns dropped/renamed/retyped.
- Idempotent: re-running is a no-op.

4. Security
- No RLS policy changes.
*/

DROP INDEX IF EXISTS price_matrix_lookup_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'price_matrix_hotel_room_code_key'
      AND conrelid = 'price_matrix'::regclass
  ) THEN
    ALTER TABLE price_matrix
      ADD CONSTRAINT price_matrix_hotel_room_code_key
      UNIQUE (hotel_id, room_type_id, rate_code);
  END IF;
END $$;