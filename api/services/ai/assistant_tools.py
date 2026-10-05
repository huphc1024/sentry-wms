"""Read-only tools for the AI assistant (phase 3).

Every tool is a fixed, parameterised SQL query scoped to one warehouse that
the caller has already been authorised for (the route runs
check_warehouse_access first). There is no free-form SQL and no write tool.
Each tool returns at most MAX_ROWS rows containing only its allow-listed
columns; run_tool() scrubs free text and passes the result through
assert_no_pii before it can reach the model or the UI.

Orders are identified by order number only and purchase orders by PO
number only: no customer, vendor, address, contact or user column is ever
selected.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text

from constants import PO_OPEN, PO_PARTIAL, SO_WAITING_STOCK
from services import dashboard_service
from services.ai.redaction import assert_no_pii, scrub_text

MAX_ROWS = 50
SEARCH_MAX = 60


def _int_arg(args, key, default, lo, hi):
    try:
        n = int(args.get(key, default))
    except (TypeError, ValueError, AttributeError):
        return default
    return max(lo, min(n, hi))


def _rows(result):
    return [dict(r._mapping) for r in result.fetchall()]


def _json_value(v):
    if isinstance(v, datetime):
        return v.isoformat(timespec="minutes")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else round(float(v), 2)
    if isinstance(v, float):
        return round(v, 2)
    if isinstance(v, str):
        return scrub_text(v)
    if isinstance(v, (int, bool)) or v is None:
        return v
    return scrub_text(str(v))


def shape_rows(rows, fields, limit=MAX_ROWS):
    """Allow-list + JSON-safe + scrubbed. Pure. Returns (rows, truncated)."""
    out = [{k: _json_value(r.get(k)) for k in fields} for r in rows[:limit]]
    return out, len(rows) > limit


# --------------------------------------------------------------------- tools

# candidates is imported lazily: it pulls in the auth middleware, which needs
# JWT_SECRET at import time and would make this module untestable in
# tests_unit.

def low_stock_items(db, wid, args):
    from services.ai import candidates

    rows = candidates.replenishment(db, wid)
    rows.sort(key=lambda r: (-(r["backorder_qty"] or 0),
                             (r["available"] or 0) - (r["reorder_point"] or 0), r["sku"]))
    return rows


def near_expiry_stock(db, wid, args):
    from services.ai import candidates

    return candidates.expiry(db, wid, _int_arg(args, "days", 30, 0, 365))


def zone_utilisation(db, wid, args):
    rows = _rows(db.execute(
        text(
            """
            SELECT z.zone_code, z.zone_name, z.zone_type,
                   COUNT(b.bin_id) AS bins_total,
                   COUNT(occ.bin_id) AS bins_occupied,
                   COALESCE(SUM(occ.qty), 0) AS units
              FROM zones z
              JOIN bins b ON b.zone_id = z.zone_id AND COALESCE(b.is_active, TRUE)
              LEFT JOIN (
                    SELECT bin_id, SUM(quantity_on_hand) AS qty
                      FROM inventory
                     WHERE warehouse_id = :wid AND quantity_on_hand > 0
                     GROUP BY bin_id
              ) occ ON occ.bin_id = b.bin_id
             WHERE z.warehouse_id = :wid AND COALESCE(z.is_active, TRUE)
             GROUP BY z.zone_id, z.zone_code, z.zone_name, z.zone_type
            """
        ),
        {"wid": wid},
    ))
    for r in rows:
        total = int(r["bins_total"] or 0)
        r["occupancy_pct"] = round(100.0 * int(r["bins_occupied"] or 0) / total, 1) if total else 0.0
    rows.sort(key=lambda r: (-r["occupancy_pct"], r["zone_code"]))
    return rows


def waiting_stock_orders(db, wid, args):
    return _rows(db.execute(
        text(
            """
            SELECT so.so_number, so.ship_by_date,
                   GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (
                       NOW() - COALESCE(so.backorder_opened_at, so.created_at))) / 86400))::int
                       AS days_waiting,
                   COUNT(sol.so_line_id) AS line_count,
                   COALESCE(SUM(GREATEST(sol.quantity_ordered - sol.quantity_shipped, 0)), 0)
                       AS short_qty
              FROM sales_orders so
              LEFT JOIN sales_order_lines sol ON sol.so_id = so.so_id
             WHERE so.warehouse_id = :wid AND so.status = :waiting
               AND so.voided_at IS NULL
             GROUP BY so.so_id, so.so_number, so.ship_by_date,
                      so.backorder_opened_at, so.created_at
             ORDER BY COALESCE(so.backorder_opened_at, so.created_at), so.so_id
             LIMIT :lim
            """
        ),
        {"wid": wid, "waiting": SO_WAITING_STOCK, "lim": MAX_ROWS + 1},
    ))


def open_purchase_orders(db, wid, args):
    days = _int_arg(args, "days_ahead", 30, 0, 365)
    return _rows(db.execute(
        text(
            """
            SELECT p.po_number, p.status, p.expected_date,
                   (p.expected_date - CURRENT_DATE) AS days_until,
                   COUNT(*) FILTER (WHERE pol.quantity_received < pol.quantity_ordered)
                       AS open_lines,
                   COALESCE(SUM(GREATEST(pol.quantity_ordered - pol.quantity_received, 0)), 0)
                       AS open_units
              FROM purchase_orders p
              JOIN purchase_order_lines pol ON pol.po_id = p.po_id
             WHERE p.warehouse_id = :wid AND p.status IN (:po_open, :po_partial)
               AND (p.expected_date IS NULL
                    OR p.expected_date <= CURRENT_DATE + CAST(:days AS INT))
             GROUP BY p.po_id, p.po_number, p.status, p.expected_date
            HAVING SUM(GREATEST(pol.quantity_ordered - pol.quantity_received, 0)) > 0
             ORDER BY p.expected_date ASC NULLS LAST, p.po_number
             LIMIT :lim
            """
        ),
        {"wid": wid, "po_open": PO_OPEN, "po_partial": PO_PARTIAL, "days": days,
         "lim": MAX_ROWS + 1},
    ))


def _like_pattern(raw):
    q = str(raw or "").strip()[:SEARCH_MAX]
    q = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{q}%" if q else None


def item_stock_lookup(db, wid, args):
    pattern = _like_pattern(args.get("query") if isinstance(args, dict) else None)
    if pattern is None:
        return []
    rows = _rows(db.execute(
        text(
            """
            SELECT i.sku, i.item_name,
                   COALESCE(SUM(inv.quantity_on_hand), 0) AS on_hand,
                   COALESCE(SUM(inv.quantity_allocated), 0) AS allocated,
                   COALESCE(SUM(GREATEST(inv.quantity_on_hand - inv.quantity_allocated, 0)), 0)
                       AS available,
                   COALESCE(i.reorder_point, 0) AS reorder_point,
                   STRING_AGG(DISTINCT b.bin_code, ', ') AS bins
              FROM items i
              LEFT JOIN inventory inv ON inv.item_id = i.item_id
                   AND inv.warehouse_id = :wid AND inv.quantity_on_hand > 0
              LEFT JOIN bins b ON b.bin_id = inv.bin_id
             WHERE i.is_active = TRUE
               AND (i.sku ILIKE :pat ESCAPE '\\' OR i.item_name ILIKE :pat ESCAPE '\\')
             GROUP BY i.item_id, i.sku, i.item_name, i.reorder_point
             ORDER BY (LOWER(i.sku) = LOWER(:exact)) DESC, i.sku
             LIMIT :lim
            """
        ),
        {"wid": wid, "pat": pattern, "exact": str(args.get("query") or "").strip(),
         "lim": MAX_ROWS + 1},
    ))
    for r in rows:
        if r["bins"] and len(r["bins"]) > 120:
            r["bins"] = r["bins"][:117] + "..."
    return rows


def recent_receipts(db, wid, args):
    days = _int_arg(args, "days", 7, 1, 90)
    return _rows(db.execute(
        text(
            """
            SELECT r.received_at, i.sku, i.item_name, r.quantity_received AS quantity,
                   b.bin_code, p.po_number
              FROM item_receipts r
              JOIN items i ON i.item_id = r.item_id
              LEFT JOIN bins b ON b.bin_id = r.bin_id
              LEFT JOIN purchase_orders p ON p.po_id = r.po_id
             WHERE r.warehouse_id = :wid
               AND r.received_at >= NOW() - make_interval(days => CAST(:days AS INT))
             ORDER BY r.received_at DESC, r.receipt_id DESC
             LIMIT :lim
            """
        ),
        {"wid": wid, "days": days, "lim": MAX_ROWS + 1},
    ))


def cycle_count_variances(db, wid, args):
    days = _int_arg(args, "days", 30, 1, 365)
    rows = _rows(db.execute(
        text(
            """
            SELECT c.count_id, c.status, b.bin_code, i.sku, i.item_name,
                   l.expected_quantity AS expected, l.counted_quantity AS counted,
                   COALESCE(c.completed_at, c.created_at) AS counted_at
              FROM cycle_count_lines l
              JOIN cycle_counts c ON c.count_id = l.count_id
              JOIN items i ON i.item_id = l.item_id
              JOIN bins b ON b.bin_id = c.bin_id
             WHERE c.warehouse_id = :wid
               AND l.counted_quantity IS NOT NULL
               AND l.counted_quantity <> l.expected_quantity
               AND COALESCE(c.completed_at, c.created_at)
                   >= NOW() - make_interval(days => CAST(:days AS INT))
             ORDER BY ABS(l.counted_quantity - l.expected_quantity) DESC, c.count_id DESC
             LIMIT :lim
            """
        ),
        {"wid": wid, "days": days, "lim": MAX_ROWS + 1},
    ))
    for r in rows:
        r["variance"] = int(r["counted"]) - int(r["expected"])
    return rows


SALES_DAYS = dashboard_service.SALES_DAYS


def sales_summary(db, wid, args):
    days = _int_arg(args, "days", 7, 1, 90)
    days = min(SALES_DAYS, key=lambda d: (abs(d - days), d))
    data = dashboard_service.sales(db, wid, days)
    rows = [{"sku": t["sku"], "item_name": t["name"], "quantity": t["quantity"],
             "revenue": t["revenue"]} for t in data["top_items"]]
    k = data["kpis"]
    summary = {"days": days, "orders": k["orders"], "revenue": k["revenue"],
               "avg_order_value": k["avg_order_value"],
               "cancelled_orders": k["cancelled_orders"]}
    return rows, summary


# ------------------------------------------------------------------ registry

_DAYS = {"type": "integer", "minimum": 0, "maximum": 365}


def _schema(props=None, required=None):
    return {"type": "object", "properties": props or {}, "required": required or [],
            "additionalProperties": False}


TOOLS = {
    "low_stock_items": {
        "fn": low_stock_items,
        "fields": ("sku", "item_name", "available", "reorder_point", "reorder_qty",
                   "backorder_qty", "inbound_qty"),
        "description": "Items at or below their reorder point, or with waiting (backordered) "
                       "demand, in this warehouse. Use for 'what is running out / sắp hết hàng'.",
        "input_schema": _schema(),
    },
    "near_expiry_stock": {
        "fn": near_expiry_stock,
        "fields": ("sku", "item_name", "bin_code", "lot_number", "quantity", "expiry_date",
                   "days_left"),
        "description": "Stock already expired or expiring within `days` days (default 30), "
                       "soonest first. Negative days_left means already expired.",
        "input_schema": _schema({"days": _DAYS}),
    },
    "zone_utilisation": {
        "fn": zone_utilisation,
        "fields": ("zone_code", "zone_name", "zone_type", "bins_total", "bins_occupied",
                   "occupancy_pct", "units"),
        "description": "Per-zone bin occupancy (bins holding stock / active bins) and units "
                       "on hand, fullest zone first. Use for 'which zone is full / zone nào đầy'.",
        "input_schema": _schema(),
    },
    "waiting_stock_orders": {
        "fn": waiting_stock_orders,
        "fields": ("so_number", "days_waiting", "ship_by_date", "line_count", "short_qty"),
        "description": "Sales orders waiting for stock (backorders), longest waiting first. "
                       "Orders are identified by order number only.",
        "input_schema": _schema(),
    },
    "open_purchase_orders": {
        "fn": open_purchase_orders,
        "fields": ("po_number", "status", "expected_date", "days_until", "open_lines",
                   "open_units"),
        "description": "Open / partially received purchase orders expected within "
                       "`days_ahead` days (default 30; undated and overdue POs included), "
                       "earliest expected date first. Negative days_until means overdue.",
        "input_schema": _schema({"days_ahead": _DAYS}),
    },
    "item_stock_lookup": {
        "fn": item_stock_lookup,
        "fields": ("sku", "item_name", "on_hand", "allocated", "available", "reorder_point",
                   "bins"),
        "description": "Find items by SKU or name fragment and show their stock in this "
                       "warehouse (on hand, allocated, available, bins).",
        "input_schema": _schema(
            {"query": {"type": "string", "minLength": 1, "maxLength": SEARCH_MAX}}, ["query"]),
    },
    "recent_receipts": {
        "fn": recent_receipts,
        "fields": ("received_at", "sku", "item_name", "quantity", "bin_code", "po_number"),
        "description": "Goods received in the last `days` days (default 7, max 90), newest first.",
        "input_schema": _schema({"days": {"type": "integer", "minimum": 1, "maximum": 90}}),
    },
    "cycle_count_variances": {
        "fn": cycle_count_variances,
        "fields": ("count_id", "status", "bin_code", "sku", "item_name", "expected", "counted",
                   "variance", "counted_at"),
        "description": "Cycle-count lines whose counted quantity differs from the expected "
                       "quantity in the last `days` days (default 30), largest variance first.",
        "input_schema": _schema({"days": {"type": "integer", "minimum": 1, "maximum": 365}}),
    },
    "sales_summary": {
        "fn": sales_summary,
        "fields": ("sku", "item_name", "quantity", "revenue"),
        "summary_fields": ("days", "orders", "revenue", "avg_order_value", "cancelled_orders"),
        "description": "Sales totals over the last `days` days (7, 14, 30 or 90; default 7) "
                       "plus the top-selling items by quantity.",
        "input_schema": _schema({"days": {"type": "integer", "enum": list(SALES_DAYS)}}),
    },
}

TOOL_NAMES = tuple(TOOLS)


def tool_definitions():
    """Anthropic `tools` param: client tools only, in a fixed order."""
    return [
        {"name": name, "description": spec["description"], "input_schema": spec["input_schema"]}
        for name, spec in TOOLS.items()
    ]


def run_tool(db, warehouse_id, name, args=None):
    """Run one tool for one (already authorised) warehouse. Returns
    {"tool", "rows", "row_count", "truncated"[, "summary"]}. Raises KeyError
    for an unknown tool and PIIError if a forbidden key slipped through."""
    spec = TOOLS[name]
    args = args if isinstance(args, dict) else {}
    raw = spec["fn"](db, warehouse_id, args)
    summary = None
    if isinstance(raw, tuple):
        raw, summary = raw
    rows, truncated = shape_rows(raw, spec["fields"])
    result = {"tool": name, "rows": rows, "row_count": len(rows), "truncated": truncated}
    if summary is not None:
        result["summary"] = {k: _json_value(summary.get(k)) for k in spec["summary_fields"]}
    assert_no_pii(result)
    return result
