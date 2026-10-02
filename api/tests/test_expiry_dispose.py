"""Tests for disposal policy and billing hook."""

from datetime import date, timedelta
import uuid

from db_test_context import get_raw_connection


def _create_floor_pallet(client, auth_headers, warehouse_id=1, customer_id=None):
    body = {"warehouse_id": warehouse_id}
    if customer_id:
        body["customer_id"] = customer_id
    resp = client.post("/api/pallets", json=body, headers=auth_headers)
    assert resp.status_code == 201
    return resp.get_json()


def test_auto_dispose_and_billing(client, auth_headers):
    conn = get_raw_connection()
    cur = conn.cursor()
    # create customer
    cust = str(uuid.uuid4())
    cur.execute("INSERT INTO customers (canonical_id, external_id, customer_name, is_active) VALUES (%s,%s,%s,true)", (cust, str(uuid.uuid4()), "Dispose Cust"))
    cur.execute("INSERT INTO billing_rate_cards (customer_id, service_type, unit, unit_price, currency, external_id) VALUES (%s,'DISPOSAL','PALLET',50000,'VND',%s)", (cust, str(uuid.uuid4())))
    conn.commit()

    # create pallet with customer
    pallet = _create_floor_pallet(client, auth_headers, customer_id=cust)
    pid = pallet["pallet_id"]

    # insert inventory row into QUARANTINE (simulate moved earlier than disposal_delay)
    older = date.today() - timedelta(days=10)
    cur.execute("INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand, lot_number, pallet_id, expiry_date, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING inventory_id", (1, 1, 1, 2, "L", pid, older, older))
    iid = cur.fetchone()[0]
    conn.commit()

    # set app settings to enable auto-dispose and immediate delay
    cur.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('auto_dispose_on_expiry','true', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()")
    cur.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('disposal_delay_days','0', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()")
    cur.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('charge_customer_on_dispose','true', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()")
    conn.commit()

    # run task
    from jobs.expiry_tasks import daily_expiry_scan
    daily_expiry_scan.apply().get()

    # billing event should exist
    cur.execute("SELECT event_type, amount FROM billing_events WHERE reference_table='PALLET' AND reference_id = %s ORDER BY event_id DESC LIMIT 1", (pid,))
    row = cur.fetchone()
    assert row is not None
    assert row[0] == "DISPOSAL"
    cur.close()

