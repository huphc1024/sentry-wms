# Admin vehicle / gate movement endpoints.
from flask import g, jsonify, request
from pydantic import BaseModel, Field
from sqlalchemy import text

from middleware.auth_middleware import (
    check_warehouse_access,
    require_admin_or_page_permission,
    require_auth,
)
from middleware.db import with_db
from routes.admin import admin_bp
from services.vehicle_service import (
    VehicleValidationError,
    check_in,
    complete_session,
)
from utils.validation import validate_body


class CreateVehicleMovement(BaseModel):
    movement_type: str = Field(..., max_length=20)
    vehicle_plate: str = Field(..., max_length=64)
    warehouse_id: int = Field(..., gt=0)
    driver_name: str | None = None
    reference_type: str | None = None
    reference_id: int | None = Field(None, gt=0)
    related_pallet_id: int | None = Field(None, gt=0)
    notes: str | None = None


class CompleteVehicleMovement(BaseModel):
    notes: str | None = None


@admin_bp.route("/vehicle-movements", methods=["GET"])
@require_auth
@require_admin_or_page_permission("vehicle-movements")
@with_db
def list_vehicle_movements():
    warehouse_id = request.args.get("warehouse_id", type=int)
    status = request.args.get("status")
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 200)
    clauses = ["1=1"]
    params = {"limit": per_page, "offset": (page - 1) * per_page}
    if warehouse_id:
        ok, denied = check_warehouse_access(warehouse_id)
        if not ok:
            return denied
        clauses.append("vm.warehouse_id = :wid")
        params["wid"] = warehouse_id
    if status:
        clauses.append("vm.status = :status")
        params["status"] = status
    where = " AND ".join(clauses)
    rows = g.db.execute(
        text(f"""
            SELECT vm.movement_id, vm.movement_type, vm.vehicle_plate, vm.driver_name,
                   vm.reference_type, vm.reference_id, vm.related_pallet_id,
                   vm.warehouse_id, vm.status, vm.recorded_by, vm.recorded_at,
                   vm.completed_at, vm.completed_by, vm.notes,
                   CASE
                     WHEN vm.reference_type = 'PO' THEN po.po_number
                     WHEN vm.reference_type = 'SO' THEN so.so_number
                     ELSE NULL
                   END AS reference_number,
                   p.pallet_code
            FROM vehicle_movements vm
            LEFT JOIN purchase_orders po
              ON vm.reference_type = 'PO' AND po.po_id = vm.reference_id
            LEFT JOIN sales_orders so
              ON vm.reference_type = 'SO' AND so.so_id = vm.reference_id
            LEFT JOIN pallets p ON p.pallet_id = vm.related_pallet_id
            WHERE {where}
            ORDER BY vm.movement_id DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()
    total = g.db.execute(
        text(f"SELECT COUNT(*) FROM vehicle_movements vm WHERE {where}"),
        params,
    ).scalar()
    return jsonify({
        "movements": [
            {
                "movement_id": r.movement_id,
                "movement_type": r.movement_type,
                "vehicle_plate": r.vehicle_plate,
                "driver_name": r.driver_name,
                "reference_type": r.reference_type,
                "reference_id": r.reference_id,
                "reference_number": r.reference_number,
                "related_pallet_id": r.related_pallet_id,
                "pallet_code": r.pallet_code,
                "warehouse_id": r.warehouse_id,
                "status": r.status,
                "recorded_by": r.recorded_by,
                "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "completed_by": r.completed_by,
                "notes": r.notes,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
    })


@admin_bp.route("/vehicle-movements", methods=["POST"])
@require_auth
@require_admin_or_page_permission("vehicle-movements")
@validate_body(CreateVehicleMovement)
@with_db
def create_vehicle_movement(validated):
    data = validated.model_dump()
    ok, denied = check_warehouse_access(data["warehouse_id"])
    if not ok:
        return denied
    try:
        session = check_in(
            g.db,
            movement_type=data["movement_type"],
            vehicle_plate=data["vehicle_plate"],
            warehouse_id=data["warehouse_id"],
            recorded_by=g.current_user["username"],
            driver_name=data.get("driver_name"),
            reference_type=data.get("reference_type"),
            reference_id=data.get("reference_id"),
            related_pallet_id=data.get("related_pallet_id"),
            notes=data.get("notes"),
        )
    except VehicleValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    g.db.commit()
    return jsonify({"message": "recorded", **session}), 201


@admin_bp.route("/vehicle-movements/<int:movement_id>/complete", methods=["POST"])
@require_auth
@require_admin_or_page_permission("vehicle-movements")
@validate_body(CompleteVehicleMovement)
@with_db
def complete_vehicle_movement(validated, movement_id):
    row = g.db.execute(
        text("SELECT warehouse_id FROM vehicle_movements WHERE movement_id = :mid"),
        {"mid": movement_id},
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    if row.warehouse_id:
        ok, denied = check_warehouse_access(row.warehouse_id)
        if not ok:
            return denied
    try:
        result = complete_session(
            g.db,
            movement_id,
            completed_by=g.current_user["username"],
            notes=validated.notes,
        )
    except VehicleValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    g.db.commit()
    return jsonify(result)
