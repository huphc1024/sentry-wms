"""DB-backed route tests for /api/admin/ai/* (AI suggestions, phase 1).

Run in rules mode: conftest removes ANTHROPIC_API_KEY. LLM-mode tests patch
services.ai.client.call_claude. Pure logic lives in tests_unit/test_ai_pure.py.
"""

import bcrypt

from db_test_context import get_raw_connection


def _one(sql, params=None):
    cur = get_raw_connection().cursor()
    cur.execute(sql, params or ())
    row = cur.fetchone()
    cur.close()
    return row[0] if row else None


def _exec(sql, params=None):
    cur = get_raw_connection().cursor()
    cur.execute(sql, params or ())
    cur.close()


def _user_with_pages(client, pages, warehouse_ids=(1,), username="aiuser1"):
    pw = bcrypt.hashpw(b"aiuser123", bcrypt.gensalt()).decode("utf-8")
    cur = get_raw_connection().cursor()
    cur.execute(
        "INSERT INTO users (username, password_hash, full_name, role, warehouse_id, "
        "warehouse_ids, external_id) VALUES (%s, %s, 'AI User', 'USER', %s, %s, gen_random_uuid()) "
        "RETURNING user_id",
        (username, pw, warehouse_ids[0], list(warehouse_ids)),
    )
    uid = cur.fetchone()[0]
    for p in pages:
        cur.execute("INSERT INTO user_page_permissions (user_id, page_key) VALUES (%s, %s)", (uid, p))
    cur.close()
    resp = client.post("/api/auth/login", json={"username": username, "password": "aiuser123"})
    return uid, {"Authorization": f"Bearer {resp.get_json()['token']}"}


def _make_count(warehouse_id=1, bin_id=3, counted=2, expected=10):
    """A cycle count with one counted line that has a variance."""
    count_id = _one(
        "INSERT INTO cycle_counts (warehouse_id, bin_id, status, external_id) "
        "VALUES (%s, %s, 'VARIANCE', gen_random_uuid()) RETURNING count_id",
        (warehouse_id, bin_id),
    )
    item_id = _one("SELECT item_id FROM items ORDER BY item_id LIMIT 1")
    _exec(
        "INSERT INTO cycle_count_lines (count_id, item_id, expected_quantity, counted_quantity) "
        "VALUES (%s, %s, %s, %s)",
        (count_id, item_id, expected, counted),
    )
    return count_id


def _set_setting(key, value):
    _exec("INSERT INTO app_settings (key, value) VALUES (%s, %s)", (key, value))


def _audit_rows():
    return _one("SELECT COUNT(*) FROM audit_log WHERE action_type = 'AI_SUGGESTION'")


class TestAIStatus:
    def test_status_rules_mode_without_key(self, client, auth_headers):
        resp = client.get("/api/admin/ai/status", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json() == {"enabled": True, "mode": "rules", "provider": "claude"}

    def test_status_flag_off(self, client, auth_headers):
        _set_setting("ai_suggestions_enabled", "false")
        assert client.get("/api/admin/ai/status", headers=auth_headers).get_json()["enabled"] is False

    def test_status_requires_auth(self, client):
        assert client.get("/api/admin/ai/status").status_code == 401


class TestAIPermissions:
    def test_403_without_page_permission(self, client):
        _, headers = _user_with_pages(client, ["bins"])
        for path, body in (
            ("replenishment", {"warehouse_id": 1, "lang": "en"}),
            ("expiry-actions", {"warehouse_id": 1, "lang": "en"}),
            ("cycle-count-review", {"count_id": 1, "lang": "en"}),
        ):
            resp = client.post(f"/api/admin/ai/{path}", json=body, headers=headers)
            assert resp.status_code == 403
            assert resp.get_json()["error"] == "Permission denied"

    def test_403_other_warehouse(self, client):
        _, headers = _user_with_pages(client, ["inventory"], warehouse_ids=(1,))
        resp = client.post("/api/admin/ai/replenishment",
                           json={"warehouse_id": 2, "lang": "en"}, headers=headers)
        assert resp.status_code == 403

    def test_cycle_count_out_of_scope_is_404(self, client):
        count_id = _make_count(warehouse_id=1)
        _, headers = _user_with_pages(client, ["cycle-counts"], warehouse_ids=(2,))
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": count_id, "lang": "en"}, headers=headers)
        assert resp.status_code == 404


class TestAIRoutes:
    def test_replenishment_shape(self, client, auth_headers):
        resp = client.post("/api/admin/ai/replenishment",
                           json={"warehouse_id": 1, "lang": "vi"}, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["mode"] == "rules" and data["kind"] == "replenish"
        assert isinstance(data["suggestions"], list) and len(data["suggestions"]) <= 20
        assert data["generated_at"]

    def test_expiry_actions_ok(self, client, auth_headers):
        resp = client.post("/api/admin/ai/expiry-actions",
                           json={"warehouse_id": 1, "lang": "en", "days": 60}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()["kind"] == "expiry"

    def test_cycle_count_review_unknown_count_404(self, client, auth_headers):
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": 999999, "lang": "en"}, headers=auth_headers)
        assert resp.status_code == 404

    def test_cycle_count_review_lists_variance(self, client, auth_headers):
        count_id = _make_count()
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": count_id, "lang": "en"}, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["kind"] == "cycle_count" and len(data["suggestions"]) == 1
        assert data["suggestions"][0]["action"] == "recount"

    def test_bad_body_400(self, client, auth_headers):
        resp = client.post("/api/admin/ai/replenishment",
                           json={"warehouse_id": "x", "lang": "fr"}, headers=auth_headers)
        assert resp.status_code == 400

    def test_503_when_flag_off(self, client, auth_headers):
        _set_setting("ai_suggestions_enabled", "false")
        resp = client.post("/api/admin/ai/replenishment",
                           json={"warehouse_id": 1, "lang": "en"}, headers=auth_headers)
        assert resp.status_code == 503
        assert resp.get_json() == {"error": "ai_disabled"}

    def test_503_when_daily_cap_reached(self, client, auth_headers):
        _set_setting("ai_daily_call_limit", "1")
        body = {"warehouse_id": 1, "lang": "en"}
        assert client.post("/api/admin/ai/replenishment", json=body, headers=auth_headers).status_code == 200
        resp = client.post("/api/admin/ai/replenishment", json=body, headers=auth_headers)
        assert resp.status_code == 503

    def test_audit_row_written_without_prompt_or_pii(self, client, auth_headers):
        before = _audit_rows()
        client.post("/api/admin/ai/replenishment",
                    json={"warehouse_id": 1, "lang": "en"}, headers=auth_headers)
        assert _audit_rows() == before + 1
        details = _one("SELECT details FROM audit_log WHERE action_type = 'AI_SUGGESTION' "
                       "ORDER BY log_id DESC LIMIT 1")
        assert set(details) == {"feature", "mode", "model", "input_tokens",
                                "output_tokens", "suggestion_count"}
        assert details["feature"] == "replenish" and details["mode"] == "rules"

    def test_llm_mode_with_patched_client(self, client, auth_headers, monkeypatch):
        from services.ai import client as ai_client, guard

        monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
        monkeypatch.setattr(guard, "api_key_present", lambda: True)
        count_id = _make_count()

        def fake(system, user_text, schema, effort="low"):
            import json
            cid = json.loads(user_text)["candidates"][0]["id"]
            return ({"suggestions": [
                {"candidate_id": cid, "priority": "high", "action": "investigate",
                 "title": "T", "detail": "D"},
                {"candidate_id": "0000000000000000", "priority": "high", "action": "none",
                 "title": "ghost", "detail": "ghost"},
            ]}, {"model": "m", "input_tokens": 10, "output_tokens": 5})

        monkeypatch.setattr(ai_client, "call_claude", fake)
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": count_id, "lang": "en"}, headers=auth_headers)
        data = resp.get_json()
        assert resp.status_code == 200 and data["mode"] == "llm"
        assert [s["title"] for s in data["suggestions"]] == ["T"]
        assert _one("SELECT details->>'input_tokens' FROM audit_log "
                    "WHERE action_type = 'AI_SUGGESTION' ORDER BY log_id DESC LIMIT 1") == "10"


    def test_llm_mode_with_patched_gemini_client(self, client, auth_headers, monkeypatch):
        """AI_PROVIDER=gemini: same validation/merge, JSON text from a fake
        google-genai client, status reports the provider."""
        import json
        from google.genai import types
        from services.ai import gemini

        monkeypatch.setenv("AI_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
        status = client.get("/api/admin/ai/status", headers=auth_headers).get_json()
        assert status == {"enabled": True, "mode": "llm", "provider": "gemini"}
        count_id = _make_count()
        sent = []

        class Models:
            def generate_content(self, **kw):
                sent.append(kw)
                cid = json.loads(kw["contents"])["candidates"][0]["id"]
                body = {"suggestions": [
                    {"candidate_id": cid, "priority": "high", "action": "investigate",
                     "title": "G", "detail": "D"},
                    {"candidate_id": "0000000000000000", "priority": "high", "action": "none",
                     "title": "ghost", "detail": "ghost"}]}
                return types.GenerateContentResponse(
                    candidates=[types.Candidate(
                        content=types.Content(role="model", parts=[types.Part(text=json.dumps(body))]),
                        finish_reason="STOP")],
                    usage_metadata=types.GenerateContentResponseUsageMetadata(
                        prompt_token_count=11, candidates_token_count=4, thoughts_token_count=3))

        monkeypatch.setattr(gemini, "_get_client", lambda key: type("C", (), {"models": Models()}))
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": count_id, "lang": "en"}, headers=auth_headers)
        data = resp.get_json()
        assert resp.status_code == 200 and data["mode"] == "llm"
        assert [s["title"] for s in data["suggestions"]] == ["G"]
        assert sent[0]["config"].response_mime_type == "application/json"
        details = _one("SELECT details FROM audit_log WHERE action_type = 'AI_SUGGESTION' "
                       "ORDER BY log_id DESC LIMIT 1")
        assert details["model"] == gemini.DEFAULT_MODEL
        assert details["input_tokens"] == 11 and details["output_tokens"] == 7

    def test_gemini_error_falls_back_to_rules(self, client, auth_headers, monkeypatch):
        from services.ai import gemini

        monkeypatch.setenv("AI_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
        count_id = _make_count()

        class Models:
            def generate_content(self, **kw):
                raise TimeoutError("timed out")

        monkeypatch.setattr(gemini, "_get_client", lambda key: type("C", (), {"models": Models()}))
        resp = client.post("/api/admin/ai/cycle-count-review",
                           json={"count_id": count_id, "lang": "en"}, headers=auth_headers)
        assert resp.status_code == 200 and resp.get_json()["mode"] == "rules"


class TestAIFeedback:
    def test_feedback_ok(self, client, auth_headers):
        resp = client.post("/api/admin/ai/feedback", headers=auth_headers, json={
            "suggestion_id": "0123456789abcdef", "kind": "expiry", "mode": "rules",
            "rating": 1, "warehouse_id": 1})
        assert resp.status_code == 200 and resp.get_json() == {"ok": True}
        assert _one("SELECT rating FROM ai_suggestion_feedback WHERE suggestion_id = %s",
                    ("0123456789abcdef",)) == 1

    def test_feedback_bad_rating_400(self, client, auth_headers):
        resp = client.post("/api/admin/ai/feedback", headers=auth_headers, json={
            "suggestion_id": "x", "kind": "expiry", "mode": "rules", "rating": 5})
        assert resp.status_code == 400
