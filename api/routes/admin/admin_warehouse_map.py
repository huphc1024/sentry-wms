"""Warehouse map / simulation aggregate endpoint."""

from flask import g, jsonify, request
from pydantic import ValidationError
from sqlalchemy import text

from constants import (
    BATCH_COMPLETED,
    BATCH_IN_PROGRESS,
    BATCH_OPEN,
    OVERRIDE_WAREHOUSE_MAP_EDIT,
    ROLE_ADMIN,
    TASK_RELEASED,
)
from middleware.auth_middleware import (
    check_warehouse_access,
    has_override,
    require_admin_or_page_permission,
    require_auth,
)
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.warehouse_layout import SaveWarehouseLayoutRequest
from services.warehouse_layout_service import (
    save_warehouse_layout,
    validate_layout_issues,
)
from services.warehouse_map_service import build_warehouse_map


@admin_bp.route("/warehouse-map", methods=["GET"])
@require_auth
@require_admin_or_page_permission("warehouse-simulation")
@with_db
def get_warehouse_map():
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400

    payload = build_warehouse_map(g.db, warehouse_id)
    if not payload:
        return jsonify({"error": "Warehouse not found"}), 404

    return jsonify(payload)


PICK_PATH_COMPLETED_LIMIT = 10


@admin_bp.route("/warehouse-map/pick-paths", methods=["GET"])
@require_auth
@require_admin_or_page_permission("warehouse-simulation")
@with_db
def get_warehouse_map_pick_paths():
    """Pick batches of one warehouse with their tasks in walk order.

    Read-only feed for the 3D warehouse view, which draws each batch as a
    route through its bins. The admin Picking Batches list is gated by a
    different page key and carries no task rows, so it cannot serve a
    user who only holds the simulation grant.

    Returns every OPEN / IN_PROGRESS batch plus the most recent COMPLETED
    ones (CANCELLED batches never walked a route). RELEASED tasks were
    unwound and are left out.
    """
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    allowed, denied = check_warehouse_access(warehouse_id)
    if not allowed:
        return denied

    batch_rows = g.db.execute(
        text("""
            SELECT * FROM (
                (SELECT batch_id, batch_number, status, assigned_to, created_at,
                        started_at, completed_at
                   FROM pick_batches
                  WHERE warehouse_id = :wid AND status IN (:b_open, :b_inprog))
                UNION ALL
                (SELECT batch_id, batch_number, status, assigned_to, created_at,
                        started_at, completed_at
                   FROM pick_batches
                  WHERE warehouse_id = :wid AND status = :b_done
                  ORDER BY completed_at DESC NULLS LAST, batch_id DESC
                  LIMIT :done_limit)
            ) AS batches
            ORDER BY CASE WHEN status = :b_done THEN 1 ELSE 0 END,
                     created_at DESC, batch_id DESC
        """),
        {
            "wid": warehouse_id,
            "b_open": BATCH_OPEN,
            "b_inprog": BATCH_IN_PROGRESS,
            "b_done": BATCH_COMPLETED,
            "done_limit": PICK_PATH_COMPLETED_LIMIT,
        },
    ).fetchall()

    batch_ids = [b.batch_id for b in batch_rows]
    tasks_by_batch: dict = {}
    orders_by_batch: dict = {}
    if batch_ids:
        task_rows = g.db.execute(
            text("""
                SELECT pt.batch_id, pt.pick_task_id, pt.pick_sequence, pt.bin_id,
                       b.bin_code, pt.item_id, i.sku, i.item_name,
                       pt.quantity_to_pick, pt.quantity_picked, pt.status,
                       so.so_number, pt.tote_number
                  FROM pick_tasks pt
                  JOIN bins b ON b.bin_id = pt.bin_id
                  JOIN items i ON i.item_id = pt.item_id
                  LEFT JOIN sales_orders so ON so.so_id = pt.so_id
                 WHERE pt.batch_id = ANY(:ids)
                   AND COALESCE(pt.status, '') <> :released
                 ORDER BY pt.batch_id, pt.pick_sequence, b.bin_code, pt.pick_task_id
            """),
            {"ids": batch_ids, "released": TASK_RELEASED},
        ).fetchall()
        for r in task_rows:
            tasks_by_batch.setdefault(r.batch_id, []).append({
                "pick_task_id": r.pick_task_id,
                "pick_sequence": r.pick_sequence,
                "bin_id": r.bin_id,
                "bin_code": r.bin_code,
                "item_id": r.item_id,
                "sku": r.sku,
                "item_name": r.item_name,
                "quantity_to_pick": int(r.quantity_to_pick or 0),
                "quantity_picked": int(r.quantity_picked or 0),
                "status": r.status,
                "so_number": r.so_number,
                "tote_number": r.tote_number,
            })
        for r in g.db.execute(
            text("""
                SELECT pbo.batch_id, so.so_number
                  FROM pick_batch_orders pbo
                  JOIN sales_orders so ON so.so_id = pbo.so_id
                 WHERE pbo.batch_id = ANY(:ids)
                 ORDER BY pbo.batch_id, so.so_number
            """),
            {"ids": batch_ids},
        ).fetchall():
            orders_by_batch.setdefault(r.batch_id, []).append(r.so_number)

    def _iso(dt):
        return dt.isoformat() if dt else None

    return jsonify({
        "warehouse_id": warehouse_id,
        "batches": [
            {
                "batch_id": b.batch_id,
                "batch_number": b.batch_number,
                "status": b.status,
                "assigned_to": b.assigned_to,
                "created_at": _iso(b.created_at),
                "started_at": _iso(b.started_at),
                "completed_at": _iso(b.completed_at),
                "orders": orders_by_batch.get(b.batch_id, []),
                "tasks": tasks_by_batch.get(b.batch_id, []),
            }
            for b in batch_rows
        ],
    })


def _require_layout_edit():
    if (
        g.current_user.get("role") != ROLE_ADMIN
        and not has_override(OVERRIDE_WAREHOUSE_MAP_EDIT)
    ):
        return jsonify({
            "error": "Layout edit requires ADMIN or warehouse-map-edit override",
            "page_key": OVERRIDE_WAREHOUSE_MAP_EDIT,
        }), 403
    return None


def _parse_layout_request():
    body = request.get_json(silent=True) or {}
    try:
        return SaveWarehouseLayoutRequest.model_validate(body), None
    except ValidationError as exc:
        return None, (
            jsonify({"error": "Invalid layout payload", "details": exc.errors()}),
            400,
        )


@admin_bp.route("/warehouse-map/layout/validate", methods=["POST"])
@require_auth
@require_admin_or_page_permission("warehouse-simulation")
@with_db
def validate_warehouse_map_layout():
    denied = _require_layout_edit()
    if denied:
        return denied
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    allowed, denied = check_warehouse_access(warehouse_id)
    if not allowed:
        return denied
    payload, invalid = _parse_layout_request()
    if invalid:
        return invalid
    issues = validate_layout_issues(g.db, warehouse_id, payload)
    errors = [i["message"] for i in issues if i["severity"] == "error"]
    return jsonify({
        "valid": not errors,
        "errors": errors,
        "warnings": [i["message"] for i in issues if i["severity"] == "warning"],
        "issues": issues,
    })


@admin_bp.route("/warehouse-map/layout", methods=["PUT"])
@require_auth
@require_admin_or_page_permission("warehouse-simulation")
@with_db
def put_warehouse_map_layout():
    denied = _require_layout_edit()
    if denied:
        return denied
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    allowed, denied = check_warehouse_access(warehouse_id)
    if not allowed:
        return denied

    payload, invalid = _parse_layout_request()
    if invalid:
        return invalid

    wh = g.db.execute(
        text("SELECT warehouse_id FROM warehouses WHERE warehouse_id = :wid"),
        {"wid": warehouse_id},
    ).fetchone()
    if not wh:
        return jsonify({"error": "Warehouse not found"}), 404

    user_id = g.current_user.get("user_id")
    result = save_warehouse_layout(g.db, warehouse_id, payload, user_id)
    if not result.get("ok"):
        status = result.get("status", 400)
        body_out = {k: v for k, v in result.items() if k not in ("ok", "status")}
        return jsonify(body_out), status

    refreshed = build_warehouse_map(g.db, warehouse_id)
    return jsonify({
        "version": result["version"],
        "warnings": result.get("warnings", []),
        "layout": refreshed.get("layout") if refreshed else None,
    })
