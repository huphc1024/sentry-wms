"""Pure tests for the Gemini provider: provider selection, schema conversion,
response parsing, the JSON call and the assistant loop with fake responses.
No network: the google-genai client is always faked."""

import json

import pytest

from services.ai import assistant, assistant_tools, client as ai_client, gemini, guard, suggestions
from services.ai.client import AIUnavailable

types = pytest.importorskip("google.genai.types")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ("AI_PROVIDER", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GEMINI_MODEL", "AI_MODEL",
              "GEMINI_FALLBACK_MODEL", "GEMINI_THINKING_LEVEL"):
        monkeypatch.delenv(k, raising=False)


# ---- provider selection -------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    (None, "claude"), ("", "claude"), ("claude", "claude"), ("Gemini", "gemini"),
    (" gemini ", "gemini"), ("openai", "claude"),
])
def test_provider_selection(monkeypatch, raw, expected):
    if raw is not None:
        monkeypatch.setenv("AI_PROVIDER", raw)
    assert ai_client.provider() == expected


def test_key_check_follows_provider(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    assert guard.api_key_present() is True
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    assert guard.api_key_present() is False          # Anthropic key does not count
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    assert guard.api_key_present() is True
    monkeypatch.setattr(guard, "_load", lambda db: ("true", "10"))
    monkeypatch.setattr(guard, "calls_today", lambda db: 0)
    assert guard.status(None) == {"enabled": True, "mode": "llm", "provider": "gemini"}


def test_model_names(monkeypatch):
    assert ai_client.model_name() == "claude-opus-5-5"
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    assert ai_client.model_name() == gemini.DEFAULT_MODEL
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    assert ai_client.model_name() == "gemini-3.5-flash-lite"
    assert ai_client.claude_model_name() == "claude-opus-5-5"


def test_generate_json_dispatch(monkeypatch):
    monkeypatch.setattr(ai_client, "call_claude", lambda *a, **k: ("claude", None))
    monkeypatch.setattr(gemini, "generate_json", lambda *a, **k: ("gemini", None))
    assert ai_client.generate_json("s", "u", {})[0] == "claude"
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    assert ai_client.generate_json("s", "u", {})[0] == "gemini"


# ---- schema conversion --------------------------------------------------------
def test_output_schema_conversion_drops_unsupported_keywords():
    out = gemini.to_gemini_schema(suggestions.OUTPUT_SCHEMA)
    dumped = json.dumps(out)
    assert "additionalProperties" not in dumped
    item = out["properties"]["suggestions"]["items"]
    assert item["required"] == ["candidate_id", "priority", "action", "title", "detail"]
    assert "reorder" in item["properties"]["action"]["enum"]
    assert out["required"] == ["suggestions"]
    # input is not mutated
    assert suggestions.OUTPUT_SCHEMA["additionalProperties"] is False


def test_schema_conversion_edge_cases():
    src = {"type": "object", "properties": {
        "q": {"type": "string", "minLength": 1, "maxLength": 80, "pattern": "x"},
        "n": {"type": "integer", "minimum": 0, "maximum": 365, "default": 3},
        "u": {"oneOf": [{"type": "string"}, {"type": "integer"}]}},
        "required": ["q", "ghost"], "$schema": "x"}
    out = gemini.to_gemini_schema(src)
    assert out["properties"]["q"] == {"type": "string"}
    assert out["properties"]["n"] == {"type": "integer", "minimum": 0, "maximum": 365}
    assert out["properties"]["u"] == {"anyOf": [{"type": "string"}, {"type": "integer"}]}
    assert out["required"] == ["q"]
    assert "$schema" not in out
    assert "required" not in gemini.to_gemini_schema({"type": "object", "properties": {},
                                                      "required": []})


def test_function_declarations_validate_with_sdk():
    decls = gemini.function_declarations(assistant_tools.tool_definitions())
    assert [d["name"] for d in decls] == list(assistant_tools.TOOL_NAMES)
    by = {d["name"]: d for d in decls}
    assert "parameters_json_schema" not in by["low_stock_items"]
    assert by["item_stock_lookup"]["parameters_json_schema"]["required"] == ["query"]
    tool = types.Tool(function_declarations=decls)        # SDK accepts the dicts
    assert len(tool.function_declarations) == len(decls)


# ---- fake responses -------------------------------------------------------------
def _resp(*parts, finish="STOP", usage=(10, 5, 2)):
    return types.GenerateContentResponse(
        candidates=[types.Candidate(
            content=types.Content(role="model", parts=list(parts)), finish_reason=finish)],
        usage_metadata=types.GenerateContentResponseUsageMetadata(
            prompt_token_count=usage[0], candidates_token_count=usage[1],
            thoughts_token_count=usage[2]),
    )


def _call(name, args=None, id_=None):
    return types.Part(function_call=types.FunctionCall(name=name, args=args or {}, id=id_))


def _text(s, thought=False):
    return types.Part(text=s, thought=thought or None)


def test_parsing_helpers():
    r = _resp(_text("thinking...", thought=True), _text("Hi"), _call("zone_utilisation"))
    assert gemini.text_of(r) == "Hi"
    assert [c.name for c in gemini.function_calls(r)] == ["zone_utilisation"]
    assert gemini.finish_reason(r) == "STOP"
    assert gemini.usage_of(r) == (10, 7)
    assert gemini.finish_reason(types.GenerateContentResponse(candidates=[])) is None


class _FakeModels:
    """Script items are responses or exceptions (raised in order)."""

    def __init__(self, script=None, error=None):
        self.script, self.error, self.requests = list(script or []), error, []

    def generate_content(self, **kw):
        if isinstance(kw.get("contents"), list):       # snapshot: the loop appends to it
            kw = {**kw, "contents": list(kw["contents"])}
        self.requests.append(kw)
        if self.error:
            raise self.error
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _install(monkeypatch, models):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "g-not-real")
    monkeypatch.setattr(gemini, "_get_client", lambda key: type("C", (), {"models": models}))


def test_generate_json_ok(monkeypatch):
    models = _FakeModels([_resp(_text('{"suggestions": []}'))])
    _install(monkeypatch, models)
    parsed, usage = ai_client.generate_json("sys", "user", suggestions.OUTPUT_SCHEMA)
    assert parsed == {"suggestions": []}
    assert usage == {"model": gemini.DEFAULT_MODEL, "input_tokens": 10, "output_tokens": 7}
    cfg = models.requests[0]["config"]
    assert cfg.response_mime_type == "application/json"
    assert cfg.system_instruction == "sys"
    assert "additionalProperties" not in json.dumps(cfg.response_json_schema)
    assert models.requests[0]["model"] == gemini.DEFAULT_MODEL


@pytest.mark.parametrize("resp", [
    _resp(_text("not json")),
    _resp(_text("[1, 2]")),
    _resp(_text('{"a": 1}'), finish="SAFETY"),
    _resp(_text('{"a": 1'), finish="MAX_TOKENS"),
    types.GenerateContentResponse(candidates=[]),
])
def test_generate_json_bad_outputs(monkeypatch, resp):
    _install(monkeypatch, _FakeModels([resp]))
    with pytest.raises(AIUnavailable):
        ai_client.generate_json("s", "u", {})


def test_generate_json_without_key_and_sdk_errors(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    with pytest.raises(AIUnavailable):
        gemini.generate_json("s", "u", {})
    _install(monkeypatch, _FakeModels(error=TimeoutError("timed out key=AIzaSECRET")))
    with pytest.raises(AIUnavailable):
        gemini.generate_json("s", "u", {})


def test_suggestions_fall_back_to_rules_on_gemini_error(monkeypatch):
    _install(monkeypatch, _FakeModels(error=RuntimeError("503")))
    monkeypatch.setattr(suggestions.rules, "build", lambda kind, rows, lang, cap=None: [{"id": "x"}])
    out = suggestions.generate("replenish", [{}], "en", use_llm=True)
    assert out["mode"] == "rules" and out["usage"] is None


# ---- assistant loop ---------------------------------------------------------------
@pytest.fixture
def fake_tools(monkeypatch):
    calls = []

    def run(db, wid, name, args=None):
        calls.append((wid, name, args))
        return {"tool": name, "rows": [{"sku": "A"}], "row_count": 1, "truncated": False}

    monkeypatch.setattr(assistant_tools, "run_tool", run)
    return calls


def test_assistant_function_call_round_then_text(monkeypatch, fake_tools):
    models = _FakeModels([
        _resp(_call("low_stock_items", id_="c1"), _call("evil_write"),
              _call("item_stock_lookup", {"query": "A"})),
        _resp(_text("SKU A is low.")),
    ])
    _install(monkeypatch, models)
    out = assistant.ask(None, 7, "what is low? call 0912345678",
                        [{"role": "assistant", "text": "hi"}, {"role": "user", "text": "x"},
                         {"role": "assistant", "text": "y"}], "en")
    assert out["answer"] == "SKU A is low." and out["rounds"] == 1
    assert out["tools_used"] == ["low_stock_items", "item_stock_lookup"]
    assert out["usage"] == {"model": gemini.DEFAULT_MODEL, "input_tokens": 20, "output_tokens": 14}
    assert fake_tools == [(7, "low_stock_items", {}), (7, "item_stock_lookup", {"query": "A"})]

    first, second = models.requests
    cfg = first["config"]
    assert cfg.automatic_function_calling.disable is True
    assert {d.name for d in cfg.tools[0].function_declarations} == set(assistant_tools.TOOL_NAMES)
    assert "0912345678" not in json.dumps(first["contents"], default=str)
    assert [c["role"] for c in first["contents"]] == ["user", "model", "user"]
    # round 2: model content sent back as-is, then one user turn of responses
    contents = second["contents"]
    assert contents[-2].role == "model" and contents[-2].parts[0].function_call.id == "c1"
    responses = [p["function_response"] for p in contents[-1]["parts"]]
    assert contents[-1]["role"] == "user"
    assert [r["name"] for r in responses] == ["low_stock_items", "evil_write", "item_stock_lookup"]
    assert responses[0]["id"] == "c1" and "id" not in responses[1]
    assert "error" in responses[1]["response"]
    assert json.loads(responses[0]["response"]["output"])["tool"] == "low_stock_items"
    types.Content.model_validate(contents[-1])        # valid SDK shape


def test_assistant_round_limit(monkeypatch, fake_tools):
    _install(monkeypatch, _FakeModels([_resp(_call("zone_utilisation"))
                                       for _ in range(assistant.MAX_TOOL_ROUNDS + 1)]))
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "loop", [], "vi")
    assert len(fake_tools) == assistant.MAX_TOOL_ROUNDS


def test_assistant_caps_calls_per_round(fake_tools):
    many = [_call("zone_utilisation") for _ in range(6)]
    script = [_resp(*many), _resp(_text("done"))]
    out = assistant.ask(None, 1, "q", [], "vi", gemini_generate=lambda *a: (script.pop(0), "m"))
    assert out["answer"] == "done"
    assert len(fake_tools) == assistant.MAX_CALLS_PER_ROUND


@pytest.mark.parametrize("resp", [
    _resp(_text("x"), finish="SAFETY"),
    _resp(),                                   # no text, no calls
    types.GenerateContentResponse(candidates=[]),
    _resp(_text("truncated ans"), finish="MAX_TOKENS"),
])
def test_assistant_bad_endings_raise(resp, fake_tools):
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "q", [], "vi", gemini_generate=lambda *a: (resp, "m"))


def test_assistant_deadline(fake_tools):
    ticks = iter([0.0, 1000.0])
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "q", [], "vi", gemini_generate=lambda *a: (None, "m"),
                      now=lambda: next(ticks))


def test_assistant_sdk_error_is_unavailable(monkeypatch, fake_tools):
    _install(monkeypatch, _FakeModels(error=ConnectionError("reset")))
    with pytest.raises(AIUnavailable):
        assistant.ask(None, 1, "q", [], "vi")


# ---- fallback model / thinking config ---------------------------------------------
def _api_error(code, status):
    from google.genai import errors

    return errors.APIError(code, {"error": {"code": code, "message": "m", "status": status}})


def test_thinking_and_fallback_settings(monkeypatch):
    assert gemini.thinking_level() == "low"
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "none")
    assert gemini.thinking_level() is None
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "MINIMAL")
    assert gemini.thinking_level() == "minimal"
    assert gemini.fallback_model_name() == "gemini-3.1-flash-lite"
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "off")
    assert gemini.fallback_model_name() is None
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", gemini.DEFAULT_MODEL)
    assert gemini.fallback_model_name() is None          # same as primary: pointless


@pytest.mark.parametrize("code,status", [(503, "UNAVAILABLE"), (429, "RESOURCE_EXHAUSTED")])
def test_overloaded_primary_falls_back_once(monkeypatch, code, status):
    models = _FakeModels([_api_error(code, status), _resp(_text('{"ok": 1}'))])
    _install(monkeypatch, models)
    parsed, usage = gemini.generate_json("s", "u", {})
    assert parsed == {"ok": 1} and usage["model"] == "gemini-3.1-flash-lite"
    assert [r["model"] for r in models.requests] == [gemini.DEFAULT_MODEL, "gemini-3.1-flash-lite"]
    assert models.requests[0]["config"].thinking_config.thinking_level == types.ThinkingLevel.LOW


def test_fallback_not_used_for_other_errors_or_twice(monkeypatch):
    models = _FakeModels([_api_error(400, "INVALID_ARGUMENT")])
    _install(monkeypatch, models)
    with pytest.raises(AIUnavailable):
        gemini.generate_json("s", "u", {})
    assert len(models.requests) == 1
    models = _FakeModels([_api_error(503, "UNAVAILABLE"), _api_error(503, "UNAVAILABLE")])
    _install(monkeypatch, models)
    with pytest.raises(AIUnavailable):
        gemini.generate_json("s", "u", {})
    assert len(models.requests) == 2
    monkeypatch.setenv("GEMINI_FALLBACK_MODEL", "none")
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "none")
    models = _FakeModels([_api_error(503, "UNAVAILABLE")])
    _install(monkeypatch, models)
    with pytest.raises(AIUnavailable):
        gemini.generate_json("s", "u", {})
    assert len(models.requests) == 1 and models.requests[0]["config"].thinking_config is None


def test_assistant_usage_reports_fallback_model(monkeypatch, fake_tools):
    models = _FakeModels([_api_error(503, "UNAVAILABLE"), _resp(_text("ok"))])
    _install(monkeypatch, models)
    out = assistant.ask(None, 1, "q", [], "vi")
    assert out["answer"] == "ok" and out["usage"]["model"] == "gemini-3.1-flash-lite"
