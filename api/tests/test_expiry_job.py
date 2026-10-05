"""Tests for the expiry daily job."""

from datetime import date, timedelta

from db_test_context import get_raw_connection


def _create_floor_pallet(client, auth_headers, warehouse_id=1):
    resp = client.post("/api/pallets", json={"warehouse_id": warehouse_id}, headers=auth_headers)
    assert resp.status_code == 201
    return resp.get_json()


def test_daily_expiry_moves_inventory_and_marks_pallet(client, auth_headers):
    # create pallet
    pallet = _create_floor_pallet(client, auth_headers)
    pallet_id = pallet["pallet_id"]

    # insert inventory row with expiry yesterday
    conn = get_raw_connection()
    cur = conn.cursor()
    yesterday = date.today() - timedelta(days=1)
    cur.execute(
        """
        INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand, lot_number, pallet_id, expiry_date)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING inventory_id
        """,
        (1, 1, 1, 3, "LOT-EXP", pallet_id, yesterday),
    )
    inv_id = cur.fetchone()[0]
    conn.commit()

    # run celery task in eager mode
    from jobs.expiry_tasks import daily_expiry_scan

    daily_expiry_scan.apply().get()

    # Verify inventory moved to QUARANTINE bin (primary guarantee)
    cur.execute("SELECT bin_id FROM bins WHERE warehouse_id = 1 AND bin_code = 'QUARANTINE' LIMIT 1")
    qbin = cur.fetchone()[0]
    cur.execute("SELECT bin_id FROM inventory WHERE inventory_id = %s", (inv_id,))
    assert cur.fetchone() is None
    cur.execute(
        """
        SELECT bin_id, quantity_on_hand
        FROM inventory
        WHERE pallet_id = %s
        """,
        (pallet_id,),
    )
    assert cur.fetchone() == (qbin, 3)
    cur.execute(
        "SELECT status, bin_id FROM pallets WHERE pallet_id = %s",
        (pallet_id,),
    )
    assert cur.fetchone() == ("EXPIRED", qbin)

    # Verify integration event recorded
    cur.execute(
        """
        SELECT event_type, payload
          FROM integration_events
         WHERE event_type = 'expiry.expired'
         LIMIT 1
        """
    )
    row = cur.fetchone()
    assert row is not None
    assert row[0] == "expiry.expired"
    cur.close()

