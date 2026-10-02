-- Migration 089: bind a WMS token to a single customer (Customer Portal phase 1)
--
-- wms_tokens today scopes an integration by warehouse_ids, source_system,
-- inbound_resources and endpoints -- but not by customer. In a
-- single-tenant deploy that is fine. Once stock is owned per customer
-- (mig 087), a token issued to customer A's ERP can still POST an order
-- naming customer B, or page the whole /api/v1/snapshot/inventory feed.
--
-- customer_id NULL = operator-owned token, unscoped (existing behaviour;
-- every token created before this migration keeps working unchanged).
-- customer_id set = the inbound and snapshot handlers must confine both
-- reads and writes to that customer. Enforcement lands in phase 6; this
-- migration only adds the column so tokens can be provisioned ahead of it.

BEGIN;

ALTER TABLE wms_tokens
    ADD COLUMN IF NOT EXISTS customer_id UUID
        REFERENCES customers(canonical_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_wms_tokens_customer
    ON wms_tokens(customer_id) WHERE customer_id IS NOT NULL;

COMMIT;
