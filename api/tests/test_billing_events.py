import uuid

from db_test_context import get_raw_connection


def test_billing_event_auto_priced(client, auth_headers):
    # Create a customer row in canonical customers table
    conn = get_raw_connection()
    cur = conn.cursor()
    cust_id = str(uuid.uuid4())
    cur.execute("INSERT INTO customers (canonical_id, external_id, customer_name, is_active) VALUES (%s, %s, %s, true)",
                (cust_id, str(uuid.uuid4()), "Billing Test Customer"))
    # STORAGE_DAY events resolve the STORAGE service rate.
    cur.execute("INSERT INTO billing_rate_cards (customer_id, service_type, unit, unit_price, currency, external_id) VALUES (NULL, 'STORAGE', 'PALLET_DAY', 250000, 'VND', %s)",
                (str(uuid.uuid4()),))
    cur.close()

    # Call create billing event endpoint; amount should be auto-applied from rate card
    resp = client.post("/api/admin/billing/events", json={
        "customer_id": cust_id,
        "warehouse_id": 1,
        "event_type": "STORAGE_DAY",
        "reference_table": "PALLET",
        "reference_id": 1,
        "quantity": 2
    }, headers=auth_headers)
    assert resp.status_code == 201
    body = resp.get_json()
    assert "amount" in body
    assert body["amount"] == 500000.0

