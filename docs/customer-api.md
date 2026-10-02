# Customer API

Two ways a 3PL customer reaches its own data in Sentry. They share the
tenancy model and nothing else: separate credentials, separate
middleware, separate routes.

| | Customer portal API | Customer-bound WMS token |
|---|---|---|
| Audience | People, through the portal SPA (`sentry-wms/portal`) | The customer's own ERP / integration |
| Credential | `customer_users` login → session cookie | `X-WMS-Token` with `wms_tokens.customer_id` set |
| Surface | `/api/portal/*` | `/api/v1/inbound/*`, `/api/v1/snapshot/inventory` |
| Provisioned at | Admin → **Portal accounts** | Admin → **API tokens** → *Customer binding* |
| Spec | [portal-openapi.yaml](api/portal-openapi.yaml) | [inbound-openapi.yaml](api/inbound-openapi.yaml) |

A staff credential is refused on both, and both are refused on the staff
API. The two audiences never share a decorator, so a route annotated
wrongly fails closed rather than serving the wrong caller.

---

## 1. Customer portal API

Session-authenticated, cookie-based, and built for the portal SPA.

### Signing in

```bash
curl -X POST https://portal.example.com/api/portal/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username": "acme-ops", "password": "..."}' \
     -c cookies.txt
```

The response sets `sentry_portal_auth` (HttpOnly) and
`sentry_portal_csrf` (readable). Every `POST` must echo the CSRF cookie
in an `X-CSRF-Token` header. Cookie names differ from the staff
panel's, so an operator can hold an admin session and a portal session
in one browser without either overwriting the other.

Accounts are provisioned with `must_change_password` set. Until the
password is changed, only `/auth/me`, `/auth/logout` and
`/auth/change-password` answer; everything else returns
`403 password_change_required`.

### Feature grants

`GET /api/portal/auth/me` returns the grants held by the login:

| Grant | Opens |
|---|---|
| `inventory` | `GET /api/portal/inventory` |
| `inbound` | `GET /api/portal/inbound` |
| `orders` | `GET /api/portal/orders`, `GET /api/portal/orders/{so_number}`, `POST /api/portal/orders` |
| `invoices` | `GET /api/portal/invoices`, `GET /api/portal/invoices/{invoice_number}` |
| `reports` | Reserved; no route yet. |

There is no admin-style bypass: a freshly provisioned account with no
grants can sign in, change its password, and see nothing else.

### What the payloads deliberately omit

- **No locators.** `bin_code`, `zone` and pick location never appear.
  Where goods sit inside the building is the operator's layout. On-hand
  is aggregated per SKU + lot for the same reason — a per-bin breakdown
  reconstructs the map even with the labels stripped.
- **No draft invoices.** Only invoices with `issued_at` set are
  published, so a customer never reads a number the operator has not
  committed to.
- **No other tenant's existence.** A record belonging to someone else
  returns `404`, identical to a record that does not exist. Answering
  `403` would turn the endpoint into an existence oracle over other
  customers' order and invoice numbers.

### Submitting an outbound request

`POST /api/portal/orders` creates a sales order at status `OPEN` in the
operator's normal queue. Everything trust-sensitive is server-controlled:

| Field | Set from |
|---|---|
| owning customer (`customer_ref`) | the session, never the body |
| `so_number` | server sequence, `PORTAL-<code>-<n>` |
| `status` | always `OPEN` |
| `order_origin` | always `customer-portal` |
| `warehouse_id` | resolved from a warehouse the caller holds stock in |

The body may carry lines, addresses, a ship method, a reference and a
memo — the customer's own data. `priority` and `status` are not
accepted at all, so a customer cannot jump the pick queue.

A SKU the caller does not own is reported exactly like a SKU that does
not exist (`400 Unknown sku`). When the caller stores goods in several
warehouses, omitting `warehouse_code` returns `400` with the valid
codes in `choices` rather than the server guessing a site.

---

## 2. Customer-bound WMS token

`wms_tokens.customer_id` (migration 089) binds an integration token to
one customer. `NULL` means an operator-owned token — the default, and
the shape of every token issued before this existed. Enforcement lives
in `services/customer_token_scope.py` (writes),
`routes/snapshot.py` (reads) and `middleware/auth_middleware.py`
(surfaces).

### Issuing one

Admin → **API tokens** → **New token**, then pick the tenant under
**Customer binding**. The create form will refuse a binding the
enforcement layer cannot honour, so a bound token cannot be issued
against a surface that has no tenant dimension.

### What a bound token may reach

| Surface | Behaviour |
|---|---|
| `POST /api/v1/inbound/sales_orders` | `customer_ref` stamped from the token |
| `POST /api/v1/inbound/purchase_orders` | `owner_customer_id` stamped from the token |
| `POST /api/v1/inbound/items` | `owner_customer_id` stamped from the token |
| `POST /api/v1/inbound/inventory_update` | Only items the customer owns; anything else is `404 item_not_found` |
| `GET /api/v1/snapshot/inventory` | Rows filtered to items the customer owns |
| `GET /api/v1/events/types`, `/events/schema` | Allowed — catalog data, no customer content |

Three rules apply to every scoped write:

1. **The owner is stamped server-side.** The mapping document does not
   have to carry it, and a value it does carry is checked, not trusted.
2. **A payload naming another customer is refused** — `403`
   `customer_scope_violation`. That covers both the FK
   (`customer_ref` / `owner_customer_id`) and the legacy free-text
   `sales_orders.customer_id` code when it resolves to another tenant's
   `customers` row.
3. **An existing record owned by someone else is refused** — same
   `403`. Reachable when two customers' tokens share a `source_system`,
   or when an operator re-attributed a record after the customer's ERP
   first ingested it.

### What a bound token may not reach

| Surface | Response | Why |
|---|---|---|
| `GET /api/v1/events` (poll / ack) | `403 customer_scope_unsupported_surface` | `integration_events` has no owning-customer column, so a page of events for a warehouse is a page of every tenant's activity in it |
| `/api/v1/dockd/*`, `/api/v1/pos/*` | `403 customer_scope_unsupported_surface` | Operator-floor tools (dispatch, counter sales) with no tenant dimension |
| `POST /api/v1/inbound/customers` | `403 customer_scope_forbidden_resource` | The customer master is the operator's record of every tenant; a create is by definition a customer other than the caller |
| `POST /api/v1/inbound/vendors` | `403 customer_scope_forbidden_resource` | Shared operator data with no owning-customer column to confine a write to |

Denying beats serving these unscoped, and beats a filter that silently
returns nothing.

### Error kinds

| `error` / `error_kind` | Status | Meaning |
|---|---|---|
| `customer_scope_violation` | 403 | The write names, or would overwrite, another customer's record |
| `customer_scope_forbidden_resource` | 403 | The resource has no per-customer dimension |
| `customer_scope_unsupported_surface` | 403 | The whole surface cannot be scoped to one tenant |
| `item_not_found` | 404 | Unknown item — or one owned by another customer; deliberately the same answer |

### Operator checklist

Stock only reaches a customer's view once it is attributed, and neither
ownership column has a backfill — there was no prior column to derive
one from.

1. Set **Owner** on the customer's SKUs (Admin → Items).
2. Set **For customer** on purchase orders received on their behalf
   (Admin → Purchase Orders).
3. Issue the token with **Customer binding** set.
4. Verify: the token's snapshot page returns only that customer's SKUs,
   and an inbound order without an owner field lands with
   `customer_ref` set.

An empty portal or an empty snapshot almost always means step 1 or 2
has not been done for that stock, not that the scope is broken.
