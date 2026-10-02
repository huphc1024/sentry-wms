-- Migration 086: gate sessions on vehicle_movements (PO/SO-linked check-in).
BEGIN;

ALTER TABLE vehicle_movements
  ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT;

ALTER TABLE vehicle_movements
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'CHECKED_IN';

ALTER TABLE vehicle_movements
  DROP CONSTRAINT IF EXISTS vehicle_movements_status_check;

ALTER TABLE vehicle_movements
  ADD CONSTRAINT vehicle_movements_status_check
  CHECK (status IN ('CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));

ALTER TABLE vehicle_movements
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE vehicle_movements
  ADD COLUMN IF NOT EXISTS completed_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS ix_vehicle_movements_warehouse_status
  ON vehicle_movements(warehouse_id, status);

CREATE INDEX IF NOT EXISTS ix_vehicle_movements_plate_status
  ON vehicle_movements(vehicle_plate, status);

COMMIT;
