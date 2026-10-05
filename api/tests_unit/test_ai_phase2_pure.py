"""Pure tests for AI suggestions phase 2: put-away and backorder kinds."""

import json

import pytest

from services.ai import client as ai_client, planning, redaction, rules, suggestions


# ---- put-away fixtures ------------------------------------------------------
def pa_line(inv_id=1, item_id=10, sku="P1", qty=5, src="RECV-01", src_type="Staging", **kw):
    row = {"inventory_id": inv_id, "item_id": item_id, "sku": sku, "item_name": f"Item {sku}",
           "quantity": qty, "source_bin": src, "source_bin_id": 900, "source_bin_type": src_type,
           "lot_number": None, "expiry_date": None, "unit_weight": None, "unit_volume": None,
           "backorder_qty": 0}
    row.update(kw)
    return row


def pa_bin(bin_id, code, zone_type="PICKING", zone_id=2, total=0, seq=0, **kw):
    row = {"bin_id": bin_id, "bin_code": code, "zone_id": zone_id, "zone_code": f"Z{zone_id}",
           "zone_type": zone_type, "putaway_sequence": seq, "max_weight_lbs": None,
           "max_volume_cuft": None, "used_weight": 0.0, "used_volume": 0.0, "total_qty": total}
    row.update(kw)
    return row


def _top(rows):
    return {r["line_id"]: r for r in rows if r["option_rank"] == 0}


# ---- put-away planner -------------------------------------------------------
def test_putaway_prefers_bin_holding_same_item():
    bins = [pa_bin(1, "E-EMPTY", seq=1), pa_bin(2, "H-HOLD", total=7, seq=9), pa_bin(3, "O-OTHER", total=3)]
    rows = planning.plan_putaway([pa_line()], bins, {10: {2: 7}}, {})
    top = _top(rows)["1"]
    assert top["bin_code"] == "H-HOLD" and top["reason"] == "same_item" and top["item_qty_in_bin"] == 7
    codes = [r["bin_code"] for r in rows]
    assert "O-OTHER" not in codes                 # bins holding only other items are never offered
    assert top["alternatives"] == ["E-EMPTY"]


def test_putaway_empty_bins_in_right_zone_first_and_deterministic():
    bins = [
        pa_bin(1, "S-01", zone_type="STORAGE", zone_id=3, seq=1),
        pa_bin(2, "P-02", zone_type="PICKING", zone_id=2, seq=2),
        pa_bin(3, "P-01", zone_type="PICKING", zone_id=2, seq=2),
        pa_bin(4, "SHIP-01", zone_type="STAGING", zone_id=4),   # ineligible zone
        pa_bin(5, "S-HOLD", zone_type="STORAGE", zone_id=3, total=4),
    ]
    # Item already lives in zone 3 (S-HOLD) but that bin is full by weight.
    line = pa_line(qty=2, unit_weight=1.0)
    bins[4].update(max_weight_lbs=4.0, used_weight=4.0)
    rows = planning.plan_putaway([line], bins, {10: {5: 4}}, {})
    assert [r["bin_code"] for r in rows] == ["S-01", "P-01", "P-02"]
    assert rows[0]["reason"] == "empty"
    assert planning.plan_putaway([line], list(reversed(bins)), {10: {5: 4}}, {}) == rows


def test_putaway_preferred_and_capacity_ordering():
    bins = [pa_bin(1, "A", total=1), pa_bin(2, "B", total=1), pa_bin(3, "PREF")]
    bins[0].update(max_weight_lbs=3.0, used_weight=1.0)       # room for 2 < qty 5
    line = pa_line(qty=5, unit_weight=1.0)
    rows = planning.plan_putaway([line], bins, {10: {1: 1, 2: 1}}, {10: {3: 1}})
    assert [r["bin_code"] for r in rows] == ["PREF", "B", "A"]
    assert rows[0]["reason"] == "preferred"
    assert rows[2]["capacity_units"] == 2


def test_putaway_no_destination_and_empty_bin_not_shared_between_items():
    bins = [pa_bin(1, "E-1", seq=1), pa_bin(2, "E-2", seq=2)]
    lines = [pa_line(1, 10, "A"), pa_line(2, 11, "B"), pa_line(3, 12, "C")]
    tops = _top(planning.plan_putaway(lines, bins, {}, {}))
    assert tops["1"]["bin_code"] == "E-1" and tops["2"]["bin_code"] == "E-2"
    assert tops["3"]["bin_code"] is None and tops["3"]["reason"] == "none"
    assert planning.plan_putaway([], bins, {}, {}) == []


def test_capacity_units():
    b = pa_bin(1, "X", max_weight_lbs=10.0, used_weight=4.0, max_volume_cuft=1.0, used_volume=0.5)
    assert planning.capacity_units(b, 2.0, 0.1) == 3
    assert planning.capacity_units(b, None, None) is None
    assert planning.capacity_units(pa_bin(2, "Y"), 1.0, 1.0) is None
    assert planning.capacity_units(pa_bin(3, "Z", max_weight_lbs=1.0, used_weight=5.0), 1.0, None) == 0


# ---- put-away rules ---------------------------------------------------------
def test_putaway_rules_one_per_line_with_priorities():
    bins = [pa_bin(1, "E-1", seq=1), pa_bin(2, "E-2", seq=2), pa_bin(3, "E-3", seq=3)]
    lines = [
        pa_line(1, 10, "A", qty=3),
        pa_line(2, 11, "B", qty=3, backorder_qty=4),
        pa_line(3, 12, "C", qty=3, src_type="PickableStaging"),
    ]
    rows = planning.plan_putaway(lines, bins, {}, {})
    out = rules.build("putaway", rows, "en")
    assert [s["sku"] for s in out] == ["B", "A", "C"]
    assert [s["priority"] for s in out] == ["high", "medium", "low"]
    assert all(s["action"] == "put_away" for s in out)
    assert out[0]["source_bin"] == "RECV-01" and out[0]["bin_code"]
    assert "backorder" in out[0]["detail"]
    vi = rules.build("putaway", rows, "vi")
    assert vi[0]["title"] != out[0]["title"] and vi[0]["id"] == out[0]["id"]


def test_putaway_rules_no_destination_is_investigate():
    rows = planning.plan_putaway([pa_line()], [], {}, {})
    s = rules.build("putaway", rows, "en")[0]
    assert s["action"] == "investigate" and s["priority"] == "high" and s["bin_code"] is None


# ---- backorder planner ------------------------------------------------------
def bo(so, days=1, lines=((10, 5),), ship_by_days=None):
    return {"so_number": so, "days_waiting": days, "ship_by_date": None, "ship_by_days": ship_by_days,
            "lines": [{"item_id": i, "sku": f"S{i}", "item_name": f"Item {i}", "short_qty": q}
                      for i, q in lines]}


def _plan(orders, here=None, inbound=None, elsewhere=None):
    return {r["so_number"]: r for r in planning.plan_backorders(orders, here or {}, inbound or {}, elsewhere or {})}


def test_backorder_release_when_stock_here():
    r = _plan([bo("SO-1")], here={10: 5})["SO-1"]
    assert r["planned_action"] == "release" and r["feasible_actions"] == ["release"]


def test_backorder_wait_po_soon():
    r = _plan([bo("SO-1")], inbound={10: {"qty": 9, "expected_date": "2026-10-08", "eta_days": 3}})["SO-1"]
    assert r["planned_action"] == "wait_po" and r["open_po_qty"] == 5 and r["po_eta"] == "2026-10-08"


def test_backorder_transfer_beats_late_po():
    r = _plan(
        [bo("SO-1")],
        inbound={10: {"qty": 9, "expected_date": "2026-12-01", "eta_days": 57}},
        elsewhere={"WH-B": {10: 2}, "WH-C": {10: 8}},
    )["SO-1"]
    assert r["planned_action"] == "transfer" and r["transfer_from"] == "WH-C"
    assert set(r["feasible_actions"]) == {"wait_po", "transfer", "create_po"}


def test_backorder_partial_and_create_po():
    rows = _plan([bo("SO-P", lines=((10, 5), (11, 2))), bo("SO-C", lines=((12, 3),))], here={10: 2})
    assert rows["SO-P"]["planned_action"] == "partial_ship"
    assert rows["SO-P"]["available_here"] == 2 and rows["SO-P"]["missing_qty"] == 5
    assert rows["SO-C"]["planned_action"] == "create_po"


def test_backorder_oldest_order_claims_stock_first():
    rows = _plan([bo("SO-NEW", days=1), bo("SO-OLD", days=9)], here={10: 5})
    assert rows["SO-OLD"]["planned_action"] == "release"
    assert rows["SO-NEW"]["planned_action"] == "create_po"
    rows = _plan([bo("SO-NEW", days=1), bo("SO-OLD", days=9)], elsewhere={"WH-B": {10: 6}})
    assert rows["SO-OLD"]["planned_action"] == "transfer"
    assert rows["SO-NEW"]["planned_action"] == "create_po"     # transfer stock already claimed


def test_backorder_rules_priority_and_facts():
    rows = planning.plan_backorders(
        [bo("SO-1", days=2), bo("SO-2", days=20, lines=((11, 1),)), bo("SO-3", days=1, lines=((12, 4),))],
        {}, {10: {"qty": 5, "expected_date": "2026-10-06", "eta_days": 1},
             11: {"qty": 1, "expected_date": "2026-10-20", "eta_days": 15}}, {"WH-B": {12: 4}},
    )
    out = {s["so_number"]: s for s in rules.build("backorder", rows, "en")}
    assert out["SO-1"]["action"] == "wait_po" and out["SO-1"]["priority"] == "low"
    assert out["SO-1"]["due_date"] == "2026-10-06" and out["SO-1"]["quantity"] == 5
    assert out["SO-2"]["priority"] == "high"                  # waiting 20 days
    assert out["SO-3"]["action"] == "transfer" and out["SO-3"]["source_warehouse"] == "WH-B"
    assert out["SO-3"]["bin_code"] is None
    assert "WH-B" in out["SO-3"]["title"]


# ---- redaction --------------------------------------------------------------
def test_backorder_context_has_no_customer_fields():
    row = dict(planning.plan_backorders([bo("SO-1")], {}, {}, {})[0])
    row.update(id="x", customer_name="Bob", customer_phone="0912345678", ship_address="1 St",
               billing_address_line1="x", memo="m")
    row["lines"][0]["customer_email"] = "a@b.co"
    ctx = redaction.build_context("backorder", [row], "en")
    redaction.assert_no_pii(ctx)
    cand = ctx["candidates"][0]
    assert cand["so_number"] == "SO-1"
    assert not set(cand) & {"customer_name", "customer_phone", "ship_address", "memo",
                            "billing_address_line1"}
    assert set(cand["lines"][0]) <= set(redaction.BACKORDER_LINE_FIELDS)


def test_putaway_context_allow_list():
    row = dict(planning.plan_putaway([pa_line()], [pa_bin(1, "E-1")], {}, {})[0])
    row.update(id="x", notes="secret", lot_number="L1")
    cand = redaction.build_context("putaway", [row], "en")["candidates"][0]
    assert "notes" not in cand and "lot_number" not in cand and cand["bin_code"] == "E-1"


# ---- LLM merge --------------------------------------------------------------
def _fake(monkeypatch, result, calls=None):
    def fake(system, user_text, schema, effort="low"):
        if calls is not None:
            calls.append(json.loads(user_text))
        return result, {"model": "m", "input_tokens": 1, "output_tokens": 2}
    monkeypatch.setattr(ai_client, "call_claude", fake)


def test_putaway_llm_may_only_pick_computed_bins(monkeypatch):
    bins = [pa_bin(1, "E-1", seq=1), pa_bin(2, "E-2", seq=2)]
    rows = planning.plan_putaway([pa_line()], bins, {}, {})
    alt = next(r for r in rows if r["bin_code"] == "E-2")
    alt_id = rules.candidate_id("putaway", alt)
    calls = []
    _fake(monkeypatch, {"suggestions": [
        {"candidate_id": "ffffffffffffffff", "priority": "high", "action": "put_away",
         "title": "Use Z-99", "detail": "invented"},
        {"candidate_id": alt_id, "priority": "high", "action": "transfer", "title": "T", "detail": "D"},
        {"candidate_id": rules.candidate_id("putaway", rows[0]), "priority": "low",
         "action": "put_away", "title": "second for same line", "detail": "x"},
    ]}, calls)
    r = suggestions.generate("putaway", rows, "en", True)
    assert r["mode"] == "llm" and len(r["suggestions"]) == 1
    s = r["suggestions"][0]
    assert s["bin_code"] == "E-2" and s["action"] == "put_away" and s["alternatives"] == ["E-1"]
    sent = calls[0]["candidates"]
    assert {c["bin_code"] for c in sent} == {"E-1", "E-2"}
    assert all(c["allowed_actions"] == ["put_away"] for c in sent)
    redaction.assert_no_pii(calls[0])


def test_backorder_llm_action_limited_to_feasible(monkeypatch):
    rows = planning.plan_backorders(
        [bo("SO-1")], {}, {10: {"qty": 5, "expected_date": None, "eta_days": None}}, {"WH-B": {10: 9}})
    assert rows[0]["planned_action"] == "transfer"
    cid = rules.candidate_id("backorder", rows[0])
    _fake(monkeypatch, {"suggestions": [
        {"candidate_id": cid, "priority": "high", "action": "wait_po", "title": "Wait", "detail": "D"}]})
    s = suggestions.generate("backorder", rows, "en", True)["suggestions"][0]
    assert s["action"] == "wait_po" and s["source_warehouse"] is None and s["due_date"] is None
    _fake(monkeypatch, {"suggestions": [
        {"candidate_id": cid, "priority": "high", "action": "release", "title": "R", "detail": "D"}]})
    s = suggestions.generate("backorder", rows, "en", True)["suggestions"][0]
    assert s["action"] == "transfer" and s["source_warehouse"] == "WH-B"   # infeasible -> rules action


@pytest.mark.parametrize("kind", ["putaway", "backorder"])
def test_new_kinds_registered(kind):
    from services.ai import KINDS
    assert kind in KINDS and kind in rules.ALLOWED_ACTIONS
    assert set(rules.ALLOWED_ACTIONS[kind]) <= set(
        suggestions.OUTPUT_SCHEMA["properties"]["suggestions"]["items"]["properties"]["action"]["enum"])
