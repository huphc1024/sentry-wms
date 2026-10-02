-- Billing module: rate cards, events, invoices, invoice lines
CREATE TABLE IF NOT EXISTS billing_rate_cards (
    rate_card_id SERIAL PRIMARY KEY,
    customer_id UUID REFERENCES customers(canonical_id),
    service_type VARCHAR(50) NOT NULL, -- 'STORAGE','INBOUND','OUTBOUND','PICK_PACK','HANDLING'
    unit VARCHAR(30) NOT NULL, -- 'PALLET','CBM','PER_ORDER','PER_SKU'
    unit_price DECIMAL(14,2) NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'VND',
    effective_from DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    external_id UUID UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_events (
    event_id BIGSERIAL PRIMARY KEY,
    customer_id UUID REFERENCES customers(canonical_id),
    warehouse_id INT REFERENCES warehouses(warehouse_id),
    event_type VARCHAR(50) NOT NULL, -- 'STORAGE_DAY','INBOUND','OUTBOUND','PICK'
    reference_table VARCHAR(64),
    reference_id BIGINT,
    quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
    unit_price DECIMAL(14,2),
    amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    billed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_invoices (
    invoice_id BIGSERIAL PRIMARY KEY,
    customer_id UUID REFERENCES customers(canonical_id),
    period_start DATE,
    period_end DATE,
    total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SENT, PAID, CANCELLED
    issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    external_id UUID UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_invoice_lines (
    line_id BIGSERIAL PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES billing_invoices(invoice_id) ON DELETE CASCADE,
    event_id BIGINT REFERENCES billing_events(event_id),
    description TEXT,
    quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
    unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
    amount DECIMAL(14,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_billing_events_customer ON billing_events(customer_id);
CREATE INDEX IF NOT EXISTS ix_billing_invoices_customer ON billing_invoices(customer_id);
