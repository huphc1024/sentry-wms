-- Make pallet inventory first-class and support FEFO allocation.
ALTER TABLE pallets
    ADD COLUMN IF NOT EXISTS expiry_date DATE,
    ALTER COLUMN item_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_pallets_barcode
    ON pallets (pallet_barcode)
    WHERE pallet_barcode IS NOT NULL;

ALTER TABLE item_receipts
    ADD COLUMN IF NOT EXISTS pallet_id BIGINT REFERENCES pallets(pallet_id),
    ADD COLUMN IF NOT EXISTS expiry_date DATE;

ALTER TABLE pick_tasks
    ADD COLUMN IF NOT EXISTS pallet_id BIGINT REFERENCES pallets(pallet_id);

CREATE INDEX IF NOT EXISTS ix_pick_tasks_pallet ON pick_tasks(pallet_id);
CREATE INDEX IF NOT EXISTS ix_inventory_expiry ON inventory(expiry_date)
    WHERE quantity_on_hand > 0;
CREATE INDEX IF NOT EXISTS ix_pallets_expiry ON pallets(expiry_date)
    WHERE status = 'STORED';

-- PostgreSQL UNIQUE treats NULLs as distinct, so use a pallet-aware
-- expression index for both palletized and loose inventory.
ALTER TABLE inventory
    DROP CONSTRAINT IF EXISTS inventory_item_id_bin_id_lot_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_item_bin_lot_pallet
    ON inventory (
        item_id,
        bin_id,
        COALESCE(lot_number, ''),
        COALESCE(pallet_id, 0)
    );
