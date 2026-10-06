"""Layout validation without a database: rotated footprints and the
structured issues the admin layout editor highlights."""

from types import SimpleNamespace

import pytest

from schemas.warehouse_layout import SaveWarehouseLayoutRequest
from services.warehouse_layout_service import (
    _rack_footprint,
    validate_layout_issues,
    validate_layout_payload,
)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class FakeDb:
    """Answers the three lookups validation makes, by SQL shape."""

    def __init__(self, zone_ids=(1, 2), stored_zones=(), rack_ids=()):
        self.zone_ids = zone_ids
        self.stored_zones = stored_zones
        self.rack_ids = rack_ids

    def execute(self, clause, params=None):
        sql = str(clause)
        if "FROM racks" in sql:
            wanted = set((params or {}).get("rack_ids") or [])
            return _Result([SimpleNamespace(rack_id=r) for r in self.rack_ids if r in wanted])
        if "map_x IS NOT NULL" in sql:
            return _Result([SimpleNamespace(**z) for z in self.stored_zones])
        if "FROM zones" in sql:
            return _Result([SimpleNamespace(zone_id=z) for z in self.zone_ids])
        if "warehouse_map_paths" in sql:
            return _Result([])
        raise AssertionError(f"unexpected query: {sql}")


def _payload(racks=(), zones=(), **layout):
    cfg = {
        "warehouse_x_m": 0, "warehouse_y_m": 0,
        "warehouse_w_m": 20, "warehouse_h_m": 10,
        "grid_step_m": 0.25,
    }
    cfg.update(layout)
    return SaveWarehouseLayoutRequest.model_validate({
        "base_version": 0,
        "layout": cfg,
        "zones": list(zones),
        "racks": list(racks),
        "paths": [],
    })


def _rack(key, x, y, w=6, h=1, rot=0, zone_id=1, rack_id=None):
    return {
        "rack_id": rack_id, "rack_key": key, "zone_id": zone_id, "label": key,
        "x_m": x, "y_m": y, "w_m": w, "h_m": h, "rotation_deg": rot,
    }


def test_footprint_turns_about_centre():
    fp = _rack_footprint({"x_m": 2, "y_m": 4, "w_m": 6, "h_m": 1, "rotation_deg": 90})
    assert fp["w_m"] == pytest.approx(1)
    assert fp["h_m"] == pytest.approx(6)
    # centre (5, 4.5) is kept
    assert fp["x_m"] + fp["w_m"] / 2 == pytest.approx(5)
    assert fp["y_m"] + fp["h_m"] / 2 == pytest.approx(4.5)


def test_footprint_unrotated_is_unchanged():
    fp = _rack_footprint({"x_m": 1, "y_m": 2, "w_m": 3, "h_m": 4, "rotation_deg": 0})
    assert (fp["x_m"], fp["y_m"], fp["w_m"], fp["h_m"]) == (1, 2, 3, 4)


def test_rotated_rack_out_of_bounds_is_caught():
    # 6 x 1 at y=0.5 fits unrotated in a 10 m deep hall; turned 90 deg it
    # stands from y=-2 to y=4 -- above the top wall.
    payload = _payload(racks=[_rack("R1", 2, 0.5, rot=90)])
    issues = validate_layout_issues(FakeDb(), 1, payload)
    codes = {i["code"] for i in issues}
    assert "rack_outside_bounds" in codes
    issue = next(i for i in issues if i["code"] == "rack_outside_bounds")
    assert issue["severity"] == "error"
    assert issue["rack_keys"] == ["R1"]


def test_rotated_racks_overlap_by_footprint():
    # Unrotated these two do not touch; R2 turned 90 deg crosses R1.
    a = _rack("R1", 2, 4, w=6, h=1)
    b = _rack("R2", 2, 6, w=6, h=1, rot=90)
    assert not validate_layout_issues(FakeDb(), 1, _payload(racks=[a, {**b, "rotation_deg": 0}]))
    issues = validate_layout_issues(FakeDb(), 1, _payload(racks=[a, b]))
    overlap = [i for i in issues if i["code"] == "racks_overlap"]
    assert overlap and overlap[0]["rack_keys"] == ["R1", "R2"]


def test_zone_issues_carry_zone_ids():
    zones = [
        {"zone_id": 1, "map_x": 15, "map_y": 1, "map_w": 8, "map_h": 4},
        {"zone_id": 99, "map_x": 1, "map_y": 1, "map_w": 2, "map_h": 2},
    ]
    issues = validate_layout_issues(FakeDb(), 1, _payload(zones=zones))
    by_code = {i["code"]: i for i in issues}
    assert by_code["zone_beyond_bounds"]["zone_ids"] == [1]
    assert by_code["zone_not_in_warehouse"]["zone_ids"] == [99]


def test_rack_outside_its_zone_is_a_warning():
    zones = [{"zone_id": 1, "map_x": 0, "map_y": 0, "map_w": 5, "map_h": 5}]
    issues = validate_layout_issues(FakeDb(), 1, _payload(zones=zones, racks=[_rack("R1", 4, 1)]))
    warn = next(i for i in issues if i["code"] == "rack_outside_zone")
    assert warn["severity"] == "warning"
    assert warn["rack_keys"] == ["R1"] and warn["zone_ids"] == [1]


def test_foreign_rack_id_is_reported_by_key():
    issues = validate_layout_issues(
        FakeDb(rack_ids=(5,)), 1,
        _payload(racks=[_rack("R1", 1, 1, rack_id=5), _rack("R2", 1, 4, rack_id=6)]),
    )
    bad = next(i for i in issues if i["code"] == "rack_not_in_warehouse")
    assert bad["rack_keys"] == ["R2"]


def test_payload_wrapper_keeps_string_lists():
    payload = _payload(racks=[_rack("R1", 2, 4), _rack("R2", 3, 4)])
    errors, warnings = validate_layout_payload(FakeDb(), 1, payload)
    assert errors == ["Racks R1 and R2 overlap"]
    assert warnings == []


def test_clean_layout_has_no_issues():
    zones = [{"zone_id": 1, "map_x": 0, "map_y": 0, "map_w": 20, "map_h": 10}]
    racks = [_rack("R1", 1, 1), _rack("R2", 1, 4), _rack("R3", 10, 4, rot=90)]
    assert validate_layout_issues(FakeDb(), 1, _payload(zones=zones, racks=racks)) == []
