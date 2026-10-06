"""Layout edit endpoints as the admin 3D layout editor drives them.

The editor sends every zone and rack of the warehouse with its meter
rectangle (plus the saved paths, untouched) and the version it loaded,
reads structured ``issues`` to highlight offending items, and handles a
409 when someone else saved first.
"""

URL_MAP = "/api/admin/warehouse-map?warehouse_id=1"
URL_VALIDATE = "/api/admin/warehouse-map/layout/validate?warehouse_id=1"
URL_SAVE = "/api/admin/warehouse-map/layout?warehouse_id=1"


def _editor_payload(data, *, zones=None, racks=None):
    layout = data["layout"]
    base = layout["config"].get("version", 0) if layout.get("has_saved_layout") else 0
    return {
        "base_version": base,
        "layout": {
            "world_width_m": 60,
            "world_height_m": 40,
            "warehouse_x_m": 0,
            "warehouse_y_m": 0,
            "warehouse_w_m": 60,
            "warehouse_h_m": 40,
            "grid_step_m": 0.25,
        },
        "zones": zones if zones is not None else [],
        "racks": racks if racks is not None else [],
        "paths": layout.get("paths", []),
    }


def _two_racks(data):
    racks = data["racks"][:2]
    assert len(racks) == 2
    return racks


class TestLayoutEditor:
    def test_validate_returns_structured_issues(self, client, auth_headers):
        data = client.get(URL_MAP, headers=auth_headers).get_json()
        a, b = _two_racks(data)
        racks = [
            {"rack_id": a["rack_id"], "rack_key": a["rack_key"], "zone_id": a["zone_id"],
             "label": a["rack_label"], "x_m": 5, "y_m": 5, "w_m": 4, "h_m": 1, "rotation_deg": 0},
            {"rack_id": b["rack_id"], "rack_key": b["rack_key"], "zone_id": b["zone_id"],
             "label": b["rack_label"], "x_m": 6, "y_m": 5, "w_m": 4, "h_m": 1, "rotation_deg": 0},
        ]
        resp = client.post(URL_VALIDATE, json=_editor_payload(data, racks=racks), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["valid"] is False
        overlap = [i for i in body["issues"] if i["code"] == "racks_overlap"]
        assert overlap and set(overlap[0]["rack_keys"]) == {a["rack_key"], b["rack_key"]}
        assert overlap[0]["message"] in body["errors"]

    def test_save_moves_zone_and_rotates_rack(self, client, auth_headers):
        data = client.get(URL_MAP, headers=auth_headers).get_json()
        zone = data["zones"][0]
        rack = next(r for r in data["racks"] if r["zone_id"] == zone["zone_id"])
        payload = _editor_payload(
            data,
            zones=[{"zone_id": zone["zone_id"], "map_x": 10, "map_y": 10, "map_w": 20, "map_h": 12}],
            racks=[{"rack_id": rack["rack_id"], "rack_key": rack["rack_key"],
                    "zone_id": rack["zone_id"], "label": rack["rack_label"],
                    "x_m": 12, "y_m": 14, "w_m": 6, "h_m": 1, "rotation_deg": 90}],
        )
        resp = client.put(URL_SAVE, json=payload, headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["version"] == payload["base_version"] + 1

        after = client.get(URL_MAP, headers=auth_headers).get_json()
        moved = next(z for z in after["zones"] if z["zone_id"] == zone["zone_id"])
        assert (moved["bounds"]["x"], moved["bounds"]["y"]) == (10, 10)
        assert (moved["bounds"]["w"], moved["bounds"]["h"]) == (20, 12)
        saved = next(r for r in after["layout"]["racks"] if r["rack_key"] == rack["rack_key"])
        assert saved["rotation_deg"] == 90
        assert after["layout"]["config"]["coordinate_unit"] == "METER"

    def test_stale_version_is_409(self, client, auth_headers):
        data = client.get(URL_MAP, headers=auth_headers).get_json()
        first = _editor_payload(data)
        assert client.put(URL_SAVE, json=first, headers=auth_headers).status_code == 200
        resp = client.put(URL_SAVE, json=first, headers=auth_headers)
        assert resp.status_code == 409
        assert resp.get_json()["current_version"] == first["base_version"] + 1

    def test_save_with_errors_returns_issues(self, client, auth_headers):
        data = client.get(URL_MAP, headers=auth_headers).get_json()
        zone = data["zones"][0]
        payload = _editor_payload(
            data,
            zones=[{"zone_id": zone["zone_id"], "map_x": 50, "map_y": 1, "map_w": 20, "map_h": 5}],
        )
        resp = client.put(URL_SAVE, json=payload, headers=auth_headers)
        assert resp.status_code == 400
        issue = next(i for i in resp.get_json()["issues"] if i["code"] == "zone_beyond_bounds")
        assert issue["zone_ids"] == [zone["zone_id"]]
