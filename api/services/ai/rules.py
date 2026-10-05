"""Deterministic (free) suggestions from candidate rows. Pure: no DB, no IO.

Candidate row shapes (plain dicts) are produced by services/ai/candidates.py.
Text is bilingual (vi/en); an unknown lang falls back to English.
"""

import hashlib

from services.ai import MAX_SUGGESTIONS

_RANK = {"high": 0, "medium": 1, "low": 2}

ALLOWED_ACTIONS = {
    "replenish": ("reorder", "none"),
    "expiry": ("ship_first", "discount", "dispose", "none"),
    "cycle_count": ("recount", "investigate", "none"),
    "putaway": ("put_away", "investigate"),
    "backorder": ("release", "wait_po", "transfer", "partial_ship", "create_po"),
}

# Kinds whose candidate rows are alternatives grouped under one decision
# (putaway: several destination bins per staged line). Only option 0 of a
# group is a rules-mode suggestion; the LLM may pick any one per group.
GROUPED_KINDS = frozenset({"putaway"})

_T = {
    "replenish_title": {
        "en": "Reorder {sku} ({item_name})",
        "vi": "Đặt thêm {sku} ({item_name})",
    },
    "replenish_detail": {
        "en": "Available {available}, reorder point {reorder_point}, backorder demand {backorder_qty}, inbound {inbound_qty}. Suggested order: {qty}.",
        "vi": "Khả dụng {available}, điểm đặt hàng {reorder_point}, nhu cầu chờ hàng {backorder_qty}, hàng sắp về {inbound_qty}. Đề xuất đặt: {qty}.",
    },
    "replenish_covered_title": {
        "en": "{sku} is low but inbound stock covers it",
        "vi": "{sku} thấp nhưng hàng sắp về đã đủ",
    },
    "expired_title": {
        "en": "Expired stock: {sku} in {bin_code}",
        "vi": "Hàng hết hạn: {sku} tại {bin_code}",
    },
    "expired_detail": {
        "en": "{quantity} units expired {days_abs} day(s) ago ({expiry_date}). Quarantine and dispose.",
        "vi": "{quantity} đơn vị đã hết hạn {days_abs} ngày trước ({expiry_date}). Cách ly và tiêu hủy.",
    },
    "expiry_title": {
        "en": "Ship {sku} from {bin_code} first",
        "vi": "Ưu tiên xuất {sku} từ {bin_code}",
    },
    "expiry_detail": {
        "en": "{quantity} units expire in {days_left} day(s) ({expiry_date}).",
        "vi": "{quantity} đơn vị hết hạn sau {days_left} ngày ({expiry_date}).",
    },
    "discount_title": {
        "en": "Consider a discount on {sku} in {bin_code}",
        "vi": "Cân nhắc giảm giá {sku} tại {bin_code}",
    },
    "unexpected_title": {
        "en": "Unexpected item {sku} found in {bin_code}",
        "vi": "Phát hiện hàng ngoài dự kiến {sku} tại {bin_code}",
    },
    "unexpected_detail": {
        "en": "Counted {counted} but nothing was expected. Find where it belongs.",
        "vi": "Đếm được {counted} nhưng không có trong dự kiến. Cần xác định vị trí đúng.",
    },
    "variance_title": {
        "en": "Recount {sku} in {bin_code}",
        "vi": "Đếm lại {sku} tại {bin_code}",
    },
    "variance_detail": {
        "en": "Expected {expected}, counted {counted} (variance {variance}).",
        "vi": "Dự kiến {expected}, đếm được {counted} (chênh lệch {variance}).",
    },
    "pending_title": {
        "en": "Review pending adjustment for {sku} in {bin_code}",
        "vi": "Xem xét điều chỉnh đang chờ duyệt cho {sku} tại {bin_code}",
    },
    "pending_detail": {
        "en": "Expected {expected}, counted {counted} (variance {variance}). An adjustment of {pending} is awaiting approval.",
        "vi": "Dự kiến {expected}, đếm được {counted} (chênh lệch {variance}). Điều chỉnh {pending} đang chờ duyệt.",
    },
    # ---- putaway ----
    "putaway_title": {
        "en": "Put {sku} away to {bin_code}",
        "vi": "Cất {sku} vào ô {bin_code}",
    },
    "putaway_same_item": {
        "en": "Move {quantity} unit(s) from {source_bin} to {bin_code} ({zone_code}), which already holds {item_qty_in_bin} of this item.",
        "vi": "Chuyển {quantity} đơn vị từ {source_bin} sang {bin_code} ({zone_code}), ô này đang chứa {item_qty_in_bin} đơn vị cùng mặt hàng.",
    },
    "putaway_preferred": {
        "en": "Move {quantity} unit(s) from {source_bin} to the item's preferred bin {bin_code} ({zone_code}).",
        "vi": "Chuyển {quantity} đơn vị từ {source_bin} sang ô ưu tiên của mặt hàng {bin_code} ({zone_code}).",
    },
    "putaway_empty": {
        "en": "Move {quantity} unit(s) from {source_bin} to empty bin {bin_code} ({zone_code}).",
        "vi": "Chuyển {quantity} đơn vị từ {source_bin} sang ô trống {bin_code} ({zone_code}).",
    },
    "putaway_capacity_note": {
        "en": " Room for about {capacity_units} unit(s); split the rest.",
        "vi": " Ô chỉ còn chỗ cho khoảng {capacity_units} đơn vị; phần còn lại cần chia sang ô khác.",
    },
    "putaway_backorder_note": {
        "en": " {backorder_qty} unit(s) of this item are on backorder.",
        "vi": " Mặt hàng này đang có {backorder_qty} đơn vị chờ hàng.",
    },
    "putaway_none_title": {
        "en": "No destination bin for {sku}",
        "vi": "Chưa có ô đích cho {sku}",
    },
    "putaway_none_detail": {
        "en": "{quantity} unit(s) in {source_bin}: no storage or picking bin with room was found. Check the bin setup.",
        "vi": "{quantity} đơn vị tại {source_bin}: không tìm thấy ô lưu trữ hoặc ô soạn hàng còn chỗ. Hãy kiểm tra cấu hình ô.",
    },
    # ---- backorder ----
    "bo_release_title": {
        "en": "{so_number}: stock is available, release it",
        "vi": "{so_number}: đã đủ hàng, có thể giải phóng đơn",
    },
    "bo_release_detail": {
        "en": "All {total_short} unit(s) are available in this warehouse now. Release the order for picking.",
        "vi": "Toàn bộ {total_short} đơn vị hiện đã có trong kho này. Hãy giải phóng đơn để soạn hàng.",
    },
    "bo_wait_title": {
        "en": "{so_number}: wait for the open PO",
        "vi": "{so_number}: chờ đơn mua hàng đang mở",
    },
    "bo_wait_detail": {
        "en": "{open_po_qty} of the {missing_qty} missing unit(s) are on open POs, expected {eta}.",
        "vi": "{open_po_qty} trên {missing_qty} đơn vị còn thiếu đã có trong đơn mua đang mở, dự kiến về {eta}.",
    },
    "bo_eta_unknown": {
        "en": "on an unknown date",
        "vi": "chưa rõ ngày",
    },
    "bo_transfer_title": {
        "en": "{so_number}: transfer stock from {transfer_from}",
        "vi": "{so_number}: điều chuyển hàng từ kho {transfer_from}",
    },
    "bo_transfer_detail": {
        "en": "Warehouse {transfer_from} has enough stock for the {missing_qty} missing unit(s). Create a transfer order.",
        "vi": "Kho {transfer_from} có đủ hàng cho {missing_qty} đơn vị còn thiếu. Hãy tạo lệnh điều chuyển.",
    },
    "bo_partial_title": {
        "en": "{so_number}: ship what is available",
        "vi": "{so_number}: giao trước phần đã có",
    },
    "bo_partial_detail": {
        "en": "{available_here} of {total_short} unit(s) are available here. Ship them and keep {missing_qty} on backorder.",
        "vi": "Kho này có {available_here} trên {total_short} đơn vị. Hãy giao phần này và giữ {missing_qty} đơn vị chờ hàng.",
    },
    "bo_create_po_title": {
        "en": "{so_number}: raise a purchase order",
        "vi": "{so_number}: cần tạo đơn mua hàng",
    },
    "bo_create_po_detail": {
        "en": "{missing_qty} unit(s) are missing with no open PO or other warehouse able to cover them.",
        "vi": "Thiếu {missing_qty} đơn vị và không có đơn mua đang mở hay kho khác đủ hàng để bù.",
    },
    "bo_waiting_note": {
        "en": " Waiting {days_waiting} day(s).",
        "vi": " Đã chờ {days_waiting} ngày.",
    },
}


def norm_lang(lang):
    return lang if lang in ("vi", "en") else "en"


def _t(key, lang, **kw):
    return _T[key][norm_lang(lang)].format(**kw)


def candidate_id(kind, row):
    """Stable 16-hex id from kind + the row's key fields."""
    if kind == "replenish":
        parts = (row.get("sku"),)
    elif kind == "putaway":
        parts = (row.get("line_id"), row.get("bin_code"))
    elif kind == "backorder":
        parts = (row.get("so_number"),)
    elif kind == "expiry":
        parts = (row.get("sku"), row.get("bin_code"), row.get("expiry_date"), row.get("lot_number"))
    else:
        parts = (row.get("sku"), row.get("bin_code"), row.get("count_id"))
    key = "|".join([kind] + ["" if p is None else str(p) for p in parts])
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _n(row, key):
    v = row.get(key)
    return 0 if v is None else v


def _replenish(row, lang):
    available = _n(row, "available")
    rp = _n(row, "reorder_point")
    rq = _n(row, "reorder_qty")
    backorder = _n(row, "backorder_qty")
    inbound = _n(row, "inbound_qty")
    if not ((rp > 0 and available <= rp) or backorder > 0):
        return None
    projected = available + inbound
    need = max(rp + backorder - projected, 0)
    qty = max(need, rq) if need > 0 else 0
    if need > 0:
        priority = "high" if (available <= 0 or backorder > projected) else "medium"
        action = "reorder"
        title = _t("replenish_title", lang, sku=row.get("sku"), item_name=row.get("item_name"))
    else:
        priority, action = "low", "none"
        title = _t("replenish_covered_title", lang, sku=row.get("sku"))
    detail = _t(
        "replenish_detail", lang, available=available, reorder_point=rp,
        backorder_qty=backorder, inbound_qty=inbound, qty=qty,
    )
    return {
        "priority": priority, "action": action, "title": title, "detail": detail,
        "quantity": qty or None, "due_date": None, "sort": available - backorder,
    }


def _expiry(row, lang):
    days = row.get("days_left")
    if days is None:
        return None
    kw = dict(
        sku=row.get("sku"), bin_code=row.get("bin_code"), quantity=row.get("quantity"),
        expiry_date=row.get("expiry_date"), days_left=days, days_abs=abs(days),
    )
    if days < 0:
        priority, action, tk, dk = "high", "dispose", "expired_title", "expired_detail"
    elif days <= 7:
        priority, action, tk, dk = "high", "ship_first", "expiry_title", "expiry_detail"
    elif days <= 14:
        priority, action, tk, dk = "medium", "ship_first", "expiry_title", "expiry_detail"
    else:
        priority, action, tk, dk = "low", "discount", "discount_title", "expiry_detail"
    return {
        "priority": priority, "action": action,
        "title": _t(tk, lang, **kw), "detail": _t(dk, lang, **kw),
        "quantity": row.get("quantity"), "due_date": row.get("expiry_date"),
        "sort": days,
    }


def _cycle(row, lang):
    counted = row.get("counted")
    if counted is None:
        return None
    expected = _n(row, "expected")
    variance = counted - expected
    unexpected = bool(row.get("unexpected"))
    if variance == 0 and not unexpected:
        return None
    pending = row.get("pending_adjustment_qty")
    pct = abs(variance) / max(expected, 1)
    if unexpected or pct >= 0.2 or abs(variance) >= 50:
        priority = "high"
    elif pct >= 0.05:
        priority = "medium"
    else:
        priority = "low"
    kw = dict(
        sku=row.get("sku"), bin_code=row.get("bin_code"), expected=expected,
        counted=counted, variance=f"{variance:+d}", pending=pending,
    )
    if unexpected:
        action, tk, dk = "investigate", "unexpected_title", "unexpected_detail"
    elif pending:
        action, tk, dk = "none", "pending_title", "pending_detail"
    else:
        action, tk, dk = "recount", "variance_title", "variance_detail"
    return {
        "priority": priority, "action": action,
        "title": _t(tk, lang, **kw), "detail": _t(dk, lang, **kw),
        "quantity": abs(variance), "due_date": None, "sort": -abs(variance),
    }


def _putaway(row, lang):
    qty = _n(row, "quantity")
    backorder = _n(row, "backorder_qty")
    if not row.get("bin_code"):
        kw = dict(sku=row.get("sku"), quantity=qty, source_bin=row.get("source_bin"))
        return {
            "priority": "high", "action": "investigate",
            "title": _t("putaway_none_title", lang, **kw),
            "detail": _t("putaway_none_detail", lang, **kw),
            "quantity": qty, "due_date": None, "sort": -qty,
            "source_bin": row.get("source_bin"), "alternatives": [],
        }
    kw = dict(
        sku=row.get("sku"), quantity=qty, source_bin=row.get("source_bin"),
        bin_code=row.get("bin_code"), zone_code=row.get("zone_code") or "-",
        item_qty_in_bin=_n(row, "item_qty_in_bin"),
        capacity_units=row.get("capacity_units"), backorder_qty=backorder,
    )
    reason = row.get("reason")
    dk = {"same_item": "putaway_same_item", "preferred": "putaway_preferred"}.get(reason, "putaway_empty")
    detail = _t(dk, lang, **kw)
    cap = row.get("capacity_units")
    if cap is not None and cap < qty:
        detail += _t("putaway_capacity_note", lang, **kw)
    if backorder > 0:
        detail += _t("putaway_backorder_note", lang, **kw)
    if backorder > 0:
        priority = "high"
    elif row.get("source_bin_type") == "PickableStaging":
        priority = "low"      # already pickable where it sits
    else:
        priority = "medium"
    return {
        "priority": priority, "action": "put_away",
        "title": _t("putaway_title", lang, **kw), "detail": detail,
        "quantity": qty, "due_date": None, "sort": -qty,
        "source_bin": row.get("source_bin"),
        "alternatives": list(row.get("alternatives") or []),
    }


_BO_TEXT = {
    "release": ("bo_release_title", "bo_release_detail"),
    "wait_po": ("bo_wait_title", "bo_wait_detail"),
    "transfer": ("bo_transfer_title", "bo_transfer_detail"),
    "partial_ship": ("bo_partial_title", "bo_partial_detail"),
    "create_po": ("bo_create_po_title", "bo_create_po_detail"),
}


def _backorder(row, lang):
    action = row.get("planned_action")
    if action not in _BO_TEXT:
        return None
    days = _n(row, "days_waiting")
    ship_by_days = row.get("ship_by_days")
    eta_days = row.get("po_eta_days")
    if action in ("create_po", "release"):
        priority = "high"
    elif ship_by_days is not None and ship_by_days <= 2:
        priority = "high"
    elif ship_by_days is not None and eta_days is not None and action == "wait_po" and eta_days > ship_by_days:
        priority = "high"
    elif days >= 14:
        priority = "high"
    elif action == "wait_po" and eta_days is not None and eta_days <= 3:
        priority = "low"
    else:
        priority = "medium"
    kw = dict(
        so_number=row.get("so_number"), total_short=_n(row, "total_short"),
        missing_qty=_n(row, "missing_qty"), open_po_qty=_n(row, "open_po_qty"),
        available_here=_n(row, "available_here"), transfer_from=row.get("transfer_from"),
        eta=row.get("po_eta") or _t("bo_eta_unknown", lang), days_waiting=days,
    )
    tk, dk = _BO_TEXT[action]
    qty = {"release": kw["total_short"], "partial_ship": kw["available_here"],
           "wait_po": kw["open_po_qty"]}.get(action, kw["missing_qty"])
    s = {
        "priority": priority, "action": action,
        "title": _t(tk, lang, **kw),
        "detail": _t(dk, lang, **kw) + (_t("bo_waiting_note", lang, **kw) if days > 0 else ""),
        "quantity": qty, "sort": -days, "so_number": row.get("so_number"),
    }
    refresh_facts("backorder", s, row)
    return s


_EVAL = {
    "replenish": _replenish, "expiry": _expiry, "cycle_count": _cycle,
    "putaway": _putaway, "backorder": _backorder,
}


def refresh_facts(kind, s, row):
    """Re-derive action-dependent facts after the action is (re)set, so a
    model-chosen action still only shows our own data."""
    if kind == "backorder":
        action = s.get("action")
        s["source_warehouse"] = row.get("transfer_candidate") if action == "transfer" else None
        s["due_date"] = row.get("po_eta") if action == "wait_po" else row.get("ship_by_date")
    return s


def allowed_actions(kind, row):
    """Actions a suggestion for this candidate may carry."""
    if kind == "backorder":
        return tuple(row.get("feasible_actions") or ())
    if kind == "putaway":
        return ("put_away",) if row.get("bin_code") else ("investigate",)
    return ALLOWED_ACTIONS[kind]


def group_key(kind, row):
    """Candidates sharing a group key are alternatives; at most one is kept."""
    if kind in GROUPED_KINDS:
        return f"{kind}|{row.get('line_id')}"
    return candidate_id(kind, row)


def evaluate(kind, row, lang):
    """One scored suggestion for a candidate row (any option rank), or None.
    The returned dict still carries the internal `sort` key."""
    s = _EVAL[kind](row, lang)
    if s is None:
        return None
    s.update(
        id=candidate_id(kind, row), sku=row.get("sku"),
        item_name=row.get("item_name"), bin_code=row.get("bin_code"),
    )
    return s


def build(kind, rows, lang, cap=MAX_SUGGESTIONS):
    """Return suggestion dicts sorted high -> low, at most `cap`."""
    scored = []
    for row in rows or []:
        if kind in GROUPED_KINDS and (row.get("option_rank") or 0) > 0:
            continue  # alternatives are offered to the LLM only
        s = evaluate(kind, row, lang)
        if s is None:
            continue
        sort = s.pop("sort")
        scored.append(((_RANK[s["priority"]], sort, s["id"]), s))
    scored.sort(key=lambda p: p[0])
    return [s for _, s in scored[:cap]]
