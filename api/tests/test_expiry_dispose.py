"""Tests for auto-disposal policy."""

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


def test_auto_dispose(client, auth_headers):
    conn = get_raw_connection()
    cur = conn.cursor()
    # create pallet
    pallet = _create_floor_pallet(client, auth_headers)
    pid = pallet["pallet_id"]

    # insert inventory row into QUARANTINE (simulate moved earlier than disposal_delay)
    older = date.today() - timedelta(days=10)
    cur.execute("INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand, lot_number, pallet_id, expiry_date, updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING inventory_id", (1, 1, 1, 2, "L", pid, older, older))
    iid = cur.fetchone()[0]
    conn.commit()

    # set app settings to enable auto-dispose and immediate delay
    cur.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('auto_dispose_on_expiry','true', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()")
    cur.execute("INSERT INTO app_settings (key, value, updated_at) VALUES ('disposal_delay_days','0', NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()")
    conn.commit()

    # run task
    from jobs.expiry_tasks import daily_expiry_scan
    assert daily_expiry_scan.apply().get() == {"success": True}
    cur.close()
