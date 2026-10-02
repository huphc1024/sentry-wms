-- Migration 087: stock ownership by customer (Customer Portal phase 1)
--
-- Before this migration the operational layer had no notion of "which
-- customer owns this stock": inventory/items carried no owner and
-- sales_orders.customer_id was a free-text VARCHAR that did not point at
-- customers.canonical_id. Only pallets.customer_id (mig 081) and the
-- billing tables carried a real FK, so a customer-facing surface could
-- not answer "what is my on-hand" for non-palletised stock.
--
-- Ownership model: owner lives on `items` (one SKU belongs to at most one
-- customer). Chosen over an owner column on `inventory` because every
-- stock query already joins item_id, so no write path in
-- services/inventory_service.py (or receiving/putaway/picking/packing/
-- transfers/adjustments) has to change. The trade-off: two customers
-- cannot share a single SKU -- they need one SKU row each. Revisit with an
-- inventory-level owner column if shared-SKU 3PL becomes a requirement.
--
-- NULL owner = stock belonging to the warehouse operator itself
-- (internal). The portal must treat NULL as "not visible to any
-- customer", never as "visible to all".

BEGIN;

-- ------------------------------------------------------------
-- items: the owner of record for stock
-- ------------------------------------------------------------
-- ON DELETE RESTRICT: a customer that still owns SKUs must not be
-- deletable out from under its inventory. Matches the posture on
-- customer_contracts.customer_id (mig 085).
ALTER TABLE items
    ADD COLUMN IF NOT EXISTS owner_customer_id UUID
        REFERENCES customers(canonical_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_items_owner_customer
    ON items(owner_customer_id) WHERE owner_customer_id IS NOT NULL;

-- ------------------------------------------------------------
-- sales_orders: resolved customer FK alongside the legacy free-text id
-- ------------------------------------------------------------
-- customer_id VARCHAR(50) is deliberately kept: the v1.7 inbound mapping
-- docs (db/mappings/*.yaml) write it straight from the source ERP payload
-- and dropping it would break every existing connector. customer_ref is
-- the resolved pointer that scoping queries use.
ALTER TABLE sales_orders
    ADD COLUMN IF NOT EXISTS customer_ref UUID
        REFERENCES customers(canonical_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_sales_orders_customer_ref
    ON sales_orders(customer_ref, status) WHERE customer_ref IS NOT NULL;

-- Backfill on customer_code only (exact match). customer_name is NOT
-- used: it is operator-typed free text on both sides, so a fuzzy match
-- would silently attribute an order to the wrong customer -- which on the
-- portal means showing customer A's order to customer B. Rows that do not
-- match stay NULL and are attributed by an operator later.
--
-- Guarded on the column's existence: customers.customer_code arrives in
-- mig 085, so the ordered migration sequence always has it -- but this
-- repo's db/schema.sql has lagged its migrations before, so a database
-- bootstrapped from a stale schema.sql can reach 087 without it. Skipping
-- the backfill leaves customer_ref NULL for an operator to attribute,
-- which is the same outcome as a row that simply did not match.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = 'customer_code'
    ) THEN
        UPDATE sales_orders so
        SET customer_ref = c.canonical_id
        FROM customers c
        WHERE so.customer_ref IS NULL
          AND so.customer_id IS NOT NULL
          AND so.customer_id <> ''
          AND c.customer_code = so.customer_id;
    ELSE
        RAISE NOTICE 'mig 087: customers.customer_code absent (mig 085 not applied); skipping sales_orders.customer_ref backfill';
    END IF;
END $$;

-- ------------------------------------------------------------
-- purchase_orders: whose goods are arriving
-- ------------------------------------------------------------
-- purchase_orders only carried vendor_name/vendor_id, so inbound work
-- done on behalf of a customer had no attribution. No backfill is
-- possible -- there is no existing column to derive it from.
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS owner_customer_id UUID
        REFERENCES customers(canonical_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_purchase_orders_owner_customer
    ON purchase_orders(owner_customer_id, status)
    WHERE owner_customer_id IS NOT NULL;

COMMIT;
