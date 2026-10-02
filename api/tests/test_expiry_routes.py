"""Expiry supervisor API: bulk extend and disposal."""

from datetime import date, timedelta

from db_test_context import get_raw_connection


def _create_pallet(client, auth_headers):
    response = client.post(
        "/api/pallets",
        json={"warehouse_id": 1},
        headers=auth_headers,
    )
    assert response.status_code == 201
    return response.get_json()


def test_bulk_extend_updates_pallet_and_inventory(client, auth_headers):
    pallet = _create_pallet(client, auth_headers)
    conn = get_raw_connection()
    cur = conn.cursor()
    old_expiry = date.today() + timedelta(days=2)
    new_expiry = date.today() + timedelta(days=60)
    cur.execute(
        """
        UPDATE pallets
        SET item_id = 1, bin_id = 3, quantity = 2,
            expiry_date = %s, status = 'EXPIRED'
        WHERE pallet_id = %s
        """,
        (old_expiry, pallet["pallet_id"]),
    )
    cur.execute(
        """
        INSERT INTO inventory (
            item_id, bin_id, warehouse_id, quantity_on_hand,
            pallet_id, expiry_date
        ) VALUES (1, 3, 1, 2, %s, %s)
        """,
        (pallet["pallet_id"], old_expiry),
    )

    response = client.post(
        "/api/expiry/extend",
        json={
            "pallet_ids": [pallet["pallet_id"]],
            "expiry_date": new_expiry.isoformat(),
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.get_json()["count"] == 1

    cur.execute(
        "SELECT expiry_date, status FROM pallets WHERE pallet_id = %s",
        (pallet["pallet_id"],),
    )
    assert cur.fetchone() == (new_expiry, "STORED")
    cur.execute(
        "SELECT expiry_date FROM inventory WHERE pallet_id = %s",
        (pallet["pallet_id"],),
    )
    assert cur.fetchone()[0] == new_expiry
    cur.close()


def test_bulk_dispose_removes_inventory_and_marks_pallet(client, auth_headers):
    pallet = _create_pallet(client, auth_headers)
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute(
        """
        UPDATE pallets
        SET item_id = 1, bin_id = 3, quantity = 2, status = 'EXPIRED'
        WHERE pallet_id = %s
        """,
        (pallet["pallet_id"],),
    )
    cur.execute(
        """
        INSERT INTO inventory (
            item_id, bin_id, warehouse_id, quantity_on_hand, pallet_id
        ) VALUES (1, 3, 1, 2, %s)
        """,
        (pallet["pallet_id"],),
    )

    response = client.post(
        "/api/expiry/dispose",
        json={"pallet_ids": [pallet["pallet_id"]]},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.get_json()["pallet_count"] == 1

    cur.execute(
        "SELECT status, quantity FROM pallets WHERE pallet_id = %s",
        (pallet["pallet_id"],),
    )
    assert cur.fetchone() == ("DISPOSED", 0)
    cur.execute(
        "SELECT COUNT(*) FROM inventory WHERE pallet_id = %s",
        (pallet["pallet_id"],),
    )
    assert cur.fetchone()[0] == 0
    cur.close()
