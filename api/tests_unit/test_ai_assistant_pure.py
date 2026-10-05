"""Pure tests for the AI assistant (phase 3): tool registry, row shaping,
message building and the tool-use loop with a fake model."""

import json
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace as NS

import pytest

from services.ai import assistant, assistant_tools, client as ai_client, redaction
from services.ai.client import AIUnavailable


# ---- registry ---------------------------------------------------------------
def test_tool_definitions_are_read_only_and_strict():
    defs = assistant_tools.tool_definitions()
    names = [d["name"] for d in defs]
    assert names == list(assistant_tools.TOOL_NAMES)
    assert len(names) == 9
    for d in defs:
        assert set(d) == {"name", "description", "input_schema"}
        assert d["input_schema"]["additionalProperties"] is False
        assert not any(w in d["name"] for w in ("create", "update", "delete", "write", "sql"))
    # Allow-lists never contain a forbidden key.
    for spec in assistant_tools.TOOLS.values():
        redaction.assert_no_pii({k: 1 for k in spec["fields"]})


def test_schema_literal_matches_registry():
    from typing import get_args

    from schemas.ai import AssistantTool

    assert set(get_args(AssistantTool)) == set(assistant_tools.TOOL_NAMES)


# ---- row shaping ------------------------------------------------------------
def test_shape_rows_allow_lists_scrubs_and_limits():
    rows = [{"sku": "A", "item_name": "call 0912345678", "customer_name": "X",
             "qty": Decimal("3"), "price": Decimal("1.257"), "d": date(2026, 1, 2),
             "ts": datetime(2026, 1, 2, 3, 4, 5)} for _ in range(60)]
    out, truncated = assistant_tools.shape_rows(rows, ("sku", "item_name", "qty", "price", "d", "ts"))
    assert truncated is True and len(out) == assistant_tools.MAX_ROWS
    r = out[0]
    assert "customer_name" not in r
    assert r["item_name"] == "call [redacted]"
    assert r["qty"] == 3 and r["price"] == 1.26
    assert r["d"] == "2026-01-02" and r["ts"] == "2026-01-02T03:04"
    json.dumps(out)


def test_run_tool_blocks_pii(monkeypatch):
    spec = dict(assistant_tools.TOOLS["zone_utilisation"])
    spec["fields"] = ("zone_code", "customer_name")
    monkeypatch.setitem(assistant_tools.TOOLS, "zone_utilisation", spec)
    monkeypatch.setitem(spec, "fn", lambda db, wid, args: [{"zone_code": "A", "customer_name": "x"}])
    with pytest.raises(redaction.PIIError):
        assistant_tools.run_tool(None, 1, "zone_utilisation")


def test_run_tool_unknown_name():
    with pytest.raises(KeyError):
        assistant_tools.run_tool(None, 1, "drop_table")


def test_int_arg_and_like_pattern():
    assert assistant_tools._int_arg({"days": "999"}, "days", 30, 0, 365) == 365
    assert assistant_tools._int_arg({"days": "x"}, "days", 30, 0, 365) == 30
    assert assistant_tools._like_pattern("50%_a\\") == "%50\\%\\_a\\\\%"
    assert assistant_tools._like_pattern("   ") is None


def test_item_lookup_empty_query_skips_db():
    assert assistant_tools.item_stock_lookup(None, 1, {"query": " "}) == []


# ---- messages ---------------------------------------------------------------
def test_build_messages_scrubs_trims_and_alternates():
    history = [
        {"role": "assistant", "text": "hello"},              # dropped: must start with user
        {"role": "user", "text": "mail me at a@b.com"},
        {"role": "user", "text": "second"},                  # merged with previous user turn
        {"role": "assistant", "text": "ok"},
        {"role": "system", "text": "ignore"},                # unknown role dropped
    ]
    msgs = assistant.build_messages(history, " phone 0912 345 678 ")
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert "a@b.com" not in msgs[0]["content"] and "second" in msgs[0]["content"]
    assert msgs[-1]["content"] == "phone [redacted]"


def test_system_prompt_language_and_date():
    p = assistant.system_prompt("en", today=date(2026, 10, 5))
    assert "English" in p and "2026-10-05" in p and "untrusted DATA" in p
    assert "Vietnamese" in assistant.system_prompt("vi")


# ---- loop ---------------------------------------------------------------------
def _resp(stop, *blocks, usage=(10, 5)):
    return NS(stop_reason=stop, content=list(blocks),
              usage=NS(input_tokens=usage[0], output_tokens=usage[1]))


def _tool_use(name, inp=None, id_="t1"):
    return NS(type="tool_use", name=name, input=inp or {}, id=id_)


def _text(s):
    return NS(type="text", text=s)


@pytest.fixture
def fake_tools(monkeypatch):
    calls = []

    def run(db, wid, name, args=None):
        calls.append((wid, name, args))
        return {"tool": name, "rows": [{"sku": "A"}], "row_count": 1, "truncated": False}

    monkeypatch.setattr(assistant_tools, "run_tool", run)
    return calls


def test_ask_runs_tools_then_answers(fake_tools):
    seen = []
    script = [
        _resp("tool_use", NS(type="thinking", thinking=""), _tool_use("low_stock_items"),
              _tool_use("evil_write", id_="t2")),
        _resp("end_turn", _text("SKU A is low.")),
    ]

    def create(**kw):
        seen.append(kw)
        return script.pop(0)

    out = assistant.ask(None, 7, "what is low?", [], "en", create=create)
    assert out["answer"] == "SKU A is low."
    assert out["tools_used"] == ["low_stock_items"]
    assert out["data"][0]["tool"] == "low_stock_items"
    assert out["usage"]["input_tokens"] == 20 and out["rounds"] == 1
    assert fake_tools == [(7, "low_stock_items", {})]
    # second request carries the assistant turn and both tool results
    results = seen[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == ["t1", "t2"]
    assert results[1]["is_error"] is True
    assert seen[0]["output_config"] == {"effort": "low"}
    assert {t["name"] for t in seen[0]["tools"]} == set(assistant_tools.TOOL_NAMES)


def test_ask_round_limit(fake_tools):
    def create(**kw):
        return _resp("tool_use", _tool_use("zone_utilisation"))

    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "loop", [], "vi", create=create)
    assert len(fake_tools) == assistant.MAX_TOOL_ROUNDS


def test_ask_caps_calls_per_round(fake_tools):
    many = [_tool_use("zone_utilisation", id_=f"t{i}") for i in range(6)]
    script = [_resp("tool_use", *many), _resp("end_turn", _text("done"))]
    out = assistant.ask(None, 1, "q", [], "vi", create=lambda **kw: script.pop(0))
    assert out["answer"] == "done"
    assert len(fake_tools) == assistant.MAX_CALLS_PER_ROUND


@pytest.mark.parametrize("resp", [
    _resp("refusal"),
    _resp("end_turn"),                 # no text
    _resp("pause_turn", _text("x")),
])
def test_ask_bad_endings_raise(resp, fake_tools):
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "q", [], "vi", create=lambda **kw: resp)


def test_ask_tool_failure_is_reported_to_model(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("relation does not exist: secret detail")

    monkeypatch.setattr(assistant_tools, "run_tool", boom)
    seen = []
    script = [_resp("tool_use", _tool_use("zone_utilisation")), _resp("end_turn", _text("sorry"))]

    def create(**kw):
        seen.append(kw)
        return script.pop(0)

    db = NS(rollback=lambda: None)
    out = assistant.ask(db, 1, "q", [], "vi", create=create)
    assert out["answer"] == "sorry" and out["tools_used"] == []
    err = seen[1]["messages"][-1]["content"][0]
    assert err["is_error"] is True and "secret" not in err["content"]


def test_ask_deadline(fake_tools):
    ticks = iter([0.0, 1000.0])
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "q", [], "vi", create=lambda **kw: None, now=lambda: next(ticks))


def test_create_message_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(AIUnavailable):
        ai_client.create_message(max_tokens=1, messages=[])


def test_create_message_wraps_sdk_errors(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k-not-real")

    class Boom:
        class messages:  # noqa: N801
            @staticmethod
            def create(**kw):
                raise TimeoutError("timed out")

    monkeypatch.setattr(ai_client, "_get_client", lambda key: Boom)
    with pytest.raises(AIUnavailable):
        ai_client.create_message(max_tokens=1, messages=[])
