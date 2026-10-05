"""Allow-list context builders and PII guards for the LLM prompt.

Only the fields named in the *_FIELDS tuples below ever reach the model.
assert_no_pii is a second, independent tripwire over the final payload.
"""

import re

_FORBIDDEN_EXACT = frozenset({
    "customer_name", "customer_id", "customer_phone", "customer_email",
    "customer_address", "customer_ref", "ship_address", "phone", "email",
    "tax_id", "memo", "notes", "contact_person", "vendor_name",
    "full_name", "username", "address",
})
_FORBIDDEN_PREFIXES = (
    "billing_address", "shipping_address", "driver", "password", "token",
)

# Allow-lists (key order is the emission order).
REPLENISH_FIELDS = (
    "id", "sku", "item_name", "available", "reorder_point", "reorder_qty",
    "backorder_qty", "inbound_qty", "rule_priority", "rule_action",
)
EXPIRY_FIELDS = (
    "id", "sku", "item_name", "bin_code", "quantity", "expiry_date",
    "days_left", "rule_priority", "rule_action",
)
CYCLE_FIELDS = (
    "id", "sku", "item_name", "bin_code", "expected", "counted", "variance",
    "unexpected", "pending_adjustment_qty", "rule_priority", "rule_action",
)
PUTAWAY_FIELDS = (
    "id", "line_id", "option_rank", "sku", "item_name", "quantity", "source_bin",
    "bin_code", "zone_code", "zone_type", "reason", "item_qty_in_bin",
    "capacity_units", "backorder_qty", "expiry_date", "allowed_actions",
    "rule_priority", "rule_action",
)
# Orders are identified by order number only: no customer columns are ever
# selected (candidates.py) and none are allow-listed here.
BACKORDER_FIELDS = (
    "id", "so_number", "days_waiting", "ship_by_date", "total_short",
    "available_here", "missing_qty", "open_po_qty", "po_eta", "transfer_candidate",
    "lines", "allowed_actions", "rule_priority", "rule_action",
)
BACKORDER_LINE_FIELDS = (
    "sku", "item_name", "short_qty", "available_here", "open_po_qty", "transfer_qty",
)
_FIELDS = {
    "replenish": REPLENISH_FIELDS,
    "expiry": EXPIRY_FIELDS,
    "cycle_count": CYCLE_FIELDS,
    "putaway": PUTAWAY_FIELDS,
    "backorder": BACKORDER_FIELDS,
}
# Nested list fields and the allow-list applied to each of their items.
_NESTED = {
    ("backorder", "lines"): BACKORDER_LINE_FIELDS,
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"(?<![\w])\+?\d[\d ().-]{6,}\d(?![\w])")
_LONG_DIGITS_RE = re.compile(r"\d{9,}")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REDACTED = "[redacted]"


class PIIError(ValueError):
    """Raised when a forbidden key is present in an LLM-bound payload."""


def _is_forbidden(key):
    k = str(key).lower()
    return k in _FORBIDDEN_EXACT or k.startswith(_FORBIDDEN_PREFIXES)


def assert_no_pii(obj, _path="$"):
    """Raise PIIError if any dict key anywhere in obj is forbidden."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            if _is_forbidden(key):
                raise PIIError(f"forbidden key {key!r} at {_path}")
            assert_no_pii(value, f"{_path}.{key}")
    elif isinstance(obj, (list, tuple)):
        for i, value in enumerate(obj):
            assert_no_pii(value, f"{_path}[{i}]")


def scrub_text(value):
    """Mask emails, phone-like and long digit runs in free text. ISO dates pass."""
    if not isinstance(value, str):
        return value
    if _ISO_DATE_RE.match(value):
        return value
    value = _EMAIL_RE.sub(REDACTED, value)
    value = _PHONE_RE.sub(
        lambda m: m.group(0) if _ISO_DATE_RE.match(m.group(0)) else REDACTED, value
    )
    return _LONG_DIGITS_RE.sub(REDACTED, value)


def _scrub_value(value):
    if isinstance(value, (list, tuple)):
        return [scrub_text(v) for v in value if not isinstance(v, (dict, list, tuple))]
    if isinstance(value, dict):
        return None  # nested objects only pass through an explicit _NESTED allow-list
    return scrub_text(value)


def _pick(row, fields, kind=None):
    out = {}
    for k in fields:
        if k not in row:
            continue
        sub = _NESTED.get((kind, k))
        if sub is not None:
            out[k] = [
                {sk: scrub_text(item[sk]) for sk in sub if sk in item}
                for item in (row[k] or []) if isinstance(item, dict)
            ]
        else:
            out[k] = _scrub_value(row[k])
    return out


def build_context(kind, rows, lang):
    """Allow-listed LLM context for `kind` from prepared candidate rows."""
    fields = _FIELDS[kind]
    ctx = {
        "kind": kind,
        "language": lang,
        "candidates": [_pick(r, fields, kind) for r in rows],
    }
    assert_no_pii(ctx)
    return ctx
