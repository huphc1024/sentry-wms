"""Feature flag, daily cap and mode selection for AI suggestions.

app_settings keys:
  ai_suggestions_enabled  'true' (default) / 'false'
  ai_daily_call_limit     integer, default 200 (counted per UTC day from
                          audit_log rows with action AI_SUGGESTION)
"""

import os

from sqlalchemy import text

from constants import ACTION_AI_SUGGESTION

FLAG_KEY = "ai_suggestions_enabled"
LIMIT_KEY = "ai_daily_call_limit"
DEFAULT_LIMIT = 200

_FALSE = ("false", "0", "no", "off")


def parse_flag(raw, default=True):
    if raw is None:
        return default
    return str(raw).strip().lower() not in _FALSE


def parse_limit(raw, default=DEFAULT_LIMIT):
    try:
        n = int(str(raw).strip())
    except (TypeError, ValueError):
        return default
    return n if n >= 0 else default


def api_key_present():
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def decide(flag_raw, limit_raw, used_today, key_present):
    """Pure decision: {"enabled": bool, "mode": "llm"|"rules"}."""
    enabled = parse_flag(flag_raw) and used_today < parse_limit(limit_raw)
    return {"enabled": enabled, "mode": "llm" if (enabled and key_present) else "rules"}


def _load(db):
    rows = db.execute(
        text("SELECT key, value FROM app_settings WHERE key IN (:f, :l)"),
        {"f": FLAG_KEY, "l": LIMIT_KEY},
    ).fetchall()
    settings = {r[0]: r[1] for r in rows}
    return settings.get(FLAG_KEY), settings.get(LIMIT_KEY)


def calls_today(db):
    return db.execute(
        text(
            "SELECT COUNT(*) FROM audit_log WHERE action_type = :a "
            "AND (created_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date"
        ),
        {"a": ACTION_AI_SUGGESTION},
    ).scalar() or 0


def status(db):
    """DB-backed wrapper around decide()."""
    flag_raw, limit_raw = _load(db)
    return decide(flag_raw, limit_raw, calls_today(db), api_key_present())


def llm_enabled(db):
    """True when the API key is set and the feature is on (and under cap)."""
    return status(db)["mode"] == "llm"
