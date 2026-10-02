"""Validation tests for phase-2 warehouse layout payloads."""

import pytest
from pydantic import ValidationError

from schemas.warehouse_layout import MapPathEntry, ZoneLayoutEntry


def test_path_requires_consistent_one_way_direction():
    with pytest.raises(ValidationError):
        MapPathEntry.model_validate({
            "path_type": "FORKLIFT",
            "points": [{"x": 2, "y": 2}, {"x": 3, "y": 2}],
            "width_m": 3,
            "one_way": True,
            "direction": "both",
        })


def test_path_rejects_duplicate_adjacent_points():
    from schemas.warehouse_layout import SaveWarehouseLayoutRequest

    with pytest.raises(ValidationError):
        SaveWarehouseLayoutRequest.model_validate({
            "base_version": 0,
            "layout": {},
            "paths": [{
                "path_type": "PEDESTRIAN",
                "points": [{"x": 2, "y": 2}, {"x": 2, "y": 2}],
                "width_m": 1.5,
            }],
        })


def test_zone_rejects_non_hex_color():
    with pytest.raises(ValidationError):
        ZoneLayoutEntry.model_validate({
            "zone_id": 1,
            "map_x": 2,
            "map_y": 2,
            "map_w": 4,
            "map_h": 4,
            "color_hex": "red",
        })
