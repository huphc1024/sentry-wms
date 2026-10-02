"""Portal outbound orders: list, detail, and submit (phase 3).

On submit: the plan for this phase was to route portal orders through the
v1.7 inbound pipeline so they reused its validation and idempotency. That
turned out not to fit. handle_inbound() takes ``token=g.current_token``
(a wms_tokens row) plus a mapping registry keyed by source_system, so
reusing it would mean provisioning an
inbound_source_systems_allowlist row and a db/mappings/<system>.yaml for
every single customer, and minting a synthetic token per portal request.
That is connector-shaped machinery for a first-party UI.

So this writes the sales_order directly -- but with every
trust-sensitive field server-controlled:

  customer_ref  the authenticated caller, never the body
  customer_id   / customer_name resolved from that customer row
  warehouse_id  resolved from a warehouse the caller holds stock in
  status        SO_OPEN, so the order enters the operator's normal queue
  so_number     server-generated
  order_origin  'customer-portal', so operators can tell these apart
  source_system left NULL: it is FK-gated on the operator-managed
                allowlist and a portal order has no source ERP

Line items are resolved by SKU and every one is checked to belong to the
caller, so a customer cannot order goods it does not own.
"""

import uuid

from flask import g, jsonify
from sqlalchemy import text

from constants import CUSTOMER_FEATURE_ORDERS, SO_OPEN
from middleware.auth_middleware import (
    customer_scope_clause,
    require_customer_auth,
    require_customer_feature,
)
from middleware.db import with_db
from routes.portal import paging, portal_bp
from schemas.portal import OutboundRequestBody
from services.audit_service import write_audit_log
from utils.validation import validate_body

ORDER_ORIGIN_PORTAL = "customer-portal"


@portal_bp.route("/orders")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_ORDERS)
@with_db
def orders():
    scope, params = customer_scope_clause("so.customer_ref")
    page, size, offset = paging()

    rows = g.db.execute(
        text(f"""
            SELECT so.so_number,
                   so.status,
                   so.order_date,
                   so.ship_by_date,
                   so.ship_method,
                   so.order_origin,
                   w.warehouse_code,
                   COUNT(sol.so_line_id)                  AS line_count,
                   COALESCE(SUM(sol.quantity_ordered), 0) AS qty_ordered,
                   COALESCE(SUM(sol.quantity_shipped), 0) AS qty_shipped
            FROM sales_orders so
            JOIN warehouses w ON w.warehouse_id = so.warehouse_id
            LEFT JOIN sales_order_lines sol ON sol.so_id = so.so_id
            WHERE 1 = 1
              {scope}
            GROUP BY so.so_id, so.so_number, so.status, so.order_date,
                     so.ship_by_date, so.ship_method, so.order_origin,
                     w.warehouse_code
            ORDER BY so.order_date DESC NULLS LAST, so.so_number DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": size, "offset": offset},
    ).fetchall()

    total = g.db.execute(
        text(f"SELECT COUNT(*) FROM sales_orders so WHERE 1 = 1 {scope}"),
        params,
    ).fetchone()[0]

    return jsonify({
        "page": page,
        "page_size": size,
        "total": total,
        "orders": [{
            "so_number": r.so_number,
            "status": r.status,
            "order_date": r.order_date.isoformat() if r.order_date else None,
            "ship_by_date": r.ship_by_date.isoformat() if r.ship_by_date else None,
            "ship_method": r.ship_method,
            "order_origin": r.order_origin,
            "warehouse_code": r.warehouse_code,
            "line_count": int(r.line_count),
            "quantity_ordered": int(r.qty_ordered),
            "quantity_shipped": int(r.qty_shipped),
        } for r in rows],
    })


@portal_bp.route("/orders/<so_number>")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_ORDERS)
@with_db
def order_detail(so_number):
    """404 covers both "no such order" and "another customer's order".

    The scope clause is part of the WHERE, so the two cases produce the
    same empty result and therefore the same response. Checking ownership
    after a successful fetch would instead answer "that order exists but
    is not yours", turning the endpoint into an existence oracle over
    other customers' order numbers.
    """
    scope, params = customer_scope_clause("so.customer_ref")
    params["so_number"] = so_number

    header = g.db.execute(
        text(f"""
            SELECT so.so_id, so.so_number, so.status, so.order_date,
                   so.ship_by_date, so.ship_method, so.ship_address,
                   so.memo, so.order_origin, w.warehouse_code
            FROM sales_orders so
            JOIN warehouses w ON w.warehouse_id = so.warehouse_id
            WHERE so.so_number = :so_number
              {scope}
        """),
        params,
    ).fetchone()
    if not header:
        return jsonify({"error": "Order not found"}), 404

    lines = g.db.execute(
        text("""
            SELECT i.sku, i.item_name, sol.line_number, sol.quantity_ordered,
                   sol.quantity_picked, sol.quantity_shipped, sol.status
            FROM sales_order_lines sol
            JOIN items i ON i.item_id = sol.item_id
            WHERE sol.so_id = :so_id
            ORDER BY sol.line_number
        """),
        {"so_id": header.so_id},
    ).fetchall()

    return jsonify({
        "so_number": header.so_number,
        "status": header.status,
        "order_date": header.order_date.isoformat() if header.order_date else None,
        "ship_by_date": header.ship_by_date.isoformat() if header.ship_by_date else None,
        "ship_method": header.ship_method,
        "ship_address": header.ship_address,
        "memo": header.memo,
        "order_origin": header.order_origin,
        "warehouse_code": header.warehouse_code,
        "lines": [{
            "line_number": r.line_number,
            "sku": r.sku,
            "item_name": r.item_name,
            "quantity_ordered": r.quantity_ordered,
            "quantity_picked": r.quantity_picked,
            "quantity_shipped": r.quantity_shipped,
            "status": r.status,
        } for r in lines],
    })


def _resolve_warehouse(scope, params, requested_code):
    """Pick the warehouse to ship from. Returns (warehouse_id, error_response).

    Candidates are warehouses where the caller actually holds stock, which
    is also what makes an operator-supplied code safe to honour: a code
    the customer has nothing in is simply not a candidate and comes back
    as 404 rather than addressing someone else's site.
    """
    rows = g.db.execute(
        text(f"""
            SELECT DISTINCT w.warehouse_id, w.warehouse_code
            FROM inventory inv
            JOIN items i      ON i.item_id = inv.item_id
            JOIN warehouses w ON w.warehouse_id = inv.warehouse_id
            WHERE inv.quantity_on_hand > 0
              {scope}
            ORDER BY w.warehouse_code
        """),
        params,
    ).fetchall()

    if requested_code:
        match = [r for r in rows if r.warehouse_code == requested_code]
        if not match:
            return None, (jsonify({"error": "Warehouse not found"}), 404)
        return match[0].warehouse_id, None

    if not rows:
        return None, (
            jsonify({"error": "No stock on hand to ship from"}),
            409,
        )
    if len(rows) > 1:
        return None, (
            jsonify({
                "error": "warehouse_code is required",
                "choices": [r.warehouse_code for r in rows],
            }),
            400,
        )
    return rows[0].warehouse_id, None


@portal_bp.route("/orders", methods=["POST"])
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_ORDERS)
@validate_body(OutboundRequestBody)
@with_db
def create_order(validated):
    customer_id = g.current_customer["customer_id"]
    username = g.current_customer["username"]

    customer = g.db.execute(
        text(
            "SELECT customer_code, customer_name FROM customers "
            "WHERE canonical_id = :cid"
        ),
        {"cid": customer_id},
    ).fetchone()
    if not customer:
        return jsonify({"error": "Customer not found"}), 404

    item_scope, item_params = customer_scope_clause("i.owner_customer_id")
    warehouse_id, err = _resolve_warehouse(
        item_scope, dict(item_params), validated.warehouse_code
    )
    if err:
        return err

    # Resolve every SKU under the ownership scope. An SKU that exists but
    # belongs to another customer resolves to nothing and is reported the
    # same way as an SKU that does not exist -- same non-oracle reasoning
    # as order_detail above.
    resolved = []
    for line in validated.lines:
        row = g.db.execute(
            text(f"""
                SELECT i.item_id FROM items i
                WHERE UPPER(i.sku) = UPPER(:sku)
                  {item_scope}
            """),
            {**item_params, "sku": line.sku},
        ).fetchone()
        if not row:
            return jsonify({
                "error": "Unknown sku",
                "sku": line.sku,
            }), 400
        resolved.append((row.item_id, line.quantity))

    # so_number must be unique. Derived from a dedicated sequence rather
    # than a timestamp or a COUNT(*), both of which collide under
    # concurrent submissions from the same customer.
    seq = g.db.execute(text("SELECT nextval('portal_order_seq')")).fetchone()[0]
    so_number = f"PORTAL-{customer.customer_code or 'NA'}-{seq:06d}"

    result = g.db.execute(
        text("""
            INSERT INTO sales_orders (
                so_number, so_barcode, customer_name, customer_id,
                customer_ref, status, warehouse_id, ship_method,
                ship_address, memo, order_origin, order_date, created_by,
                external_id
            ) VALUES (
                :so_number, :so_number, :customer_name, :customer_code,
                :customer_ref, :status, :warehouse_id, :ship_method,
                :ship_address, :memo, :order_origin, NOW(), :created_by,
                :external_id
            ) RETURNING so_id
        """),
        {
            "so_number": so_number,
            "customer_name": validated.ship_to_name or customer.customer_name,
            "customer_code": customer.customer_code,
            "customer_ref": customer_id,
            "status": SO_OPEN,
            "warehouse_id": warehouse_id,
            "ship_method": validated.ship_method,
            "ship_address": validated.ship_address,
            "memo": validated.memo,
            "order_origin": ORDER_ORIGIN_PORTAL,
            "created_by": f"portal:{username}",
            "external_id": str(uuid.uuid4()),
        },
    )
    so_id = result.fetchone()[0]

    for idx, (item_id, quantity) in enumerate(resolved, start=1):
        g.db.execute(
            text("""
                INSERT INTO sales_order_lines
                    (so_id, item_id, quantity_ordered, line_number, status)
                VALUES (:so_id, :item_id, :qty, :line_number, 'PENDING')
            """),
            {
                "so_id": so_id,
                "item_id": item_id,
                "qty": quantity,
                "line_number": idx,
            },
        )

    write_audit_log(
        g.db,
        action_type="portal_order_submitted",
        entity_type="SO",
        entity_id=so_id,
        user_id=f"portal:{username}",
        warehouse_id=warehouse_id,
        details={
            "so_number": so_number,
            "reference": validated.reference,
            "line_count": len(resolved),
        },
    )

    g.db.commit()

    return jsonify({
        "so_number": so_number,
        "status": SO_OPEN,
        "line_count": len(resolved),
    }), 201
