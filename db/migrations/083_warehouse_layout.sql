-- ============================================================
-- Migration 083: editable warehouse floor plan (meters)
-- ============================================================
-- Persists warehouse canvas size, rack geometry, and traffic paths
-- (forklift / pedestrian). Coordinates are in meters.

CREATE TABLE IF NOT EXISTS warehouse_layouts (
    warehouse_id INT PRIMARY KEY REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    world_width_m DECIMAL(8, 2) NOT NULL DEFAULT 50,
    world_height_m DECIMAL(8, 2) NOT NULL DEFAULT 40,
    warehouse_x_m DECIMAL(8, 2) NOT NULL DEFAULT 2,
    warehouse_y_m DECIMAL(8, 2) NOT NULL DEFAULT 2,
    warehouse_w_m DECIMAL(8, 2) NOT NULL DEFAULT 46,
    warehouse_h_m DECIMAL(8, 2) NOT NULL DEFAULT 30,
    grid_step_m DECIMAL(8, 4) NOT NULL DEFAULT 0.25,
    version INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by INT
);

CREATE TABLE IF NOT EXISTS warehouse_rack_layouts (
    layout_rack_id SERIAL PRIMARY KEY,
    warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    rack_key VARCHAR(120) NOT NULL,
    zone_id INT REFERENCES zones(zone_id) ON DELETE SET NULL,
    label VARCHAR(80),
    x_m DECIMAL(8, 2) NOT NULL,
    y_m DECIMAL(8, 2) NOT NULL,
    w_m DECIMAL(8, 2) NOT NULL,
    h_m DECIMAL(8, 2) NOT NULL,
    rotation_deg DECIMAL(6, 2) NOT NULL DEFAULT 0,
    UNIQUE (warehouse_id, rack_key)
);

CREATE INDEX IF NOT EXISTS ix_warehouse_rack_layouts_wh
    ON warehouse_rack_layouts (warehouse_id);

CREATE TABLE IF NOT EXISTS warehouse_map_paths (
    path_id SERIAL PRIMARY KEY,
    warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id) ON DELETE CASCADE,
    path_type VARCHAR(20) NOT NULL CHECK (path_type IN ('FORKLIFT', 'PEDESTRIAN')),
    label VARCHAR(100),
    points JSONB NOT NULL,
    width_m DECIMAL(6, 3) NOT NULL DEFAULT 2.5,
    one_way BOOLEAN NOT NULL DEFAULT FALSE,
    direction VARCHAR(10) NOT NULL DEFAULT 'both',
    sort_order INT NOT NULL DEFAULT 0,
    CONSTRAINT warehouse_map_paths_direction_check
        CHECK (direction IN ('both', 'forward', 'reverse'))
);

CREATE INDEX IF NOT EXISTS ix_warehouse_map_paths_wh
    ON warehouse_map_paths (warehouse_id, path_type);
