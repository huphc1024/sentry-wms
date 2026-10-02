"""Contracts for customer, contract and billing migration 085."""

from pathlib import Path

from schemas.customers import CreateContractRequest, CreateCustomerRequest


MIGRATION = Path(__file__).parents[2] / "db" / "migrations" / "085_customer_contracts_billing.sql"


def test_migration_defines_commercial_billing_chain():
    sql = MIGRATION.read_text(encoding="utf-8-sig")
    assert "CREATE TABLE IF NOT EXISTS customer_contracts" in sql
    assert "contract_id BIGINT REFERENCES customer_contracts" in sql
    assert "invoice_number" in sql
    assert "invoice_id BIGINT REFERENCES billing_invoices" in sql
    assert "ux_billing_events_source" in sql


def test_customer_and_contract_payloads_validate():
    customer = CreateCustomerRequest.model_validate({
        "customer_name": "Công ty kiểm thử",
        "payment_terms_days": 30,
    })
    assert customer.default_currency == "VND"

    contract = CreateContractRequest.model_validate({
        "customer_id": "00000000-0000-0000-0000-000000000001",
        "contract_name": "Hợp đồng lưu kho",
        "start_date": "2026-07-01",
        "status": "ACTIVE",
    })
    assert contract.billing_cycle == "MONTHLY"
