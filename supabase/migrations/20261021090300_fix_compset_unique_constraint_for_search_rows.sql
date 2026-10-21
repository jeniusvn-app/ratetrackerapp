-- The original unique constraint UNIQUE(hotel_id, date, competitor_id, entry_type)
-- doesn't work for search entries where competitor_id is NULL (NULL != NULL in unique indexes).
-- We need to support up to 5 individual search compset rows per date.
-- Strategy: add a search_row_index column (int) to distinguish search rows,
-- and replace the unique constraint with one that uses COALESCE for competitor_id/search_row_index.

ALTER TABLE compset_daily_entries ADD COLUMN IF NOT EXISTS search_row_index int DEFAULT 0;

-- Drop old unique constraint
ALTER TABLE compset_daily_entries DROP CONSTRAINT IF EXISTS compset_daily_entries_hotel_id_date_competitor_id_entry__key;

-- Create new unique constraint that handles both direct (competitor_id) and search (search_row_index) entries
-- For direct entries: competitor_id is non-null, search_row_index = 0
-- For search entries: competitor_id is null, search_row_index = 1..5
CREATE UNIQUE INDEX IF NOT EXISTS compset_daily_entries_unique_idx
  ON compset_daily_entries (hotel_id, date, entry_type, COALESCE(competitor_id::text, ''), search_row_index);
