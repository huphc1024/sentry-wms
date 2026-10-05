import uuid

from db_test_context import get_raw_connection


def test_invoice_pdf_generation(client, auth_headers):
    # prepare invoice + line
    conn = get_raw_connection()
    cur = conn.cursor()
    customer_id = str(uuid.uuid4())
    customer_code = f"PDF-{uuid.uuid4().hex[:8]}"
    cur.execute(
        "INSERT INTO customers (canonical_id, external_id, customer_code, customer_name, is_active) VALUES (%s, %s, %s, %s, true)",
        (customer_id, str(uuid.uuid4()), customer_code, "PDF Test Customer"),
    )
    cur.execute("INSERT INTO billing_invoices (customer_id, period_start, period_end, total_amount, status, external_id, created_at) VALUES (%s, %s, %s, %s, %s, %s, NOW()) RETURNING invoice_id",
                (customer_id, '2026-07-01', '2026-07-31', 1000, 'DRAFT', str(uuid.uuid4())))
    inv_id = cur.fetchone()[0]
    cur.execute("INSERT INTO billing_invoice_lines (invoice_id, description, quantity, unit_price, amount) VALUES (%s, %s, %s, %s, %s)",
                (inv_id, 'Test line', 1, 1000, 1000))
    cur.close()
    resp = client.get(f"/api/admin/billing/invoices/{inv_id}/pdf", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers['Content-Type'] == 'application/pdf'
    assert resp.data.startswith(b'%PDF-1.4')

