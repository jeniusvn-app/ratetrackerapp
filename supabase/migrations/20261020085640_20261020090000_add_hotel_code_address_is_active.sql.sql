/*
# Add code, address, is_active columns to hotels table

1. Changes
- `hotels`: add `code` text NULL — optional hotel code/identifier.
- `hotels`: add `address` text NULL — optional hotel street address.
- `hotels`: add `is_active` boolean NOT NULL DEFAULT true — controls
  whether a hotel is active and visible in the app.

2. Data Safety
- Additive only. No drops, no type changes, no renames. Existing rows
  get NULL for code/address and true for is_active.

3. Security
- No policy changes. Existing RLS policies govern the new columns.
*/

ALTER TABLE hotels
  ADD COLUMN IF NOT EXISTS code text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS address text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;