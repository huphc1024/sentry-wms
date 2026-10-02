"""Load, validate, and persist editable warehouse floor plans (meters)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import text

from constants import ACTION_WAREHOUSE_LAYOUT_UPDATED
from schemas.warehouse_layout import SaveWarehouseLayoutRequest
from services.audit_service import write_audit_log

DEFAULT_LAYOUT = {
    "world_width_m": 50,
    "world_height_m": 40,
    "warehouse_x_m": 2,
    "warehouse_y_m": 2,
    "warehouse_w_m": 46,
    "warehouse_h_m": 30,
    "grid_step_m": 0.25,
    "coordinate_unit": "LEGACY_CANVAS",
    "version": 1,
}


def _rect_overlap(a: dict, b: dict, gap: float = 0.05) -> bool:
    return not (
        a["x_m"] + a["w_m"] + gap <= b["x_m"]
        or b["x_m"] + b["w_m"] + gap <= a["x_m"]
        or a["y_m"] + a["h_m"] + gap <= b["y_m"]
        or b["y_m"] + b["h_m"] + gap <= a["y_m"]
    )


def _segment_intersects_rect(
    p1: dict, p2: dict, rect: dict, buffer_m: float = 0
) -> bool:
    """Liang-Barsky segment/AABB intersection with lane-width buffering."""
    xmin = rect["x_m"] - buffer_m
    xmax = rect["x_m"] + rect["w_m"] + buffer_m
    ymin = rect["y_m"] - buffer_m
    ymax = rect["y_m"] + rect["h_m"] + buffer_m
    dx = p2["x"] - p1["x"]
    dy = p2["y"] - p1["y"]
    p = (-dx, dx, -dy, dy)
    q = (p1["x"] - xmin, xmax - p1["x"], p1["y"] - ymin, ymax - p1["y"])
    low, high = 0.0, 1.0
    for pi, qi in zip(p, q):
        if pi == 0:
            if qi < 0:
                return False
            continue
        ratio = qi / pi
        if pi < 0:
            low = max(low, ratio)
        else:
            high = min(high, ratio)
        if low > high:
            return False
    return True


def _orientation(a: dict, b: dict, c: dict) -> float:
    return (b["x"] - a["x"]) * (c["y"] - a["y"]) - (
        b["y"] - a["y"]
    ) * (c["x"] - a["x"])


def _segments_intersect(a: dict, b: dict, c: dict, d: dict) -> bool:
    return (
        _orientation(a, b, c) * _orientation(a, b, d) <= 0
        and _orientation(c, d, a) * _orientation(c, d, b) <= 0
        and max(min(a["x"], b["x"]), min(c["x"], d["x"]))
        <= min(max(a["x"], b["x"]), max(c["x"], d["x"]))
        and max(min(a["y"], b["y"]), min(c["y"], d["y"]))
        <= min(max(a["y"], b["y"]), max(c["y"], d["y"]))
    )


def load_warehouse_layout(db, warehouse_id: int) -> dict:
    row = db.execute(
        text("""
            SELECT world_width_m, world_height_m, warehouse_x_m, warehouse_y_m,
                   warehouse_w_m, warehouse_h_m, grid_step_m, coordinate_unit,
                   version, updated_at
            FROM warehouse_layouts
            WHERE warehouse_id = :wid
        """),
        {"wid": warehouse_id},
    ).fetchone()

    config = dict(DEFAULT_LAYOUT)
    if row:
        config.update({
            "world_width_m": float(row.world_width_m),
            "world_height_m": float(row.world_height_m),
            "warehouse_x_m": float(row.warehouse_x_m),
            "warehouse_y_m": float(row.warehouse_y_m),
            "warehouse_w_m": float(row.warehouse_w_m),
            "warehouse_h_m": float(row.warehouse_h_m),
            "grid_step_m": float(row.grid_step_m),
            "coordinate_unit": row.coordinate_unit,
            "version": int(row.version),
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        })

    rack_rows = db.execute(
        text("""
            SELECT r.rack_id, r.legacy_rack_key AS rack_key, r.zone_id,
                   COALESCE(wrl.label, r.rack_name, r.rack_code) AS label,
                   COALESCE(wrl.x_m, r.map_x) AS x_m,
                   COALESCE(wrl.y_m, r.map_y) AS y_m,
                   COALESCE(wrl.w_m, r.map_w) AS w_m,
                   COALESCE(wrl.h_m, r.map_h) AS h_m,
                   COALESCE(wrl.rotation_deg, r.rotation_deg) AS rotation_deg
            FROM racks r
            LEFT JOIN warehouse_rack_layouts wrl
              ON wrl.rack_id = r.rack_id
            WHERE r.warehouse_id = :wid AND r.is_active = true
            ORDER BY r.rack_code
        """),
        {"wid": warehouse_id},
    ).fetchall()

    path_rows = db.execute(
        text("""
            SELECT path_id, path_type, label, points, width_m, one_way, direction, sort_order
            FROM warehouse_map_paths
            WHERE warehouse_id = :wid
            ORDER BY sort_order, path_id
        """),
        {"wid": warehouse_id},
    ).fetchall()

    paths = []
    for p in path_rows:
        pts = p.points
        if isinstance(pts, str):
            pts = json.loads(pts)
        paths.append({
            "path_id": p.path_id,
            "path_type": p.path_type,
            "label": p.label,
            "points": pts,
            "width_m": float(p.width_m),
            "one_way": bool(p.one_way),
            "direction": p.direction,
            "sort_order": int(p.sort_order or 0),
        })

    return {
        "config": config,
        "racks": [
            {
                "rack_id": r.rack_id,
                "rack_key": r.rack_key,
                "zone_id": r.zone_id,
                "label": r.label,
                "x_m": float(r.x_m),
                "y_m": float(r.y_m),
                "w_m": float(r.w_m),
                "h_m": float(r.h_m),
                "rotation_deg": float(r.rotation_deg or 0),
            }
            for r in rack_rows
        ],
        "paths": paths,
        "has_saved_layout": row is not None,
    }


def validate_layout_payload(db, warehouse_id: int, payload: SaveWarehouseLayoutRequest) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors block save."""
    errors: list[str] = []
    warnings: list[str] = []

    cfg = payload.layout
    wh_right = cfg.warehouse_x_m + cfg.warehouse_w_m
    wh_bottom = cfg.warehouse_y_m + cfg.warehouse_h_m

    zone_ids = {
        r.zone_id
        for r in db.execute(
            text("SELECT zone_id FROM zones WHERE warehouse_id = :wid AND is_active = true"),
            {"wid": warehouse_id},
        ).fetchall()
    }
    zone_bounds = {
        z.zone_id: {
            "x_m": float(z.map_x),
            "y_m": float(z.map_y),
            "w_m": float(z.map_w),
            "h_m": float(z.map_h),
        }
        for z in db.execute(
            text("""
                SELECT zone_id, map_x, map_y, map_w, map_h
                FROM zones
                WHERE warehouse_id = :wid AND is_active = true
                  AND map_x IS NOT NULL AND map_y IS NOT NULL
                  AND map_w IS NOT NULL AND map_h IS NOT NULL
            """),
            {"wid": warehouse_id},
        ).fetchall()
    }
    for zone in payload.zones:
        zone_bounds[zone.zone_id] = {
            "x_m": zone.map_x,
            "y_m": zone.map_y,
            "w_m": zone.map_w,
            "h_m": zone.map_h,
        }

    supplied_rack_ids = {r.rack_id for r in payload.racks if r.rack_id}
    if supplied_rack_ids:
        owned_rack_ids = {
            r.rack_id
            for r in db.execute(
                text("""
                    SELECT rack_id FROM racks
                    WHERE warehouse_id = :wid AND rack_id = ANY(:rack_ids)
                """),
                {"wid": warehouse_id, "rack_ids": list(supplied_rack_ids)},
            ).fetchall()
        }
        missing = supplied_rack_ids - owned_rack_ids
        if missing:
            errors.append(f"Racks {sorted(missing)} do not belong to warehouse")

    supplied_path_ids = {p.path_id for p in payload.paths if p.path_id}
    if supplied_path_ids:
        owned_path_ids = {
            r.path_id
            for r in db.execute(
                text("""
                    SELECT path_id FROM warehouse_map_paths
                    WHERE warehouse_id = :wid AND path_id = ANY(:path_ids)
                """),
                {"wid": warehouse_id, "path_ids": list(supplied_path_ids)},
            ).fetchall()
        }
        missing = supplied_path_ids - owned_path_ids
        if missing:
            errors.append(f"Paths {sorted(missing)} do not belong to warehouse")

    for zone in payload.zones:
        if zone.zone_id not in zone_ids:
            errors.append(f"Zone {zone.zone_id} does not belong to warehouse")
            continue
        if zone.map_x < cfg.warehouse_x_m or zone.map_y < cfg.warehouse_y_m:
            errors.append(f"Zone {zone.zone_id} is outside warehouse bounds")
        if zone.map_x + zone.map_w > wh_right + 0.01 or zone.map_y + zone.map_h > wh_bottom + 0.01:
            errors.append(f"Zone {zone.zone_id} extends beyond warehouse bounds")

    racks = [r.model_dump() for r in payload.racks]
    for rack in racks:
        if rack["x_m"] < cfg.warehouse_x_m or rack["y_m"] < cfg.warehouse_y_m:
            errors.append(f"Rack {rack['rack_key']} is outside warehouse bounds")
        if rack["x_m"] + rack["w_m"] > wh_right + 0.01 or rack["y_m"] + rack["h_m"] > wh_bottom + 0.01:
            errors.append(f"Rack {rack['rack_key']} extends beyond warehouse bounds")
        if rack.get("zone_id") and rack["zone_id"] not in zone_ids:
            errors.append(f"Rack {rack['rack_key']} references unknown zone")
        zone_rect = zone_bounds.get(rack.get("zone_id"))
        if zone_rect and (
            rack["x_m"] < zone_rect["x_m"]
            or rack["y_m"] < zone_rect["y_m"]
            or rack["x_m"] + rack["w_m"] > zone_rect["x_m"] + zone_rect["w_m"]
            or rack["y_m"] + rack["h_m"] > zone_rect["y_m"] + zone_rect["h_m"]
        ):
            warnings.append(f"Rack {rack['rack_key']} is not fully inside its zone")

    for i, a in enumerate(racks):
        for b in racks[i + 1:]:
            if _rect_overlap(a, b):
                errors.append(f"Racks {a['rack_key']} and {b['rack_key']} overlap")

    for path in payload.paths:
        for pt in path.points:
            if (
                pt.x < cfg.warehouse_x_m
                or pt.y < cfg.warehouse_y_m
                or pt.x > wh_right
                or pt.y > wh_bottom
            ):
                errors.append(
                    f"Path {path.label or path.path_type} has a point outside warehouse"
                )
        if path.path_type == "PEDESTRIAN" and path.width_m < 1.0:
            warnings.append(f"Pedestrian path {path.label or 'unnamed'} is narrower than 1 m")
        if path.path_type == "FORKLIFT" and path.width_m < 2.5:
            warnings.append(f"Forklift path {path.label or 'unnamed'} is narrower than 2.5 m")
        pts = [{"x": p.x, "y": p.y} for p in path.points]
        for rack in racks:
            for idx in range(len(pts) - 1):
                if _segment_intersects_rect(
                    pts[idx], pts[idx + 1], rack, path.width_m / 2
                ):
                    warnings.append(
                        f"Path {path.label or path.path_type} crosses rack {rack['rack_key']}"
                    )
                    break

    forklift_paths = [p for p in payload.paths if p.path_type == "FORKLIFT"]
    pedestrian_paths = [p for p in payload.paths if p.path_type == "PEDESTRIAN"]
    for forklift in forklift_paths:
        forklift_pts = [{"x": p.x, "y": p.y} for p in forklift.points]
        for pedestrian in pedestrian_paths:
            pedestrian_pts = [{"x": p.x, "y": p.y} for p in pedestrian.points]
            intersects = any(
                _segments_intersect(
                    forklift_pts[i],
                    forklift_pts[i + 1],
                    pedestrian_pts[j],
                    pedestrian_pts[j + 1],
                )
                for i in range(len(forklift_pts) - 1)
                for j in range(len(pedestrian_pts) - 1)
            )
            if intersects:
                warnings.append(
                    f"Forklift path {forklift.label or 'unnamed'} intersects "
                    f"pedestrian path {pedestrian.label or 'unnamed'}"
                )

    return errors, warnings


def save_warehouse_layout(
    db,
    warehouse_id: int,
    payload: SaveWarehouseLayoutRequest,
    user_id: int | None,
) -> dict[str, Any]:
    # Serialize first-save and subsequent saves for one warehouse.
    db.execute(
        text("SELECT pg_advisory_xact_lock(84084, :wid)"),
        {"wid": warehouse_id},
    )
    current = db.execute(
        text("""
            SELECT version FROM warehouse_layouts
            WHERE warehouse_id = :wid
            FOR UPDATE
        """),
        {"wid": warehouse_id},
    ).fetchone()

    current_version = int(current.version) if current else 0
    if payload.base_version != current_version:
        return {
            "ok": False,
            "status": 409,
            "error": "Layout was updated by another user. Reload and try again.",
            "current_version": current_version,
        }

    errors, warnings = validate_layout_payload(db, warehouse_id, payload)
    if errors:
        return {"ok": False, "status": 400, "errors": errors, "warnings": warnings}

    before = load_warehouse_layout(db, warehouse_id)
    cfg = payload.layout
    next_version = current_version + 1

    db.execute(
        text("""
            INSERT INTO warehouse_layouts (
                warehouse_id, world_width_m, world_height_m,
                warehouse_x_m, warehouse_y_m, warehouse_w_m, warehouse_h_m,
                grid_step_m, coordinate_unit, version, updated_at, updated_by
            ) VALUES (
                :wid, :ww, :wh, :wx, :wy, :wwh, :whh, :grid, 'METER',
                :ver, NOW(), :uid
            )
            ON CONFLICT (warehouse_id) DO UPDATE SET
                world_width_m = EXCLUDED.world_width_m,
                world_height_m = EXCLUDED.world_height_m,
                warehouse_x_m = EXCLUDED.warehouse_x_m,
                warehouse_y_m = EXCLUDED.warehouse_y_m,
                warehouse_w_m = EXCLUDED.warehouse_w_m,
                warehouse_h_m = EXCLUDED.warehouse_h_m,
                grid_step_m = EXCLUDED.grid_step_m,
                coordinate_unit = 'METER',
                version = EXCLUDED.version,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
        """),
        {
            "wid": warehouse_id,
            "ww": cfg.world_width_m,
            "wh": cfg.world_height_m,
            "wx": cfg.warehouse_x_m,
            "wy": cfg.warehouse_y_m,
            "wwh": cfg.warehouse_w_m,
            "whh": cfg.warehouse_h_m,
            "grid": cfg.grid_step_m,
            "ver": next_version,
            "uid": user_id,
        },
    )

    for zone in payload.zones:
        db.execute(
            text("""
                UPDATE zones
                SET map_x = :x, map_y = :y, map_w = :w, map_h = :h,
                    color_hex = COALESCE(:color, color_hex)
                WHERE zone_id = :zid AND warehouse_id = :wid
            """),
            {
                "x": zone.map_x,
                "y": zone.map_y,
                "w": zone.map_w,
                "h": zone.map_h,
                "color": zone.color_hex,
                "zid": zone.zone_id,
                "wid": warehouse_id,
            },
        )

    saved_rack_ids: list[int] = []
    for rack in payload.racks:
        rack_code = (
            rack.rack_key.replace("|", "-")[:48]
            + "-"
            + hashlib.md5(rack.rack_key.encode("utf-8")).hexdigest()[:12]
        )
        params = {
            "wid": warehouse_id,
            "rid": rack.rack_id,
            "rk": rack.rack_key,
            "rack_code": rack_code,
            "zid": rack.zone_id,
            "label": rack.label or rack.rack_key,
            "aisle": rack.rack_key.split("|")[1] if "|" in rack.rack_key else None,
            "bay": rack.rack_key.split("|")[-1] if "|" in rack.rack_key else None,
            "x": rack.x_m,
            "y": rack.y_m,
            "w": rack.w_m,
            "h": rack.h_m,
            "rot": rack.rotation_deg,
        }
        if rack.rack_id:
            saved = db.execute(
                text("""
                    UPDATE racks SET
                        zone_id = :zid, rack_name = :label,
                        legacy_rack_key = :rk, map_x = :x, map_y = :y,
                        map_w = :w, map_h = :h, rotation_deg = :rot,
                        updated_at = NOW()
                    WHERE rack_id = :rid AND warehouse_id = :wid
                    RETURNING rack_id
                """),
                params,
            ).fetchone()
        else:
            saved = db.execute(
                text("""
                    INSERT INTO racks (
                        warehouse_id, zone_id, rack_code, rack_name, aisle, bay,
                        legacy_rack_key, map_x, map_y, map_w, map_h, rotation_deg
                    ) VALUES (
                        :wid, :zid, :rack_code, :label, :aisle, :bay,
                        :rk, :x, :y, :w, :h, :rot
                    )
                    ON CONFLICT (warehouse_id, legacy_rack_key) DO UPDATE SET
                        zone_id = EXCLUDED.zone_id,
                        rack_name = EXCLUDED.rack_name,
                        map_x = EXCLUDED.map_x, map_y = EXCLUDED.map_y,
                        map_w = EXCLUDED.map_w, map_h = EXCLUDED.map_h,
                        rotation_deg = EXCLUDED.rotation_deg,
                        updated_at = NOW()
                    RETURNING rack_id
                """),
                params,
            ).fetchone()
        rack_id = int(saved.rack_id)
        saved_rack_ids.append(rack_id)
        params["rid"] = rack_id
        db.execute(
            text("""
                INSERT INTO warehouse_rack_layouts (
                    warehouse_id, rack_key, zone_id, label,
                    x_m, y_m, w_m, h_m, rotation_deg, rack_id
                ) VALUES (
                    :wid, :rk, :zid, :label, :x, :y, :w, :h, :rot, :rid
                )
                ON CONFLICT (warehouse_id, rack_key) DO UPDATE SET
                    zone_id = EXCLUDED.zone_id,
                    label = EXCLUDED.label,
                    x_m = EXCLUDED.x_m, y_m = EXCLUDED.y_m,
                    w_m = EXCLUDED.w_m, h_m = EXCLUDED.h_m,
                    rotation_deg = EXCLUDED.rotation_deg,
                    rack_id = EXCLUDED.rack_id
            """),
            params,
        )
        db.execute(
            text("""
                UPDATE bins SET rack_id = :rid
                WHERE warehouse_id = :wid AND zone_id = :zid
                  AND (
                    zone_id::text || '|' ||
                    COALESCE(NULLIF(UPPER(TRIM(aisle)), ''), 'X') || '|' ||
                    COALESCE(NULLIF(TRIM(row_num), ''), bin_code)
                  ) = :rk
            """),
            params,
        )

    saved_path_ids: list[int] = []
    for path in payload.paths:
        params = {
            "wid": warehouse_id,
            "pid": path.path_id,
            "ptype": path.path_type,
            "label": path.label,
            "points": json.dumps([p.model_dump() for p in path.points]),
            "width": path.width_m,
            "one_way": path.one_way,
            "direction": path.direction,
            "sort": path.sort_order,
        }
        if path.path_id:
            saved = db.execute(
                text("""
                    UPDATE warehouse_map_paths SET
                        path_type = :ptype, label = :label,
                        points = CAST(:points AS jsonb), width_m = :width,
                        one_way = :one_way, direction = :direction,
                        sort_order = :sort
                    WHERE path_id = :pid AND warehouse_id = :wid
                    RETURNING path_id
                """),
                params,
            ).fetchone()
        else:
            saved = db.execute(
                text("""
                    INSERT INTO warehouse_map_paths (
                        warehouse_id, path_type, label, points, width_m,
                        one_way, direction, sort_order
                    ) VALUES (
                        :wid, :ptype, :label, CAST(:points AS jsonb), :width,
                        :one_way, :direction, :sort
                    )
                    RETURNING path_id
                """),
                params,
            ).fetchone()
        saved_path_ids.append(int(saved.path_id))

    if saved_path_ids:
        db.execute(
            text("""
                DELETE FROM warehouse_map_paths
                WHERE warehouse_id = :wid
                  AND NOT (path_id = ANY(:keep_ids))
            """),
            {"wid": warehouse_id, "keep_ids": saved_path_ids},
        )
    else:
        db.execute(
            text("DELETE FROM warehouse_map_paths WHERE warehouse_id = :wid"),
            {"wid": warehouse_id},
        )

    after_summary = {
        "version": next_version,
        "coordinate_unit": "METER",
        "zone_count": len(payload.zones),
        "rack_count": len(payload.racks),
        "path_count": len(payload.paths),
    }
    write_audit_log(
        db,
        action_type=ACTION_WAREHOUSE_LAYOUT_UPDATED,
        entity_type="WAREHOUSE_LAYOUT",
        entity_id=warehouse_id,
        user_id=str(user_id or "system"),
        warehouse_id=warehouse_id,
        details={
            "base_version": payload.base_version,
            "before": {
                "version": before["config"].get("version", 0)
                if before.get("has_saved_layout") else 0,
                "coordinate_unit": before["config"].get("coordinate_unit"),
                "rack_count": len(before.get("racks", [])),
                "path_count": len(before.get("paths", [])),
            },
            "after": after_summary,
            "warnings": warnings,
        },
    )

    db.commit()
    return {
        "ok": True,
        "status": 200,
        "version": next_version,
        "rack_ids": saved_rack_ids,
        "path_ids": saved_path_ids,
        "warnings": warnings,
    }
