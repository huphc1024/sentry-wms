"""Phase 3: /api/portal/* endpoints.

The property that matters here is tenant isolation, so almost every test
sets up two customers and asserts that one cannot see or use the other's
rows. Fixture data is inserted on the raw connection from
db_test_context, which is the same connection the autouse
_db_transaction fixture wraps -- so the app sees the rows and the whole
lot is rolled back at teardown.
"""

import bcrypt
import pytest

from db_test_context import get_raw_connection

WAREHOUSE_ID = 1
STORAGE_BIN_ID = 3
SECOND_BIN_ID = 4

ALL_FEATURES = ("inventory", "orders", "inbound", "invoices")


class PortalWorld:
    """Two customers, each with stock, orders and invoices of their own."""

    def __init__(self, client):
        self.client = client
        self.cur = get_raw_connection().cursor()

    # -- builders ---------------------------------------------------

    def customer(self, code, name=None):
        self.cur.execute(
            "INSERT INTO customers (customer_name, customer_code, is_active) "
            "VALUES (%s, %s, TRUE) RETURNING canonical_id",
            (name or f"{code} Ltd", code),
        )
        return str(self.cur.fetchone()[0])

    def login(self, customer_id, username, password="portal-pw-1",
              features=ALL_FEATURES, must_change_password=False):
        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        self.cur.execute(
            "INSERT INTO customer_users (customer_id, username, password_hash, "
            "full_name, is_active, must_change_password) "
            "VALUES (%s, %s, %s, %s, TRUE, %s) RETURNING customer_user_id",
            (customer_id, username, pw_hash, "Portal User", must_change_password),
        )
        cu_id = self.cur.fetchone()[0]
        for key in features:
            self.cur.execute(
                "INSERT INTO customer_user_permissions (customer_user_id, feature_key) "
                "VALUES (%s, %s)",
                (cu_id, key),
            )
        return cu_id

    def item(self, sku, owner_customer_id, name=None):
        self.cur.execute(
            "INSERT INTO items (sku, item_name, owner_customer_id, is_active, external_id) "
            "VALUES (%s, %s, %s, TRUE, gen_random_uuid()) RETURNING item_id",
            (sku, name or f"Item {sku}", owner_customer_id),
        )
        return self.cur.fetchone()[0]

    def stock(self, item_id, qty, bin_id=STORAGE_BIN_ID, warehouse_id=WAREHOUSE_ID,
              allocated=0):
        self.cur.execute(
            "INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand, "
            "quantity_allocated) VALUES (%s, %s, %s, %s, %s)",
            (item_id, bin_id, warehouse_id, qty, allocated),
        )

    def order(self, so_number, customer_ref, item_id, qty=5, status="OPEN"):
        self.cur.execute(
            "INSERT INTO sales_orders (so_number, customer_ref, status, warehouse_id, "
            "order_date, external_id) "
            "VALUES (%s, %s, %s, %s, NOW(), gen_random_uuid()) RETURNING so_id",
            (so_number, customer_ref, status, WAREHOUSE_ID),
        )
        so_id = self.cur.fetchone()[0]
        self.cur.execute(
            "INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) "
            "VALUES (%s, %s, %s, 1)",
            (so_id, item_id, qty),
        )
        return so_id

    def purchase_order(self, po_number, owner_customer_id, item_id, qty=10):
        self.cur.execute(
            "INSERT INTO purchase_orders (po_number, owner_customer_id, status, "
            "warehouse_id, expected_date, external_id) "
            "VALUES (%s, %s, 'OPEN', %s, CURRENT_DATE, gen_random_uuid()) RETURNING po_id",
            (po_number, owner_customer_id, WAREHOUSE_ID),
        )
        po_id = self.cur.fetchone()[0]
        self.cur.execute(
            "INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) "
            "VALUES (%s, %s, %s, 1)",
            (po_id, item_id, qty),
        )
        return po_id

    def invoice(self, number, customer_id, total=100, issued=True):
        self.cur.execute(
            "INSERT INTO billing_invoices (invoice_number, customer_id, total_amount, "
            "status, issued_at, external_id) "
            "VALUES (%s, %s, %s, %s, %s, gen_random_uuid()) RETURNING invoice_id",
            (number, customer_id, total, "ISSUED" if issued else "DRAFT",
             "2026-01-01T00:00:00Z" if issued else None),
        )
        return self.cur.fetchone()[0]

    # -- helpers ----------------------------------------------------

    def token(self, username, password="portal-pw-1"):
        r = self.client.post(
            "/api/portal/auth/login",
            json={"username": username, "password": password},
        )
        assert r.status_code == 200, r.get_json()
        return {"Authorization": f"Bearer {r.get_json()['token']}"}


@pytest.fixture()
def world(client):
    w = PortalWorld(client)
    w.a_id = w.customer("PORTAL-A", "Alpha Logistics")
    w.b_id = w.customer("PORTAL-B", "Bravo Trading")
    w.login(w.a_id, "alpha-user")
    w.login(w.b_id, "bravo-user")
    w.a_item = w.item("ALPHA-SKU-1", w.a_id)
    w.b_item = w.item("BRAVO-SKU-1", w.b_id)
    w.stock(w.a_item, 40, allocated=10)
    w.stock(w.b_item, 77)
    w.a_auth = w.token("alpha-user")
    w.b_auth = w.token("bravo-user")
    return w


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------

def test_login_rejects_wrong_password(client, world):
    r = client.post(
        "/api/portal/auth/login",
        json={"username": "alpha-user", "password": "not-the-password"},
    )
    assert r.status_code == 401


def test_staff_username_cannot_log_in_at_the_portal(client, world):
    """authenticate_customer_user queries customer_users only, so the
    seeded admin account is not a portal identity."""
    r = client.post(
        "/api/portal/auth/login", json={"username": "admin", "password": "admin"}
    )
    assert r.status_code == 401


def test_portal_username_cannot_log_in_as_staff(client, world):
    r = client.post(
        "/api/auth/login",
        json={"username": "alpha-user", "password": "portal-pw-1"},
    )
    assert r.status_code == 401


def test_me_returns_the_callers_own_customer(client, world):
    r = client.get("/api/portal/auth/me", headers=world.a_auth)
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["customer_id"] == world.a_id
    assert body["customer_code"] == "PORTAL-A"
    assert sorted(body["features"]) == sorted(ALL_FEATURES)


def test_portal_token_rejected_on_a_staff_endpoint(client, world):
    """End-to-end confirmation of the phase 2 audience split, on real
    routes rather than a probe app."""
    r = client.get("/api/admin/items", headers=world.a_auth)
    assert r.status_code == 403


def test_staff_token_rejected_on_a_portal_endpoint(client, auth_headers, world):
    r = client.get("/api/portal/inventory", headers=auth_headers)
    assert r.status_code == 403


# ------------------------------------------------------------------
# Inventory
# ------------------------------------------------------------------

def test_inventory_shows_only_own_stock(client, world):
    r = client.get("/api/portal/inventory", headers=world.a_auth)
    assert r.status_code == 200, r.get_json()
    skus = [i["sku"] for i in r.get_json()["items"]]
    assert skus == ["ALPHA-SKU-1"]
    assert "BRAVO-SKU-1" not in skus


def test_inventory_derives_available_from_on_hand_minus_allocated(client, world):
    r = client.get("/api/portal/inventory", headers=world.a_auth)
    row = r.get_json()["items"][0]
    assert row["quantity_on_hand"] == 40
    assert row["quantity_allocated"] == 10
    assert row["quantity_available"] == 30


def test_inventory_does_not_leak_the_warehouse_layout(client, world):
    """Bin and zone are the operator's layout, not the tenant's data."""
    r = client.get("/api/portal/inventory", headers=world.a_auth)
    row = r.get_json()["items"][0]
    for leaked in ("bin_code", "bin_id", "zone", "zone_code", "bin"):
        assert leaked not in row


def test_inventory_search_cannot_reach_another_customers_sku(client, world):
    r = client.get("/api/portal/inventory?search=BRAVO", headers=world.a_auth)
    assert r.status_code == 200
    assert r.get_json()["items"] == []
    assert r.get_json()["total"] == 0


def test_inventory_requires_the_feature_grant(client, world):
    world.login(world.a_id, "alpha-nofeat", features=())
    auth = world.token("alpha-nofeat")
    r = client.get("/api/portal/inventory", headers=auth)
    assert r.status_code == 403
    assert r.get_json()["feature_key"] == "inventory"


def test_inventory_page_size_is_capped(client, world):
    r = client.get("/api/portal/inventory?page_size=100000", headers=world.a_auth)
    assert r.status_code == 200
    assert r.get_json()["page_size"] == 200


# ------------------------------------------------------------------
# Orders
# ------------------------------------------------------------------

def test_orders_list_scoped_to_caller(client, world):
    world.order("SO-ALPHA-1", world.a_id, world.a_item)
    world.order("SO-BRAVO-1", world.b_id, world.b_item)

    r = client.get("/api/portal/orders", headers=world.a_auth)
    assert r.status_code == 200, r.get_json()
    numbers = [o["so_number"] for o in r.get_json()["orders"]]
    assert numbers == ["SO-ALPHA-1"]


def test_other_customers_order_is_404_not_403(client, world):
    """403 would confirm the order number exists. The scope clause is part
    of the WHERE, so "not yours" and "no such order" are the same result."""
    world.order("SO-BRAVO-2", world.b_id, world.b_item)

    mine = client.get("/api/portal/orders/SO-BRAVO-2", headers=world.b_auth)
    assert mine.status_code == 200

    theirs = client.get("/api/portal/orders/SO-BRAVO-2", headers=world.a_auth)
    nonexistent = client.get("/api/portal/orders/SO-NO-SUCH-THING", headers=world.a_auth)
    assert theirs.status_code == 404
    assert nonexistent.status_code == 404
    assert theirs.get_json() == nonexistent.get_json()


def test_submit_order_sets_server_controlled_fields(client, world):
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 3}]},
    )
    assert r.status_code == 201, r.get_json()
    so_number = r.get_json()["so_number"]
    assert so_number.startswith("PORTAL-PORTAL-A-")

    row = get_raw_connection().cursor()
    row.execute(
        "SELECT customer_ref, status, order_origin, source_system, created_by, "
        "       warehouse_id "
        "FROM sales_orders WHERE so_number = %s",
        (so_number,),
    )
    customer_ref, status, origin, source_system, created_by, wid = row.fetchone()
    assert str(customer_ref) == world.a_id
    assert status == "OPEN"
    assert origin == "customer-portal"
    # FK-gated against the operator-managed allowlist; a portal order has
    # no source ERP, so it must stay NULL.
    assert source_system is None
    assert created_by == "portal:alpha-user"
    assert wid == WAREHOUSE_ID


def test_submit_order_rejects_another_customers_sku(client, world):
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "BRAVO-SKU-1", "quantity": 1}]},
    )
    assert r.status_code == 400
    assert r.get_json()["sku"] == "BRAVO-SKU-1"

    # And reports it identically to a SKU that does not exist at all.
    absent = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "NO-SUCH-SKU", "quantity": 1}]},
    )
    assert absent.status_code == 400
    assert absent.get_json()["error"] == r.get_json()["error"]


def test_submit_order_rejects_a_body_supplied_customer(client, world):
    """A body naming its own customer / priority / status is rejected
    outright, not silently ignored: validate_body applies extra="forbid"
    (V-017), so an unknown top-level key is a 400. That is the stronger
    behaviour -- a client trying to escalate gets told it failed instead
    of getting a 201 and believing the field took effect."""
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={
            "lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}],
            "customer_ref": world.b_id,
            "customer_id": "PORTAL-B",
            "priority": 999,
            "status": "SHIPPED",
        },
    )
    assert r.status_code == 400, r.get_json()
    rejected = {d["loc"][0] for d in r.get_json()["details"]}
    assert {"customer_ref", "customer_id", "priority", "status"} <= rejected


def test_submit_order_attributes_to_the_caller_not_the_body(client, world):
    """The accepted shape carries no customer field at all, so
    customer_ref can only come from the authenticated session."""
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}]},
    )
    assert r.status_code == 201, r.get_json()
    cur = get_raw_connection().cursor()
    cur.execute(
        "SELECT customer_ref, status, priority FROM sales_orders WHERE so_number = %s",
        (r.get_json()["so_number"],),
    )
    customer_ref, status, priority = cur.fetchone()
    assert str(customer_ref) == world.a_id
    assert status == "OPEN"
    assert priority == 0


def test_submit_order_requires_warehouse_when_stock_spans_several(client, world):
    """Rather than guessing which site to ship from."""
    cur = get_raw_connection().cursor()
    cur.execute(
        "INSERT INTO warehouses (warehouse_code, warehouse_name) "
        "VALUES ('PWH-2', 'Portal WH 2') RETURNING warehouse_id"
    )
    wh2 = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type) "
        "VALUES (%s, 'PZ', 'Portal Zone', 'STORAGE') RETURNING zone_id",
        (wh2,),
    )
    zone_id = cur.fetchone()[0]
    cur.execute(
        "INSERT INTO bins (warehouse_id, zone_id, bin_code, bin_barcode, bin_type, "
        "external_id) "
        "VALUES (%s, %s, 'PB-1', 'PB-1', 'Pickable', gen_random_uuid()) RETURNING bin_id",
        (wh2, zone_id),
    )
    bin2 = cur.fetchone()[0]
    world.stock(world.a_item, 5, bin_id=bin2, warehouse_id=wh2)

    ambiguous = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}]},
    )
    assert ambiguous.status_code == 400
    assert "PWH-2" in ambiguous.get_json()["choices"]

    chosen = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}],
              "warehouse_code": "PWH-2"},
    )
    assert chosen.status_code == 201, chosen.get_json()


def test_submit_order_rejects_a_warehouse_the_caller_has_no_stock_in(client, world):
    cur = get_raw_connection().cursor()
    cur.execute(
        "INSERT INTO warehouses (warehouse_code, warehouse_name) "
        "VALUES ('PWH-EMPTY', 'Empty') RETURNING warehouse_id"
    )
    cur.fetchone()
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}],
              "warehouse_code": "PWH-EMPTY"},
    )
    assert r.status_code == 404


def test_submit_order_rejects_duplicate_skus(client, world):
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [
            {"sku": "ALPHA-SKU-1", "quantity": 1},
            {"sku": "alpha-sku-1", "quantity": 2},
        ]},
    )
    assert r.status_code == 400


def test_submit_order_rejects_non_positive_quantity(client, world):
    r = client.post(
        "/api/portal/orders",
        headers=world.a_auth,
        json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 0}]},
    )
    assert r.status_code == 400


def test_concurrent_submissions_get_distinct_so_numbers(client, world):
    """so_number comes off a sequence; MAX(...)+1 would collide."""
    numbers = set()
    for _ in range(3):
        r = client.post(
            "/api/portal/orders",
            headers=world.a_auth,
            json={"lines": [{"sku": "ALPHA-SKU-1", "quantity": 1}]},
        )
        assert r.status_code == 201, r.get_json()
        numbers.add(r.get_json()["so_number"])
    assert len(numbers) == 3


# ------------------------------------------------------------------
# Inbound
# ------------------------------------------------------------------

def test_inbound_scoped_to_caller(client, world):
    world.purchase_order("PO-ALPHA-1", world.a_id, world.a_item)
    world.purchase_order("PO-BRAVO-1", world.b_id, world.b_item)

    r = client.get("/api/portal/inbound", headers=world.a_auth)
    assert r.status_code == 200, r.get_json()
    numbers = [p["po_number"] for p in r.get_json()["purchase_orders"]]
    assert numbers == ["PO-ALPHA-1"]


def test_inbound_hides_unattributed_purchase_orders(client, world):
    """purchase_orders.owner_customer_id has no backfill (mig 087), so a
    pre-phase-1 PO belongs to nobody and must surface for nobody."""
    cur = get_raw_connection().cursor()
    cur.execute(
        "INSERT INTO purchase_orders (po_number, status, warehouse_id, external_id) "
        "VALUES ('PO-LEGACY-1', 'OPEN', %s, gen_random_uuid())",
        (WAREHOUSE_ID,),
    )
    r = client.get("/api/portal/inbound", headers=world.a_auth)
    numbers = [p["po_number"] for p in r.get_json()["purchase_orders"]]
    assert "PO-LEGACY-1" not in numbers


# ------------------------------------------------------------------
# Invoices
# ------------------------------------------------------------------

def test_invoices_scoped_to_caller(client, world):
    world.invoice("INV-ALPHA-1", world.a_id)
    world.invoice("INV-BRAVO-1", world.b_id)

    r = client.get("/api/portal/invoices", headers=world.a_auth)
    assert r.status_code == 200, r.get_json()
    numbers = [i["invoice_number"] for i in r.get_json()["invoices"]]
    assert numbers == ["INV-ALPHA-1"]


def test_draft_invoices_are_withheld(client, world):
    """An operator revises a draft's total before issuing it; publishing
    one means the customer reads a figure that then changes."""
    world.invoice("INV-ALPHA-DRAFT", world.a_id, issued=False)
    world.invoice("INV-ALPHA-ISSUED", world.a_id, issued=True)

    r = client.get("/api/portal/invoices", headers=world.a_auth)
    numbers = [i["invoice_number"] for i in r.get_json()["invoices"]]
    assert numbers == ["INV-ALPHA-ISSUED"]

    detail = client.get("/api/portal/invoices/INV-ALPHA-DRAFT", headers=world.a_auth)
    assert detail.status_code == 404


def test_other_customers_invoice_is_404(client, world):
    world.invoice("INV-BRAVO-2", world.b_id)
    r = client.get("/api/portal/invoices/INV-BRAVO-2", headers=world.a_auth)
    assert r.status_code == 404
