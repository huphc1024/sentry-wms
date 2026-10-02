-- Vehicle movements log: track vehicle plates for inbound/outbound
CREATE TABLE IF NOT EXISTS vehicle_movements (
    movement_id BIGSERIAL PRIMARY KEY,
    movement_type VARCHAR(20) NOT NULL, -- 'INBOUND' or 'OUTBOUND'
    vehicle_plate VARCHAR(64) NOT NULL,
    driver_name VARCHAR(200),
    reference_type VARCHAR(64), -- 'PO','SO','PICK','RECEIPT'
    reference_id BIGINT,
    related_pallet_id BIGINT REFERENCES pallets(pallet_id),
    recorded_by VARCHAR(100),
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS ix_vehicle_movements_plate ON vehicle_movements(vehicle_plate);
CREATE INDEX IF NOT EXISTS ix_vehicle_movements_ref ON vehicle_movements(reference_type, reference_id);
