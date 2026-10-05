import json
import re

import pytest

from services.ai import MAX_SUGGESTIONS, client as ai_client, guard, redaction, rules, suggestions

HEX16 = re.compile(r"^[0-9a-f]{16}$")


# ---- fixtures -------------------------------------------------------------
def rep_row(sku="A1", available=2, rp=10, rq=50, bo=0, inbound=0):
    return {"sku": sku, "item_name": f"Item {sku}", "available": available,
            "reorder_point": rp, "reorder_qty": rq, "backorder_qty": bo,
            "inbound_qty": inbound}


def exp_row(sku="E1", bin_code="B-1", days=3, qty=10):
    return {"sku": sku, "item_name": f"Item {sku}", "bin_code": bin_code, "quantity": qty,
            "expiry_date": "2026-10-08", "days_left": days, "lot_number": None}


def cc_row(sku="C1", expected=10, counted=4, unexpected=False, pending=None):
    return {"count_id": 7, "sku": sku, "item_name": f"Item {sku}", "bin_code": "B-9",
            "expected": expected, "counted": counted, "unexpected": unexpected,
            "pending_adjustment_qty": pending}


# ---- redaction ------------------------------------------------------------
@pytest.mark.parametrize("key", [
    "customer_name", "customer_phone", "email", "memo", "notes", "tax_id",
    "billing_address_line1", "shipping_address_city", "driver_name", "password_hash",
    "token_hash", "Contact_Person",
])
def test_forbidden_keys_raise(key):
    with pytest.raises(redaction.PIIError):
        redaction.assert_no_pii({"ok": [{"nested": {key: "x"}}]})


def test_allowed_keys_pass():
    redaction.assert_no_pii({"sku": "A", "candidates": [{"id": "x", "quantity": 1}]})


def test_scrub_text():
    assert redaction.scrub_text("mail bob@example.com now") == "mail [redacted] now"
    assert "0912" not in redaction.scrub_text("call 0912 345 678")
    assert "+84" not in redaction.scrub_text("call +84 912 345 678 ok")
    assert redaction.scrub_text("id 123456789012") == "id [redacted]"
    assert redaction.scrub_text("2026-10-08") == "2026-10-08"
    assert redaction.scrub_text("expires 2026-10-08 ok") == "expires 2026-10-08 ok"
    assert redaction.scrub_text(5) == 5


@pytest.mark.parametrize("kind,rows", [
    ("replenish", [dict(rep_row(), customer_name="Bob", phone="0912345678", id="i")]),
    ("expiry", [dict(exp_row(), customer_email="a@b.co", memo="m", id="i")]),
    ("cycle_count", [dict(cc_row(), ship_address="x", notes="n", id="i")]),
])
def test_builders_never_emit_forbidden_keys(kind, rows):
    ctx = redaction.build_context(kind, rows, "en")
    redaction.assert_no_pii(ctx)
    emitted = set(ctx["candidates"][0])
    assert not emitted & {"customer_name", "phone", "customer_email", "memo", "ship_address", "notes"}


def test_builder_scrubs_free_text_values():
    row = dict(rep_row(), id="i")
    row["item_name"] = "Widget bob@example.com 0912345678"
    out = redaction.build_context("replenish", [row], "en")["candidates"][0]["item_name"]
    assert "@" not in out and "0912345678" not in out


# ---- rules ----------------------------------------------------------------
def test_replenish_priority_and_order():
    rows = [
        rep_row("MED", available=8, rp=10),                 # medium
        rep_row("HI", available=0, rp=10),                   # high
        rep_row("COV", available=5, rp=10, inbound=100),     # covered -> low
        rep_row("OK", available=500, rp=10),                 # not flagged
    ]
    out = rules.build("replenish", rows, "en")
    assert [s["sku"] for s in out] == ["HI", "MED", "COV"]
    assert [s["priority"] for s in out] == ["high", "medium", "low"]
    assert out[0]["action"] == "reorder" and out[0]["quantity"] == 50
    assert out[2]["action"] == "none"


def test_replenish_backorder_without_reorder_point():
    out = rules.build("replenish", [rep_row("B", available=5, rp=0, bo=20)], "en")
    assert len(out) == 1 and out[0]["priority"] == "high"


def test_expiry_priorities_and_actions():
    rows = [exp_row("L", days=25), exp_row("H", days=3), exp_row("X", days=-2), exp_row("M", days=10)]
    out = rules.build("expiry", rows, "en")
    assert [s["sku"] for s in out] == ["X", "H", "M", "L"]
    assert [s["action"] for s in out] == ["dispose", "ship_first", "ship_first", "discount"]
    assert out[0]["due_date"] == "2026-10-08"


def test_cycle_count_rules():
    rows = [
        cc_row("SAME", expected=5, counted=5),
        cc_row("SMALL", expected=100, counted=98),
        cc_row("BIG", expected=10, counted=2),
        cc_row("UNEXP", expected=0, counted=3, unexpected=True),
        cc_row("PEND", expected=10, counted=5, pending=-5),
        {**cc_row("NOCOUNT"), "counted": None},
    ]
    out = {s["sku"]: s for s in rules.build("cycle_count", rows, "en")}
    assert set(out) == {"SMALL", "BIG", "UNEXP", "PEND"}
    assert out["UNEXP"]["action"] == "investigate" and out["UNEXP"]["priority"] == "high"
    assert out["BIG"]["action"] == "recount" and out["BIG"]["quantity"] == 8
    assert out["PEND"]["action"] == "none"
    assert out["SMALL"]["priority"] == "low"


def test_bilingual_text():
    en = rules.build("expiry", [exp_row()], "en")[0]
    vi = rules.build("expiry", [exp_row()], "vi")[0]
    assert en["title"] != vi["title"]
    assert "first" in en["title"] and "Ưu tiên" in vi["title"]
    assert rules.build("expiry", [exp_row()], "fr")[0]["title"] == en["title"]


def test_cap_and_empty():
    rows = [rep_row(f"S{i:03d}", available=0) for i in range(50)]
    assert len(rules.build("replenish", rows, "vi")) == MAX_SUGGESTIONS
    assert len(rules.build("replenish", rows, "vi", cap=40)) == 40
    assert rules.build("replenish", [], "vi") == []
    assert rules.build("expiry", None, "en") == []


def test_ids_stable_and_distinct():
    a = rules.candidate_id("replenish", rep_row("A1"))
    assert HEX16.match(a)
    assert a == rules.candidate_id("replenish", rep_row("A1", available=99))
    assert a != rules.candidate_id("replenish", rep_row("A2"))
    assert rules.candidate_id("expiry", exp_row("A1")) != a
    assert rules.build("expiry", [exp_row()], "en")[0]["id"] == rules.build("expiry", [exp_row()], "vi")[0]["id"]


def test_contract_shape():
    s = rules.build("replenish", [rep_row()], "en")[0]
    assert set(s) == {"id", "priority", "title", "detail", "sku", "item_name",
                      "bin_code", "quantity", "due_date", "action"}


# ---- LLM merge / orchestration -------------------------------------------
def _fake(monkeypatch, result=None, exc=None, calls=None):
    def fake(system, user_text, schema, effort="low"):
        if calls is not None:
            calls.append((system, user_text))
        if exc:
            raise exc
        return result, {"model": "m", "input_tokens": 1, "output_tokens": 2}
    monkeypatch.setattr(ai_client, "call_claude", fake)


def test_llm_mode_merges_and_drops_invented(monkeypatch):
    rows = [rep_row("A", available=0), rep_row("B", available=8)]
    ids = {r["sku"]: rules.candidate_id("replenish", r) for r in rows}
    calls = []
    _fake(monkeypatch, calls=calls, result={"suggestions": [
        {"candidate_id": ids["B"], "priority": "high", "action": "reorder", "title": "T-B", "detail": "D-B"},
        {"candidate_id": "deadbeefdeadbeef", "priority": "high", "action": "reorder", "title": "ghost", "detail": "x"},
        {"candidate_id": ids["B"], "priority": "low", "action": "none", "title": "dup", "detail": "dup"},
        {"candidate_id": ids["A"], "priority": "low", "action": "dispose", "title": "T-A", "detail": "D-A"},
    ]})
    r = suggestions.generate("replenish", rows, "en", use_llm=True)
    assert r["mode"] == "llm" and r["usage"]["input_tokens"] == 1
    assert [s["sku"] for s in r["suggestions"]] == ["B", "A"]          # high before low
    assert r["suggestions"][0]["title"] == "T-B"
    assert r["suggestions"][1]["action"] == "reorder"                  # invalid action -> rules action
    assert all(s["id"] in ids.values() for s in r["suggestions"])
    # prompt hygiene: system first/stable, data only has allow-listed keys
    system, user = calls[0]
    assert system == suggestions.SYSTEM_PROMPT
    payload = json.loads(user)
    assert payload["language"] == "en" and "rule_priority" in payload["candidates"][0]
    redaction.assert_no_pii(payload)


def test_llm_text_is_scrubbed_and_truncated(monkeypatch):
    rows = [rep_row("A", available=0)]
    cid = rules.candidate_id("replenish", rows[0])
    _fake(monkeypatch, result={"suggestions": [
        {"candidate_id": cid, "priority": "high", "action": "reorder",
         "title": "mail x@y.com", "detail": "z" * 1000}]})
    s = suggestions.generate("replenish", rows, "en", True)["suggestions"][0]
    assert "@" not in s["title"] and len(s["detail"]) == 400


@pytest.mark.parametrize("exc", [ai_client.AIUnavailable("refusal"), RuntimeError("boom sk-ant-abc123")])
def test_fallback_to_rules_on_error(monkeypatch, exc):
    rows = [rep_row("A", available=0)]
    _fake(monkeypatch, exc=exc)
    r = suggestions.generate("replenish", rows, "vi", True)
    assert r["mode"] == "rules" and r["usage"] is None
    assert r["suggestions"] == rules.build("replenish", rows, "vi")


def test_fallback_when_nothing_valid_or_garbage(monkeypatch):
    rows = [rep_row("A", available=0)]
    for bad in ({"suggestions": [{"candidate_id": "nope"}]}, {"suggestions": "x"}, {}):
        _fake(monkeypatch, result=bad)
        assert suggestions.generate("replenish", rows, "en", True)["mode"] == "rules"


def test_no_llm_call_when_off_or_no_candidates(monkeypatch):
    calls = []
    _fake(monkeypatch, result={"suggestions": []}, calls=calls)
    assert suggestions.generate("replenish", [rep_row(available=0)], "en", False)["mode"] == "rules"
    assert suggestions.generate("replenish", [], "en", True) == {"mode": "rules", "suggestions": [], "usage": None}
    assert calls == []


def test_call_claude_without_key_raises(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ai_client.AIUnavailable):
        ai_client.call_claude("s", "u", {})


def test_model_default_and_override(monkeypatch):
    monkeypatch.delenv("AI_MODEL", raising=False)
    assert ai_client.model_name() == "claude-opus-5-5"
    monkeypatch.setenv("AI_MODEL", "claude-sonnet-5-5")
    assert ai_client.model_name() == "claude-sonnet-5-5"


# ---- guard ----------------------------------------------------------------
def test_guard_decide():
    assert guard.decide(None, None, 0, True) == {"enabled": True, "mode": "llm"}
    assert guard.decide(None, None, 0, False) == {"enabled": True, "mode": "rules"}
    assert guard.decide("false", None, 0, True) == {"enabled": False, "mode": "rules"}
    assert guard.decide("TRUE", "5", 4, True)["mode"] == "llm"
    assert guard.decide("true", "5", 5, True) == {"enabled": False, "mode": "rules"}
    assert guard.decide("true", "junk", 199, True)["enabled"] is True      # default 200
    assert guard.decide("true", "junk", 200, True)["enabled"] is False


def test_guard_key_and_status_with_fake_db(monkeypatch):
    monkeypatch.setattr(guard, "_load", lambda db: ("true", "10"))
    monkeypatch.setattr(guard, "calls_today", lambda db: 3)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "  ")
    assert guard.status(None)["mode"] == "rules"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert guard.llm_enabled(None) is True
    monkeypatch.setattr(guard, "calls_today", lambda db: 10)
    assert guard.llm_enabled(None) is False
