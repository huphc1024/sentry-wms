"""Phase 2 — pallet-centric receive / put-away."""

import uuid

import pytest
from db_test_context import get_raw_connection


def _create_floor_pallet(client, auth_headers, warehouse_id=1, customer_id=None):
    body = {"warehouse_id": warehouse_id}
    if customer_id:
        body["customer_id"] = customer_id
    resp = client.post("/api/pallets", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()


def _receive(client, auth_headers, *, pallet_code=None, item_id=1, quantity=5, bin_id=1, customer_id=None):
    body = {
        "po_id": 1,
        "items": [{"item_id": item_id, "quantity": quantity, "bin_id": bin_id}],
    }
    if pallet_code:
        body["items"][0]["pallet_code"] = pallet_code
    if customer_id:
        body["customer_id"] = customer_id
    return client.post("/api/receiving/receive", json=body, headers=auth_headers)


def _set_app_setting(key, value):
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        """,
        (key, value),
    )
    cur.close()


@pytest.fixture
def restore_require_pallet_setting():
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("SELECT value FROM app_settings WHERE key = 'require_pallet_on_receive'")
    row = cur.fetchone()
    original = row[0] if row else None
    cur.close()
    yield
    cur = conn.cursor()
    if original is None:
        cur.execute("DELETE FROM app_settings WHERE key = 'require_pallet_on_receive'")
    else:
        cur.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('require_pallet_on_receive', %s, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            """,
            (original,),
        )
    cur.close()


class TestFloorPallets:
    def test_create_floor_pallet(self, client, auth_headers):
        created = _create_floor_pallet(client, auth_headers)
        assert created["pallet_id"]
        assert created["pallet_code"]
        assert created["pallet_code"] == created["pallet_barcode"]

    def test_next_code(self, client, auth_headers):
        resp = client.get("/api/pallets/next-code?warehouse_id=1", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()["pallet_code"]


class TestPalletReceive:
    def test_receive_binds_pallet_and_inventory(self, client, auth_headers):
        pallet = _create_floor_pallet(client, auth_headers)
        resp = _receive(client, auth_headers, pallet_code=pallet["pallet_code"], quantity=3)
        assert resp.status_code == 200

        conn = get_raw_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT item_id, quantity, bin_id FROM pallets WHERE pallet_id = %s",
            (pallet["pallet_id"],),
        )
        row = cur.fetchone()
        assert row[0] == 1
        assert row[1] == 3
        assert row[2] == 1

        cur.execute(
            """
            SELECT pallet_id FROM inventory
             WHERE item_id = 1 AND bin_id = 1 AND warehouse_id = 1
               AND pallet_id = %s
            """,
            (pallet["pallet_id"],),
        )
        assert cur.fetchone() is not None
        cur.close()

    def test_require_pallet_setting_blocks_receive(
        self, client, auth_headers, restore_require_pallet_setting
    ):
        _set_app_setting("require_pallet_on_receive", "true")
        resp = _receive(client, auth_headers, quantity=1)
        assert resp.status_code == 400
        assert "pallet_code" in resp.get_json()["error"]

        pallet = _create_floor_pallet(client, auth_headers)
        ok = _receive(client, auth_headers, pallet_code=pallet["pallet_code"], quantity=1)
        assert ok.status_code == 200

    def test_inbound_billing_event_when_customer_on_pallet(self, client, auth_headers):
        conn = get_raw_connection()
        cur = conn.cursor()
        cust_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO customers (canonical_id, external_id, customer_name, is_active)
            VALUES (%s, %s, %s, true)
            """,
            (cust_id, str(uuid.uuid4()), "Pallet Receive Customer"),
        )
        cur.execute(
            """
            INSERT INTO billing_rate_cards (customer_id, service_type, unit, unit_price, currency, external_id)
            VALUES (%s, 'INBOUND', 'UNIT', 10000, 'VND', %s)
            """,
            (cust_id, str(uuid.uuid4())),
        )
        cur.close()

        pallet = _create_floor_pallet(client, auth_headers, customer_id=cust_id)
        resp = _receive(client, auth_headers, pallet_code=pallet["pallet_code"], quantity=2)
        assert resp.status_code == 200

        cur = conn.cursor()
        cur.execute(
            """
            SELECT event_type, reference_id, quantity, amount
              FROM billing_events
             WHERE customer_id = %s AND event_type = 'INBOUND'
             ORDER BY event_id DESC LIMIT 1
            """,
            (cust_id,),
        )
        row = cur.fetchone()
        cur.close()
        assert row is not None
        assert row[0] == "INBOUND"
        assert row[1] == pallet["pallet_id"]
        assert float(row[2]) == 2.0
        assert float(row[3]) == 20000.0


class TestPalletPutaway:
    def test_putaway_requires_matching_pallet_scan(self, client, auth_headers):
        pallet = _create_floor_pallet(client, auth_headers)
        assert _receive(
            client, auth_headers, pallet_code=pallet["pallet_code"], quantity=4
        ).status_code == 200

        pending = client.get("/api/putaway/pending/1", headers=auth_headers).get_json()
        row = next(p for p in pending["pending_items"] if p.get("pallet_id") == pallet["pallet_id"])

        missing = client.post(
            "/api/putaway/confirm",
            json={
                "item_id": row["item_id"],
                "from_bin_id": row["bin_id"],
                "to_bin_id": 3,
                "quantity": row["quantity"],
                "pallet_id": row["pallet_id"],
            },
            headers=auth_headers,
        )
        assert missing.status_code == 400

        wrong = client.post(
            "/api/putaway/confirm",
            json={
                "item_id": row["item_id"],
                "from_bin_id": row["bin_id"],
                "to_bin_id": 3,
                "quantity": row["quantity"],
                "pallet_id": row["pallet_id"],
                "pallet_code": "WRONG-PALLET",
            },
            headers=auth_headers,
        )
        assert wrong.status_code == 400

        ok = client.post(
            "/api/putaway/confirm",
            json={
                "item_id": row["item_id"],
                "from_bin_id": row["bin_id"],
                "to_bin_id": 3,
                "quantity": row["quantity"],
                "pallet_id": row["pallet_id"],
                "pallet_code": pallet["pallet_code"],
            },
            headers=auth_headers,
        )
        assert ok.status_code == 200

        conn = get_raw_connection()
        cur = conn.cursor()
        cur.execute("SELECT bin_id FROM pallets WHERE pallet_id = %s", (pallet["pallet_id"],))
        assert cur.fetchone()[0] == 3
        cur.close()
