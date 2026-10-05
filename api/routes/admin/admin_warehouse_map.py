"""Warehouse map / simulation aggregate endpoint."""

from flask import g, jsonify, request
from pydantic import ValidationError
from sqlalchemy import text

from constants import OVERRIDE_WAREHOUSE_MAP_EDIT, ROLE_ADMIN
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
    validate_layout_payload,
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
    errors, warnings = validate_layout_payload(g.db, warehouse_id, payload)
    return jsonify({
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
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
