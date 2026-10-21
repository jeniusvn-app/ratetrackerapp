/*
# Add updated_at, unique constraint to daily_rates, and date_ranges to rate_change_requests

## Purpose
Enable proper UPSERT (latest-overwrite) on daily_rates and support multi-date-range
rate requests. This migration is idempotent — safe to re-run.

## Changes to `daily_rates`
1. Add `updated_at` column (timestamptz, default now()) to track when each rate row
   was last written.
2. Add a trigger `daily_rates_set_updated_at` that auto-updates `updated_at` on every
   INSERT or UPDATE.
3. Add a UNIQUE constraint on (hotel_id, room_type_id, date, rate_code) so that
   Supabase `.upsert(..., { onConflict: 'hotel_id,room_type_id,date,rate_code' })`
   overwrites the existing row instead of creating duplicates.
   The existing delete-then-insert pattern is replaced by native upsert in the
   frontend code after this migration.

## Changes to `rate_change_requests`
1. Add `date_ranges` column (jsonb, nullable) to store an array of date-range
   objects: [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }, ...].
   When non-null, the multi-range expansion is used instead of start_date/end_date.
   start_date/end_date are kept for backward compatibility and set to the earliest
   start / latest end across all ranges.

## Security
- No RLS policy changes.
- No new tables.

## Notes
- The unique constraint may fail if duplicate rows already exist. A cleanup step
  removes duplicates (keeping the one with the newest id) before creating the
  constraint, so no manual intervention is needed.
*/

-- 1. Add updated_at to daily_rates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_rates' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE daily_rates ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- 2. Auto-update trigger for updated_at
DROP TRIGGER IF EXISTS daily_rates_set_updated_at ON daily_rates;
DROP FUNCTION IF EXISTS daily_rates_set_updated_at_fn();

CREATE FUNCTION daily_rates_set_updated_at_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_rates_set_updated_at
BEFORE INSERT OR UPDATE ON daily_rates
FOR EACH ROW
EXECUTE FUNCTION daily_rates_set_updated_at_fn();

-- 3. Remove duplicate rows before adding unique constraint
-- Keep the row with the newest updated_at (tie-break by id).
DELETE FROM daily_rates a
USING daily_rates b
WHERE a.hotel_id = b.hotel_id
  AND a.room_type_id = b.room_type_id
  AND a.date = b.date
  AND a.rate_code = b.rate_code
  AND a.id < b.id;

-- 4. Add unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'daily_rates_unique_rate'
  ) THEN
    ALTER TABLE daily_rates
      ADD CONSTRAINT daily_rates_unique_rate
      UNIQUE (hotel_id, room_type_id, date, rate_code);
  END IF;
END $$;

-- 5. Add date_ranges jsonb to rate_change_requests
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rate_change_requests' AND column_name = 'date_ranges'
  ) THEN
    ALTER TABLE rate_change_requests ADD COLUMN date_ranges jsonb;
  END IF;
END $$;