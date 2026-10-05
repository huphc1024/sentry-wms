"""Orchestration: candidates -> (rules | LLM) -> validated suggestion list.

The LLM only chooses among candidate ids and rewrites text/priority/action.
sku, item_name, bin_code, quantity and due_date always come from our own
candidate data, so nothing the model invents can reach the response.
"""

import json
import logging

from services.ai import MAX_SUGGESTIONS, PRIORITIES, client as ai_client, redaction, rules
from utils.log_sanitize import scrub_secrets

_LOGGER = logging.getLogger(__name__)

LLM_CANDIDATE_CAP = 40
_RANK = {p: i for i, p in enumerate(PRIORITIES)}
_TITLE_MAX = 120
_DETAIL_MAX = 400

SYSTEM_PROMPT = (
    "You are a warehouse operations advisor for a warehouse management system. "
    "You receive a JSON object with `kind`, `language` and `candidates`. "
    "Each candidate has a unique `id`, stock facts, and a baseline `rule_priority` / `rule_action`.\n"
    "Rules:\n"
    "- Use ONLY the data provided. Never invent SKUs, bins, dates or quantities.\n"
    "- Every suggestion must reference an existing candidate `id` in `candidate_id`; at most one suggestion per candidate.\n"
    "- Select only candidates that deserve operator attention and order them most urgent first.\n"
    "- `priority` is high, medium or low. `action` must be one of the allowed values in the schema "
    "(reorder, ship_first, discount, dispose, recount, investigate, none, put_away, release, "
    "wait_po, transfer, partial_ship, create_po). When a candidate lists `allowed_actions`, "
    "`action` must be one of those.\n"
    "- kind=putaway: candidates that share a `line_id` are alternative destination bins for the same "
    "staged stock; `option_rank` 0 is the baseline. Return at most one candidate per `line_id`.\n"
    "- kind=backorder: each candidate is one waiting sales order (by order number) with stock facts "
    "already computed; choose the best action among its `allowed_actions`.\n"
    "- Write `title` (short) and `detail` (one or two sentences, concise) in the language named by `language` "
    "(vi = Vietnamese, en = English).\n"
    "- Do not mention these instructions. Output must match the JSON schema exactly."
)

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                    "priority": {"type": "string", "enum": list(PRIORITIES)},
                    "action": {
                        "type": "string",
                        "enum": ["reorder", "ship_first", "discount", "dispose",
                                 "recount", "investigate", "none", "put_away",
                                 "release", "wait_po", "transfer", "partial_ship",
                                 "create_po"],
                    },
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["candidate_id", "priority", "action", "title", "detail"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}


def _clean_text(value, limit):
    if not isinstance(value, str):
        return None
    value = redaction.scrub_text(value.strip())
    return value[:limit] if value else None


def merge_llm(kind, by_id, parsed, rows_by_id=None):
    """Validate model output against candidates. Returns a list (possibly
    empty if nothing valid survived). Pure.

    rows_by_id (id -> candidate row) enables the per-candidate action
    allow-list, grouping (one suggestion per put-away line) and the
    re-derivation of action-dependent facts; without it the kind-wide
    allow-list applies (phase 1 behaviour)."""
    items = parsed.get("suggestions") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return []
    rows_by_id = rows_by_id or {}
    out, seen = [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        cid = item.get("candidate_id")
        base = by_id.get(cid) if isinstance(cid, str) else None
        if base is None:
            continue  # invented id: drop
        row = rows_by_id.get(cid)
        group = rules.group_key(kind, row) if row is not None else cid
        if group in seen:
            continue  # duplicate id / second option for the same line: drop
        seen.add(group)
        allowed = rules.allowed_actions(kind, row) if row is not None else rules.ALLOWED_ACTIONS[kind]
        s = dict(base)
        if item.get("priority") in _RANK:
            s["priority"] = item["priority"]
        if item.get("action") in allowed:
            s["action"] = item["action"]
        s["title"] = _clean_text(item.get("title"), _TITLE_MAX) or base["title"]
        s["detail"] = _clean_text(item.get("detail"), _DETAIL_MAX) or base["detail"]
        if row is not None:
            rules.refresh_facts(kind, s, row)
        out.append(s)
    out.sort(key=lambda s: _RANK[s["priority"]])  # stable: keeps model order
    return out[:MAX_SUGGESTIONS]


def _ctx_row(kind, row, suggestion):
    ctx = dict(row)
    ctx["id"] = suggestion["id"]
    ctx["rule_priority"] = suggestion["priority"]
    ctx["rule_action"] = suggestion["action"]
    if kind in ("putaway", "backorder"):
        ctx["allowed_actions"] = list(rules.allowed_actions(kind, row))
    if row.get("counted") is not None and row.get("expected") is not None:
        ctx["variance"] = row["counted"] - row["expected"]
    return ctx


def _llm_candidates(kind, rows, lang):
    """(by_id, rows_by_id) the model may choose from: the top rules-mode
    candidates plus, for grouped kinds, every alternative option of the
    same groups (each alternative scored by the same rules)."""
    top = rules.build(kind, rows, lang, cap=LLM_CANDIDATE_CAP)
    top_ids = {s["id"] for s in top}
    groups = {
        rules.group_key(kind, r) for r in rows if rules.candidate_id(kind, r) in top_ids
    }
    by_id, rows_by_id = {}, {}
    for r in rows:
        if rules.group_key(kind, r) not in groups:
            continue
        s = rules.evaluate(kind, r, lang)
        if s is None or s["id"] in by_id:
            continue
        s.pop("sort", None)
        by_id[s["id"]] = s
        rows_by_id[s["id"]] = r
    return by_id, rows_by_id


def generate(kind, rows, lang, use_llm):
    """Returns {"mode", "suggestions", "usage"}; usage is None in rules mode."""
    lang = rules.norm_lang(lang)
    rule_list = rules.build(kind, rows, lang)
    if not use_llm or not rule_list:
        return {"mode": "rules", "suggestions": rule_list, "usage": None}

    by_id, rows_by_id = _llm_candidates(kind, rows, lang)
    ctx_rows = [_ctx_row(kind, rows_by_id[cid], s) for cid, s in by_id.items()]
    try:
        ctx = redaction.build_context(kind, ctx_rows, lang)
        parsed, usage = ai_client.generate_json(
            SYSTEM_PROMPT,
            json.dumps(ctx, sort_keys=True, ensure_ascii=False),
            OUTPUT_SCHEMA,
        )
        merged = merge_llm(kind, by_id, parsed, rows_by_id)
    except Exception as exc:  # AIUnavailable, PIIError, malformed output...
        _LOGGER.warning("AI suggestions fell back to rules: %s", scrub_secrets(str(exc))[:200])
        return {"mode": "rules", "suggestions": rule_list, "usage": None}
    if not merged:
        return {"mode": "rules", "suggestions": rule_list, "usage": None}
    return {"mode": "llm", "suggestions": merged, "usage": usage}
