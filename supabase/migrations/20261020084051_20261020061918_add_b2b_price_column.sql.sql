/*
# Add optional b2b_price column to price_matrix and daily_rates

1. Changes
- `price_matrix`: add `b2b_price` numeric(12,2) NULL default NULL.
  Stores an optional B2B reference price for a room type + rate code.
- `daily_rates`: add `b2b_price` numeric(12,2) NULL default NULL.
  Optional per-day B2B price. NEVER used in lowest selling price benchmark.

2. Data Safety
- Additive only. No drops, no type changes, no renames.

3. Security
- No policy changes. Existing RLS policies govern the new column.
*/

ALTER TABLE price_matrix
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;

ALTER TABLE daily_rates
  ADD COLUMN IF NOT EXISTS b2b_price numeric(12,2) DEFAULT NULL;