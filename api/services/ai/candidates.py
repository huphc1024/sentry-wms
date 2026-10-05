"""Thin SQL candidate queries (read-only) feeding rules/LLM.

Each function takes an open `db` session and returns list[dict]. Only stock
facts are selected: no customer, vendor, address or contact columns.
Callers must have already authorised access to the warehouse.
"""

from sqlalchemy import text

from constants import (
    BIN_PICKABLE, BIN_PICKABLE_STAGING, BIN_STAGING, PO_OPEN, PO_PARTIAL, SO_WAITING_STOCK,
)
from middleware.auth_middleware import warehouse_scope_clause
from services.ai import planning

_LIMIT = 500
_PUTAWAY_LINE_LIMIT = 200
_PUTAWAY_BIN_LIMIT = 300
_BACKORDER_LIMIT = 200


def _rows(result):
    return [dict(r._mapping) for r in result.fetchall()]


def replenishment(db, warehouse_id):
    """Items at/below reorder point or with backorder demand in the warehouse."""
    rows = _rows(db.execute(
        text(
            """
            SELECT i.sku, i.item_name,
                   COALESCE(i.reorder_point, 0)   AS reorder_point,
                   COALESCE(i.reorder_qty, 0)     AS reorder_qty,
                   COALESCE(inv.avail, 0)         AS available,
                   COALESCE(bo.qty, 0)            AS backorder_qty,
                   COALESCE(po.qty, 0)            AS inbound_qty
              FROM items i
              LEFT JOIN (
                    SELECT item_id, SUM(quantity_on_hand - quantity_allocated) AS avail
                      FROM inventory WHERE warehouse_id = :wid GROUP BY item_id
              ) inv ON inv.item_id = i.item_id
              LEFT JOIN (
                    SELECT sol.item_id,
                           SUM(GREATEST(sol.quantity_ordered - sol.quantity_shipped, 0)) AS qty
                      FROM sales_order_lines sol
                      JOIN sales_orders so ON so.so_id = sol.so_id
                     WHERE so.warehouse_id = :wid AND so.status = 'WAITING_STOCK'
                     GROUP BY sol.item_id
              ) bo ON bo.item_id = i.item_id
              LEFT JOIN (
                    SELECT pol.item_id,
                           SUM(GREATEST(pol.quantity_ordered - pol.quantity_received, 0)) AS qty
                      FROM purchase_order_lines pol
                      JOIN purchase_orders p ON p.po_id = pol.po_id
                     WHERE p.warehouse_id = :wid AND p.status IN ('OPEN', 'PARTIAL')
                     GROUP BY pol.item_id
              ) po ON po.item_id = i.item_id
             WHERE i.is_active = TRUE
               AND (inv.item_id IS NOT NULL OR bo.item_id IS NOT NULL)
               AND ((COALESCE(i.reorder_point, 0) > 0
                     AND COALESCE(inv.avail, 0) <= i.reorder_point)
                    OR COALESCE(bo.qty, 0) > 0)
             ORDER BY i.sku
             LIMIT :lim
            """
        ),
        {"wid": warehouse_id, "lim": _LIMIT},
    ))
    for r in rows:
        for k in ("available", "backorder_qty", "inbound_qty"):
            r[k] = int(r[k])
    return rows


def expiry(db, warehouse_id, days=30):
    """Stock expired or expiring within `days`. Mirrors routes/expiry.py
    (pallet expiry) but also reads inventory.expiry_date."""
    rows = _rows(db.execute(
        text(
            """
            SELECT i.sku, i.item_name, b.bin_code, inv.lot_number,
                   inv.quantity_on_hand AS quantity,
                   COALESCE(inv.expiry_date, p.expiry_date) AS expiry_date,
                   (COALESCE(inv.expiry_date, p.expiry_date) - CURRENT_DATE) AS days_left
              FROM inventory inv
              JOIN items i ON i.item_id = inv.item_id
              JOIN bins b ON b.bin_id = inv.bin_id
              LEFT JOIN pallets p ON p.pallet_id = inv.pallet_id
             WHERE inv.warehouse_id = :wid
               AND inv.quantity_on_hand > 0
               AND COALESCE(inv.expiry_date, p.expiry_date) IS NOT NULL
               AND COALESCE(inv.expiry_date, p.expiry_date) <= CURRENT_DATE + CAST(:days AS INT)
             ORDER BY COALESCE(inv.expiry_date, p.expiry_date) ASC, i.sku
             LIMIT :lim
            """
        ),
        {"wid": warehouse_id, "days": max(0, min(int(days), 365)), "lim": _LIMIT},
    ))
    for r in rows:
        r["expiry_date"] = r["expiry_date"].isoformat()
        r["days_left"] = int(r["days_left"])
    return rows


def load_count(db, count_id):
    """Return {"count_id", "warehouse_id"} for a count the user may see, else
    None (same answer for missing and out-of-scope: no existence oracle)."""
    scope_sql, scope_params = warehouse_scope_clause("c.warehouse_id")
    row = db.execute(
        text(
            "SELECT c.count_id, c.warehouse_id FROM cycle_counts c "
            "WHERE c.count_id = :cid " + scope_sql
        ),
        {"cid": count_id, **scope_params},
    ).fetchone()
    return dict(row._mapping) if row else None


def cycle_count_lines(db, count_id):
    """Counted lines with variance or flagged unexpected, plus any PENDING
    adjustments raised for the same count/item."""
    rows = _rows(db.execute(
        text(
            """
            SELECT c.count_id, i.sku, i.item_name, b.bin_code,
                   l.expected_quantity AS expected,
                   l.counted_quantity  AS counted,
                   COALESCE(l.unexpected, FALSE) AS unexpected,
                   (SELECT SUM(a.quantity_change)
                      FROM inventory_adjustments a
                     WHERE a.cycle_count_id = c.count_id
                       AND a.item_id = l.item_id
                       AND a.status = 'PENDING') AS pending_adjustment_qty
              FROM cycle_count_lines l
              JOIN cycle_counts c ON c.count_id = l.count_id
              JOIN items i ON i.item_id = l.item_id
              JOIN bins b ON b.bin_id = c.bin_id
             WHERE l.count_id = :cid
               AND l.counted_quantity IS NOT NULL
               AND (l.counted_quantity <> l.expected_quantity
                    OR COALESCE(l.unexpected, FALSE))
             ORDER BY i.sku
             LIMIT :lim
            """
        ),
        {"cid": count_id, "lim": _LIMIT},
    ))
    for r in rows:
        if r["pending_adjustment_qty"] is not None:
            r["pending_adjustment_qty"] = int(r["pending_adjustment_qty"])
    return rows


def _f(v):
    return None if v is None else float(v)


def putaway(db, warehouse_id):
    """Staged (received, not yet put away) stock and the destination bins it
    could go to. Staged = on hand in a Staging / PickableStaging bin, the same
    definition as routes/putaway.py. Destinations are active Pickable bins in
    PICKING / STORAGE zones of the same warehouse. Returns planner rows."""
    wid = warehouse_id
    lines = _rows(db.execute(
        text(
            """
            SELECT inv.inventory_id, inv.item_id, i.sku, i.item_name,
                   inv.quantity_on_hand AS quantity,
                   inv.bin_id AS source_bin_id, b.bin_code AS source_bin,
                   b.bin_type AS source_bin_type,
                   inv.lot_number, inv.expiry_date,
                   i.weight_lbs AS unit_weight,
                   (i.length_in * i.width_in * i.height_in / 1728.0) AS unit_volume
              FROM inventory inv
              JOIN items i ON i.item_id = inv.item_id
              JOIN bins b ON b.bin_id = inv.bin_id
             WHERE inv.warehouse_id = :wid
               AND b.bin_type IN (:staging, :pickable_staging)
               AND inv.quantity_on_hand > 0
             ORDER BY i.sku, inv.inventory_id
             LIMIT :lim
            """
        ),
        {"wid": wid, "staging": BIN_STAGING, "pickable_staging": BIN_PICKABLE_STAGING,
         "lim": _PUTAWAY_LINE_LIMIT},
    ))
    if not lines:
        return []
    item_ids = sorted({r["item_id"] for r in lines})
    params = {"wid": wid, "items": item_ids, "pickable": BIN_PICKABLE,
              "ztypes": list(planning.ELIGIBLE_ZONE_TYPES)}

    backorder = {
        r["item_id"]: int(r["qty"]) for r in _rows(db.execute(
            text(
                """
                SELECT sol.item_id,
                       SUM(GREATEST(sol.quantity_ordered - sol.quantity_shipped, 0)) AS qty
                  FROM sales_order_lines sol
                  JOIN sales_orders so ON so.so_id = sol.so_id
                 WHERE so.warehouse_id = :wid AND so.status = :waiting
                   AND sol.item_id = ANY(CAST(:items AS INT[]))
                 GROUP BY sol.item_id
                """
            ),
            {"wid": wid, "items": item_ids, "waiting": SO_WAITING_STOCK},
        ))
    }

    holdings = {}
    for r in _rows(db.execute(
        text(
            """
            SELECT inv.item_id, inv.bin_id, SUM(inv.quantity_on_hand) AS qty
              FROM inventory inv
              JOIN bins b ON b.bin_id = inv.bin_id
              JOIN zones z ON z.zone_id = b.zone_id
             WHERE inv.warehouse_id = :wid
               AND inv.item_id = ANY(CAST(:items AS INT[]))
               AND inv.quantity_on_hand > 0
               AND COALESCE(b.is_active, TRUE) AND b.bin_type = :pickable
               AND z.zone_type = ANY(CAST(:ztypes AS TEXT[]))
             GROUP BY inv.item_id, inv.bin_id
            """
        ),
        params,
    )):
        holdings.setdefault(r["item_id"], {})[r["bin_id"]] = int(r["qty"])

    preferred = {}
    for r in _rows(db.execute(
        text(
            """
            SELECT pb.item_id, pb.bin_id, pb.priority
              FROM preferred_bins pb
              JOIN bins b ON b.bin_id = pb.bin_id
             WHERE pb.item_id = ANY(CAST(:items AS INT[])) AND b.warehouse_id = :wid
            UNION ALL
            SELECT i.item_id, i.default_bin_id AS bin_id, 1000 AS priority
              FROM items i
              JOIN bins b ON b.bin_id = i.default_bin_id
             WHERE i.item_id = ANY(CAST(:items AS INT[])) AND b.warehouse_id = :wid
            """
        ),
        {"wid": wid, "items": item_ids},
    )):
        cur = preferred.setdefault(r["item_id"], {})
        cur[r["bin_id"]] = min(cur.get(r["bin_id"], 10 ** 6), int(r["priority"]))

    wanted = sorted({b for m in holdings.values() for b in m} | {b for m in preferred.values() for b in m})
    bins = _rows(db.execute(
        text(
            """
            WITH occ AS (
                SELECT inv.bin_id,
                       SUM(inv.quantity_on_hand) AS qty,
                       SUM(inv.quantity_on_hand * COALESCE(i.weight_lbs, 0)) AS w,
                       SUM(inv.quantity_on_hand
                           * COALESCE(i.length_in * i.width_in * i.height_in / 1728.0, 0)) AS v
                  FROM inventory inv
                  JOIN items i ON i.item_id = inv.item_id
                 WHERE inv.warehouse_id = :wid AND inv.quantity_on_hand > 0
                 GROUP BY inv.bin_id
            )
            SELECT b.bin_id, b.bin_code, b.zone_id, z.zone_code, z.zone_type,
                   b.putaway_sequence, b.max_weight_lbs, b.max_volume_cuft,
                   COALESCE(occ.qty, 0) AS total_qty,
                   COALESCE(occ.w, 0) AS used_weight,
                   COALESCE(occ.v, 0) AS used_volume
              FROM bins b
              JOIN zones z ON z.zone_id = b.zone_id
              LEFT JOIN occ ON occ.bin_id = b.bin_id
             WHERE b.warehouse_id = :wid
               AND COALESCE(b.is_active, TRUE) AND COALESCE(z.is_active, TRUE)
               AND b.bin_type = :pickable
               AND z.zone_type = ANY(CAST(:ztypes AS TEXT[]))
               AND (b.bin_id = ANY(CAST(:wanted AS INT[])) OR occ.bin_id IS NULL)
             ORDER BY (b.bin_id = ANY(CAST(:wanted AS INT[]))) DESC,
                      b.putaway_sequence, b.bin_code
             LIMIT :lim
            """
        ),
        {**params, "wanted": wanted, "lim": _PUTAWAY_BIN_LIMIT},
    ))
    for b in bins:
        for k in ("max_weight_lbs", "max_volume_cuft", "used_weight", "used_volume"):
            b[k] = _f(b[k])
        b["total_qty"] = int(b["total_qty"])
    for ln in lines:
        ln["unit_weight"] = _f(ln["unit_weight"])
        ln["unit_volume"] = _f(ln["unit_volume"])
        ln["expiry_date"] = ln["expiry_date"].isoformat() if ln["expiry_date"] else None
        ln["backorder_qty"] = backorder.get(ln["item_id"], 0)
    return planning.plan_putaway(lines, bins, holdings, preferred)


def backorders(db, warehouse_id):
    """WAITING_STOCK sales orders with per-line shortfall and the stock facts
    the planner needs. Orders are identified by so_number only: no customer
    column is selected. Other-warehouse stock is limited to warehouses the
    caller can access."""
    wid = warehouse_id
    orders = _rows(db.execute(
        text(
            """
            SELECT so.so_id, so.so_number, so.ship_by_date,
                   (so.ship_by_date - CURRENT_DATE) AS ship_by_days,
                   GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
                       NOW() - COALESCE(so.backorder_opened_at, so.created_at))) / 86400))::int
                       AS days_waiting
              FROM sales_orders so
             WHERE so.warehouse_id = :wid AND so.status = :waiting
               AND so.voided_at IS NULL
             ORDER BY COALESCE(so.backorder_opened_at, so.created_at), so.so_id
             LIMIT :lim
            """
        ),
        {"wid": wid, "waiting": SO_WAITING_STOCK, "lim": _BACKORDER_LIMIT},
    ))
    if not orders:
        return []
    lines_by_so = {}
    for r in _rows(db.execute(
        text(
            """
            SELECT sol.so_id, sol.item_id, i.sku, i.item_name,
                   GREATEST(sol.quantity_ordered - sol.quantity_shipped, 0) AS short_qty
              FROM sales_order_lines sol
              JOIN items i ON i.item_id = sol.item_id
             WHERE sol.so_id = ANY(CAST(:ids AS INT[]))
             ORDER BY sol.so_id, sol.line_number
            """
        ),
        {"ids": [o["so_id"] for o in orders]},
    )):
        so_id = r.pop("so_id")
        r["short_qty"] = int(r["short_qty"])
        lines_by_so.setdefault(so_id, []).append(r)
    item_ids = sorted({ln["item_id"] for lns in lines_by_so.values() for ln in lns})
    if not item_ids:
        return []
    params = {"wid": wid, "items": item_ids}

    here = {
        r["item_id"]: int(r["qty"]) for r in _rows(db.execute(
            text(
                """
                SELECT item_id, SUM(GREATEST(quantity_on_hand - quantity_allocated, 0)) AS qty
                  FROM inventory
                 WHERE warehouse_id = :wid AND item_id = ANY(CAST(:items AS INT[]))
                 GROUP BY item_id
                """
            ),
            params,
        ))
    }

    inbound = {}
    for r in _rows(db.execute(
        text(
            """
            SELECT pol.item_id,
                   SUM(GREATEST(pol.quantity_ordered - pol.quantity_received, 0)) AS qty,
                   MIN(p.expected_date) AS expected_date,
                   (MIN(p.expected_date) - CURRENT_DATE) AS eta_days
              FROM purchase_order_lines pol
              JOIN purchase_orders p ON p.po_id = pol.po_id
             WHERE p.warehouse_id = :wid AND p.status IN (:po_open, :po_partial)
               AND pol.item_id = ANY(CAST(:items AS INT[]))
             GROUP BY pol.item_id
            """
        ),
        {**params, "po_open": PO_OPEN, "po_partial": PO_PARTIAL},
    )):
        exp = r["expected_date"]
        inbound[r["item_id"]] = {
            "qty": int(r["qty"] or 0),
            "expected_date": exp.isoformat() if exp else None,
            "eta_days": None if r["eta_days"] is None else int(r["eta_days"]),
        }

    scope_sql, scope_params = warehouse_scope_clause("inv.warehouse_id")
    elsewhere = {}
    for r in _rows(db.execute(
        text(
            """
            SELECT w.warehouse_code, inv.item_id,
                   SUM(GREATEST(inv.quantity_on_hand - inv.quantity_allocated, 0)) AS qty
              FROM inventory inv
              JOIN warehouses w ON w.warehouse_id = inv.warehouse_id
             WHERE inv.warehouse_id <> :wid
               AND COALESCE(w.is_active, TRUE)
               AND inv.item_id = ANY(CAST(:items AS INT[]))
               """ + scope_sql + """
             GROUP BY w.warehouse_code, inv.item_id
            HAVING SUM(GREATEST(inv.quantity_on_hand - inv.quantity_allocated, 0)) > 0
            """
        ),
        {**params, **scope_params},
    )):
        elsewhere.setdefault(r["warehouse_code"], {})[r["item_id"]] = int(r["qty"])

    plan_orders = [
        {
            "so_number": o["so_number"],
            "days_waiting": int(o["days_waiting"] or 0),
            "ship_by_date": o["ship_by_date"].isoformat() if o["ship_by_date"] else None,
            "ship_by_days": None if o["ship_by_days"] is None else int(o["ship_by_days"]),
            "lines": lines_by_so.get(o["so_id"], []),
        }
        for o in orders
    ]
    return planning.plan_backorders(plan_orders, here, inbound, elsewhere)
