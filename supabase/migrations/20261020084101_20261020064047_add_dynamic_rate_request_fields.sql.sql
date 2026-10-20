/*
# Add Dynamic rate request fields to rate_change_requests

1. Changes
- `rate_change_requests`: add optional columns for "Dynamic" rate requests:
  - `room_type_ids` jsonb NULL — array of room type UUIDs
  - `selling_price` numeric(12,2) NULL — requested selling price
  - `net_price` numeric(12,2) NULL — requested net price
  - `b2b_price` numeric(12,2) NULL — requested B2B price

2. Data Safety
- Additive only. No drops, no type changes, no renames.

3. Security
- No policy changes. Existing RLS policies govern the new columns.
*/

ALTER TABLE rate_change_requests
  ADD COLUMN IF NOT EXISTS room_type_ids jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS selling_price numeric(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS net_price numeric(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;