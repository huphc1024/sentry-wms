"""GET /api/admin/warehouse-map end-to-end.

Regression cover for a 500 that reached a running deployment: the map
builder gained a `_merge_empty_bin_pallets` helper calling `text(...)`,
but services/warehouse_map_service.py imported `text` inside
`build_warehouse_map` only -- a function-local import that does not
cover its siblings. Every call to the endpoint raised NameError, and the
admin Warehouse Simulation page rendered "Internal server error".

The existing map tests (test_warehouse_map_pallets.py) all exercise pure
helpers with hand-built rows, so none of them imports the module's SQL
path. One request through the real builder is what was missing.
"""

import os
import sys

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")
os.environ.setdefault("SENTRY_ENCRYPTION_KEY", "t5hPIEVn_O41qfiMqAiPEnwzQh68o3Es46YfSOBvEK8=")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestWarehouseMapEndpoint:
    def test_returns_the_map_payload(self, client, auth_headers, seed_data):
        resp = client.get(
            f"/api/admin/warehouse-map?warehouse_id={seed_data['warehouse_id']}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.get_json()
        body = resp.get_json()
        # Shape the admin simulation page reads. Asserting the keys (not
        # just the status) keeps a builder that starts returning an empty
        # dict from passing as "works".
        for key in ("warehouse_id", "zones", "bins"):
            assert key in body, f"missing {key} in {sorted(body)}"
        assert body["warehouse_id"] == seed_data["warehouse_id"]
        assert len(body["bins"]) > 0

    def test_pallet_merge_path_runs(self, client, auth_headers, seed_data):
        """The helper that was broken runs on every request, including
        when the warehouse holds no pallets at all -- which is exactly
        the case that used to 500."""
        from services import warehouse_map_service

        assert hasattr(warehouse_map_service, "text"), (
            "warehouse_map_service must import sqlalchemy.text at module "
            "scope; a function-local import leaves its sibling helpers "
            "raising NameError at runtime"
        )
        resp = client.get(
            f"/api/admin/warehouse-map?warehouse_id={seed_data['warehouse_id']}",
            headers=auth_headers,
        )
        assert resp.status_code == 200

    def test_unknown_warehouse_is_404(self, client, auth_headers):
        resp = client.get(
            "/api/admin/warehouse-map?warehouse_id=999999", headers=auth_headers
        )
        assert resp.status_code == 404

    def test_warehouse_id_is_required(self, client, auth_headers):
        resp = client.get("/api/admin/warehouse-map", headers=auth_headers)
        assert resp.status_code == 400
