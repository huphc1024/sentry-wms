"""Customer-bound WMS tokens (mig 089 / phase 6).

``wms_tokens.customer_id`` existed since migration 089 but nothing read
it: a token issued to customer A's ERP could POST an order naming
customer B and could page the whole inventory snapshot. These tests
cover the three places that changed:

  services/customer_token_scope.py  inbound writes: stamp the owner,
                                    refuse a payload naming another
                                    tenant, refuse an existing row
                                    owned by another tenant
  routes/snapshot.py                reads: only the caller's own stock
  middleware/auth_middleware.py     surfaces with no tenant dimension
                                    (event feed, dockd, POS) are refused

Every test asserts the operator-token behaviour too, because the
regression that matters most here is the boring one: a token with
customer_id NULL -- every token issued before this change -- must behave
exactly as it did before.
"""

import base64
import hashlib
import json
import os
import sys
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")
os.environ.setdefault("SENTRY_ENCRYPTION_KEY", "t5hPIEVn_O41qfiMqAiPEnwzQh68o3Es46YfSOBvEK8=")
os.environ.setdefault("SENTRY_TOKEN_PEPPER", "NEVER_USE_THIS_PEPPER_IN_PRODUCTION")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import psycopg2
import yaml

import db_test_context
from services import token_cache
from services.mapping_loader import (
    LoadedMappingFile,
    MappingDocument,
    MappingRegistry,
)


PEPPER = os.environ["SENTRY_TOKEN_PEPPER"]
DATABASE_URL = os.environ["DATABASE_URL"]


def _hash(plaintext: str) -> str:
    return hashlib.sha256((PEPPER + plaintext).encode("utf-8")).hexdigest()


def _query(sql, params=()):
    """SELECT against the test transaction's own connection, so writes
    the Flask handler made through g.db are visible."""
    conn = db_test_context.get_raw_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        if cur.description is None:
            return None
        return cur.fetchall()
    finally:
        cur.close()


def _exec(sql, params=()):
    conn = db_test_context.get_raw_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.fetchone() if cur.description else None
    finally:
        cur.close()


# ----------------------------------------------------------------------
# Fixtures / helpers
# ----------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_token_cache():
    token_cache.clear()
    yield
    token_cache.clear()


def _fresh_source(prefix="custscope"):
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _make_customer(code=None, name="Scope Test Co"):
    """Insert a customers row on the test connection (rolls back)."""
    code = code or f"CST{uuid.uuid4().hex[:6].upper()}"
    row = _exec(
        "INSERT INTO customers (customer_code, customer_name) "
        "VALUES (%s, %s) RETURNING canonical_id",
        (code, name),
    )
    return {"customer_id": str(row[0]), "customer_code": code}


def _make_token(
    ss,
    plaintext,
    *,
    customer_id=None,
    inbound_resources=("sales_orders",),
    endpoints=(),
    warehouse_ids=(1,),
    event_types=(),
):
    """Insert wms_tokens (+ the allowlist row the FK needs) on the test
    connection so both roll back at end-of-test -- same reasoning as
    test_inbound_sales_orders_endpoint._insert_via_test_conn."""
    conn = db_test_context.get_raw_connection()
    cur = conn.cursor()
    try:
        if ss:
            cur.execute(
                "INSERT INTO inbound_source_systems_allowlist (source_system, kind) "
                "VALUES (%s, 'internal_tool') ON CONFLICT DO NOTHING",
                (ss,),
            )
        cur.execute(
            "INSERT INTO wms_tokens "
            "(token_name, token_hash, status, warehouse_ids, event_types, "
            " endpoints, source_system, inbound_resources, mapping_override, "
            " mapping_overrides, customer_id) "
            "VALUES (%s, %s, 'active', %s, %s, %s, %s, %s, false, '{}'::jsonb, %s) "
            "RETURNING token_id",
            (
                f"custscope-{uuid.uuid4().hex[:6]}",
                _hash(plaintext),
                list(warehouse_ids),
                list(event_types),
                list(endpoints),
                ss,
                list(inbound_resources),
                customer_id,
            ),
        )
        return cur.fetchone()[0]
    finally:
        cur.close()


def _build_registry(app, ss, body_yaml):
    doc = MappingDocument.model_validate(yaml.safe_load(body_yaml))
    registry = MappingRegistry()
    registry.register(
        LoadedMappingFile(document=doc, path=f"<test:{ss}>", sha256="0" * 64)
    )
    app.config["MAPPING_REGISTRY"] = registry
    return doc


_SO_MAPPING = """\
mapping_version: "1.0"
source_system: "{ss}"
version_compare: "lexicographic"
resources:
  sales_orders:
    canonical_type: "sales_order"
    fields:
      - canonical: "so_number"
        source_path: "$.orderNumber"
        type: "string"
        required: true
      - canonical: "warehouse_id"
        source_path: "$.warehouseId"
        type: "integer"
        required: true
      - canonical: "customer_ref"
        source_path: "$.customerRef"
        type: "string"
      - canonical: "customer_id"
        source_path: "$.customerCode"
        type: "string"
"""

_ITEM_MAPPING = """\
mapping_version: "1.0"
source_system: "{ss}"
version_compare: "lexicographic"
resources:
  items:
    canonical_type: "item"
    fields:
      - canonical: "sku"
        source_path: "$.sku"
        type: "string"
        required: true
      - canonical: "item_name"
        source_path: "$.name"
        type: "string"
        required: true
"""

_CUSTOMER_MAPPING = """\
mapping_version: "1.0"
source_system: "{ss}"
version_compare: "lexicographic"
resources:
  customers:
    canonical_type: "customer"
    fields:
      - canonical: "customer_code"
        source_path: "$.code"
        type: "string"
        required: true
      - canonical: "customer_name"
        source_path: "$.name"
        type: "string"
"""


def _post(client, resource, plaintext, source_payload, external_id=None):
    body = {
        "external_id": external_id or f"ext-{uuid.uuid4().hex[:8]}",
        "external_version": "1",
        "source_payload": source_payload,
    }
    return client.post(
        f"/api/v1/inbound/{resource}",
        headers={"X-WMS-Token": plaintext, "Content-Type": "application/json"},
        data=json.dumps(body),
    )


# ----------------------------------------------------------------------
# Inbound: sales_orders
# ----------------------------------------------------------------------


class TestInboundSalesOrders:
    def test_owner_is_stamped_from_the_token(self, app, client, seed_data):
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        customer = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=customer["customer_id"])

        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
        })
        assert resp.status_code == 201, resp.get_json()

        rows = _query(
            "SELECT customer_ref FROM sales_orders WHERE so_number = %s",
            (so_number,),
        )
        # The source said nothing about ownership; the token did.
        assert str(rows[0][0]) == customer["customer_id"]

    def test_payload_naming_another_customer_is_refused(self, app, client, seed_data):
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        mine = _make_customer()
        theirs = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=mine["customer_id"])

        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
            "customerRef": theirs["customer_id"],
        })
        assert resp.status_code == 403
        assert resp.get_json()["error_kind"] == "customer_scope_violation"
        # And nothing was written under the caller's own name either.
        assert _query(
            "SELECT 1 FROM sales_orders WHERE so_number = %s", (so_number,)
        ) == []

    def test_customer_code_naming_another_customer_is_refused(
        self, app, client, seed_data
    ):
        """sales_orders.customer_id is the legacy free-text code. A code
        resolving to another tenant is the same attempt by another
        route."""
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        mine = _make_customer()
        theirs = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=mine["customer_id"])

        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": f"SO-CS-{uuid.uuid4().hex[:6]}",
            "warehouseId": seed_data["warehouse_id"],
            "customerCode": theirs["customer_code"],
        })
        assert resp.status_code == 403
        assert resp.get_json()["error_kind"] == "customer_scope_violation"

    def test_unresolvable_customer_code_is_allowed(self, app, client, seed_data):
        """A code matching no customers row is just a label -- it cannot
        address another tenant, so it must not block the write."""
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        mine = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=mine["customer_id"])

        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
            "customerCode": "NO-SUCH-CODE",
        })
        assert resp.status_code == 201, resp.get_json()
        rows = _query(
            "SELECT customer_ref FROM sales_orders WHERE so_number = %s",
            (so_number,),
        )
        assert str(rows[0][0]) == mine["customer_id"]

    def test_updating_another_customers_record_is_refused(
        self, app, client, seed_data
    ):
        """Same (source_system, external_id) already mapped to a row
        owned by someone else: refuse rather than re-stamp it."""
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        first = _make_customer()
        second = _make_customer()
        external_id = f"ext-{uuid.uuid4().hex[:8]}"
        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"

        plaintext_a = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext_a, customer_id=first["customer_id"])
        assert _post(client, "sales_orders", plaintext_a, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
        }, external_id=external_id).status_code == 201

        # A second customer's token on the same source_system pushing a
        # newer version of the same external_id.
        plaintext_b = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext_b, customer_id=second["customer_id"])
        resp = client.post(
            "/api/v1/inbound/sales_orders",
            headers={"X-WMS-Token": plaintext_b, "Content-Type": "application/json"},
            data=json.dumps({
                "external_id": external_id,
                "external_version": "2",
                "source_payload": {
                    "orderNumber": so_number,
                    "warehouseId": seed_data["warehouse_id"],
                },
            }),
        )
        assert resp.status_code == 403
        assert resp.get_json()["error_kind"] == "customer_scope_violation"
        rows = _query(
            "SELECT customer_ref FROM sales_orders WHERE so_number = %s",
            (so_number,),
        )
        assert str(rows[0][0]) == first["customer_id"]

    def test_operator_token_writes_no_owner(self, app, client, seed_data):
        """The regression that matters: an unbound token behaves exactly
        as it did before phase 6."""
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=None)

        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
        })
        assert resp.status_code == 201, resp.get_json()
        rows = _query(
            "SELECT customer_ref FROM sales_orders WHERE so_number = %s",
            (so_number,),
        )
        assert rows[0][0] is None

    def test_operator_token_may_still_name_any_customer(
        self, app, client, seed_data
    ):
        ss = _fresh_source()
        _build_registry(app, ss, _SO_MAPPING.format(ss=ss))
        anyone = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(ss, plaintext, customer_id=None)

        so_number = f"SO-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "sales_orders", plaintext, {
            "orderNumber": so_number,
            "warehouseId": seed_data["warehouse_id"],
            "customerRef": anyone["customer_id"],
        })
        assert resp.status_code == 201, resp.get_json()


# ----------------------------------------------------------------------
# Inbound: items + refused resources
# ----------------------------------------------------------------------


class TestInboundOtherResources:
    def test_item_owner_is_stamped(self, app, client):
        ss = _fresh_source()
        _build_registry(app, ss, _ITEM_MAPPING.format(ss=ss))
        customer = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            ss, plaintext,
            customer_id=customer["customer_id"],
            inbound_resources=("items",),
        )

        sku = f"SKU-CS-{uuid.uuid4().hex[:6]}"
        resp = _post(client, "items", plaintext, {"sku": sku, "name": "Scoped item"})
        assert resp.status_code == 201, resp.get_json()
        rows = _query(
            "SELECT owner_customer_id FROM items WHERE sku = %s", (sku,)
        )
        assert str(rows[0][0]) == customer["customer_id"]

    def test_customers_resource_is_refused(self, app, client):
        """The customer master is the operator's record of every tenant;
        a create is by definition a customer other than the caller."""
        ss = _fresh_source()
        _build_registry(app, ss, _CUSTOMER_MAPPING.format(ss=ss))
        customer = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            ss, plaintext,
            customer_id=customer["customer_id"],
            inbound_resources=("customers",),
        )

        code = f"NEW{uuid.uuid4().hex[:6].upper()}"
        resp = _post(client, "customers", plaintext, {"code": code, "name": "Sneaky"})
        assert resp.status_code == 403
        assert resp.get_json()["error_kind"] == "customer_scope_forbidden_resource"
        assert _query(
            "SELECT 1 FROM customers WHERE customer_code = %s", (code,)
        ) == []

    def test_operator_token_may_still_push_customers(self, app, client):
        ss = _fresh_source()
        _build_registry(app, ss, _CUSTOMER_MAPPING.format(ss=ss))
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            ss, plaintext, customer_id=None, inbound_resources=("customers",),
        )
        code = f"OPS{uuid.uuid4().hex[:6].upper()}"
        resp = _post(client, "customers", plaintext, {"code": code, "name": "Fine"})
        assert resp.status_code == 201, resp.get_json()


# ----------------------------------------------------------------------
# Inbound: inventory_update
# ----------------------------------------------------------------------


class TestInventoryUpdate:
    def _map_item(self, ss, item_id):
        """Point a cross_system_mappings row at a seeded item so the
        inventory_update handler can resolve it."""
        row = _exec("SELECT external_id FROM items WHERE item_id = %s", (item_id,))
        source_id = f"src-{uuid.uuid4().hex[:8]}"
        # cross_system_mappings.source_system is FK'd to the allowlist,
        # and this helper runs before _make_token seeds it.
        _exec(
            "INSERT INTO inbound_source_systems_allowlist (source_system, kind) "
            "VALUES (%s, 'internal_tool') ON CONFLICT DO NOTHING",
            (ss,),
        )
        _exec(
            "INSERT INTO cross_system_mappings "
            "(source_system, source_type, source_id, canonical_type, canonical_id) "
            "VALUES (%s, 'item', %s, 'item', %s)",
            (ss, source_id, str(row[0])),
        )
        return source_id

    def _post_update(self, client, plaintext, source_id, bin_code, warehouse_id, qty):
        return client.post(
            "/api/v1/inbound/inventory_update",
            headers={"X-WMS-Token": plaintext, "Content-Type": "application/json"},
            data=json.dumps({
                "external_id": f"ext-{uuid.uuid4().hex[:8]}",
                "external_version": "1",
                "source_payload": {
                    "item_external_id": source_id,
                    "bin_code": bin_code,
                    "warehouse_id": warehouse_id,
                    "target_quantity": qty,
                    "reason_code": "scope_test",
                },
            }),
        )

    def test_another_customers_item_reads_as_not_found(self, app, client, seed_data):
        """404 item_not_found, not 403: "not yours" and "not there" must
        stay indistinguishable or the endpoint enumerates other tenants'
        SKUs."""
        ss = _fresh_source()
        mine = _make_customer()
        theirs = _make_customer()
        item_id = seed_data["item_ids"][0]
        _exec(
            "UPDATE items SET owner_customer_id = %s WHERE item_id = %s",
            (theirs["customer_id"], item_id),
        )
        source_id = self._map_item(ss, item_id)
        bin_code = _exec(
            "SELECT bin_code FROM bins WHERE bin_id = %s",
            (seed_data["storage_bin_ids"][0],),
        )[0]

        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            ss, plaintext,
            customer_id=mine["customer_id"],
            inbound_resources=("inventory_update",),
        )
        resp = self._post_update(
            client, plaintext, source_id, bin_code,
            seed_data["warehouse_id"], 5,
        )
        assert resp.status_code == 404
        assert resp.get_json()["error_kind"] == "item_not_found"

    def test_own_item_is_adjusted(self, app, client, seed_data):
        ss = _fresh_source()
        mine = _make_customer()
        item_id = seed_data["item_ids"][1]
        _exec(
            "UPDATE items SET owner_customer_id = %s WHERE item_id = %s",
            (mine["customer_id"], item_id),
        )
        source_id = self._map_item(ss, item_id)
        bin_id = seed_data["storage_bin_ids"][1]
        bin_code = _exec(
            "SELECT bin_code FROM bins WHERE bin_id = %s", (bin_id,)
        )[0]
        current = _query(
            "SELECT quantity_on_hand FROM inventory "
            " WHERE item_id = %s AND bin_id = %s",
            (item_id, bin_id),
        )
        target = (current[0][0] if current else 0) + 7

        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            ss, plaintext,
            customer_id=mine["customer_id"],
            inbound_resources=("inventory_update",),
        )
        resp = self._post_update(
            client, plaintext, source_id, bin_code,
            seed_data["warehouse_id"], target,
        )
        assert resp.status_code == 201, resp.get_json()
        assert resp.get_json()["applied_delta"] == 7


# ----------------------------------------------------------------------
# Surface gate
# ----------------------------------------------------------------------


class TestSurfaceGate:
    def test_event_feed_is_refused(self, app, client):
        """integration_events has no owning-customer column, so a page of
        events for a warehouse is a page of every tenant's activity in
        it. Refuse rather than serve it unscoped."""
        customer = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            None, plaintext,
            customer_id=customer["customer_id"],
            inbound_resources=(),
            endpoints=("events.poll", "snapshot.inventory"),
            event_types=("receipt.completed",),
        )
        resp = client.get(
            "/api/v1/events?after=0", headers={"X-WMS-Token": plaintext}
        )
        assert resp.status_code == 403
        assert resp.get_json()["error"] == "customer_scope_unsupported_surface"

    def test_event_type_catalog_is_allowed(self, app, client):
        """Carries no customer data at all -- refusing it would only make
        a bound token harder to integrate."""
        customer = _make_customer()
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            None, plaintext,
            customer_id=customer["customer_id"],
            inbound_resources=(),
            endpoints=("events.types",),
            event_types=("receipt.completed",),
        )
        resp = client.get(
            "/api/v1/events/types", headers={"X-WMS-Token": plaintext}
        )
        assert resp.status_code == 200

    def test_operator_token_still_polls_events(self, app, client):
        plaintext = f"cs-{uuid.uuid4().hex}"
        _make_token(
            None, plaintext,
            customer_id=None,
            inbound_resources=(),
            endpoints=("events.poll",),
            event_types=("receipt.completed",),
        )
        resp = client.get(
            "/api/v1/events?after=0", headers={"X-WMS-Token": plaintext}
        )
        assert resp.status_code == 200


# ----------------------------------------------------------------------
# Snapshot reads
# ----------------------------------------------------------------------


def _direct_conn(autocommit=True):
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = autocommit
    return conn


def _encode_cursor(scan_id, warehouse_id, item_id, bin_id):
    payload = json.dumps(
        {"scan_id": str(scan_id), "w": warehouse_id, "i": item_id, "b": bin_id},
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


@pytest.fixture(scope="module")
def committed_fixtures():
    """Rows the snapshot tests must COMMIT, cleaned up at module scope.

    Cleanup cannot run inside the test: the handler's writes hold row
    locks that only release when the per-test transaction rolls back at
    fixture teardown, so a separate-connection DELETE issued from the
    test body waits forever (test_snapshot.py hit the same wall and
    chose to leak its scan rows instead). A module-scoped finalizer runs
    after the last per-test transaction has closed, so it can clean up
    properly.
    """
    created = {"tokens": [], "customers": [], "items": []}
    yield created
    conn = _direct_conn()
    cur = conn.cursor()
    try:
        if created["tokens"]:
            cur.execute(
                "DELETE FROM snapshot_scans WHERE created_by_token_id = ANY(%s)",
                (created["tokens"],),
            )
            cur.execute(
                "DELETE FROM wms_tokens WHERE token_id = ANY(%s)",
                (created["tokens"],),
            )
        for item_id in created["items"]:
            cur.execute(
                "UPDATE items SET owner_customer_id = NULL WHERE item_id = %s",
                (item_id,),
            )
        for customer_id in created["customers"]:
            cur.execute(
                "DELETE FROM customers WHERE canonical_id = %s", (customer_id,)
            )
    finally:
        conn.close()


class TestSnapshotScope:
    """The snapshot endpoint pages a keeper-exported pg_snapshot, which
    lives on its own connection and therefore only sees COMMITTED rows.
    So unlike the inbound tests above, these commit their fixture data
    on a direct connection; `committed_fixtures` undoes it afterwards.
    """

    def _setup(self, ctx, warehouse_id, item_id, plaintext, bind_to_owner):
        conn = _direct_conn()
        cur = conn.cursor()
        code = f"SNAP{uuid.uuid4().hex[:6].upper()}"
        cur.execute(
            "INSERT INTO customers (customer_code, customer_name) "
            "VALUES (%s, 'Snapshot Co') RETURNING canonical_id",
            (code,),
        )
        owner = str(cur.fetchone()[0])
        cur.execute(
            "UPDATE items SET owner_customer_id = %s WHERE item_id = %s",
            (owner, item_id),
        )
        cur.execute(
            "INSERT INTO wms_tokens "
            "(token_name, token_hash, status, warehouse_ids, event_types, "
            " endpoints, customer_id) "
            "VALUES (%s, %s, 'active', %s, %s, %s, %s) RETURNING token_id",
            (
                f"snapscope-{uuid.uuid4().hex[:6]}",
                _hash(plaintext),
                [warehouse_id],
                [],
                ["snapshot.inventory"],
                owner if bind_to_owner else None,
            ),
        )
        token_id = cur.fetchone()[0]
        conn.close()
        ctx["customers"].append(owner)
        ctx["items"].append(item_id)
        ctx["tokens"].append(token_id)
        return {"owner": owner, "token_id": token_id}

    def _page(self, client, plaintext, warehouse_id, token_id):
        """Pre-create an active scan row against a real exported
        snapshot so the request skips keeper promotion."""
        holder = _direct_conn(autocommit=False)
        hcur = holder.cursor()
        hcur.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        hcur.execute(
            "SELECT COALESCE(MAX(event_id), 0) FROM integration_events "
            " WHERE visible_at IS NOT NULL "
            "   AND visible_at <= NOW() - INTERVAL '2 seconds'"
        )
        snapshot_event_id = hcur.fetchone()[0]
        hcur.execute("SELECT pg_export_snapshot()")
        pg_snapshot_id = hcur.fetchone()[0]
        scan_id = str(uuid.uuid4())
        writer = _direct_conn()
        writer.cursor().execute(
            "INSERT INTO snapshot_scans (scan_id, warehouse_id, status, "
            "pg_snapshot_id, snapshot_event_id, created_by_token_id) "
            "VALUES (%s, %s, 'active', %s, %s, %s)",
            (scan_id, warehouse_id, pg_snapshot_id, snapshot_event_id, token_id),
        )
        writer.close()
        try:
            return client.get(
                f"/api/v1/snapshot/inventory?warehouse_id={warehouse_id}"
                f"&cursor={_encode_cursor(scan_id, warehouse_id, 0, 0)}",
                headers={"X-WMS-Token": plaintext},
            )
        finally:
            holder.rollback()
            holder.close()

    def test_bound_token_sees_only_its_own_stock(
        self, app, client, seed_data, committed_fixtures
    ):
        warehouse_id = seed_data["warehouse_id"]
        item_id = seed_data["item_ids"][2]
        plaintext = f"snap-{uuid.uuid4().hex}"
        ctx = self._setup(
            committed_fixtures, warehouse_id, item_id, plaintext,
            bind_to_owner=True,
        )
        resp = self._page(client, plaintext, warehouse_id, ctx["token_id"])
        assert resp.status_code == 200, resp.get_json()
        owned_external_id = str(
            _exec("SELECT external_id FROM items WHERE item_id = %s", (item_id,))[0]
        )
        returned = {r["item_external_id"] for r in resp.get_json()["rows"]}
        # Only the one item that customer owns -- and the seed fills this
        # warehouse with stock for twenty items.
        assert returned == {owned_external_id}, returned

    def test_operator_token_still_sees_everything(
        self, app, client, seed_data, committed_fixtures
    ):
        warehouse_id = seed_data["warehouse_id"]
        item_id = seed_data["item_ids"][3]
        plaintext = f"snap-{uuid.uuid4().hex}"
        ctx = self._setup(
            committed_fixtures, warehouse_id, item_id, plaintext,
            bind_to_owner=False,
        )
        resp = self._page(client, plaintext, warehouse_id, ctx["token_id"])
        assert resp.status_code == 200, resp.get_json()
        returned = {r["item_external_id"] for r in resp.get_json()["rows"]}
        assert len(returned) > 1


# ----------------------------------------------------------------------
# Admin provisioning
# ----------------------------------------------------------------------


class TestAdminProvisioning:
    def test_create_binds_the_token(self, client, auth_headers):
        customer = _make_customer()
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"bound-{uuid.uuid4().hex[:6]}",
                "warehouse_ids": [1],
                "endpoints": ["snapshot.inventory"],
                "customer_id": customer["customer_id"],
            },
        )
        assert resp.status_code == 201, resp.get_json()
        token_id = resp.get_json()["token_id"]
        rows = _query(
            "SELECT customer_id FROM wms_tokens WHERE token_id = %s", (token_id,)
        )
        assert str(rows[0][0]) == customer["customer_id"]

        listing = client.get("/api/admin/tokens", headers=auth_headers).get_json()
        row = next(t for t in listing["tokens"] if t["token_id"] == token_id)
        assert row["customer_id"] == customer["customer_id"]
        assert row["customer_code"] == customer["customer_code"]

    def test_unknown_customer_is_rejected(self, client, auth_headers):
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"bad-{uuid.uuid4().hex[:6]}",
                "endpoints": ["snapshot.inventory"],
                "customer_id": str(uuid.uuid4()),
            },
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "unknown_customer_id"

    def test_malformed_customer_id_is_rejected(self, client, auth_headers):
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"bad-{uuid.uuid4().hex[:6]}",
                "endpoints": ["snapshot.inventory"],
                "customer_id": "not-a-uuid",
            },
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "unknown_customer_id"

    def test_unscopable_endpoint_slug_is_rejected(self, client, auth_headers):
        """Refuse at issuance rather than minting a token that 403s on
        first use."""
        customer = _make_customer()
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"bad-{uuid.uuid4().hex[:6]}",
                "warehouse_ids": [1],
                "endpoints": ["events.poll"],
                "event_types": ["receipt.completed"],
                "customer_id": customer["customer_id"],
            },
        )
        # validate_body turns a Pydantic model-validator failure into a
        # 400 validation_error (utils/validation.py), not a 422.
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"] == "validation_error"

    def test_forbidden_inbound_resource_is_rejected(self, client, auth_headers):
        customer = _make_customer()
        _exec(
            "INSERT INTO inbound_source_systems_allowlist (source_system, kind) "
            "VALUES ('cs-admin-test', 'internal_tool') ON CONFLICT DO NOTHING"
        )
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"bad-{uuid.uuid4().hex[:6]}",
                "warehouse_ids": [1],
                "source_system": "cs-admin-test",
                "inbound_resources": ["vendors"],
                "customer_id": customer["customer_id"],
            },
        )
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"] == "validation_error"

    def test_operator_token_creation_is_unchanged(self, client, auth_headers):
        resp = client.post(
            "/api/admin/tokens",
            headers=auth_headers,
            json={
                "token_name": f"ops-{uuid.uuid4().hex[:6]}",
                "warehouse_ids": [1],
                "endpoints": ["events.poll"],
                "event_types": ["receipt.completed"],
            },
        )
        assert resp.status_code == 201, resp.get_json()
        listing = client.get("/api/admin/tokens", headers=auth_headers).get_json()
        row = next(
            t for t in listing["tokens"]
            if t["token_id"] == resp.get_json()["token_id"]
        )
        assert row["customer_id"] is None
        assert row["customer_code"] is None
