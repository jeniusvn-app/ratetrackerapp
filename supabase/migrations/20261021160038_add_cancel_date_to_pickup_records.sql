/*
# Add cancel_date column to pickup_records

1. Changes
- Add `cancel_date` (text, nullable) to `pickup_records` table.
  Stores the date a booking was cancelled, populated when a
  Cancellation Report is imported and matched against an existing record.
- No security changes: existing RLS policies on pickup_records remain unchanged.
2. Notes
- The column is nullable so existing rows are unaffected.
- Text format matches the existing date columns (YYYY-MM-DD or DD/MM/YYYY as imported).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pickup_records' AND column_name = 'cancel_date'
  ) THEN
    ALTER TABLE pickup_records ADD COLUMN cancel_date text;
  END IF;
END $$;