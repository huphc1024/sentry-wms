# Sentry WMS — Architecture Patterns

Catalog of mandatory patterns for hybrid 3PL + ecommerce operations.
Every new feature must follow these rules so floor, admin, billing, and
simulation stay consistent.

---

## 1. Scan-to-confirm

**Purpose:** Every physical movement (receive, put-away, pick, transfer,
pallet move) is confirmed by scanning before the ledger is updated.

**Reference files:**

- Mobile: `mobile/src/screens/ReceiveScreen.js`, `PutAwayScreen.js`, `PickWalkScreen.js`
- API error codes: `docs/uat-test-cases.md` (`SKU_NOT_IN_PO`, `BIN_MISMATCH`, `PALLET_MISMATCH`)
- Receiving: `api/routes/receiving.py`, `api/routes/putaway.py`

**Rules when adding features:**

- Never commit inventory changes from a free-text field alone; require scan or explicit admin override with audit.
- Return structured error codes the mobile client can display without parsing message text.
- Support idempotency keys on write endpoints that scanners may double-fire.

---

## 2. Inventory ledger (event-driven)

**Purpose:** Stock levels are derived from immutable movement events, not
direct row overwrites.

**Reference files:**

- `api/services/inventory_service.py` — `add_inventory`, adjustments
- `db/migrations/016_audit_log_tamper_resistance.sql` — hash-chain audit
- Admin: `admin/src/pages/Adjustments.jsx`, `CycleCounts.jsx`

**Rules when adding features:**

- Use service-layer helpers (`add_inventory`, pick/putaway flows) instead of raw `UPDATE inventory SET quantity`.
- Sensitive mutations (layout save, SO edit past OPEN, billing) must write audit log rows.
- Cycle count and adjustment flows go through approval where configured.

---

## 3. Pallet entity (3PL LPN)

**Purpose:** A pallet is the operational unit for 3PL storage — traceable
by QR, tied to customer, SKU, lot, and expiry.

**Reference files:**

- Schema: `db/migrations/078_create_pallets.sql`, `081_pallet_customer.sql`, `082_pallet_expiry_fefo.sql`
- Admin: `admin/src/pages/Pallets.jsx`, `api/routes/admin/admin_pallets.py`
- Mobile: `mobile/src/components/map/PalletInfoModal.js`, `PalletSlotGrid.js`
- Code format: `{warehouse_code}-PLT-{5-digit seq}` in `admin_pallets._next_pallet_code`

**Rules when adding features:**

- Inventory rows for palletized stock must set `pallet_id` on the ledger row.
- Outbound allocation should prefer FEFO (`expiry_date` on pallet) before bin-only picks.
- Pallet status transitions (`STORED` → `IN_TRANSIT`) must stay in sync with inventory and billing.

---

## 4. Warehouse layout (digital twin)

**Purpose:** Floor plan uses stable rack identity and meter-based coordinates
so admin simulation and mobile map stay aligned.

**Reference files:**

- `api/services/warehouse_layout_service.py` — validate, save, audit snapshot
- `db/migrations/083_warehouse_layout.sql`, `084_warehouse_layout_phase2.sql`
- Admin editor: `admin/src/pages/WarehouseSimulation.jsx`, `components/warehouse-map/`
- Mobile: `mobile/src/components/map/WarehouseFloorPlan.js`

**Rules when adding features:**

- Use `rack_id` (numeric, stable) for new code; `legacy_rack_key` only for backward-compatible URLs.
- Respect `coordinate_unit` (`METER` vs `LEGACY_CANVAS`) when rendering or converting positions.
- Layout writes require `warehouse-map-edit` override (or ADMIN); viewers use `warehouse-simulation` page key.

---

## 5. Billing pipeline (3PL commercial)

**Purpose:** Operational events become billable lines matched to rate cards
and contracts, then aggregated into invoices.

**Reference files:**

- `api/services/billing_service.py` — `create_billing_event`, `_find_rate_card`
- Schema: `db/migrations/079_billing.sql`, `085_customer_contracts_billing.sql`
- Admin: `admin/src/pages/Customers.jsx`, `RateCards.jsx`, `Invoices.jsx`
- PDF: `api/utils/pdf.py`, templates `contract_print.html`, `invoice_print.html`
- Daily storage: `api/jobs/billing_tasks.py`, manual trigger `POST /api/admin/billing/run_storage_billing`

**Rules when adding features:**

- Emit `billing_events` from service layer on receive, pick, storage, outbound — not only from admin buttons.
- Match rate cards by customer, warehouse, contract validity, and `service_type`.
- Use `service_date` + unique constraints to prevent duplicate daily storage charges.
- Invoice generation aggregates unbilled events for a period; PDF uses the same template engine as contracts.

---

## 6. Permissions (two layers)

**Purpose:** Control who sees admin pages and who can bypass status gates.

**Reference files:**

- Page catalog: `api/constants.py` — `ALL_PAGE_KEYS`, `ALL_OVERRIDE_KEYS`
- Middleware: `api/middleware/auth_middleware.py` — `@require_admin_or_page_permission`
- Admin UI grants: `admin/src/pages/Users.jsx` — `PAGE_GROUPS`, `ROLE_PRESETS`
- Go-live personas: `docs/role-matrix.md`
- Nav filter: `admin/src/components/Sidebar.jsx`, tab filter: `admin/src/pages/Data.jsx`
- Auth payload: `api/routes/auth.py` — `allowed_pages` on `/api/auth/me`

**Rules when adding features:**

- Every new admin page/route must add a `page_key` to `ALL_PAGE_KEYS`, `Users.jsx` PAGE_GROUPS, Sidebar `pageKey`, and route decorator.
- Override grants (`so-full-edit`, `warehouse-map-edit`) live in a separate Users modal group — not in `ALL_PAGE_KEYS`.
- ADMIN bypasses page checks; USER role requires explicit grants.
- Sidebar and tabs filter client-side; backend must still return 403 on direct API/URL access.

---

## 7. Background jobs (Celery)

**Purpose:** Long-running or scheduled work runs off the API thread so
scanners and admin stay responsive.

**Reference files:**

- App config: `api/jobs/__init__.py` — beat schedule, autodiscover
- Cleanup: `api/jobs/cleanup_tasks.py`
- Connectors: `api/jobs/sync_tasks.py`
- Billing: `api/jobs/billing_tasks.py` — `daily_storage_billing`
- Ops schedule table: `docs/runbooks/go-live.md` §4

**Rules when adding features:**

- New tasks live under `api/jobs/` and register via `celery_app.autodiscover_tasks`.
- Beat entries must use the full task name (`jobs.module.task_name`).
- Tasks open their own DB session (`SessionLocal`), commit/rollback explicitly, and return JSON-serializable dicts.
- Add registration tests in `api/tests/test_celery.py` for every new scheduled task.

---

## 8. Gate sessions (vehicle ↔ PO/SO)

**Purpose:** Track trucks at the dock and link them to inbound POs or
outbound SOs so partner webhooks include plate context.

**Reference files:**

- Schema: `db/migrations/080_vehicle_movements.sql`, `086_vehicle_gate_sessions.sql`
- Service: `api/services/vehicle_service.py`
- Floor API: `api/routes/gate.py` — `/api/gate/check-in`, `/active`, `/sessions/:id/complete`
- Admin: `admin/src/pages/VehicleMovements.jsx`, `api/routes/admin/admin_vehicle_movements.py`
- Mobile: `mobile/src/screens/GateScreen.js`
- Partner events: `inbound.completed`, `outbound.shipped`, `invoice.issued`

**Rules when adding features:**

- INBOUND sessions reference `PO`; OUTBOUND sessions reference `SO`.
- Completing receive (PO → RECEIVED) or ship auto-closes the open gate session when linked.
- Do not invent a parallel vehicle log — extend `vehicle_movements`.

---

## 9. Customer tenancy (3PL multi-tenant)

**Purpose:** In a 3PL warehouse the operator's data and each customer's
data live in the same tables. A surface that forgets the tenant
dimension does not fail loudly -- it quietly serves customer A rows
belonging to customer B.

**Reference files:**

- Ownership columns: `db/migrations/087_customer_ownership.sql` — `items.owner_customer_id`, `purchase_orders.owner_customer_id`, `sales_orders.customer_ref`
- Portal reads: `api/middleware/auth_middleware.py` — `customer_scope_clause`, `require_customer_auth`, `require_customer_feature`
- Token writes: `api/services/customer_token_scope.py`; token binding `db/migrations/089_customer_token_scope.sql`
- Token reads: `api/routes/snapshot.py` — `_run_keyset_query(owner_customer_id=...)`
- Docs: [customer-api.md](customer-api.md), [api/portal-openapi.yaml](api/portal-openapi.yaml)

**Rules when adding features:**

- A read for a customer filters in SQL (`customer_scope_clause`), never after fetching: "no such record" and "someone else's record" must both be 404, or the endpoint enumerates other tenants' order numbers (V-026).
- A write for a customer takes its owner from the credential and never from the body; a body that names another customer is refused, not silently overridden.
- Never publish the operator's layout to a customer: no `bin_code`, `zone`, or pick location on any `/api/portal/*` payload.
- A new token-authed surface must decide its tenant story before it ships. If it has no owning-customer dimension, add it to the refusal list in `CUSTOMER_SCOPED_OUTBOUND_SLUGS` rather than serving it unscoped.
- New inbound resources need a rule in `OWNER_COLUMN_BY_RESOURCE` or `FORBIDDEN_RESOURCES`; the helper fails closed on an unknown resource, so forgetting means a 403, not a leak.

---

## Checklist for new modules

| Step | Action |
|------|--------|
| 1 | Define scan/confirm flow if floor-facing |
| 2 | Route inventory changes through service layer |
| 3 | Add `page_key` + Sidebar + Users.jsx if admin UI |
| 4 | Emit billing events if customer-billable |
| 5 | Register Celery task + beat entry if scheduled |
| 6 | Add pytest for permissions and task discovery |
| 7 | Scope it to the owning customer if a tenant can reach it (§9) |
