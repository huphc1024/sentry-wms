-- Create pallets table and link to inventory
CREATE TABLE IF NOT EXISTS pallets (
    pallet_id BIGSERIAL PRIMARY KEY,
    pallet_code VARCHAR(100) NOT NULL UNIQUE,
    pallet_barcode VARCHAR(200),
    item_id INT NOT NULL REFERENCES items(item_id),
    warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id),
    bin_id INT REFERENCES bins(bin_id),
    quantity INT NOT NULL DEFAULT 0,
    weight_kg DECIMAL(10,3),
    lot_code VARCHAR(100),
    status VARCHAR(32) NOT NULL DEFAULT 'STORED', -- STORED, IN_TRANSIT, QUARANTINE
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    external_id UUID UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_pallets_item ON pallets(item_id);
CREATE INDEX IF NOT EXISTS ix_pallets_bin ON pallets(bin_id);

-- add optional pallet_id to inventory for pallet-tracked inventory
ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS pallet_id BIGINT REFERENCES pallets(pallet_id);

