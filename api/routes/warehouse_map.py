"""Mobile / worker warehouse map endpoints (2D rack grid)."""

from urllib.parse import unquote

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_auth
from middleware.db import with_db
from services.warehouse_map_service import build_rack_detail, build_warehouse_map, parse_bin_address

warehouse_map_bp = Blueprint("warehouse_map", __name__)


def _allowed_warehouse(warehouse_id: int) -> bool:
    if g.current_user.get("role") == "ADMIN":
        return True
    allowed = set(g.current_user.get("warehouse_ids") or [])
    return warehouse_id in allowed


@warehouse_map_bp.route("", methods=["GET"])
@require_auth
@with_db
def get_map():
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    if not _allowed_warehouse(warehouse_id):
        return jsonify({"error": "Forbidden"}), 403

    payload = build_warehouse_map(g.db, warehouse_id)
    if not payload:
        return jsonify({"error": "Warehouse not found"}), 404

    zone_id = request.args.get("zone_id", type=int)
    if zone_id:
        payload["racks"] = [r for r in payload["racks"] if r["zone_id"] == zone_id]
        payload["bins"] = [b for b in payload["bins"] if b["zone_id"] == zone_id]
        payload["zones"] = [z for z in payload["zones"] if z["zone_id"] == zone_id]

    return jsonify(payload)


@warehouse_map_bp.route("/pallet/<string:pallet_code>", methods=["GET"])
@require_auth
@with_db
def locate_pallet(pallet_code):
    """Resolve a QR/barcode scan to the pallet's exact rack slot."""
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    if not _allowed_warehouse(warehouse_id):
        return jsonify({"error": "Forbidden"}), 403

    pallet = g.db.execute(
        text("""
        SELECT p.pallet_id, p.pallet_code, p.pallet_barcode, p.quantity, p.lot_code, p.status,
               p.bin_id, i.sku, i.item_name,
               b.bin_code, b.aisle, b.row_num, b.level_num, b.position_num,
               b.zone_id, b.rack_id, r.legacy_rack_key,
               r.rack_code, r.rack_name, z.zone_code, z.zone_name
        FROM pallets p
        JOIN items i ON i.item_id = p.item_id
        LEFT JOIN bins b ON b.bin_id = p.bin_id
        LEFT JOIN racks r ON r.rack_id = b.rack_id
        LEFT JOIN zones z ON z.zone_id = b.zone_id
        WHERE p.warehouse_id = :warehouse_id
          AND (UPPER(p.pallet_code) = UPPER(:pallet_code)
               OR UPPER(COALESCE(p.pallet_barcode, '')) = UPPER(:pallet_code))
        """),
        {"warehouse_id": warehouse_id, "pallet_code": pallet_code.strip()},
    ).fetchone()
    if not pallet:
        return jsonify({"error": "Pallet not found in this warehouse"}), 404
    if not pallet.bin_id:
        return jsonify({"error": "Pallet has no current storage location", "pallet_code": pallet.pallet_code}), 409

    address = parse_bin_address(pallet)
    return jsonify({
        "pallet": {
            "pallet_id": pallet.pallet_id,
            "pallet_code": pallet.pallet_code,
            "pallet_barcode": pallet.pallet_barcode,
            "sku": pallet.sku,
            "item_name": pallet.item_name,
            "quantity": pallet.quantity,
            "lot_code": pallet.lot_code,
            "status": pallet.status,
        },
        "location": {
            "warehouse_id": warehouse_id,
            "zone_id": pallet.zone_id,
            "zone_code": pallet.zone_code,
            "zone_name": pallet.zone_name,
            "bin_id": pallet.bin_id,
            "bin_code": pallet.bin_code,
            "rack_id": pallet.rack_id,
            "rack_key": pallet.legacy_rack_key or address["rack_key"],
            "rack_label": pallet.rack_name or pallet.rack_code or address["rack_label"],
            "slot_label": address["slot_label"],
            "level": address["level"],
            "position": address["position"],
        },
    })


@warehouse_map_bp.route("/expiry-alerts", methods=["GET"])
@require_auth
@with_db
def expiry_alerts():
    warehouse_id = request.args.get("warehouse_id", type=int)
    days = min(max(request.args.get("days", 30, type=int), 1), 365)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    if not _allowed_warehouse(warehouse_id):
        return jsonify({"error": "Forbidden"}), 403

    rows = g.db.execute(
        text("""
            SELECT p.pallet_id, p.pallet_code, p.quantity, p.lot_code,
                   COALESCE(p.expiry_date, inv.expiry_date) AS expiry_date,
                   i.sku, i.item_name,
                   b.bin_id, b.bin_code, b.zone_id, b.aisle, b.row_num,
                   b.level_num, b.position_num, b.rack_id,
                   r.legacy_rack_key, r.rack_code, r.rack_name,
                   z.zone_code, z.zone_name,
                   (COALESCE(p.expiry_date, inv.expiry_date) - CURRENT_DATE) AS days_remaining
            FROM pallets p
            JOIN items i ON i.item_id = p.item_id
            JOIN bins b ON b.bin_id = p.bin_id
            LEFT JOIN racks r ON r.rack_id = b.rack_id
            JOIN zones z ON z.zone_id = b.zone_id
            LEFT JOIN inventory inv ON inv.pallet_id = p.pallet_id
            WHERE p.warehouse_id = :warehouse_id
              AND p.status = 'STORED'
              AND p.quantity > 0
              AND COALESCE(p.expiry_date, inv.expiry_date) IS NOT NULL
              AND COALESCE(p.expiry_date, inv.expiry_date) <= CURRENT_DATE + :days
            ORDER BY COALESCE(p.expiry_date, inv.expiry_date) ASC, p.pallet_code
        """),
        {"warehouse_id": warehouse_id, "days": days},
    ).fetchall()

    alerts = []
    for row in rows:
        address = parse_bin_address(row)
        alerts.append({
            "pallet_id": row.pallet_id,
            "pallet_code": row.pallet_code,
            "sku": row.sku,
            "item_name": row.item_name,
            "quantity": row.quantity,
            "lot_code": row.lot_code,
            "expiry_date": row.expiry_date.isoformat(),
            "days_remaining": row.days_remaining,
            "severity": "expired" if row.days_remaining < 0 else (
                "critical" if row.days_remaining <= 7 else "warning"
            ),
            "location": {
                "zone_id": row.zone_id,
                "zone_code": row.zone_code,
                "zone_name": row.zone_name,
                "bin_id": row.bin_id,
                "bin_code": row.bin_code,
                "rack_id": row.rack_id,
                "rack_key": row.legacy_rack_key or address["rack_key"],
                "rack_label": row.rack_name or row.rack_code or address["rack_label"],
                "slot_label": address["slot_label"],
            },
        })

    return jsonify({"days": days, "count": len(alerts), "alerts": alerts})


def _rack_response(warehouse_id: int, rack_key=None, rack_id=None):
    payload = build_warehouse_map(g.db, warehouse_id)
    if not payload:
        return jsonify({"error": "Warehouse not found"}), 404

    detail = build_rack_detail(
        payload["bins"], rack_key=rack_key, rack_id=rack_id
    )
    if not detail:
        return jsonify({"error": "Rack not found"}), 404

    highlight_item_id = request.args.get("item_id", type=int)
    highlight_sku = (request.args.get("sku") or "").strip().upper()
    select_mode = (request.args.get("mode") or "view").strip().lower()

    for level in detail["levels"]:
        for slot in level["positions"]:
            bin_data = slot.get("bin")
            selectable = False
            if not bin_data:
                slot["selectable"] = False
                continue

            is_empty = slot["is_empty"]
            has_match = False
            if highlight_item_id or highlight_sku:
                for content in bin_data.get("contents") or []:
                    if highlight_item_id and content.get("item_id") == highlight_item_id:
                        has_match = True
                        break
                    if highlight_sku and (content.get("sku") or "").upper() == highlight_sku:
                        has_match = True
                        break

            if select_mode == "putaway":
                bin_type = (bin_data.get("bin_type") or "").lower()
                selectable = is_empty and bin_type not in (
                    "staging", "pickablestaging", "receiving", "shipping"
                )
            elif select_mode == "pick":
                selectable = has_match and not is_empty
            else:
                selectable = True

            slot["selectable"] = selectable
            slot["highlight"] = has_match

    return jsonify({
        "warehouse_id": payload["warehouse_id"],
        "rack": detail,
        "mode": select_mode,
    })


@warehouse_map_bp.route("/rack/by-id/<int:rack_id>", methods=["GET"])
@require_auth
@with_db
def get_rack_by_id(rack_id):
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    if not _allowed_warehouse(warehouse_id):
        return jsonify({"error": "Forbidden"}), 403
    return _rack_response(warehouse_id, rack_id=rack_id)


@warehouse_map_bp.route("/rack/<path:rack_key>", methods=["GET"])
@require_auth
@with_db
def get_rack(rack_key):
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400
    if not _allowed_warehouse(warehouse_id):
        return jsonify({"error": "Forbidden"}), 403
    rack_key = unquote(rack_key)
    return _rack_response(warehouse_id, rack_key=rack_key)
