-- Migration 085: customer contracts and production billing lifecycle
BEGIN;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(40);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_person VARCHAR(120);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms_days INT NOT NULL DEFAULT 30;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_currency VARCHAR(8) NOT NULL DEFAULT 'VND';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;

WITH numbered AS (
  SELECT canonical_id, ROW_NUMBER() OVER (ORDER BY created_at, canonical_id) AS seq
  FROM customers WHERE customer_code IS NULL
)
UPDATE customers c
SET customer_code = 'CUS-' || LPAD(numbered.seq::text, 5, '0')
FROM numbered WHERE numbered.canonical_id = c.canonical_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_customer_code
  ON customers(customer_code) WHERE customer_code IS NOT NULL;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_payment_terms_check;
ALTER TABLE customers ADD CONSTRAINT customers_payment_terms_check
  CHECK (payment_terms_days BETWEEN 0 AND 365);

CREATE TABLE IF NOT EXISTS customer_contracts (
    contract_id BIGSERIAL PRIMARY KEY,
    contract_number VARCHAR(64) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(canonical_id) ON DELETE RESTRICT,
    warehouse_id INT REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT,
    contract_name VARCHAR(200) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
      CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED','EXPIRED','TERMINATED')),
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
      CHECK (billing_cycle IN ('MONTHLY','WEEKLY','PER_EVENT')),
    payment_terms_days INT NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
    currency VARCHAR(8) NOT NULL DEFAULT 'VND',
    notes TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    external_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS ix_customer_contracts_customer
  ON customer_contracts(customer_id, status);

ALTER TABLE billing_rate_cards
  ADD COLUMN IF NOT EXISTS contract_id BIGINT REFERENCES customer_contracts(contract_id) ON DELETE CASCADE;
ALTER TABLE billing_rate_cards
  ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(warehouse_id) ON DELETE RESTRICT;
ALTER TABLE billing_rate_cards
  ADD COLUMN IF NOT EXISTS rate_name VARCHAR(120);
CREATE INDEX IF NOT EXISTS ix_billing_rate_cards_contract
  ON billing_rate_cards(contract_id, service_type);

ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS rate_card_id INT REFERENCES billing_rate_cards(rate_card_id) ON DELETE SET NULL;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS invoice_id BIGINT REFERENCES billing_invoices(invoice_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_billing_events_unbilled
  ON billing_events(customer_id, service_date) WHERE billed = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_events_source
  ON billing_events(event_type, reference_table, reference_id, service_date)
  WHERE reference_table IS NOT NULL AND reference_id IS NOT NULL;

ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS contract_id BIGINT REFERENCES customer_contracts(contract_id) ON DELETE SET NULL;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'VND';
ALTER TABLE billing_invoices ADD COLUMN IF NOT EXISTS notes TEXT;
UPDATE billing_invoices
SET invoice_number = 'INV-' || TO_CHAR(created_at, 'YYYY') || '-' || LPAD(invoice_id::text, 6, '0')
WHERE invoice_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_invoices_number
  ON billing_invoices(invoice_number) WHERE invoice_number IS NOT NULL;

COMMIT;
