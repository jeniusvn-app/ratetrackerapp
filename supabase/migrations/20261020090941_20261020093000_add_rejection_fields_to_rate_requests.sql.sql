ALTER TABLE rate_change_requests
  ADD COLUMN IF NOT EXISTS rejection_reason text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz DEFAULT NULL;