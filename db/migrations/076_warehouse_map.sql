-- ============================================================
-- Migration 076: warehouse map coordinates for simulation UI
-- ============================================================
-- Adds optional 2D layout fields to zones and bins. NULL map_x
-- means the admin simulation view derives position from aisle/row/level.

ALTER TABLE zones
  ADD COLUMN IF NOT EXISTS color_hex VARCHAR(7),
  ADD COLUMN IF NOT EXISTS map_x NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS map_y NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS map_w NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS map_h NUMERIC(8, 2);

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS map_x NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS map_y NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS map_w NUMERIC(8, 2) DEFAULT 24,
  ADD COLUMN IF NOT EXISTS map_h NUMERIC(8, 2) DEFAULT 20;
