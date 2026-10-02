"""Expiry query and supervisor action endpoints."""

import uuid
from datetime import date, datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import bindparam, text

from middleware.auth_middleware import (
    check_warehouse_access,
    require_admin_or_page_permission,
    require_auth,
)
from middleware.db import with_db
from services.billing_service import create_billing_event
from services.events_service import emit_event

expiry_bp = Blueprint("expiry", __name__)


@expiry_bp.route("/near", methods=["GET"])
@require_auth
@require_admin_or_page_permission("expiry")
@with_db
def near_expiry():
    """GET /api/expiry/near?warehouse_id=&days=7

    Returns pallets/inventory whose expiry_date is within `days` from today.
    """
    warehouse_id = request.args.get("warehouse_id", type=int)
    days = request.args.get("days", type=int, default=7)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400

    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied

    rows = g.db.execute(
        text(
            f"""
            SELECT p.pallet_id, p.pallet_code, p.item_id, i.sku, p.bin_id, p.quantity, p.expiry_date
            FROM pallets p
            LEFT JOIN items i ON i.item_id = p.item_id
            WHERE p.warehouse_id = :wid
              AND p.expiry_date IS NOT NULL
              AND p.expiry_date <= CURRENT_DATE + :days
              AND p.expiry_date >= CURRENT_DATE
            ORDER BY p.expiry_date ASC
            """
        ),
        {"wid": warehouse_id, "days": max(0, min(days, 365))},
    ).fetchall()

    return jsonify(
        {
            "warehouse_id": warehouse_id,
            "near_expiry": [
                {
                    "pallet_id": r.pallet_id,
                    "pallet_code": r.pallet_code,
                    "item_id": r.item_id,
                    "sku": r.sku,
                    "bin_id": r.bin_id,
                    "quantity": r.quantity,
                    "expiry_date": r.expiry_date.isoformat() if r.expiry_date else None,
                }
                for r in rows
            ],
        }
    )


@expiry_bp.route("/expired", methods=["GET"])
@require_auth
@require_admin_or_page_permission("expiry")
@with_db
def expired():
    """GET /api/expiry/expired?warehouse_id=

    Returns expired pallets (expiry_date < today).
    """
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return jsonify({"error": "warehouse_id is required"}), 400

    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied

    rows = g.db.execute(
        text(
            f"""
            SELECT p.pallet_id, p.pallet_code, p.item_id, i.sku, p.bin_id, p.quantity, p.expiry_date
            FROM pallets p
            LEFT JOIN items i ON i.item_id = p.item_id
            WHERE p.warehouse_id = :wid
              AND p.expiry_date IS NOT NULL
              AND p.expiry_date < CURRENT_DATE
            ORDER BY p.expiry_date ASC
            """
        ),
        {"wid": warehouse_id},
    ).fetchall()

    return jsonify(
        {
            "warehouse_id": warehouse_id,
            "expired": [
                {
                    "pallet_id": r.pallet_id,
                    "pallet_code": r.pallet_code,
                    "item_id": r.item_id,
                    "sku": r.sku,
                    "bin_id": r.bin_id,
                    "quantity": r.quantity,
                    "expiry_date": r.expiry_date.isoformat() if r.expiry_date else None,
                }
                for r in rows
            ],
        }
    )


@expiry_bp.route("/dispose", methods=["POST"])
@require_auth
@require_admin_or_page_permission("expiry")
@with_db
def dispose_now():
    """Dispose selected pallets, or run the configured warehouse policy."""
    body = request.get_json() or {}
    pallet_ids = body.get("pallet_ids")
    warehouse_id = body.get("warehouse_id")

    if pallet_ids:
        normalized_ids = sorted({int(pid) for pid in pallet_ids if str(pid).isdigit()})
        if not normalized_ids:
            return jsonify({"error": "pallet_ids must contain positive integers"}), 400

        pallets = g.db.execute(
            text(
                """
                SELECT pallet_id, warehouse_id, customer_id
                FROM pallets
                WHERE pallet_id IN :pallet_ids
                FOR UPDATE
                """
            ).bindparams(bindparam("pallet_ids", expanding=True)),
            {"pallet_ids": normalized_ids},
        ).fetchall()
        if len(pallets) != len(normalized_ids):
            return jsonify({"error": "One or more pallets were not found"}), 404

        for pallet in pallets:
            ok, denied = check_warehouse_access(pallet.warehouse_id)
            if not ok:
                return denied

        charge_setting = g.db.execute(
            text("SELECT value FROM app_settings WHERE key = 'charge_customer_on_dispose'")
        ).fetchone()
        charge_customer = bool(charge_setting and charge_setting.value == "true")
        disposed_count = 0
        for pallet in pallets:
            inventory_rows = g.db.execute(
                text(
                    """
                    SELECT inventory_id, item_id, quantity_on_hand, lot_number
                    FROM inventory
                    WHERE pallet_id = :pid AND quantity_on_hand > 0
                    FOR UPDATE
                    """
                ),
                {"pid": pallet.pallet_id},
            ).fetchall()
            for inventory in inventory_rows:
                quantity = float(inventory.quantity_on_hand)
                g.db.execute(
                    text("DELETE FROM inventory WHERE inventory_id = :iid"),
                    {"iid": inventory.inventory_id},
                )
                emit_event(
                    g.db,
                    event_type="expiry.disposed",
                    event_version=1,
                    aggregate_type="inventory_adjustment",
                    aggregate_id=inventory.inventory_id,
                    aggregate_external_id=uuid.uuid4(),
                    warehouse_id=pallet.warehouse_id,
                    source_txn_id=uuid.uuid4(),
                    payload={
                        "pallet_id": pallet.pallet_id,
                        "item_id": inventory.item_id,
                        "quantity_disposed": quantity,
                        "lot_number": inventory.lot_number,
                        "disposed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "warehouse_id": pallet.warehouse_id,
                    },
                )
                disposed_count += 1

            g.db.execute(
                text(
                    """
                    UPDATE pallets
                    SET status = 'DISPOSED', quantity = 0, updated_at = NOW()
                    WHERE pallet_id = :pid
                    """
                ),
                {"pid": pallet.pallet_id},
            )
            if charge_customer and pallet.customer_id:
                create_billing_event(
                    g.db,
                    pallet.customer_id,
                    pallet.warehouse_id,
                    "DISPOSAL",
                    "PALLET",
                    pallet.pallet_id,
                    1,
                )

        g.db.commit()
        return jsonify({
            "message": "Selected pallets disposed",
            "pallet_count": len(pallets),
            "inventory_count": disposed_count,
        })

    if not warehouse_id:
        return jsonify({"error": "pallet_ids or warehouse_id is required"}), 400
    ok, denied = check_warehouse_access(int(warehouse_id))
    if not ok:
        return denied

    from jobs.expiry_tasks import process_expiry

    process_expiry(g.db, warehouse_id=int(warehouse_id))
    g.db.commit()
    return jsonify({"message": "Expiry policy run completed"})


@expiry_bp.route("/extend", methods=["POST"])
@require_auth
@require_admin_or_page_permission("expiry")
@with_db
def extend_expiry():
    """Set a future expiry date on selected pallets and their inventory."""
    body = request.get_json() or {}
    pallet_ids = body.get("pallet_ids") or []
    expiry_value = body.get("expiry_date")
    try:
        new_expiry = date.fromisoformat(expiry_value)
    except (TypeError, ValueError):
        return jsonify({"error": "expiry_date must use YYYY-MM-DD"}), 400
    if new_expiry < date.today():
        return jsonify({"error": "expiry_date cannot be in the past"}), 400

    normalized_ids = sorted({int(pid) for pid in pallet_ids if str(pid).isdigit()})
    if not normalized_ids:
        return jsonify({"error": "pallet_ids is required"}), 400

    pallets = g.db.execute(
        text(
            """
            SELECT pallet_id, warehouse_id
            FROM pallets
            WHERE pallet_id IN :pallet_ids
            FOR UPDATE
            """
        ).bindparams(bindparam("pallet_ids", expanding=True)),
        {"pallet_ids": normalized_ids},
    ).fetchall()
    if len(pallets) != len(normalized_ids):
        return jsonify({"error": "One or more pallets were not found"}), 404
    for pallet in pallets:
        ok, denied = check_warehouse_access(pallet.warehouse_id)
        if not ok:
            return denied

    g.db.execute(
        text(
            """
            UPDATE pallets
            SET expiry_date = :expiry_date,
                status = CASE WHEN status = 'EXPIRED' THEN 'STORED' ELSE status END,
                updated_at = NOW()
            WHERE pallet_id IN :pallet_ids
            """
        ).bindparams(bindparam("pallet_ids", expanding=True)),
        {"pallet_ids": normalized_ids, "expiry_date": new_expiry},
    )
    g.db.execute(
        text(
            """
            UPDATE inventory
            SET expiry_date = :expiry_date, updated_at = NOW()
            WHERE pallet_id IN :pallet_ids
            """
        ).bindparams(bindparam("pallet_ids", expanding=True)),
        {"pallet_ids": normalized_ids, "expiry_date": new_expiry},
    )
    g.db.commit()
    return jsonify({"message": "Expiry dates updated", "count": len(normalized_ids)})

