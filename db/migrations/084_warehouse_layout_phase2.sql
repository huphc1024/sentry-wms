-- ============================================================
-- Migration 084: stable racks and unit-aware warehouse layouts
-- ============================================================
-- Gradual migration: legacy rack_key URLs continue to work and bins.rack_id
-- remains nullable for rows that cannot be linked safely.

ALTER TABLE warehouse_layouts
  ADD COLUMN IF NOT EXISTS coordinate_unit VARCHAR(20) NOT NULL DEFAULT 'METER';

ALTER TABLE warehouse_layouts
  DROP CONSTRAINT IF EXISTS warehouse_layouts_coordinate_unit_check;
ALTER TABLE warehouse_layouts
  ADD CONSTRAINT warehouse_layouts_coordinate_unit_check
  CHECK (coordinate_unit IN ('METER', 'LEGACY_CANVAS'));

-- Every row created by migration 083/service v1 stores meter coordinates.
UPDATE warehouse_layouts SET coordinate_unit = 'METER';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'zones'::regclass
      AND conname = 'zones_zone_warehouse_uq'
  ) THEN
    ALTER TABLE zones
      ADD CONSTRAINT zones_zone_warehouse_uq UNIQUE (zone_id, warehouse_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS racks (
    rack_id BIGSERIAL PRIMARY KEY,
    external_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    zone_id INT NOT NULL,
    rack_code VARCHAR(64) NOT NULL,
    rack_name VARCHAR(128),
    aisle VARCHAR(32),
    bay VARCHAR(32),
    legacy_rack_key VARCHAR(120) NOT NULL,
    map_x DECIMAL(10,2) NOT NULL,
    map_y DECIMAL(10,2) NOT NULL,
    map_w DECIMAL(10,2) NOT NULL CHECK (map_w > 0),
    map_h DECIMAL(10,2) NOT NULL CHECK (map_h > 0),
    rotation_deg DECIMAL(6,2) NOT NULL DEFAULT 0
      CHECK (rotation_deg >= 0 AND rotation_deg < 360),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (zone_id, warehouse_id)
      REFERENCES zones(zone_id, warehouse_id),
    UNIQUE (warehouse_id, rack_code),
    UNIQUE (warehouse_id, legacy_rack_key)
);

CREATE INDEX IF NOT EXISTS ix_racks_wh_zone
  ON racks (warehouse_id, zone_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS ix_racks_legacy_key
  ON racks (warehouse_id, legacy_rack_key);

ALTER TABLE warehouse_rack_layouts
  ADD COLUMN IF NOT EXISTS rack_id BIGINT REFERENCES racks(rack_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_warehouse_rack_layouts_rack_id
  ON warehouse_rack_layouts (rack_id) WHERE rack_id IS NOT NULL;

ALTER TABLE bins
  ADD COLUMN IF NOT EXISTS rack_id BIGINT REFERENCES racks(rack_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_bins_rack_id
  ON bins (rack_id) WHERE rack_id IS NOT NULL;

-- First preserve every phase-1 rack that already has saved geometry.
INSERT INTO racks (
    warehouse_id, zone_id, rack_code, rack_name, aisle, bay,
    legacy_rack_key, map_x, map_y, map_w, map_h, rotation_deg
)
SELECT
    wrl.warehouse_id,
    wrl.zone_id,
    LEFT(REPLACE(wrl.rack_key, '|', '-'), 48) || '-' ||
      SUBSTR(MD5(wrl.rack_key), 1, 12),
    COALESCE(wrl.label, wrl.rack_key),
    NULLIF(SPLIT_PART(wrl.rack_key, '|', 2), 'X'),
    NULLIF(SPLIT_PART(wrl.rack_key, '|', 3), ''),
    wrl.rack_key,
    wrl.x_m, wrl.y_m, wrl.w_m, wrl.h_m, wrl.rotation_deg
FROM warehouse_rack_layouts wrl
WHERE wrl.zone_id IS NOT NULL
ON CONFLICT (warehouse_id, legacy_rack_key) DO NOTHING;

-- Then create missing racks from the exact legacy key formula used by
-- parse_bin_address: zone_id|AISLE|row_num (or bin_code fallback).
WITH derived AS (
    SELECT DISTINCT
        b.warehouse_id,
        b.zone_id,
        COALESCE(NULLIF(UPPER(TRIM(b.aisle)), ''), 'X') AS aisle_norm,
        COALESCE(NULLIF(TRIM(b.row_num), ''), b.bin_code) AS bay_norm,
        b.zone_id::text || '|' ||
          COALESCE(NULLIF(UPPER(TRIM(b.aisle)), ''), 'X') || '|' ||
          COALESCE(NULLIF(TRIM(b.row_num), ''), b.bin_code) AS legacy_rack_key
    FROM bins b
    WHERE b.is_active = TRUE
), numbered AS (
    SELECT d.*, ROW_NUMBER() OVER (
        PARTITION BY d.warehouse_id ORDER BY d.zone_id, d.aisle_norm, d.bay_norm
    ) - 1 AS seq
    FROM derived d
)
INSERT INTO racks (
    warehouse_id, zone_id, rack_code, rack_name, aisle, bay,
    legacy_rack_key, map_x, map_y, map_w, map_h, rotation_deg
)
SELECT
    n.warehouse_id,
    n.zone_id,
    LEFT(REPLACE(n.legacy_rack_key, '|', '-'), 48) || '-' ||
      SUBSTR(MD5(n.legacy_rack_key), 1, 12),
    COALESCE(NULLIF(n.aisle_norm, 'X'), '?') || '-' ||
      LPAD(n.bay_norm, 3, '0'),
    NULLIF(n.aisle_norm, 'X'),
    n.bay_norm,
    n.legacy_rack_key,
    3 + MOD(n.seq, 10) * 4,
    4 + FLOOR(n.seq / 10) * 4,
    2.5,
    3,
    0
FROM numbered n
ON CONFLICT (warehouse_id, legacy_rack_key) DO NOTHING;

UPDATE warehouse_rack_layouts wrl
SET rack_id = r.rack_id
FROM racks r
WHERE r.warehouse_id = wrl.warehouse_id
  AND r.legacy_rack_key = wrl.rack_key
  AND wrl.rack_id IS NULL;

-- Link only unambiguous structural slots. Ambiguous legacy data remains
-- nullable and continues through the rack_key fallback until corrected.
WITH candidates AS (
    SELECT
        b.bin_id,
        r.rack_id,
        COUNT(*) OVER (
            PARTITION BY r.rack_id,
              NULLIF(TRIM(b.level_num), ''),
              NULLIF(TRIM(b.position_num), '')
        ) AS slot_count
    FROM bins b
    JOIN racks r
      ON r.warehouse_id = b.warehouse_id
     AND r.legacy_rack_key =
       b.zone_id::text || '|' ||
       COALESCE(NULLIF(UPPER(TRIM(b.aisle)), ''), 'X') || '|' ||
       COALESCE(NULLIF(TRIM(b.row_num), ''), b.bin_code)
    WHERE b.is_active = TRUE
)
UPDATE bins b
SET rack_id = c.rack_id
FROM candidates c
WHERE c.bin_id = b.bin_id
  AND (
    c.slot_count = 1
    OR NULLIF(TRIM(b.level_num), '') IS NULL
    OR NULLIF(TRIM(b.position_num), '') IS NULL
  )
  AND b.rack_id IS NULL;

-- Enforce uniqueness only where legacy data has a complete structural slot.
CREATE UNIQUE INDEX IF NOT EXISTS ux_bins_rack_slot
  ON bins (rack_id, level_num, position_num)
  WHERE rack_id IS NOT NULL
    AND is_active = TRUE
    AND NULLIF(TRIM(level_num), '') IS NOT NULL
    AND NULLIF(TRIM(position_num), '') IS NOT NULL;

ALTER TABLE warehouse_map_paths
  DROP CONSTRAINT IF EXISTS warehouse_map_paths_points_min_len;
ALTER TABLE warehouse_map_paths
  ADD CONSTRAINT warehouse_map_paths_points_min_len
  CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) >= 2);

ALTER TABLE warehouse_map_paths
  DROP CONSTRAINT IF EXISTS warehouse_map_paths_width_positive;
ALTER TABLE warehouse_map_paths
  ADD CONSTRAINT warehouse_map_paths_width_positive CHECK (width_m > 0);

ALTER TABLE warehouse_map_paths
  DROP CONSTRAINT IF EXISTS warehouse_map_paths_one_way_direction;
ALTER TABLE warehouse_map_paths
  ADD CONSTRAINT warehouse_map_paths_one_way_direction
  CHECK (
    (one_way = FALSE AND direction = 'both')
    OR (one_way = TRUE AND direction IN ('forward', 'reverse'))
  );
