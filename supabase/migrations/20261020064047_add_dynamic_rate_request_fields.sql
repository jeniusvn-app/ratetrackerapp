/*
# Add Dynamic rate request fields to rate_change_requests

1. Changes
- `rate_change_requests`: add optional columns to support "Dynamic" rate
  requests created on Page 3 (Yêu cầu chỉnh giá):
  - `room_type_ids` jsonb NULL — array of room type UUIDs the user selected
    (only used when rate_code = 'Dynamic'; null otherwise).
  - `selling_price` numeric(12,2) NULL — requested selling price (Giá bán).
  - `net_price` numeric(12,2) NULL — requested net price (Giá thu về).
  - `b2b_price` numeric(12,2) NULL — requested B2B price (Giá B2B).
  All four are optional: a Dynamic request is valid as long as at least
  one of the three price fields is provided. The CMS price is intentionally
  NOT stored — Dynamic requests never expose Giá CMS to non-admin users.

2. Data Safety
- Additive only. No drops, no type changes, no renames. Existing rows keep
  their current data; the new columns default to NULL.

3. Security
- No policy changes. Existing RLS policies on rate_change_requests
  continue to govern all access to the new columns automatically.
*/

ALTER TABLE rate_change_requests
  ADD COLUMN IF NOT EXISTS room_type_ids jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS selling_price numeric(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS net_price numeric(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;
