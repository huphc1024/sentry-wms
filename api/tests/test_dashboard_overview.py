"""DB-backed route tests for /api/admin/dashboard/*. Pure logic lives in
tests_unit/test_dashboard_pure.py. Written without a local Postgres: unrun.
"""

import bcrypt

from db_test_context import get_raw_connection


def _one(sql, params=None):
    cur = get_raw_connection().cursor()
    cur.execute(sql, params or ())
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def _exec(sql, params=None):
    cur = get_raw_connection().cursor()
    cur.execute(sql, params or ())
    cur.close()


def _make_order(status="OPEN", total=100, warehouse_id=1):
    return _one(
        "INSERT INTO sales_orders (so_number, status, warehouse_id, order_total, "
        "order_date, external_id) VALUES (%s, %s, %s, %s, NOW(), gen_random_uuid()) "
        "RETURNING so_id",
        (f"DASH-{status}-{total}-{warehouse_id}-{_one('SELECT COUNT(*) FROM sales_orders')}",
         status, warehouse_id, total),
    )


def _other_wh_user(client):
    pw = bcrypt.hashpw(b"dash12345", bcrypt.gensalt()).decode("utf-8")
    _exec(
        "INSERT INTO users (username, password_hash, full_name, role, warehouse_id, "
        "warehouse_ids, external_id) VALUES ('dashuser', %s, 'Dash', 'USER', 2, %s, gen_random_uuid())",
        (pw, [2]),
    )
    r = client.post("/api/auth/login", json={"username": "dashuser", "password": "dash12345"})
    return {"Authorization": f"Bearer {r.get_json()['token']}"}


class TestOverview:
    def test_requires_auth(self, client):
        assert client.get("/api/admin/dashboard/overview?warehouse_id=1").status_code == 401

    def test_requires_warehouse_id(self, client, auth_headers):
        assert client.get("/api/admin/dashboard/overview", headers=auth_headers).status_code == 400

    def test_invalid_days(self, client, auth_headers):
        r = client.get("/api/admin/dashboard/overview?warehouse_id=1&days=5", headers=auth_headers)
        assert r.status_code == 400

    def test_shape_and_gap_fill(self, client, auth_headers):
        _make_order("OPEN")
        _make_order("PICKED")
        body = client.get("/api/admin/dashboard/overview?warehouse_id=1&days=14",
                          headers=auth_headers).get_json()
        assert set(body) == {"kpis", "series", "status_breakdown", "stock_by_zone"}
        for k in ("orders_open", "orders_picked", "orders_packed", "orders_shipped_today",
                  "backorders", "low_stock_items", "near_expiry_units", "expired_units",
                  "pending_variances", "open_po_lines", "inbound_expected_units"):
            assert isinstance(body["kpis"][k], int)
        assert body["kpis"]["orders_open"] >= 1 and body["kpis"]["orders_picked"] >= 1
        for s in ("orders_created", "orders_shipped", "received_units"):
            assert len(body["series"][s]) == 14
        assert sum(p["value"] for p in body["series"]["orders_created"]) >= 2
        assert {"OPEN", "PICKED"} <= {r["status"] for r in body["status_breakdown"]}

    def test_default_days_is_7(self, client, auth_headers):
        body = client.get("/api/admin/dashboard/overview?warehouse_id=1",
                          headers=auth_headers).get_json()
        assert len(body["series"]["orders_created"]) == 7

    def test_warehouse_access_denied(self, client):
        headers = _other_wh_user(client)
        r = client.get("/api/admin/dashboard/overview?warehouse_id=1", headers=headers)
        assert r.status_code == 403


class TestSales:
    def test_requires_auth(self, client):
        assert client.get("/api/admin/dashboard/sales?warehouse_id=1").status_code == 401

    def test_90_days_ok_overview_rejects(self, client, auth_headers):
        assert client.get("/api/admin/dashboard/sales?warehouse_id=1&days=90",
                          headers=auth_headers).status_code == 200
        assert client.get("/api/admin/dashboard/overview?warehouse_id=1&days=90",
                          headers=auth_headers).status_code == 400

    def test_kpis_and_series(self, client, auth_headers):
        _make_order("SHIPPED", 100)
        _make_order("SHIPPED", 50)
        _make_order("CANCELLED", 999)
        body = client.get("/api/admin/dashboard/sales?warehouse_id=1&days=7",
                          headers=auth_headers).get_json()
        k = body["kpis"]
        assert k["orders"] >= 2 and k["revenue"] >= 150
        assert k["cancelled_orders"] >= 1
        assert k["avg_order_value"] == round(k["revenue"] / k["orders"], 2)
        assert len(body["series"]["revenue"]) == 7
        assert isinstance(body["by_channel"], list) and len(body["top_items"]) <= 10
        assert "customer" not in str(body).lower()
