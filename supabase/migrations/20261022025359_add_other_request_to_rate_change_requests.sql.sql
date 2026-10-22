/*
# Add "Other Request" support to rate_change_requests

1. Changes
- `rate_change_requests`: add `other_text` column (text, nullable) to store
  free-form custom request text when the user selects "Other Request" (Yêu cầu khác).
- Make `start_date` and `end_date` nullable so "Other Request" submissions
  can omit the date range entirely (dates are optional for that request type).
- Make `rate_code` nullable so "Other Request" submissions don't require a rate code.

2. Data Safety
- Additive only for new column. Altering existing columns to nullable is safe —
  existing rows keep their values; new rows may store NULL when appropriate.
  No drops, no type changes, no renames.

3. Security
- No policy changes. Existing RLS policies on rate_change_requests
  continue to govern all access to the new/modified columns automatically.
*/

ALTER TABLE rate_change_requests
  ADD COLUMN IF NOT EXISTS other_text text DEFAULT NULL;

DO $$
BEGIN
  -- Make start_date nullable (was NOT NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rate_change_requests' AND column_name = 'start_date' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE rate_change_requests ALTER COLUMN start_date DROP NOT NULL;
  END IF;

  -- Make end_date nullable (was NOT NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rate_change_requests' AND column_name = 'end_date' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE rate_change_requests ALTER COLUMN end_date DROP NOT NULL;
  END IF;

  -- Make rate_code nullable (was NOT NULL)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rate_change_requests' AND column_name = 'rate_code' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE rate_change_requests ALTER COLUMN rate_code DROP NOT NULL;
  END IF;
END $$;
