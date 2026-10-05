# AI suggestions (phases 1-2)

Operator-facing suggestions on admin pages: **replenishment** (Inventory), **expiry actions** (Expiry), **cycle-count review** (Cycle counts), and since phase 2 **put-away destinations** (Put Away) and **backorder resolution** (Backorders, Waiting tab). The dashboard Overview tab carries replenishment, expiry, put-away and backorder panels. The feature is advisory only: it returns suggestions and **never writes inventory**.

## Modes

| Mode | When | Cost |
|---|---|---|
| `rules` | No `ANTHROPIC_API_KEY`, feature disabled for LLM, or any AI error | Free; nothing leaves the server |
| `llm` | `ANTHROPIC_API_KEY` set and the feature enabled | Anthropic API usage |

Both modes start from the same SQL candidates (items at/below reorder point or with backorder demand; stock expired or expiring within N days; counted lines with variance, plus pending adjustments). Rules mode turns them into bilingual (vi/en) sentences with deterministic priorities. LLM mode sends the redacted candidates to Claude, which selects, ranks and rewrites them. Every suggestion must reference a candidate id; anything the model invents is dropped, and `sku`, `bin_code`, `quantity` and `due_date` always come from our own data. A refusal, timeout, API error, malformed output or empty result silently falls back to rules mode (the error is logged after secret scrubbing).

## Configuration

| Setting | Where | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | environment (`.env`) | empty = rules mode |
| `AI_MODEL` | environment | `claude-opus-5-5` |
| `ai_suggestions_enabled` | `app_settings` | `true` |
| `ai_daily_call_limit` | `app_settings` | `200` per UTC day |

Requests use effort `low`, `max_tokens` 4000, a 30 s timeout and one retry.

## Endpoints

`GET /api/admin/ai/status`, `POST /api/admin/ai/replenishment`, `POST /api/admin/ai/expiry-actions`, `POST /api/admin/ai/cycle-count-review`, `POST /api/admin/ai/putaway`, `POST /api/admin/ai/backorders`, `POST /api/admin/ai/feedback`. Page permissions reuse `inventory`, `expiry`, `cycle-counts`, `putaway` and `backorders`; the generating endpoints are limited to 20 requests per minute per user and are scoped to the caller's warehouses.

`putaway` and `backorders` take `{"warehouse_id": int, "lang": "vi"|"en"}`. Their suggestions carry the common fields plus: put-away `source_bin` (staging bin) and `alternatives` (other computed bins); backorder `so_number` and `source_warehouse` (set for `transfer`). Feedback accepts kinds `putaway` and `backorder` (no migration: `ai_suggestion_feedback.kind` has no CHECK).

## Put-away (phase 2)

Candidates are staged stock: on hand in `Staging` / `PickableStaging` bins of the warehouse, the same set as the Put Away page (`routes/putaway.py`). Destinations are active `Pickable` bins in `PICKING` / `STORAGE` zones of the same warehouse. Per staged line the planner (`services/ai/planning.py`, pure) ranks at most 3 destinations:

1. Bins already holding the same item, and the item's preferred / default bins (tier 0).
2. Empty bins in a zone where the item already sits or has a preferred bin (tier 1); if the item has no such zone, every eligible zone counts.
3. Other empty eligible bins (tier 2).

Within a tier: bins with room for the whole quantity first, then preferred-bin priority, `PICKING` before `STORAGE`, more of the item already in the bin, `putaway_sequence`, `bin_code`. Bins holding only other items are never offered. Capacity uses `bins.max_weight_lbs` / `max_volume_cuft` against the stock already in the bin and the item's weight and dimensions; when neither limit can be evaluated the bin counts as unconstrained, and a bin with no room is skipped. An empty bin proposed for one item is not offered to a different item in the same run. A line with no destination becomes an `investigate` suggestion.

Priority: `high` when the item has WAITING_STOCK demand in the warehouse or there is no destination, `low` when the stock already sits in a `PickableStaging` bin, otherwise `medium`. Rules mode returns option 1 of each line. LLM mode sends every computed option (grouped by `line_id`); the model may pick one option per line and rewrite the text, but cannot change the bin set or the `put_away` action.

## Backorders (phase 2)

Candidates are sales orders in `WAITING_STOCK` (not voided), identified by `so_number` only; no customer column is selected or sent. Per order the remaining quantity is `quantity_ordered - quantity_shipped` per line. Facts, all computed by us:

- available here: `quantity_on_hand - quantity_allocated` in the order's warehouse;
- open PO: remaining quantity on `OPEN` / `PARTIAL` POs for the warehouse, earliest `expected_date`;
- elsewhere: available stock in other active warehouses **the caller can access**.

Orders are planned oldest first and consume the pools, so two orders never claim the same units. Action:

1. `release` - everything is available here now.
2. `wait_po` - open POs cover the rest and arrive within 7 days.
3. `transfer` - one other warehouse covers the whole remainder (most stock, then code).
4. `wait_po` - open POs cover the rest but later or with no date, and no transfer source.
5. `partial_ship` - some stock is here.
6. `create_po` - nothing covers it.

Priority: `high` for `release`, `create_po`, a ship-by date within 2 days, a PO due after the ship-by date, or 14+ days waiting; `low` for a PO due within 3 days; otherwise `medium`. LLM mode may switch only among the order's feasible actions (sent as `allowed_actions`); `source_warehouse` and `due_date` are re-derived from our data for the chosen action.

## Privacy

- Context is built from per-feature **allow-lists** (SKU, item name, bin code, quantities, dates, rule hints; for backorders the order number, per-line stock facts and a warehouse code). Customer, vendor, address, contact, memo/notes, driver, password and token fields are never selected by the candidate queries; nested lists (backorder lines) pass through their own allow-list.
- A second tripwire (`assert_no_pii`) aborts the LLM call if a forbidden key ever appears; free-text values have emails, phone-like numbers and long digit runs masked.
- Prompts and responses are not stored. The audit row (`AI_SUGGESTION`) holds only feature, mode, model, token counts and suggestion count. Feedback rows hold a suggestion hash, kind, mode and rating.

## Turning it off

- Stop LLM use only: unset `ANTHROPIC_API_KEY` (rules mode keeps working).
- Disable entirely: `UPDATE app_settings SET value = 'false' WHERE key = 'ai_suggestions_enabled'` (insert the row if missing). Endpoints then answer `503 {"error": "ai_disabled"}`.
- The same `503` is returned once `ai_daily_call_limit` requests have been audited for the day.

## Cost notes

One call per button press, only when there are candidates. The system prompt is stable at the front of the request (cache friendly); candidate data is capped at 40 rows (for put-away, 40 staged lines with up to 3 destination options each). Lower `ai_daily_call_limit` to bound spend.
