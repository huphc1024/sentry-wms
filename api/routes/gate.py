"""Floor gate check-in / check-out (vehicle ↔ PO/SO sessions)."""

from flask import Blueprint, g, jsonify, request
from pydantic import BaseModel, Field
from sqlalchemy import text

from middleware.auth_middleware import check_warehouse_access, require_auth
from middleware.db import with_db
from services.vehicle_service import (
    VehicleValidationError,
    check_in,
    complete_session,
)
from utils.validation import validate_body

gate_bp = Blueprint("gate", __name__)


class GateCheckInRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    movement_type: str = Field(..., max_length=20)
    vehicle_plate: str = Field(..., max_length=64)
    driver_name: str | None = None
    reference_type: str | None = None
    reference_id: int | None = Field(None, gt=0)
    related_pallet_id: int | None = Field(None, gt=0)
    notes: str | None = None


class GateCompleteRequest(BaseModel):
    notes: str | None = None


@gate_bp.route("/check-in", methods=["POST"])
@require_auth
@validate_body(GateCheckInRequest)
@with_db
def gate_check_in(validated):
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
    return jsonify(session), 201


@gate_bp.route("/sessions/<int:movement_id>/complete", methods=["POST"])
@require_auth
@validate_body(GateCompleteRequest)
@with_db
def gate_complete(validated, movement_id):
    row = g.db.execute(
        text("SELECT warehouse_id FROM vehicle_movements WHERE movement_id = :mid"),
        {"mid": movement_id},
    ).fetchone()
    if not row:
        return jsonify({"error": "Gate session not found"}), 404
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


@gate_bp.route("/active", methods=["GET"])
@require_auth
@with_db
def gate_active():
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied
    rows = g.db.execute(
        text("""
            SELECT vm.movement_id, vm.movement_type, vm.vehicle_plate, vm.driver_name,
                   vm.reference_type, vm.reference_id, vm.status, vm.recorded_at,
                   vm.related_pallet_id, vm.notes,
                   CASE
                     WHEN vm.reference_type = 'PO' THEN po.po_number
                     WHEN vm.reference_type = 'SO' THEN so.so_number
                     ELSE NULL
                   END AS reference_number
            FROM vehicle_movements vm
            LEFT JOIN purchase_orders po
              ON vm.reference_type = 'PO' AND po.po_id = vm.reference_id
            LEFT JOIN sales_orders so
              ON vm.reference_type = 'SO' AND so.so_id = vm.reference_id
            WHERE vm.warehouse_id = :wid
              AND vm.status IN ('CHECKED_IN', 'IN_PROGRESS')
            ORDER BY vm.movement_id DESC
        """),
        {"wid": warehouse_id},
    ).fetchall()
    return jsonify({
        "sessions": [
            {
                "movement_id": r.movement_id,
                "movement_type": r.movement_type,
                "vehicle_plate": r.vehicle_plate,
                "driver_name": r.driver_name,
                "reference_type": r.reference_type,
                "reference_id": r.reference_id,
                "reference_number": r.reference_number,
                "related_pallet_id": r.related_pallet_id,
                "status": r.status,
                "recorded_at": r.recorded_at.isoformat() if r.recorded_at else None,
                "notes": r.notes,
                "session": {
                    "open_receive": r.movement_type == "INBOUND" and r.reference_type == "PO",
                    "open_ship": r.movement_type == "OUTBOUND" and r.reference_type == "SO",
                    "po_id": r.reference_id if r.reference_type == "PO" else None,
                    "so_id": r.reference_id if r.reference_type == "SO" else None,
                },
            }
            for r in rows
        ]
    })
