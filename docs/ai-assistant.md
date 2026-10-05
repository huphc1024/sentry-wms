# AI assistant (phase 3)

Admin page **Trợ lý AI / AI assistant** (`/ai-assistant`, page key `ai-assistant`). Staff ask about one warehouse in Vietnamese or English: "tuần này mặt hàng nào sắp hết?", "zone nào đang đầy?", "đơn nào chờ hàng lâu nhất?", "PO nào sắp về?". The assistant is **read-only**: it can only run fixed queries and never writes anything except one audit row per request.

## Modes

| Mode | When | What happens | Cost |
|---|---|---|---|
| `quick` | Always available | The UI sends a preset question (`quick: <tool>`); the backend runs that one tool and returns its rows. No LLM. | Free |
| `llm` | The selected provider's key set (`AI_PROVIDER=claude` → `ANTHROPIC_API_KEY`, `AI_PROVIDER=gemini` → `GEMINI_API_KEY`), `ai_suggestions_enabled` on and `ai_daily_call_limit` not reached (same guard as phases 1-2, `GET /api/admin/ai/status` → `mode: "llm"`, `provider`) | Free-text question → the model calls the read-only tools (manual tool-use loop) and writes a short answer. | Anthropic or Google Gemini API usage |

A free-text question while the LLM is not available returns `503 {"error": "ai_llm_unavailable", "mode": "quick"}`; any SDK / API / timeout / refusal / round-limit problem returns `503 {"error": "ai_llm_failed", "mode": "llm"}` — never a 500. The UI maps both to translated messages and keeps the quick questions usable.

## Endpoint

`POST /api/admin/ai/ask` — `@require_admin_or_page_permission("ai-assistant")`, 20 requests/minute, `check_warehouse_access(warehouse_id)`.

```json
{"warehouse_id": 1, "lang": "vi", "question": "PO nào sắp về?",
 "history": [{"role": "user", "text": "..."}, {"role": "assistant", "text": "..."}]}
{"warehouse_id": 1, "lang": "en", "quick": "zone_utilisation"}
```

Exactly one of `question` (≤ 1000 chars) or `quick` is required (else `400 question_or_quick_required`). `history` is text only, at most 6 turns of ≤ 2000 chars.

Response: `{"mode": "llm"|"quick", "answer": "markdown-light text" | null, "tools_used": ["..."], "data": [{"tool", "rows", "row_count", "truncated", "summary"?}], "generated_at"}`. `data` holds at most 6 tables of at most 50 rows each.

## Tools (`api/services/ai/assistant_tools.py`)

Each tool is one parameterised SQL query, always filtered by the authorised `warehouse_id`, limited to 50 rows and shaped to an allow-list of columns. There is no free-form SQL and no write tool.

| Tool | Returns | Args |
|---|---|---|
| `low_stock_items` | at/below reorder point or with waiting demand (reuses `candidates.replenishment`) | – |
| `near_expiry_stock` | expired / expiring stock (reuses `candidates.expiry`) | `days` (default 30) |
| `zone_utilisation` | bins occupied / active bins and units per zone, fullest first | – |
| `waiting_stock_orders` | WAITING_STOCK orders by `so_number`, longest waiting first | – |
| `open_purchase_orders` | OPEN/PARTIAL POs by `po_number`, expected date, open units | `days_ahead` (default 30) |
| `item_stock_lookup` | items matching a SKU / name fragment with on hand / allocated / available / bins | `query` (required) |
| `recent_receipts` | receipts in the last N days | `days` (default 7, ≤ 90) |
| `cycle_count_variances` | counted lines that differ from expected | `days` (default 30) |
| `sales_summary` | sales KPIs + top items (reuses `dashboard_service.sales`) | `days` ∈ 7/14/30/90 |

## LLM loop

Manual tool-use loop with `client.messages.create` (`services/ai/client.create_message`): model from `AI_MODEL` (default `claude-opus-5-5`), effort `low` (adaptive thinking is always on for this model; no budget is sent), `max_tokens` 1500, 30 s timeout with one retry per call, at most 6 tool rounds, 4 tool calls per round, 75 s overall deadline. The stable system prompt is sent with `cache_control` so repeated rounds read it from the prompt cache. Unknown tool names get an `is_error` result; a failing tool returns a generic error to the model (no SQL detail).

With `AI_PROVIDER=gemini` the same loop (`assistant._ask_gemini`, same round / per-round / deadline caps, same tools and system prompt) runs on `client.models.generate_content` from `google-genai`: tools are sent as `FunctionDeclaration`s (schemas reduced to the Gemini-safe subset, see [ai-suggestions.md](ai-suggestions.md#providers)), **automatic function calling is disabled** so our loop executes every call, the model's own turn is sent back unchanged (keeps thought signatures) and the results go back as one user turn of `function_response` parts (`{"output": <json>}` or `{"error": "..."}`, matching the call `id`). Model `GEMINI_MODEL` (default `gemini-3.5-flash`), `max_output_tokens` 4096, thinking level `GEMINI_THINKING_LEVEL` (default `low`), 30 s timeout, no SDK retries, one retry on `GEMINI_FALLBACK_MODEL` for 429 / 503. Only finish reason `STOP` with text counts as an answer (`MAX_TOKENS` means a truncated answer → `ai_llm_failed`).

## Privacy and safety decisions

- **No customer / vendor data.** Orders are identified by order number and POs by PO number only; no customer, vendor, address, contact or user column is selected. Every tool result passes `redaction.assert_no_pii` and free text is masked with `scrub_text` (emails, phone-like and long digit runs) before it reaches the model or the UI.
- **The question text is never stored.** Free input can contain names or phone numbers, so the audit row (`action_type = 'AI_ASSISTANT'`) records only `mode`, `outcome`, `quick`, `question_length`, `history_turns`, `tools_used`, `rounds`, `model` and token counts. The question and history are also scrubbed before being sent to the provider (Anthropic or Google).
- **Gemini free tier.** Per Google's terms (verify), content sent with a free-tier Gemini key may be used to improve Google products. Only the redacted, allow-listed data above (scrubbed question / history, tool rows without customer or vendor fields) is sent.
- **Prompt injection.** The system prompt states that tool results are untrusted data, that there are no write tools and that the assistant cannot act. The model can only call the nine tools above and always for the warehouse the route authorised; it never chooses the warehouse.
- **Daily cap.** Only LLM-mode assistant rows count towards `ai_daily_call_limit` (`guard.calls_today` counts `AI_SUGGESTION` rows plus `AI_ASSISTANT` rows with `details->>'mode' = 'llm'`). Quick answers are free and always allowed, even with the flag off.
- **Permissions.** `ai-assistant` is a new page key (`ALL_PAGE_KEYS`, Users page grid, supervisor preset). `sales_summary` exposes the same figures as the any-auth dashboard sales endpoint, so the key does not widen access.
