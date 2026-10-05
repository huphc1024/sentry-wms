"""Floor endpoints for pallet LPN creation (no admin page grant required)."""

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_auth, check_warehouse_access
from middleware.db import with_db
from schemas.pallets import FloorCreatePalletRequest
from services.pallet_service import create_empty_pallet, next_pallet_code
from utils.validation import validate_body

pallets_bp = Blueprint("pallets", __name__)


@pallets_bp.route("/next-code", methods=["GET"])
@require_auth
@with_db
def floor_next_pallet_code():
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400

    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied

    code = next_pallet_code(g.db, warehouse_id)
    if not code:
        return jsonify({"error": "Warehouse not found"}), 404
    return jsonify({"pallet_code": code})


@pallets_bp.route("", methods=["POST"])
@require_auth
@validate_body(FloorCreatePalletRequest)
@with_db
def floor_create_pallet(validated):
    data = validated.model_dump()
    warehouse_id = data["warehouse_id"]

    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied

    if data.get("customer_id"):
        cust = g.db.execute(
            text("SELECT canonical_id FROM customers WHERE canonical_id = :cid AND is_active = true"),
            {"cid": data["customer_id"]},
        ).fetchone()
        if not cust:
            return jsonify({"error": "Customer not found"}), 404

    try:
        created = create_empty_pallet(
            g.db,
            warehouse_id=warehouse_id,
            created_by=g.current_user["username"],
            customer_id=data.get("customer_id"),
            pallet_code=data.get("pallet_code"),
            pallet_barcode=data.get("pallet_barcode"),
        )
    except ValueError:
        return jsonify({"error": "Warehouse not found"}), 404

    g.db.commit()
    return jsonify(created), 201
