"""AI suggestions (phases 1-2): read-only advice for replenishment, expiry,
cycle-count review, put-away destinations and backorder resolution, plus the
phase 3 read-only Q&A assistant (/ai/ask). Never writes inventory; the only
writes are an audit row per request and thumbs up/down feedback. See
docs/ai-suggestions.md and docs/ai-assistant.md.
"""

import logging
from datetime import datetime, timezone

from flask import g, jsonify
from sqlalchemy import text

from constants import ACTION_AI_ASSISTANT, ACTION_AI_SUGGESTION
from middleware.auth_middleware import (
    check_warehouse_access,
    require_admin_or_page_permission,
    require_auth,
)
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.ai import (
    AssistantAskRequest,
    BackordersRequest,
    CycleCountReviewRequest,
    ExpiryActionsRequest,
    FeedbackRequest,
    PutawayRequest,
    ReplenishmentRequest,
)
from services.ai import assistant, candidates, guard, suggestions
from services.ai.client import AIUnavailable
from services.audit_service import write_audit_log
from services.rate_limit import limiter
from utils.validation import validate_body

_LOGGER = logging.getLogger(__name__)


def _respond(kind, rows, lang, warehouse_id, entity_id, st):
    """Generate, audit and serialise. `st` is the guard status (enabled)."""
    result = suggestions.generate(kind, rows, lang, use_llm=st["mode"] == "llm")
    usage = result["usage"] or {}
    write_audit_log(
        g.db, ACTION_AI_SUGGESTION, "ai", entity_id,
        g.current_user["username"], warehouse_id,
        details={
            "feature": kind,
            "mode": result["mode"],
            "model": usage.get("model"),
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
            "suggestion_count": len(result["suggestions"]),
        },
    )
    g.db.commit()
    return jsonify({
        "mode": result["mode"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kind": kind,
        "suggestions": result["suggestions"],
    })


def _disabled():
    return jsonify({"error": "ai_disabled"}), 503


@admin_bp.route("/ai/status", methods=["GET"])
@require_auth
@with_db
def ai_status():
    return jsonify(guard.status(g.db))


@admin_bp.route("/ai/replenishment", methods=["POST"])
@require_auth
@require_admin_or_page_permission("inventory")
@limiter.limit("20 per minute")
@validate_body(ReplenishmentRequest)
@with_db
def ai_replenishment(validated):
    ok, denied = check_warehouse_access(validated.warehouse_id)
    if not ok:
        return denied
    st = guard.status(g.db)
    if not st["enabled"]:
        return _disabled()
    rows = candidates.replenishment(g.db, validated.warehouse_id)
    return _respond("replenish", rows, validated.lang,
                    validated.warehouse_id, validated.warehouse_id, st)


@admin_bp.route("/ai/expiry-actions", methods=["POST"])
@require_auth
@require_admin_or_page_permission("expiry")
@limiter.limit("20 per minute")
@validate_body(ExpiryActionsRequest)
@with_db
def ai_expiry_actions(validated):
    ok, denied = check_warehouse_access(validated.warehouse_id)
    if not ok:
        return denied
    st = guard.status(g.db)
    if not st["enabled"]:
        return _disabled()
    rows = candidates.expiry(g.db, validated.warehouse_id, validated.days)
    return _respond("expiry", rows, validated.lang,
                    validated.warehouse_id, validated.warehouse_id, st)


@admin_bp.route("/ai/cycle-count-review", methods=["POST"])
@require_auth
@require_admin_or_page_permission("cycle-counts")
@limiter.limit("20 per minute")
@validate_body(CycleCountReviewRequest)
@with_db
def ai_cycle_count_review(validated):
    count = candidates.load_count(g.db, validated.count_id)
    if count is None:
        return jsonify({"error": "count_not_found"}), 404
    st = guard.status(g.db)
    if not st["enabled"]:
        return _disabled()
    rows = candidates.cycle_count_lines(g.db, validated.count_id)
    return _respond("cycle_count", rows, validated.lang,
                    count["warehouse_id"], validated.count_id, st)


@admin_bp.route("/ai/putaway", methods=["POST"])
@require_auth
@require_admin_or_page_permission("putaway")
@limiter.limit("20 per minute")
@validate_body(PutawayRequest)
@with_db
def ai_putaway(validated):
    ok, denied = check_warehouse_access(validated.warehouse_id)
    if not ok:
        return denied
    st = guard.status(g.db)
    if not st["enabled"]:
        return _disabled()
    rows = candidates.putaway(g.db, validated.warehouse_id)
    return _respond("putaway", rows, validated.lang,
                    validated.warehouse_id, validated.warehouse_id, st)


@admin_bp.route("/ai/backorders", methods=["POST"])
@require_auth
@require_admin_or_page_permission("backorders")
@limiter.limit("20 per minute")
@validate_body(BackordersRequest)
@with_db
def ai_backorders(validated):
    ok, denied = check_warehouse_access(validated.warehouse_id)
    if not ok:
        return denied
    st = guard.status(g.db)
    if not st["enabled"]:
        return _disabled()
    rows = candidates.backorders(g.db, validated.warehouse_id)
    return _respond("backorder", rows, validated.lang,
                    validated.warehouse_id, validated.warehouse_id, st)


def _audit_assistant(warehouse_id, mode, outcome, validated, result=None, usage=None):
    """Assistant audit row. Records the question LENGTH, never its text (free
    input that may contain names / phone numbers)."""
    result = result or {}
    usage = usage or {}
    write_audit_log(
        g.db, ACTION_AI_ASSISTANT, "ai", warehouse_id,
        g.current_user["username"], warehouse_id,
        details={
            "feature": "assistant",
            "mode": mode,
            "outcome": outcome,
            "quick": validated.quick,
            "question_length": len(validated.question or ""),
            "history_turns": len(validated.history),
            "tools_used": result.get("tools_used", []),
            "rounds": result.get("rounds", 0),
            "model": usage.get("model"),
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        },
    )
    g.db.commit()


def _assistant_body(result, mode):
    return {
        "mode": mode,
        "answer": result["answer"],
        "tools_used": result["tools_used"],
        "data": result["data"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@admin_bp.route("/ai/ask", methods=["POST"])
@require_auth
@require_admin_or_page_permission("ai-assistant")
@limiter.limit("20 per minute")
@validate_body(AssistantAskRequest)
@with_db
def ai_ask(validated):
    """AI assistant (phase 3). `quick` runs one preset read-only tool with no
    LLM (always available, free); `question` runs the LLM tool loop when the
    API key is set, the flag is on and the daily cap is not reached."""
    wid = validated.warehouse_id
    ok, denied = check_warehouse_access(wid)
    if not ok:
        return denied
    question = (validated.question or "").strip()
    if bool(question) == bool(validated.quick):
        return jsonify({"error": "question_or_quick_required"}), 400

    if validated.quick:
        result = assistant.quick(g.db, wid, validated.quick)
        _audit_assistant(wid, "quick", "ok", validated, result)
        return jsonify(_assistant_body(result, "quick"))

    if guard.status(g.db)["mode"] != "llm":
        return jsonify({"error": "ai_llm_unavailable", "mode": "quick"}), 503
    try:
        result = assistant.ask(g.db, wid, question, validated.history, validated.lang)
    except Exception as exc:  # AIUnavailable or anything unexpected: never a 500
        if not isinstance(exc, AIUnavailable):
            _LOGGER.warning("assistant failed: %s", type(exc).__name__)
        g.db.rollback()
        _audit_assistant(wid, "llm", "error", validated)
        return jsonify({"error": "ai_llm_failed", "mode": "llm"}), 503
    _audit_assistant(wid, "llm", "ok", validated, result, result.get("usage"))
    return jsonify(_assistant_body(result, "llm"))


@admin_bp.route("/ai/feedback", methods=["POST"])
@require_auth
@limiter.limit("60 per minute")
@validate_body(FeedbackRequest)
@with_db
def ai_feedback(validated):
    if validated.warehouse_id is not None:
        ok, denied = check_warehouse_access(validated.warehouse_id)
        if not ok:
            return denied
    g.db.execute(
        text(
            "INSERT INTO ai_suggestion_feedback "
            "(suggestion_id, kind, mode, rating, user_id, warehouse_id) "
            "VALUES (:sid, :kind, :mode, :rating, :uid, :wid)"
        ),
        {
            "sid": validated.suggestion_id, "kind": validated.kind,
            "mode": validated.mode, "rating": validated.rating,
            "uid": g.current_user["user_id"], "wid": validated.warehouse_id,
        },
    )
    g.db.commit()
    return jsonify({"ok": True})
