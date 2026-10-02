-- Add optional customer owner to pallets for billing attribution
ALTER TABLE pallets
    ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(canonical_id);

CREATE INDEX IF NOT EXISTS ix_pallets_customer ON pallets(customer_id);

