"""Dashboard aggregates (read-only). Pure helpers first, SQL query functions
below. No customer names or other PII are ever selected. See
docs/dashboard-api.md.
"""

from datetime import date, timedelta

from sqlalchemy import text

OVERVIEW_DAYS = (7, 14, 30)
SALES_DAYS = (7, 14, 30, 90)
DEFAULT_DAYS = 7
NEAR_EXPIRY_DAYS = 30


# ---------------------------------------------------------------- pure helpers

def parse_days(raw, allowed, default=DEFAULT_DAYS):
    """Return (days, ok). None/'' -> default; non-int or not allowed -> (default, False)."""
    if raw is None or raw == "":
        return default, True
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return default, False
    if days not in allowed:
        return default, False
    return days, True


def date_range(days, today):
    """`days` consecutive dates ending at `today`, oldest first."""
    return [today - timedelta(days=days - 1 - i) for i in range(days)]


def _to_date(d):
    # datetime -> date; date stays as is (date has no .date()).
    return d.date() if hasattr(d, "date") else d


def fill_series(rows, days, today, numeric=int):
    """Gap-fill (date, value) rows into [{date:'YYYY-MM-DD', value}] for every day."""
    by_day = {}
    for d, v in rows:
        d = _to_date(d)
        by_day[d] = by_day.get(d, 0) + (v or 0)
    return [{"date": d.isoformat(), "value": numeric(by_day.get(d, 0))}
            for d in date_range(days, today)]


def shape_counts(rows, key):
    return [{key: r[0], "count": int(r[1] or 0)} for r in rows]


def avg_order_value(revenue, orders):
    return round(float(revenue) / orders, 2) if orders else 0.0


# ------------------------------------------------------------------ SQL helpers

def _scalar(db, sql, params):
    return db.execute(text(sql), params).scalar() or 0


def _day_rows(db, sql, params):
    return [(r[0], r[1]) for r in db.execute(text(sql), params).fetchall()]


def overview(db, warehouse_id, days, today=None):
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    p = {"wh": warehouse_id, "start": start, "near": NEAR_EXPIRY_DAYS}

    def so_count(cond):
        return int(_scalar(
            db, f"SELECT COUNT(*) FROM sales_orders WHERE warehouse_id = :wh AND {cond}", p))

    kpis = {
        "orders_open": so_count("status = 'OPEN'"),
        "orders_picked": so_count("status = 'PICKED'"),
        "orders_packed": so_count("status = 'PACKED'"),
        "orders_shipped_today": so_count(
            "status = 'SHIPPED' AND CAST(shipped_at AS DATE) = CURRENT_DATE"),
        "backorders": so_count("status = 'WAITING_STOCK'"),
        "low_stock_items": int(_scalar(db, """
            SELECT COUNT(*) FROM (
                SELECT it.item_id
                FROM items it
                JOIN inventory inv ON inv.item_id = it.item_id AND inv.warehouse_id = :wh
                WHERE it.is_active = TRUE AND it.reorder_point > 0
                GROUP BY it.item_id, it.reorder_point
                HAVING SUM(inv.quantity_on_hand) <= it.reorder_point
            ) t""", p)),
        "near_expiry_units": int(_scalar(db, """
            SELECT COALESCE(SUM(quantity_on_hand), 0) FROM inventory
            WHERE warehouse_id = :wh AND quantity_on_hand > 0
              AND expiry_date >= CURRENT_DATE
              AND expiry_date <= CURRENT_DATE + CAST(:near AS INT)""", p)),
        "expired_units": int(_scalar(db, """
            SELECT COALESCE(SUM(quantity_on_hand), 0) FROM inventory
            WHERE warehouse_id = :wh AND quantity_on_hand > 0
              AND expiry_date < CURRENT_DATE""", p)),
        "pending_variances": int(_scalar(db, """
            SELECT COUNT(*) FROM cycle_count_lines l
            JOIN cycle_counts c ON c.count_id = l.count_id
            WHERE c.warehouse_id = :wh AND c.status = 'VARIANCE'
              AND l.counted_quantity IS NOT NULL
              AND l.counted_quantity <> l.expected_quantity""", p)),
        "open_po_lines": int(_scalar(db, """
            SELECT COUNT(*) FROM purchase_order_lines l
            JOIN purchase_orders po ON po.po_id = l.po_id
            WHERE po.warehouse_id = :wh AND po.status IN ('OPEN', 'PARTIAL')
              AND l.quantity_received < l.quantity_ordered""", p)),
        "inbound_expected_units": int(_scalar(db, """
            SELECT COALESCE(SUM(l.quantity_ordered - l.quantity_received), 0)
            FROM purchase_order_lines l
            JOIN purchase_orders po ON po.po_id = l.po_id
            WHERE po.warehouse_id = :wh AND po.status IN ('OPEN', 'PARTIAL')
              AND l.quantity_received < l.quantity_ordered""", p)),
    }

    series = {
        "orders_created": fill_series(_day_rows(db, """
            SELECT CAST(created_at AS DATE), COUNT(*) FROM sales_orders
            WHERE warehouse_id = :wh AND CAST(created_at AS DATE) >= :start
            GROUP BY 1""", p), days, today),
        "orders_shipped": fill_series(_day_rows(db, """
            SELECT CAST(shipped_at AS DATE), COUNT(*) FROM sales_orders
            WHERE warehouse_id = :wh AND shipped_at IS NOT NULL
              AND CAST(shipped_at AS DATE) >= :start
            GROUP BY 1""", p), days, today),
        "received_units": fill_series(_day_rows(db, """
            SELECT CAST(received_at AS DATE), SUM(quantity_received) FROM item_receipts
            WHERE warehouse_id = :wh AND CAST(received_at AS DATE) >= :start
            GROUP BY 1""", p), days, today),
    }

    status_breakdown = shape_counts(db.execute(text("""
        SELECT status, COUNT(*) FROM sales_orders
        WHERE warehouse_id = :wh GROUP BY status ORDER BY COUNT(*) DESC, status"""),
        p).fetchall(), "status")

    stock_by_zone = [
        {"zone_code": r[0], "zone_name": r[1], "units": int(r[2] or 0)}
        for r in db.execute(text("""
            SELECT z.zone_code, z.zone_name, COALESCE(SUM(inv.quantity_on_hand), 0)
            FROM zones z
            JOIN bins b ON b.zone_id = z.zone_id
            JOIN inventory inv ON inv.bin_id = b.bin_id
            WHERE z.warehouse_id = :wh
            GROUP BY z.zone_id, z.zone_code, z.zone_name
            ORDER BY 3 DESC, z.zone_code"""), p).fetchall()
    ]

    return {"kpis": kpis, "series": series,
            "status_breakdown": status_breakdown, "stock_by_zone": stock_by_zone}


# Counted as sales: real sales, not cancelled / refunded / fraud-held.
_SALE_COND = ("order_type = 'sale' AND status NOT IN "
              "('CANCELLED', 'REFUNDED', 'FRAUD_REVIEW')")
_IN_RANGE = ("warehouse_id = :wh AND "
             "CAST(COALESCE(order_date, created_at) AS DATE) >= :start")


def sales(db, warehouse_id, days, today=None):
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    p = {"wh": warehouse_id, "start": start}

    row = db.execute(text(f"""
        SELECT COUNT(*), COALESCE(SUM(order_total), 0) FROM sales_orders
        WHERE {_IN_RANGE} AND {_SALE_COND}"""), p).fetchone()
    orders, revenue = int(row[0] or 0), float(row[1] or 0)

    cancelled = int(_scalar(db, f"""
        SELECT COUNT(*) FROM sales_orders
        WHERE {_IN_RANGE} AND status = 'CANCELLED'""", p))

    # Invoices have no warehouse column; scope through their billing events.
    inv = db.execute(text("""
        SELECT COUNT(*),
               COALESCE(SUM(CASE WHEN bi.status IN ('DRAFT', 'SENT') THEN 1 ELSE 0 END), 0)
        FROM billing_invoices bi
        WHERE CAST(bi.created_at AS DATE) >= :start
          AND bi.status <> 'CANCELLED'
          AND EXISTS (SELECT 1 FROM billing_events e
                      WHERE e.invoice_id = bi.invoice_id AND e.warehouse_id = :wh)"""),
        p).fetchone()

    revenue_series = fill_series(_day_rows(db, f"""
        SELECT CAST(COALESCE(order_date, created_at) AS DATE), SUM(order_total)
        FROM sales_orders WHERE {_IN_RANGE} AND {_SALE_COND}
        GROUP BY 1""", p), days, today, numeric=lambda v: round(float(v), 2))

    by_channel = [
        {"channel": r[0], "orders": int(r[1] or 0), "revenue": float(r[2] or 0)}
        for r in db.execute(text(f"""
            SELECT COALESCE(source_system, order_source, 'unknown'), COUNT(*),
                   COALESCE(SUM(order_total), 0)
            FROM sales_orders WHERE {_IN_RANGE} AND {_SALE_COND}
            GROUP BY 1 ORDER BY 3 DESC, 1"""), p).fetchall()
    ]

    # Lines carry no price: revenue is the order total apportioned by quantity share.
    top_items = [
        {"sku": r[0], "name": r[1], "quantity": int(r[2] or 0),
         "revenue": round(float(r[3] or 0), 2)}
        for r in db.execute(text("""
            SELECT it.sku, it.item_name, SUM(l.quantity_ordered),
                   SUM(COALESCE(so.order_total, 0) * l.quantity_ordered
                       / NULLIF(t.total_qty, 0)) AS revenue
            FROM sales_order_lines l
            JOIN sales_orders so ON so.so_id = l.so_id
            JOIN items it ON it.item_id = l.item_id
            JOIN (SELECT so_id, SUM(quantity_ordered) AS total_qty
                  FROM sales_order_lines GROUP BY so_id) t ON t.so_id = l.so_id
            WHERE so.warehouse_id = :wh
              AND CAST(COALESCE(so.order_date, so.created_at) AS DATE) >= :start
              AND so.order_type = 'sale'
              AND so.status NOT IN ('CANCELLED', 'REFUNDED', 'FRAUD_REVIEW')
            GROUP BY it.item_id, it.sku, it.item_name
            ORDER BY 3 DESC, it.sku LIMIT 10"""), p).fetchall()
    ]

    return {
        "kpis": {
            "revenue": round(revenue, 2),
            "orders": orders,
            "avg_order_value": avg_order_value(revenue, orders),
            "cancelled_orders": cancelled,
            "invoiced": int(inv[0] or 0),
            "unpaid": int(inv[1] or 0),
        },
        "series": {"revenue": revenue_series},
        "by_channel": by_channel,
        "top_items": top_items,
    }
