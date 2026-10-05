# Dashboard API

Read-only aggregates for the admin dashboard. Auth: any logged-in user with
access to `warehouse_id` (403 otherwise). `warehouse_id` is required (400 if
missing); `days` outside the allowed set returns 400. No customer names or
other PII are returned.

## GET /api/admin/dashboard/overview?warehouse_id=&days=7|14|30

Default `days=7`. Returns:

- `kpis`: `orders_open`, `orders_picked`, `orders_packed`, `orders_shipped_today`,
  `backorders` (status `WAITING_STOCK`), `low_stock_items` (on-hand <= reorder
  point), `near_expiry_units` (expiring within 30 days), `expired_units`,
  `pending_variances` (lines of `VARIANCE` cycle counts with counted != expected),
  `open_po_lines`, `inbound_expected_units` (open/partial POs, ordered - received)
- `series`: `orders_created`, `orders_shipped`, `received_units`, each
  `[{date: "YYYY-MM-DD", value}]` with every day in range present
- `status_breakdown`: `[{status, count}]` of sales orders
- `stock_by_zone`: `[{zone_code, zone_name, units}]`

## GET /api/admin/dashboard/sales?warehouse_id=&days=7|14|30|90

Sales = `order_type='sale'` orders not CANCELLED / REFUNDED / FRAUD_REVIEW,
dated by `COALESCE(order_date, created_at)`.

- `kpis`: `revenue`, `orders`, `avg_order_value`, `cancelled_orders`,
  `invoiced`, `unpaid` (invoices in DRAFT/SENT; invoices are scoped to the
  warehouse through their billing events)
- `series.revenue`: gap-filled `[{date, value}]`
- `by_channel`: `[{channel, orders, revenue}]` (`source_system`, else `order_source`)
- `top_items`: top 10 `[{sku, name, quantity, revenue}]`; order lines carry no
  price, so item revenue is `order_total` apportioned by quantity share.
