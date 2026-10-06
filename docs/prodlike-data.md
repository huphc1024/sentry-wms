# Production-like Demo Data

`scripts/seed_prodlike.py` builds a separate database filled with realistic (but
obviously fake) Vietnamese data for a mid-size distributor. Use it to try the
whole admin: dashboard charts, AI suggestions, the AI assistant, sales,
billing and productivity. It never touches `sentry`, `sentry_test`,
`sentry_demo` or `erasd_dev`.

## Run it

```bash
# from the repo root, with PostgreSQL running and .env filled in
python scripts/seed_prodlike.py --reset          # drop + rebuild sentry_prodlike
python scripts/seed_prodlike.py                  # create only if missing, else no-op
python scripts/seed_prodlike.py demo2_prodlike --reset   # another target
```

- The target name must end in `_prodlike`. Anything else is refused.
- `--reset` drops the database, recreates it owned by `POSTGRES_USER`, loads
  `db/schema.sql` (it already includes every migration through 097) and
  generates the data in one transaction. It takes about 20 seconds.
- Without `--reset` the script only seeds a database that is new or empty.
- Data is deterministic (fixed random seed). Dates are relative to the day
  you run it, so "today" always has open orders and fresh receipts.

Settings read from `.env` (values are never printed):

| Key | Used for |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | owner of the new database; loads schema and data |
| `POSTGRES_SUPERUSER` / `POSTGRES_SUPERUSER_PASSWORD` | create / drop the database (falls back to the app role) |
| `ADMIN_PASSWORD` | password of the `admin` user (no forced change on first login) |
| `DEMO_USER_PASSWORD` | optional password for the staff accounts; defaults to `ADMIN_PASSWORD` |

## Point the app at it

Set the database name in `DATABASE_URL` (in `.env` or the shell that starts
the API), then restart the API:

```
DATABASE_URL=postgresql://sentry:<password>@localhost:5432/sentry_prodlike
```

Log in to the admin as `admin`. Switch it back to `sentry` when you are done.

## What is in it

| Area | Content |
|---|---|
| Warehouses | `SL-HCM` (Thủ Đức, main) and `SL-HN` (Long Biên), timezone Asia/Ho_Chi_Minh |
| Zones / bins | RECEIVING (`RCV-xx`, Staging), STORAGE (`R1-01-1` pallet racks, `QC-01`), PICKING (`A-01-01` ...), STAGING (`STG-xx`), SHIPPING (`DOCK-xx`). The last pick aisle and a few rack slots are left empty for put-away. |
| Items | 300 SKUs in 8 categories (đồ uống, sữa, thực phẩm khô, gia vị, hóa mỹ phẩm, tẩy rửa, văn phòng phẩm, điện gia dụng) with reorder points from real demand; weights / dimensions on most |
| Lots / expiry | Lot-tracked categories carry 1-3 lots per bin; some lots expired, some within 30 days |
| Purchasing | 10 vendors; ~90 POs over 120 days: CLOSED / RECEIVED, PARTIAL, OPEN with expected dates past, near and future; receipts and put-away moves |
| Staged stock | The most recent receipts (14 lines in HCM, 5 in HN) are still in the RCV bins, waiting for put-away |
| Sales | ~4,200 orders over 120 days with weekday/weekend pattern, ~35% growth and "ngày đôi" promo spikes; channels Shopee, Lazada, TikTok Shop, ERP dealers, website, POS; totals in VND |
| Lifecycle | OPEN / PICKED / PACKED / SHIPPED / CANCELLED / REFUNDED / FRAUD_REVIEW, plus `-BO` backorders in WAITING_STOCK (some covered by a PO due soon, some by stock in the other warehouse, some partial, some with nothing) |
| Customers | 14 B2B customers (`KH-0001` ...) and generated retail buyers; phones start with `000`, emails use `example.com`, addresses say "Đường Demo" |
| Pick batches | `SL-HCM`: one IN_PROGRESS batch (first half of its stops picked, stock moved to the tote), two OPEN and two COMPLETED (recently PICKED orders); `SL-HN`: one OPEN, one COMPLETED. Open batches only take OPEN orders whose allocated pick-bin stock covers every line. Used by the 3D view's pick route ([3D Warehouse View](warehouse-3d.md)). |
| Cycle counts | Completed history, counts in VARIANCE with pending adjustments (including an unexpected item), in-progress and pending counts |
| Billing | Contracts, rate cards, daily billing events, monthly invoices (PAID / SENT / DRAFT / one CANCELLED) |
| Users | `admin`, `quanly.hcm` (ADMIN), supervisors / accountant with page permissions, and floor staff (`nv.*`) with 120 days of receive / put-away / pick / pack / ship activity for the Productivity tab |
| Settings | `ai_suggestions_enabled = true`, `ai_daily_call_limit = 200` |

The script prints row counts for the main tables at the end.
