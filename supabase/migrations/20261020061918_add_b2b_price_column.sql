/*
# Add optional b2b_price column to price_matrix and daily_rates

1. Changes
- `price_matrix`: add `b2b_price` numeric(12,2) NULL default NULL.
  Stores an optional B2B (business-to-business) reference price for a
  room type + rate code combination. Displayed as "Giá B2B" in the rate
  matrix config table and on the lookup calendar.
- `daily_rates`: add `b2b_price` numeric(12,2) NULL default NULL.
  Optional per-day B2B price. When null/empty, the calendar shows a dash
  for the third price line. B2B prices are NEVER used in the "lowest
  selling price" benchmark calculation on Page 1 (Lịch) — that
  calculation only compares selling_price.

2. Data Safety
- Additive only. No drops, no type changes, no renames. Existing rows
  keep their current data; the new column simply defaults to NULL.

3. Security
- No policy changes. Existing RLS policies on both tables continue to
  govern all access to the new column automatically.
*/

ALTER TABLE price_matrix
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;

ALTER TABLE daily_rates
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;
