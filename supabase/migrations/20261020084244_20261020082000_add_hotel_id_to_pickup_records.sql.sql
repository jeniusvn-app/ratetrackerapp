/*
# Add hotel_id column to pickup_records

1. Changes
- `pickup_records`: add `hotel_id` uuid NULL — links a pickup record to a
  specific hotel. When null, the record is not filtered by hotel.
  Foreign key to hotels(id) ON DELETE SET NULL.

2. Data Safety
- Additive only. No drops, no type changes. Existing rows get NULL.

3. Security
- No policy changes. Existing RLS policies govern the new column.
*/

ALTER TABLE pickup_records
  ADD COLUMN IF NOT EXISTS hotel_id uuid REFERENCES hotels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pickup_records_hotel_id_idx ON pickup_records(hotel_id);