import uuid
from io import BytesIO

from db_test_context import get_raw_connection
from pypdf import PdfReader


def test_contract_pdf_generation(client, auth_headers):
    conn = get_raw_connection()
    cur = conn.cursor()
    customer_id = str(uuid.uuid4())
    customer_code = f"CON-{uuid.uuid4().hex[:8]}"
    cur.execute(
        """
        INSERT INTO customers (
            canonical_id, external_id, customer_code, customer_name,
            contact_person, tax_id, billing_address, is_active
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, true)
        """,
        (
            customer_id,
            str(uuid.uuid4()),
            customer_code,
            "Công ty Hợp đồng Kiểm thử",
            "Nguyễn Văn A",
            "0101234567",
            "Hà Nội",
        ),
    )
    cur.execute(
        """
        INSERT INTO customer_contracts (
            contract_number, customer_id, contract_name, start_date,
            status, billing_cycle, payment_terms_days, currency
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING contract_id
        """,
        (
            f"CTR-{uuid.uuid4().hex[:8]}",
            customer_id,
            "Dịch vụ lưu kho",
            "2026-07-01",
            "ACTIVE",
            "MONTHLY",
            30,
            "VND",
        ),
    )
    contract_id = cur.fetchone()[0]
    cur.execute(
        """
        INSERT INTO billing_rate_cards (
            customer_id, contract_id, rate_name, service_type, unit,
            unit_price, currency, effective_from, external_id
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            customer_id,
            contract_id,
            "Phí lưu pallet",
            "STORAGE",
            "PALLET_DAY",
            15000,
            "VND",
            "2026-07-01",
            str(uuid.uuid4()),
        ),
    )
    cur.close()

    response = client.get(
        f"/api/admin/customer-contracts/{contract_id}/pdf",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "application/pdf"
    assert "contract-" in response.headers["Content-Disposition"]
    assert response.data.startswith(b"%PDF-1.4")
    pdf_text = "\n".join(
        page.extract_text() or "" for page in PdfReader(BytesIO(response.data)).pages
    )
    assert "HỢP ĐỒNG DỊCH VỤ LOGISTICS" in pdf_text
    assert "Công ty Hợp đồng Kiểm thử" in pdf_text
