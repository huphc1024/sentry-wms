"""DB-backed route tests for /api/admin/ai/putaway and /api/admin/ai/backorders
(AI suggestions, phase 2). Rules mode unless call_claude is patched.
Pure planner/rules logic lives in tests_unit/test_ai_phase2_pure.py.
"""

import json

from test_ai_routes import _exec, _one, _set_setting, _user_with_pages


def _bin_id(code, warehouse_id=1):
    return _one("SELECT bin_id FROM bins WHERE bin_code = %s AND warehouse_id = %s", (code, warehouse_id))


def _item_id(sku):
    return _one("SELECT item_id FROM items WHERE sku = %s", (sku,))


def _stage(sku, qty, bin_code="RECV-01"):
    _exec(
        "INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand) VALUES (%s, %s, 1, %s)",
        (_item_id(sku), _bin_id(bin_code), qty),
    )


def _waiting_order(so_number, lines, warehouse_id=1, customer="Nguyen Van Secret"):
    so_id = _one(
        "INSERT INTO sales_orders (so_number, customer_name, customer_phone, customer_email, "
        "customer_address, status, warehouse_id, backorder_opened_at, external_id) "
        "VALUES (%s, %s, '0912345678', 'secret@example.com', '1 Secret St', 'WAITING_STOCK', %s, "
        "NOW() - INTERVAL '3 days', gen_random_uuid()) RETURNING so_id",
        (so_number, customer, warehouse_id),
    )
    for n, (sku, qty) in enumerate(lines, start=1):
        _exec(
            "INSERT INTO sales_order_lines (so_id, item_id, quantity_ordered, line_number) "
            "VALUES (%s, %s, %s, %s)",
            (so_id, _item_id(sku), qty, n),
        )
    return so_id


def _open_po(po_number, sku, qty, expected="CURRENT_DATE + 2"):
    po_id = _one(
        "INSERT INTO purchase_orders (po_number, vendor_name, status, expected_date, warehouse_id, "
        f"external_id) VALUES (%s, 'Vendor', 'OPEN', {expected}, 1, gen_random_uuid()) RETURNING po_id",
        (po_number,),
    )
    _exec(
        "INSERT INTO purchase_order_lines (po_id, item_id, quantity_ordered, line_number) "
        "VALUES (%s, %s, %s, 1)",
        (po_id, _item_id(sku), qty),
    )


def _close_seed_pos():
    _exec("UPDATE purchase_orders SET status = 'CLOSED'")


def _other_warehouse_stock(sku, qty):
    zone_id = _one(
        "INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type) "
        "VALUES (2, 'VZ', 'Virtual', 'STORAGE') RETURNING zone_id"
    )
    bin_id = _one(
        "INSERT INTO bins (zone_id, warehouse_id, bin_code, bin_barcode, bin_type, external_id) "
        "VALUES (%s, 2, 'V-01', 'V-01', 'Pickable', gen_random_uuid()) RETURNING bin_id",
        (zone_id,),
    )
    _exec(
        "INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand) VALUES (%s, %s, 2, %s)",
        (_item_id(sku), bin_id, qty),
    )


def _post(client, headers, path, wid=1, lang="en"):
    return client.post(f"/api/admin/ai/{path}", json={"warehouse_id": wid, "lang": lang}, headers=headers)


class TestAIPutaway:
    def test_empty_when_nothing_staged(self, client, auth_headers):
        resp = _post(client, auth_headers, "putaway")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["kind"] == "putaway" and data["mode"] == "rules" and data["suggestions"] == []

    def test_prefers_bin_already_holding_item(self, client, auth_headers):
        _stage("TST-001", 7)          # seed: TST-001 lives in A-01-01 (PICKING)
        data = _post(client, auth_headers, "putaway").get_json()
        assert len(data["suggestions"]) == 1
        s = data["suggestions"][0]
        assert s["sku"] == "TST-001" and s["action"] == "put_away"
        assert s["bin_code"] == "A-01-01" and s["source_bin"] == "RECV-01" and s["quantity"] == 7
        # every destination (chosen + alternatives) is a real bin in an eligible zone
        codes = [s["bin_code"], *s["alternatives"]]
        for code in codes:
            zt = _one("SELECT z.zone_type FROM bins b JOIN zones z ON z.zone_id = b.zone_id "
                      "WHERE b.bin_code = %s AND b.warehouse_id = 1", (code,))
            assert zt in ("PICKING", "STORAGE")
        assert "RECV-02" not in codes and "SHIP-01" not in codes

    def test_new_item_goes_to_empty_bin(self, client, auth_headers):
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-020"),))
        _exec("UPDATE items SET default_bin_id = NULL WHERE sku = 'TST-020'")
        _exec("DELETE FROM inventory WHERE bin_id = %s", (_bin_id("BULK-02"),))
        _stage("TST-020", 4)
        s = _post(client, auth_headers, "putaway", lang="vi").get_json()["suggestions"][0]
        empty = _one("SELECT COUNT(*) FROM inventory WHERE bin_id = %s AND quantity_on_hand > 0",
                     (_bin_id(s["bin_code"]),))
        assert empty == 0 and s["action"] == "put_away"
        assert s["title"].startswith("Cất")

    def test_permissions(self, client):
        _, headers = _user_with_pages(client, ["backorders"], username="aiput1")
        assert _post(client, headers, "putaway").status_code == 403
        _, headers = _user_with_pages(client, ["putaway"], warehouse_ids=(1,), username="aiput2")
        assert _post(client, headers, "putaway").status_code == 200
        assert _post(client, headers, "putaway", wid=2).status_code == 403

    def test_audit_and_flag(self, client, auth_headers):
        _post(client, auth_headers, "putaway")
        assert _one("SELECT details->>'feature' FROM audit_log WHERE action_type = 'AI_SUGGESTION' "
                    "ORDER BY log_id DESC LIMIT 1") == "putaway"
        _set_setting("ai_suggestions_enabled", "false")
        assert _post(client, auth_headers, "putaway").status_code == 503

    def test_llm_cannot_invent_bins(self, client, auth_headers, monkeypatch):
        from services.ai import client as ai_client, guard

        monkeypatch.setattr(guard, "api_key_present", lambda: True)
        _stage("TST-001", 3)
        seen = {}

        def fake(system, user_text, schema, effort="low"):
            payload = json.loads(user_text)
            seen["payload"] = payload
            alt = [c for c in payload["candidates"] if c["option_rank"] == 1]
            pick = (alt or payload["candidates"])[0]
            return ({"suggestions": [
                {"candidate_id": "0000000000000000", "priority": "high", "action": "put_away",
                 "title": "ghost", "detail": "ghost"},
                {"candidate_id": pick["id"], "priority": "high", "action": "put_away",
                 "title": "LLM pick", "detail": "because"},
            ]}, {"model": "m", "input_tokens": 3, "output_tokens": 4})

        monkeypatch.setattr(ai_client, "call_claude", fake)
        data = _post(client, auth_headers, "putaway").get_json()
        assert data["mode"] == "llm" and [s["title"] for s in data["suggestions"]] == ["LLM pick"]
        offered = {c["bin_code"] for c in seen["payload"]["candidates"]}
        assert data["suggestions"][0]["bin_code"] in offered


class TestAIBackorders:
    def test_empty(self, client, auth_headers):
        data = _post(client, auth_headers, "backorders").get_json()
        assert data["kind"] == "backorder" and data["suggestions"] == []

    def test_actions_from_our_facts(self, client, auth_headers):
        # Seed stock: TST-001 has 50 in warehouse 1. Seed POs cover every item; close them.
        _close_seed_pos()
        _waiting_order("SO-AI-REL", [("TST-001", 5)])
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-002"),))
        _waiting_order("SO-AI-PO", [("TST-002", 4)])
        _open_po("PO-AI-1", "TST-002", 10)
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-003"),))
        _waiting_order("SO-AI-NEW", [("TST-003", 2)])
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-004"),))
        _waiting_order("SO-AI-TO", [("TST-004", 3)])
        _other_warehouse_stock("TST-004", 9)

        resp = _post(client, auth_headers, "backorders")
        assert resp.status_code == 200
        by_so = {s["so_number"]: s for s in resp.get_json()["suggestions"]}
        assert by_so["SO-AI-REL"]["action"] == "release"
        assert by_so["SO-AI-PO"]["action"] == "wait_po" and by_so["SO-AI-PO"]["quantity"] == 4
        assert by_so["SO-AI-PO"]["due_date"]
        assert by_so["SO-AI-NEW"]["action"] == "create_po"
        assert by_so["SO-AI-TO"]["action"] == "transfer"
        assert by_so["SO-AI-TO"]["source_warehouse"] == "VIRTUAL"
        body = resp.get_data(as_text=True)
        for secret in ("Nguyen Van Secret", "0912345678", "secret@example.com", "Secret St"):
            assert secret not in body

    def test_other_warehouse_hidden_without_access(self, client):
        _close_seed_pos()
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-004"),))
        _waiting_order("SO-AI-SC", [("TST-004", 3)])
        _other_warehouse_stock("TST-004", 9)
        _, headers = _user_with_pages(client, ["backorders"], warehouse_ids=(1,), username="aibo1")
        s = _post(client, headers, "backorders").get_json()["suggestions"][0]
        assert s["action"] == "create_po" and s["source_warehouse"] is None

    def test_permissions(self, client):
        _, headers = _user_with_pages(client, ["putaway"], username="aibo2")
        assert _post(client, headers, "backorders").status_code == 403

    def test_llm_payload_has_no_customer_data(self, client, auth_headers, monkeypatch):
        from services.ai import client as ai_client, guard, redaction

        monkeypatch.setattr(guard, "api_key_present", lambda: True)
        _close_seed_pos()
        _exec("UPDATE inventory SET quantity_on_hand = 0 WHERE item_id = %s", (_item_id("TST-003"),))
        _waiting_order("SO-AI-LLM", [("TST-003", 2)])
        sent = []

        def fake(system, user_text, schema, effort="low"):
            sent.append(user_text)
            cid = json.loads(user_text)["candidates"][0]["id"]
            return ({"suggestions": [{"candidate_id": cid, "priority": "medium",
                                      "action": "transfer", "title": "T", "detail": "D"}]},
                    {"model": "m", "input_tokens": 1, "output_tokens": 1})

        monkeypatch.setattr(ai_client, "call_claude", fake)
        data = _post(client, auth_headers, "backorders").get_json()
        assert data["mode"] == "llm"
        s = data["suggestions"][0]
        assert s["action"] == "create_po"        # transfer was not feasible: rules action kept
        assert "Nguyen" not in sent[0] and "0912345678" not in sent[0] and "@" not in sent[0]
        redaction.assert_no_pii(json.loads(sent[0]))


class TestAIFeedbackPhase2:
    def test_feedback_accepts_new_kinds(self, client, auth_headers):
        for kind in ("putaway", "backorder"):
            resp = client.post("/api/admin/ai/feedback", headers=auth_headers, json={
                "suggestion_id": f"{kind}-0123456789", "kind": kind, "mode": "rules", "rating": -1})
            assert resp.status_code == 200
