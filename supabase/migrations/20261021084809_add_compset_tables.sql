/*
# Add Compset tables for competitive set analysis

## Overview
Creates three new tables to support the Compset (Competitive Set) module
in the MiniRMS page (Tab 3): competitor configuration, daily rate tracker
entries, and manual actual rooms sold overrides.

## New Tables

### 1. compset_competitors
Stores direct competitor configuration for each hotel (max 5 per hotel).
- `id` (uuid PK)
- `hotel_id` (uuid FK → hotels) — the hotel this competitor belongs to
- `name` (text) — competitor hotel name
- `room_type_match` (text) — which room type to compare
- `default_hotel_link` (text) — linked hotel reference
- `display_order` (int, default 0) — ordering
- `created_at` (timestamptz)

### 2. compset_daily_entries
Daily rate tracker data per competitor per date.
- `id` (uuid PK)
- `hotel_id` (uuid FK → hotels)
- `competitor_id` (uuid FK → compset_competitors, nullable for search compset)
- `date` (date) — the night being tracked
- `entry_type` (text) — 'direct' or 'search'
- `competitor_name` (text) — denormalized name for search compset
- `selling_rate` (numeric, nullable) — competitor's selling rate
- `availability_status` (text) — 'available', 'sold_out', 'no_data'
- `pace_status` (text, nullable) — for search compset: 'very_available', 'selling_fast', 'sold_out', 'no_data'
- `created_at` (timestamptz)

### 3. manual_rooms_sold
Manual override for actual rooms sold per hotel per date (hybrid occupancy).
- `id` (uuid PK)
- `hotel_id` (uuid FK → hotels)
- `date` (date) — the arrival date
- `actual_rooms_sold` (int) — manual count of rooms sold
- `my_rate` (numeric, nullable) — my hotel's rate for compset
- `manual_occupancy` (int, nullable) — manual occupancy or rooms left
- `created_at` (timestamptz)

## Security
- RLS enabled on all three tables.
- Policies: TO anon, authenticated (same pattern as all other tables —
  single-tenant app with custom auth, no Supabase Auth).

## Unique Constraints
- compset_competitors: UNIQUE(hotel_id, name)
- compset_daily_entries: UNIQUE(hotel_id, date, competitor_id, entry_type)
- manual_rooms_sold: UNIQUE(hotel_id, date)
*/

CREATE TABLE IF NOT EXISTS compset_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  name text NOT NULL,
  room_type_match text DEFAULT '',
  default_hotel_link text DEFAULT '',
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hotel_id, name)
);

ALTER TABLE compset_competitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_compset_competitors" ON compset_competitors;
CREATE POLICY "select_compset_competitors" ON compset_competitors FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_compset_competitors" ON compset_competitors;
CREATE POLICY "insert_compset_competitors" ON compset_competitors FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_compset_competitors" ON compset_competitors;
CREATE POLICY "update_compset_competitors" ON compset_competitors FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_compset_competitors" ON compset_competitors;
CREATE POLICY "delete_compset_competitors" ON compset_competitors FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS compset_daily_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  competitor_id uuid REFERENCES compset_competitors(id) ON DELETE CASCADE,
  date date NOT NULL,
  entry_type text NOT NULL DEFAULT 'direct',
  competitor_name text DEFAULT '',
  selling_rate numeric(12,2),
  availability_status text DEFAULT 'available',
  pace_status text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hotel_id, date, competitor_id, entry_type)
);

ALTER TABLE compset_daily_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_compset_entries" ON compset_daily_entries;
CREATE POLICY "select_compset_entries" ON compset_daily_entries FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_compset_entries" ON compset_daily_entries;
CREATE POLICY "insert_compset_entries" ON compset_daily_entries FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_compset_entries" ON compset_daily_entries;
CREATE POLICY "update_compset_entries" ON compset_daily_entries FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_compset_entries" ON compset_daily_entries;
CREATE POLICY "delete_compset_entries" ON compset_daily_entries FOR DELETE
  TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS manual_rooms_sold (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  date date NOT NULL,
  actual_rooms_sold int NOT NULL DEFAULT 0,
  my_rate numeric(12,2),
  manual_occupancy int,
  created_at timestamptz DEFAULT now(),
  UNIQUE(hotel_id, date)
);

ALTER TABLE manual_rooms_sold ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_manual_rooms" ON manual_rooms_sold;
CREATE POLICY "select_manual_rooms" ON manual_rooms_sold FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "insert_manual_rooms" ON manual_rooms_sold;
CREATE POLICY "insert_manual_rooms" ON manual_rooms_sold FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_manual_rooms" ON manual_rooms_sold;
CREATE POLICY "update_manual_rooms" ON manual_rooms_sold FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "delete_manual_rooms" ON manual_rooms_sold;
CREATE POLICY "delete_manual_rooms" ON manual_rooms_sold FOR DELETE
  TO anon, authenticated USING (true);