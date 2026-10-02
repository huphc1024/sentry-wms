"""Portal stock visibility: on-hand and expected inbound (phase 3).

Deliberately omitted from both payloads: bin_code, zone, and any other
locator. Where goods sit inside the building is the operator's layout,
not the customer's data, and publishing it would leak the warehouse map
to every tenant. On-hand is aggregated per SKU (and lot, when the item
is lot-tracked) for the same reason -- a per-bin breakdown reconstructs
the layout even without the bin labels.
"""

from flask import g, jsonify, request
from sqlalchemy import text

from constants import CUSTOMER_FEATURE_INBOUND, CUSTOMER_FEATURE_INVENTORY
from middleware.auth_middleware import (
    customer_scope_clause,
    require_customer_auth,
    require_customer_feature,
)
from middleware.db import with_db
from routes.portal import paging, portal_bp


@portal_bp.route("/inventory")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_INVENTORY)
@with_db
def inventory():
    """On-hand for the caller's own SKUs, aggregated per item + lot."""
    scope, params = customer_scope_clause("i.owner_customer_id")
    page, size, offset = paging()

    search = (request.args.get("search") or "").strip()
    search_clause = ""
    if search:
        search_clause = "AND (i.sku ILIKE :q OR i.item_name ILIKE :q)"
        params["q"] = f"%{search}%"

    # quantity_available mirrors the staff-side derivation
    # (on_hand - allocated); it is not a stored column.
    rows = g.db.execute(
        text(f"""
            SELECT i.sku,
                   i.item_name,
                   inv.lot_number,
                   inv.expiry_date,
                   w.warehouse_code,
                   w.warehouse_name,
                   SUM(inv.quantity_on_hand)                          AS on_hand,
                   SUM(inv.quantity_allocated)                        AS allocated,
                   SUM(inv.quantity_on_hand - inv.quantity_allocated) AS available
            FROM inventory inv
            JOIN items i      ON i.item_id = inv.item_id
            JOIN warehouses w ON w.warehouse_id = inv.warehouse_id
            WHERE inv.quantity_on_hand > 0
              {scope}
              {search_clause}
            GROUP BY i.sku, i.item_name, inv.lot_number, inv.expiry_date,
                     w.warehouse_code, w.warehouse_name
            ORDER BY i.sku, inv.lot_number NULLS FIRST
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": size, "offset": offset},
    ).fetchall()

    total = g.db.execute(
        text(f"""
            SELECT COUNT(*) FROM (
                SELECT 1
                FROM inventory inv
                JOIN items i ON i.item_id = inv.item_id
                WHERE inv.quantity_on_hand > 0
                  {scope}
                  {search_clause}
                GROUP BY i.sku, inv.lot_number, inv.expiry_date, inv.warehouse_id
            ) AS grouped
        """),
        params,
    ).fetchone()[0]

    return jsonify({
        "page": page,
        "page_size": size,
        "total": total,
        "items": [{
            "sku": r.sku,
            "item_name": r.item_name,
            "lot_number": r.lot_number,
            "expiry_date": r.expiry_date.isoformat() if r.expiry_date else None,
            "warehouse_code": r.warehouse_code,
            "warehouse_name": r.warehouse_name,
            "quantity_on_hand": int(r.on_hand),
            "quantity_allocated": int(r.allocated),
            "quantity_available": int(r.available),
        } for r in rows],
    })


@portal_bp.route("/inbound")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_INBOUND)
@with_db
def inbound():
    """Expected and received goods, from POs owned by this customer.

    Scoped on purchase_orders.owner_customer_id (mig 087). That column has
    no backfill -- there was no prior column to derive it from -- so POs
    created before phase 1 show up for nobody until an operator attributes
    them. Empty here means "not yet attributed", not "nothing inbound".
    """
    scope, params = customer_scope_clause("po.owner_customer_id")
    page, size, offset = paging()

    status = (request.args.get("status") or "").strip().upper()
    status_clause = ""
    if status:
        status_clause = "AND po.status = :status"
        params["status"] = status

    rows = g.db.execute(
        text(f"""
            SELECT po.po_number,
                   po.status,
                   po.expected_date,
                   po.received_at,
                   w.warehouse_code,
                   COUNT(pol.po_line_id)               AS line_count,
                   COALESCE(SUM(pol.quantity_ordered), 0)  AS qty_ordered,
                   COALESCE(SUM(pol.quantity_received), 0) AS qty_received
            FROM purchase_orders po
            JOIN warehouses w ON w.warehouse_id = po.warehouse_id
            LEFT JOIN purchase_order_lines pol ON pol.po_id = po.po_id
            WHERE 1 = 1
              {scope}
              {status_clause}
            GROUP BY po.po_id, po.po_number, po.status, po.expected_date,
                     po.received_at, w.warehouse_code
            ORDER BY po.expected_date DESC NULLS LAST, po.po_number DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": size, "offset": offset},
    ).fetchall()

    total = g.db.execute(
        text(f"""
            SELECT COUNT(*) FROM purchase_orders po
            WHERE 1 = 1
              {scope}
              {status_clause}
        """),
        params,
    ).fetchone()[0]

    return jsonify({
        "page": page,
        "page_size": size,
        "total": total,
        "purchase_orders": [{
            "po_number": r.po_number,
            "status": r.status,
            "expected_date": r.expected_date.isoformat() if r.expected_date else None,
            "received_at": r.received_at.isoformat() if r.received_at else None,
            "warehouse_code": r.warehouse_code,
            "line_count": int(r.line_count),
            "quantity_ordered": int(r.qty_ordered),
            "quantity_received": int(r.qty_received),
        } for r in rows],
    })
