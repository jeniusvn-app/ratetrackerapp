ALTER TABLE pickup_records ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1;
COMMENT ON COLUMN pickup_records.quantity IS 'Number of rooms in this booking row; defaults to 1 if omitted in import.';
