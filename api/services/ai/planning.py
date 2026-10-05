"""Pure planners for the phase 2 kinds (putaway, backorder). No DB, no IO.

candidates.py loads raw facts and hands them here; the output is a flat
list of candidate rows that rules.py scores and the LLM may re-rank. Every
bin code, warehouse code, quantity and date in the output comes from the
input facts: nothing is invented here or later.
"""

ELIGIBLE_ZONE_TYPES = ("PICKING", "STORAGE")
MAX_PUTAWAY_OPTIONS = 3
WAIT_PO_MAX_DAYS = 7          # wait for a PO arriving within this many days


# ---- put-away ---------------------------------------------------------------
def capacity_units(bin_row, unit_weight, unit_volume):
    """Whole units of this item that still fit in the bin, or None when the
    bin has no limit we can evaluate (no max set or item has no size)."""
    caps = []
    max_w = bin_row.get("max_weight_lbs")
    if max_w is not None and unit_weight and unit_weight > 0:
        caps.append(int((float(max_w) - float(bin_row.get("used_weight") or 0)) // float(unit_weight)))
    max_v = bin_row.get("max_volume_cuft")
    if max_v is not None and unit_volume and unit_volume > 0:
        caps.append(int((float(max_v) - float(bin_row.get("used_volume") or 0)) // float(unit_volume)))
    if not caps:
        return None
    return max(min(caps), 0)


def _zone_rank(zone_type):
    return 0 if zone_type == "PICKING" else 1


def _line_options(line, bins, holdings, preferred, claimed):
    """Ranked destination options for one staged line."""
    item_id = line["item_id"]
    held = holdings.get(item_id, {})               # bin_id -> qty of this item
    pref = preferred.get(item_id, {})              # bin_id -> priority
    right_zones = {b["zone_id"] for b in bins if b["bin_id"] in held or b["bin_id"] in pref}
    qty = line["quantity"]
    scored = []
    for b in bins:
        bid = b["bin_id"]
        if b.get("zone_type") not in ELIGIBLE_ZONE_TYPES or bid == line.get("source_bin_id"):
            continue
        holds = bid in held
        is_pref = bid in pref
        empty = not b.get("total_qty")
        if holds:
            reason, tier = "same_item", 0
        elif is_pref:
            reason, tier = "preferred", 0
        elif empty:
            owner = claimed.get(bid)
            if owner is not None and owner != item_id:
                continue                            # already proposed for another item
            reason = "empty"
            tier = 1 if (not right_zones or b["zone_id"] in right_zones) else 2
        else:
            continue                                # holds other items only
        cap = capacity_units(b, line.get("unit_weight"), line.get("unit_volume"))
        if cap is not None and cap <= 0:
            continue
        fits = cap is None or cap >= qty
        key = (
            tier, 0 if fits else 1, pref.get(bid, 10 ** 6), _zone_rank(b.get("zone_type")),
            -held.get(bid, 0), b.get("putaway_sequence") or 0, b["bin_code"],
        )
        scored.append((key, {
            "bin_id": bid, "bin_code": b["bin_code"], "zone_code": b.get("zone_code"),
            "zone_type": b.get("zone_type"), "reason": reason,
            "item_qty_in_bin": held.get(bid, 0), "capacity_units": cap,
        }))
    scored.sort(key=lambda p: p[0])
    return [o for _, o in scored[:MAX_PUTAWAY_OPTIONS]]


def plan_putaway(lines, bins, holdings, preferred):
    """Flatten staged lines into (line x destination option) candidate rows.

    lines:     [{inventory_id, item_id, sku, item_name, quantity, source_bin,
                 source_bin_id, source_bin_type, lot_number, expiry_date,
                 unit_weight, unit_volume, backorder_qty}]
    bins:      [{bin_id, bin_code, zone_id, zone_code, zone_type,
                 putaway_sequence, max_weight_lbs, max_volume_cuft,
                 used_weight, used_volume, total_qty}]
    holdings:  {item_id: {bin_id: qty}}   (eligible bins only)
    preferred: {item_id: {bin_id: priority}}

    Option 0 of a line is the rules-mode answer; options 1.. are the only
    alternatives the LLM may pick. A line with no option yields one row with
    bin_code None. An empty bin proposed for one item is not offered to a
    different item later in the run (deterministic order: sku, inventory_id).
    """
    claimed = {}
    out = []
    for line in sorted(lines or [], key=lambda r: (str(r.get("sku")), r.get("inventory_id") or 0)):
        opts = _line_options(line, bins or [], holdings or {}, preferred or {}, claimed)
        if opts and opts[0]["reason"] == "empty":
            claimed.setdefault(opts[0]["bin_id"], line["item_id"])
        base = {
            "line_id": str(line["inventory_id"]),
            "sku": line.get("sku"), "item_name": line.get("item_name"),
            "quantity": line.get("quantity"), "source_bin": line.get("source_bin"),
            "source_bin_type": line.get("source_bin_type"),
            "lot_number": line.get("lot_number"), "expiry_date": line.get("expiry_date"),
            "backorder_qty": line.get("backorder_qty") or 0,
        }
        if not opts:
            out.append({**base, "bin_code": None, "zone_code": None, "zone_type": None,
                        "reason": "none", "item_qty_in_bin": 0, "capacity_units": None,
                        "option_rank": 0, "alternatives": []})
            continue
        codes = [o["bin_code"] for o in opts]
        for rank, o in enumerate(opts):
            row = {**base, **{k: v for k, v in o.items() if k != "bin_id"}}
            row["option_rank"] = rank
            row["alternatives"] = [c for c in codes if c != o["bin_code"]]
            out.append(row)
    return out


# ---- backorders -------------------------------------------------------------
def _choose_transfer_source(rem, pools):
    """First other warehouse (most total stock, then code) covering every
    remaining line, else None."""
    needed = {i: q for i, q in rem.items() if q > 0}
    best = None
    for code in sorted(pools):
        pool = pools[code]
        if all(pool.get(i, 0) >= q for i, q in needed.items()):
            total = sum(pool.get(i, 0) for i in needed)
            if best is None or total > best[0]:
                best = (total, code)
    return best[1] if best else None


def plan_backorders(orders, available_here, inbound, elsewhere):
    """Allocate stock to WAITING_STOCK orders oldest first and pick an action.

    orders:         [{so_number, days_waiting, ship_by_date, ship_by_days,
                      lines: [{item_id, sku, item_name, short_qty}]}]
    available_here: {item_id: units available in this warehouse}
    inbound:        {item_id: {"qty": open PO units, "expected_date": iso|None,
                               "eta_days": int|None}}
    elsewhere:      {warehouse_code: {item_id: units available}}

    Pools are consumed as orders are planned so two orders never claim the
    same units. Returns one row per order with a `planned_action` and the
    `feasible_actions` an LLM may choose between.
    """
    here = {k: int(v or 0) for k, v in (available_here or {}).items()}
    po_pool = {k: int((v or {}).get("qty") or 0) for k, v in (inbound or {}).items()}
    other = {w: {k: int(v or 0) for k, v in (p or {}).items()} for w, p in (elsewhere or {}).items()}
    out = []
    ordered = sorted(orders or [], key=lambda o: (-(o.get("days_waiting") or 0), str(o.get("so_number"))))
    for order in ordered:
        lines = [ln for ln in order.get("lines") or [] if (ln.get("short_qty") or 0) > 0]
        if not lines:
            continue
        need, local, rem, po_cov = {}, {}, {}, {}
        for ln in lines:
            i = ln["item_id"]
            need[i] = need.get(i, 0) + int(ln["short_qty"])
        for i, q in need.items():
            local[i] = min(q, here.get(i, 0))
            rem[i] = q - local[i]
            po_cov[i] = min(rem[i], po_pool.get(i, 0))
        total = sum(need.values())
        local_total = sum(local.values())
        rem_total = sum(rem.values())
        po_total = sum(po_cov.values())
        po_full = rem_total > 0 and po_total == rem_total
        eta_items = [i for i in rem if rem[i] > 0 and po_cov[i] > 0]
        etas = [(inbound or {}).get(i, {}) for i in eta_items]
        eta_days_known = [e.get("eta_days") for e in etas if e.get("eta_days") is not None]
        eta_dates = [e.get("expected_date") for e in etas if e.get("expected_date")]
        eta_unknown = len(eta_days_known) < len(etas)
        po_eta = max(eta_dates) if eta_dates and not eta_unknown else None
        po_eta_days = max(eta_days_known) if eta_days_known and not eta_unknown else None
        source = _choose_transfer_source(rem, other) if rem_total > 0 else None

        feasible = []
        if rem_total == 0:
            action = "release"
            feasible = ["release"]
        else:
            if po_full:
                feasible.append("wait_po")
            if source:
                feasible.append("transfer")
            if local_total > 0:
                feasible.append("partial_ship")
            feasible.append("create_po")
            if po_full and po_eta_days is not None and po_eta_days <= WAIT_PO_MAX_DAYS:
                action = "wait_po"
            elif source:
                action = "transfer"
            elif po_full:
                action = "wait_po"
            elif local_total > 0:
                action = "partial_ship"
            else:
                action = "create_po"

        # Commit: local stock and PO cover always (older orders keep their
        # claim); other-warehouse stock only when a transfer is planned.
        for i in need:
            here[i] = here.get(i, 0) - local[i]
            po_pool[i] = po_pool.get(i, 0) - po_cov[i]
        transfer_qty = 0
        if action == "transfer":
            for i, q in rem.items():
                if q > 0:
                    other[source][i] = other[source].get(i, 0) - q
                    transfer_qty += q

        detail_lines = []
        for ln in lines:
            i = ln["item_id"]
            detail_lines.append({
                "sku": ln.get("sku"), "item_name": ln.get("item_name"),
                "short_qty": int(ln["short_qty"]), "available_here": local[i],
                "open_po_qty": po_cov[i],
                "transfer_qty": rem[i] if action == "transfer" else 0,
            })
        primary = max(detail_lines, key=lambda d: (d["short_qty"] - d["available_here"], d["short_qty"]))
        out.append({
            "so_number": order.get("so_number"),
            "days_waiting": int(order.get("days_waiting") or 0),
            "ship_by_date": order.get("ship_by_date"),
            "ship_by_days": order.get("ship_by_days"),
            "sku": primary["sku"], "item_name": primary["item_name"],
            "lines": detail_lines,
            "total_short": total, "available_here": local_total,
            "missing_qty": rem_total, "open_po_qty": po_total,
            "po_eta": po_eta, "po_eta_days": po_eta_days,
            "transfer_from": source if action == "transfer" else None,
            "transfer_qty": transfer_qty,
            "transfer_candidate": source,
            "planned_action": action,
            "feasible_actions": feasible,
        })
    return out
