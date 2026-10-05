"""DB-backed route tests for POST /api/admin/ai/ask (AI assistant, phase 3).

Quick mode runs without a key. LLM-mode tests patch the Anthropic client
(services.ai.client._get_client) with a fake that answers one tool_use round
and then end_turn, so the real loop, tools and SQL run.
"""

import json
from types import SimpleNamespace as NS

import pytest

from test_ai_routes import _exec, _one, _set_setting, _user_with_pages
from test_ai_routes_phase2 import _waiting_order

from services.ai import assistant_tools

ASK = "/api/admin/ai/ask"


def _assistant_audit():
    return _one("SELECT details FROM audit_log WHERE action_type = 'AI_ASSISTANT' "
                "ORDER BY log_id DESC LIMIT 1")


def _resp(stop, *blocks):
    return NS(stop_reason=stop, content=list(blocks),
              usage=NS(input_tokens=100, output_tokens=20))


class _FakeClient:
    """Stands in for anthropic.Anthropic(): first a tool_use, then end_turn."""

    def __init__(self, tool="waiting_stock_orders", tool_input=None, error=None):
        self.requests = []
        self.tool, self.tool_input, self.error = tool, tool_input or {}, error
        self.messages = self

    def create(self, **kw):
        self.requests.append(json.loads(json.dumps(kw, default=lambda o: o.__dict__)))
        if self.error:
            raise self.error
        if len(self.requests) == 1:
            return _resp("tool_use", NS(type="text", text="Checking."),
                         NS(type="tool_use", id="tu_1", name=self.tool, input=self.tool_input))
        return _resp("end_turn", NS(type="text", text="**SO-AI-1** has waited longest."))


@pytest.fixture
def llm(monkeypatch):
    from services.ai import client as ai_client, guard

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    monkeypatch.setattr(guard, "api_key_present", lambda: True)

    def install(**kw):
        fake = _FakeClient(**kw)
        monkeypatch.setattr(ai_client, "_get_client", lambda key: fake)
        return fake

    return install


class TestQuickMode:
    @pytest.mark.parametrize("tool", assistant_tools.TOOL_NAMES)
    def test_every_quick_tool_runs(self, client, auth_headers, tool):
        if tool == "item_stock_lookup":
            pytest.skip("needs a query; covered by the LLM test below")
        resp = client.post(ASK, json={"warehouse_id": 1, "quick": tool, "lang": "en"},
                           headers=auth_headers)
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()
        assert data["mode"] == "quick" and data["answer"] is None
        assert data["tools_used"] == [tool]
        table = data["data"][0]
        assert table["tool"] == tool and len(table["rows"]) <= assistant_tools.MAX_ROWS
        fields = set(assistant_tools.TOOLS[tool]["fields"])
        assert all(set(r) == fields for r in table["rows"])

    def test_quick_works_with_flag_off_and_is_audited_without_text(self, client, auth_headers):
        _set_setting("ai_suggestions_enabled", "false")
        resp = client.post(ASK, json={"warehouse_id": 1, "quick": "zone_utilisation"},
                           headers=auth_headers)
        assert resp.status_code == 200
        rows = resp.get_json()["data"][0]["rows"]
        assert rows and rows[0]["occupancy_pct"] >= rows[-1]["occupancy_pct"]
        d = _assistant_audit()
        assert d["mode"] == "quick" and d["quick"] == "zone_utilisation"
        assert d["question_length"] == 0

    def test_waiting_orders_never_expose_customer(self, client, auth_headers):
        _waiting_order("SO-AI-1", [("TST-001", 5)])
        resp = client.post(ASK, json={"warehouse_id": 1, "quick": "waiting_stock_orders"},
                           headers=auth_headers)
        body = json.dumps(resp.get_json())
        assert "SO-AI-1" in body
        for secret in ("Nguyen Van Secret", "0912345678", "secret@example.com", "Secret St"):
            assert secret not in body

    def test_free_text_without_llm_is_friendly_503(self, client, auth_headers):
        resp = client.post(ASK, json={"warehouse_id": 1, "question": "zone nào đang đầy?"},
                           headers=auth_headers)
        assert resp.status_code == 503
        assert resp.get_json() == {"error": "ai_llm_unavailable", "mode": "quick"}

    @pytest.mark.parametrize("body", [
        {"warehouse_id": 1},
        {"warehouse_id": 1, "question": "x", "quick": "zone_utilisation"},
        {"warehouse_id": 1, "question": "   "},
    ])
    def test_needs_exactly_one_of_question_or_quick(self, client, auth_headers, body):
        resp = client.post(ASK, json=body, headers=auth_headers)
        assert resp.status_code == 400

    def test_unknown_quick_tool_400(self, client, auth_headers):
        resp = client.post(ASK, json={"warehouse_id": 1, "quick": "run_sql"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_permissions(self, client):
        _, headers = _user_with_pages(client, ["inventory"], username="aiask1")
        body = {"warehouse_id": 1, "quick": "low_stock_items"}
        assert client.post(ASK, json=body, headers=headers).status_code == 403
        _, headers = _user_with_pages(client, ["ai-assistant"], username="aiask2")
        assert client.post(ASK, json=body, headers=headers).status_code == 200
        body["warehouse_id"] = 2
        assert client.post(ASK, json=body, headers=headers).status_code == 403


class TestLLMMode:
    def test_tool_round_then_answer(self, client, auth_headers, llm):
        _waiting_order("SO-AI-1", [("TST-001", 5)])
        fake = llm()
        resp = client.post(ASK, headers=auth_headers, json={
            "warehouse_id": 1, "lang": "vi", "question": "đơn nào chờ hàng lâu nhất? gọi 0987654321",
            "history": [{"role": "user", "text": "xin chào"},
                        {"role": "assistant", "text": "Chào bạn"}],
        })
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()
        assert data["mode"] == "llm" and "SO-AI-1" in data["answer"]
        assert data["tools_used"] == ["waiting_stock_orders"]
        assert data["data"][0]["rows"][0]["so_number"] == "SO-AI-1"

        assert len(fake.requests) == 2
        first, second = fake.requests
        assert first["output_config"] == {"effort": "low"}
        assert first["max_tokens"] <= 2000
        assert [m["role"] for m in first["messages"]] == ["user", "assistant", "user"]
        assert "0987654321" not in json.dumps(first)          # phone scrubbed from question
        sent = json.dumps(second, ensure_ascii=False)
        assert "SO-AI-1" in sent and "Nguyen Van Secret" not in sent and "0912345678" not in sent
        assert second["messages"][-1]["content"][0]["tool_use_id"] == "tu_1"

        d = _assistant_audit()
        assert d["mode"] == "llm" and d["outcome"] == "ok"
        assert d["tools_used"] == ["waiting_stock_orders"] and d["input_tokens"] == 200
        assert d["question_length"] > 0 and "question" not in d
        raw = _one("SELECT details::text FROM audit_log WHERE action_type = 'AI_ASSISTANT' "
                   "ORDER BY log_id DESC LIMIT 1")
        assert "chờ hàng" not in raw

    def test_item_lookup_tool_scoped_to_warehouse(self, client, auth_headers, llm):
        fake = llm(tool="item_stock_lookup", tool_input={"query": "TST-001"})
        resp = client.post(ASK, headers=auth_headers,
                           json={"warehouse_id": 1, "question": "TST-001 còn bao nhiêu?"})
        assert resp.status_code == 200
        rows = resp.get_json()["data"][0]["rows"]
        assert rows and rows[0]["sku"] == "TST-001"
        assert len(fake.requests) == 2

    def test_sdk_error_is_graceful(self, client, auth_headers, llm):
        llm(error=TimeoutError("boom"))
        resp = client.post(ASK, headers=auth_headers,
                           json={"warehouse_id": 1, "question": "PO nào sắp về?"})
        assert resp.status_code == 503
        assert resp.get_json() == {"error": "ai_llm_failed", "mode": "llm"}
        d = _assistant_audit()
        assert d["mode"] == "llm" and d["outcome"] == "error"

    def test_llm_calls_count_towards_cap_quick_does_not(self, client, auth_headers, llm):
        llm()
        _set_setting("ai_daily_call_limit", "1")
        quick = {"warehouse_id": 1, "quick": "zone_utilisation"}
        ask = {"warehouse_id": 1, "question": "zone nào đang đầy?"}
        assert client.post(ASK, json=quick, headers=auth_headers).status_code == 200
        assert client.post(ASK, json=ask, headers=auth_headers).status_code == 200
        resp = client.post(ASK, json=ask, headers=auth_headers)
        assert resp.status_code == 503 and resp.get_json()["error"] == "ai_llm_unavailable"
        assert client.post(ASK, json=quick, headers=auth_headers).status_code == 200


class _FakeGeminiModels:
    """Stands in for genai.Client().models: one function_call round, then text."""

    def __init__(self, tool="waiting_stock_orders", args=None, error=None):
        self.requests = []
        self.tool, self.args, self.error = tool, args or {}, error

    def generate_content(self, **kw):
        from google.genai import types

        self.requests.append({**kw, "contents": list(kw["contents"])})
        if self.error:
            raise self.error
        if len(self.requests) == 1:
            parts = [types.Part(function_call=types.FunctionCall(
                name=self.tool, args=self.args, id="fc_1"))]
        else:
            parts = [types.Part(text="**SO-AI-1** has waited longest.")]
        return types.GenerateContentResponse(
            candidates=[types.Candidate(content=types.Content(role="model", parts=parts),
                                        finish_reason="STOP")],
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=100, candidates_token_count=20))


@pytest.fixture
def gemini_llm(monkeypatch):
    from services.ai import gemini

    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")

    def install(**kw):
        fake = _FakeGeminiModels(**kw)
        monkeypatch.setattr(gemini, "_get_client", lambda key: type("C", (), {"models": fake}))
        return fake

    return install


class TestGeminiMode:
    def test_function_call_round_then_answer(self, client, auth_headers, gemini_llm):
        from services.ai import gemini

        _waiting_order("SO-AI-1", [("TST-001", 5)])
        fake = gemini_llm()
        resp = client.post(ASK, headers=auth_headers, json={
            "warehouse_id": 1, "lang": "vi", "question": "đơn nào chờ hàng lâu nhất? gọi 0987654321",
            "history": [{"role": "user", "text": "xin chào"},
                        {"role": "assistant", "text": "Chào bạn"}],
        })
        assert resp.status_code == 200, resp.get_json()
        data = resp.get_json()
        assert data["mode"] == "llm" and "SO-AI-1" in data["answer"]
        assert data["tools_used"] == ["waiting_stock_orders"]
        assert data["data"][0]["rows"][0]["so_number"] == "SO-AI-1"

        assert len(fake.requests) == 2
        first, second = fake.requests
        assert first["config"].automatic_function_calling.disable is True
        assert [c["role"] for c in first["contents"]] == ["user", "model", "user"]
        assert "0987654321" not in json.dumps(first["contents"], ensure_ascii=False)
        last = second["contents"][-1]
        fr = last["parts"][0]["function_response"]
        assert last["role"] == "user" and fr["id"] == "fc_1" and fr["name"] == "waiting_stock_orders"
        sent = json.dumps(fr, ensure_ascii=False)
        assert "SO-AI-1" in sent and "Nguyen Van Secret" not in sent and "0912345678" not in sent

        d = _assistant_audit()
        assert d["mode"] == "llm" and d["outcome"] == "ok"
        assert d["model"] == gemini.DEFAULT_MODEL and d["input_tokens"] == 200

    def test_sdk_error_is_graceful(self, client, auth_headers, gemini_llm):
        gemini_llm(error=TimeoutError("boom"))
        resp = client.post(ASK, headers=auth_headers,
                           json={"warehouse_id": 1, "question": "PO nào sắp về?"})
        assert resp.status_code == 503
        assert resp.get_json() == {"error": "ai_llm_failed", "mode": "llm"}

    def test_no_gemini_key_means_quick_only(self, client, auth_headers, monkeypatch):
        monkeypatch.setenv("AI_PROVIDER", "gemini")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")   # wrong provider's key
        monkeypatch.setenv("GEMINI_API_KEY", "")
        from services.ai import gemini

        def no_network(key):
            raise AssertionError("Gemini must not be called without GEMINI_API_KEY")

        monkeypatch.setattr(gemini, "_get_client", no_network)
        resp = client.post(ASK, json={"warehouse_id": 1, "question": "zone nào đang đầy?"},
                           headers=auth_headers)
        assert resp.status_code == 503 and resp.get_json()["error"] == "ai_llm_unavailable"
