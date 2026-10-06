"""GET /api/admin/warehouse-map/pick-paths: pick batches for the 3D view.

Read-only, warehouse-scoped feed of pick batches with their tasks in
walk (pick_sequence) order, gated by the warehouse-simulation page key.
"""

import bcrypt

from db_test_context import get_raw_connection


def _create_so_batch(client, auth_headers, identifiers=None):
    resp = client.post(
        "/api/picking/create-batch",
        json={"so_identifiers": identifiers or ["SO-2026-001"], "warehouse_id": 1},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def _user_with_pages(client, pages, warehouse_ids=(1,), username="map3duser"):
    pw = bcrypt.hashpw(b"map3duser123", bcrypt.gensalt()).decode("utf-8")
    cur = get_raw_connection().cursor()
    cur.execute(
        "INSERT INTO users (username, password_hash, full_name, role, warehouse_id, "
        "warehouse_ids, external_id) VALUES (%s, %s, 'Map User', 'USER', %s, %s, "
        "gen_random_uuid()) RETURNING user_id",
        (username, pw, warehouse_ids[0], list(warehouse_ids)),
    )
    uid = cur.fetchone()[0]
    for p in pages:
        cur.execute(
            "INSERT INTO user_page_permissions (user_id, page_key) VALUES (%s, %s)",
            (uid, p),
        )
    cur.close()
    resp = client.post(
        "/api/auth/login", json={"username": username, "password": "map3duser123"}
    )
    return {"Authorization": f"Bearer {resp.get_json()['token']}"}


URL = "/api/admin/warehouse-map/pick-paths"


class TestPickPaths:
    def test_requires_warehouse_id(self, client, auth_headers):
        resp = client.get(URL, headers=auth_headers)
        assert resp.status_code == 400

    def test_requires_auth(self, client):
        resp = client.get(f"{URL}?warehouse_id=1")
        assert resp.status_code == 401

    def test_empty_when_no_batches(self, client, auth_headers):
        resp = client.get(f"{URL}?warehouse_id=1", headers=auth_headers)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["warehouse_id"] == 1
        assert isinstance(body["batches"], list)

    def test_lists_open_batch_with_tasks_in_walk_order(self, client, auth_headers):
        created = _create_so_batch(client, auth_headers)
        resp = client.get(f"{URL}?warehouse_id=1", headers=auth_headers)
        assert resp.status_code == 200
        batches = {b["batch_id"]: b for b in resp.get_json()["batches"]}
        assert created["batch_id"] in batches
        batch = batches[created["batch_id"]]
        assert batch["status"] == "OPEN"
        assert batch["orders"] == ["SO-2026-001"]
        tasks = batch["tasks"]
        assert tasks, "an open batch carries its pick tasks"
        for key in ("bin_id", "bin_code", "sku", "pick_sequence", "quantity_to_pick", "status"):
            assert key in tasks[0]
        seqs = [t["pick_sequence"] for t in tasks]
        assert seqs == sorted(seqs)

    def test_scoped_to_the_warehouse(self, client, auth_headers):
        created = _create_so_batch(client, auth_headers)
        resp = client.get(f"{URL}?warehouse_id=2", headers=auth_headers)
        assert resp.status_code == 200
        ids = {b["batch_id"] for b in resp.get_json()["batches"]}
        assert created["batch_id"] not in ids

    def test_simulation_page_key_is_enough(self, client, auth_headers):
        _create_so_batch(client, auth_headers)
        headers = _user_with_pages(client, ["warehouse-simulation"])
        resp = client.get(f"{URL}?warehouse_id=1", headers=headers)
        assert resp.status_code == 200
        assert resp.get_json()["batches"]

    def test_other_page_key_is_refused(self, client):
        headers = _user_with_pages(client, ["inventory"], username="map3dnope")
        resp = client.get(f"{URL}?warehouse_id=1", headers=headers)
        assert resp.status_code == 403

    def test_unassigned_warehouse_is_refused(self, client):
        headers = _user_with_pages(
            client, ["warehouse-simulation"], warehouse_ids=(1,), username="map3dwh"
        )
        resp = client.get(f"{URL}?warehouse_id=2", headers=headers)
        assert resp.status_code == 403
