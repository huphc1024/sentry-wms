"""Shared warehouse map + rack grid builders for admin simulation and mobile."""

import math
import re
from collections import defaultdict

from sqlalchemy import text

ZONE_TYPE_COLORS = {
    "RECEIVING": "#F5A623",
    "STORAGE": "#4A90D9",
    "PICKING": "#7ED321",
    "STAGING": "#BD10E0",
    "SHIPPING": "#D0021B",
}

CATEGORY_PALETTE = [
    "#E74C3C", "#3498DB", "#2ECC71", "#9B59B6", "#F39C12",
    "#1ABC9C", "#E67E22", "#34495E", "#16A085", "#C0392B",
    "#8E44AD", "#27AE60", "#2980B9", "#D35400", "#7F8C8D",
]

# A-01-005-L2-P1 or legacy A-01-02
BIN_CODE_EXTENDED = re.compile(
    r"^(?P<prefix>[A-Za-z0-9]+)-(?P<aisle>\d+)-(?P<bay>\d+)-L(?P<level>\d+)-P(?P<pos>\d+)$",
    re.I,
)
BIN_CODE_LEGACY = re.compile(
    r"^(?P<aisle>[A-Za-z]+)-(?P<row>\d+)-(?P<level>\d+)$",
    re.I,
)


def _category_color(category: str, index_map: dict) -> str:
    if not category:
        return "#BDC3C7"
    if category not in index_map:
        index_map[category] = len(index_map) % len(CATEGORY_PALETTE)
    return CATEGORY_PALETTE[index_map[category]]


def _parse_int(value) -> int:
    if value is None:
        return 0
    s = str(value).strip()
    if not s or not s.isdigit():
        return 0
    return int(s)


def _format_rack_label(aisle, bay, code: str | None = None) -> str:
    """Human-readable rack label; avoid '?-REC' when aisle is missing."""
    bay_s = str(bay).strip() if bay is not None else None
    if aisle and bay_s:
        bay_part = bay_s.zfill(3) if bay_s.isdigit() else bay_s
        return f"{aisle}-{bay_part}"
    if bay_s:
        if bay_s.isdigit():
            return f"Kệ {int(bay_s)}"
        return f"Kệ {bay_s}"
    if code:
        head = code.split("-")[0] if "-" in code else code[:20]
        return f"Kệ {head}" if head else "Kệ"
    return "Kệ"


def parse_bin_address(bin_row) -> dict:
    """Normalize aisle / bay / level / position from DB columns or bin_code."""
    aisle = (bin_row.aisle or "").strip().upper() or None
    bay = str(bin_row.row_num).strip() if bin_row.row_num else None
    level = _parse_int(bin_row.level_num) or None
    position = _parse_int(getattr(bin_row, "position_num", None)) or None

    code = (bin_row.bin_code or "").strip().upper()
    m_ext = BIN_CODE_EXTENDED.match(code)
    if m_ext:
        aisle = aisle or m_ext.group("aisle")
        bay = bay or m_ext.group("bay")
        level = level or int(m_ext.group("level"))
        position = position or int(m_ext.group("pos"))
    else:
        m_legacy = BIN_CODE_LEGACY.match(code)
        if m_legacy:
            aisle = aisle or m_legacy.group("aisle").upper()
            bay = bay or m_legacy.group("row")
            level = level or int(m_legacy.group("level"))
            position = position or 1

    if not position:
        position = 1
    if not level:
        level = 1

    rack_key = f"{bin_row.zone_id}|{aisle or 'X'}|{bay or code}"
    rack_label = _format_rack_label(aisle, bay, code)
    slot_label = f"L{level}-P{position}"

    return {
        "aisle": aisle,
        "bay": bay,
        "level": level,
        "position": position,
        "rack_key": rack_key,
        "rack_label": rack_label,
        "slot_label": slot_label,
    }


def _derive_bin_position(bin_row, zone_index: int, bin_index_in_zone: int):
    if bin_row.map_x is not None and bin_row.map_y is not None:
        return (
            float(bin_row.map_x),
            float(bin_row.map_y),
            float(bin_row.map_w or 24),
            float(bin_row.map_h or 20),
            True,
        )

    aisle = (bin_row.aisle or "").strip().upper()
    row = _parse_int(bin_row.row_num)
    level = _parse_int(bin_row.level_num)
    zone_x = zone_index * 300 + 30

    if aisle:
        aisle_idx = ord(aisle[0]) - ord("A") if aisle[0].isalpha() else 0
        x = zone_x + 20 + aisle_idx * 90 + max(0, row - 1) * 6
        y = 50 + max(0, level - 1) * 32 + max(0, row - 1) * 4
        return x, y, 26, 22, False

    col = bin_index_in_zone % 3
    row_i = bin_index_in_zone // 3
    x = zone_x + 20 + col * 70
    y = 50 + row_i * 40
    return x, y, 60, 30, False


def _zone_bounds(bins_in_zone):
    if not bins_in_zone:
        return None
    min_x = min(b["map"]["x"] for b in bins_in_zone)
    min_y = min(b["map"]["y"] for b in bins_in_zone)
    max_x = max(b["map"]["x"] + b["map"]["w"] for b in bins_in_zone)
    max_y = max(b["map"]["y"] + b["map"]["h"] for b in bins_in_zone)
    pad = 16
    return {
        "x": min_x - pad,
        "y": min_y - pad,
        "w": (max_x - min_x) + pad * 2,
        "h": (max_y - min_y) + pad * 2,
    }


def _zone_layout_key(zone_code: str, zone_name: str, zone_type: str) -> str | None:
    code = (zone_code or zone_name or "").lower()
    ztype = (zone_type or "").upper()
    if ztype == "RECEIVING" or "recv" in code:
        return "receiving"
    if ztype == "SHIPPING" or "ship" in code:
        return "shipping"
    if ztype in ("STAGING", "PICKING") or "pack" in code or "qc" in code:
        return "packing"
    if "office" in code:
        return "office"
    if "fast" in code:
        return "fast"
    if "regular" in code:
        return "regular"
    if "bulk" in code:
        return "bulk"
    return None


METER_ZONE_DEFAULTS = {
    "receiving": {"x": 0.6, "y": 2.0, "w": 6.5, "h": 18.0},
    "shipping": {"x": 42.9, "y": 2.0, "w": 6.5, "h": 18.0},
    "fast": {"x": 10.2, "y": 2.2, "w": 13.0, "h": 8.2},
    "packing": {"x": 10.2, "y": 27.0, "w": 10.5, "h": 4.8},
    "office": {"x": 22.2, "y": 27.0, "w": 7.8, "h": 4.8},
    "regular": {"x": 24.2, "y": 2.2, "w": 10.2, "h": 8.2},
    "bulk": {"x": 10.2, "y": 14.6, "w": 24.2, "h": 10.0},
}


def _meter_zone_bounds(zone_row, layout: dict | None) -> dict | None:
    """Resolve zone rectangle in meters — matches admin buildInitialDraft."""
    if zone_row.map_x is not None and zone_row.map_y is not None:
        return {
            "x": float(zone_row.map_x),
            "y": float(zone_row.map_y),
            "w": float(zone_row.map_w or 280),
            "h": float(zone_row.map_h or 180),
            "stored": True,
            "coordinate_unit": "METER",
        }
    cfg = (layout or {}).get("config") or {}
    if layout and layout.get("has_saved_layout") and cfg.get("coordinate_unit") == "METER":
        key = _zone_layout_key(zone_row.zone_code, zone_row.zone_name, zone_row.zone_type)
        fallback = METER_ZONE_DEFAULTS.get(key) if key else None
        if fallback:
            return {**fallback, "stored": False, "coordinate_unit": "METER"}
    return None


def _build_pallets_for_content(bin_id: int, content_rows: list[dict]) -> list[dict]:
    """Return only real LPN pallets referenced by inventory (no synthetic splits)."""
    by_pallet: dict = {}
    for c in content_rows:
        if not c.get("pallet_id"):
            continue
        pid = c["pallet_id"]
        if pid not in by_pallet:
            by_pallet[pid] = {
                "pallet_id": pid,
                "pallet_code": c.get("pallet_code"),
                "pallet_barcode": c.get("pallet_barcode"),
                "is_synthetic": False,
                "bin_id": bin_id,
                "item_id": c["item_id"],
                "sku": c["sku"],
                "item_name": c["item_name"],
                "category": c["category"],
                "lot_code": c.get("lot_number"),
                "expiry_date": c.get("expiry_date"),
                "quantity_on_hand": 0,
                "quantity_allocated": 0,
            }
        entry = by_pallet[pid]
        entry["quantity_on_hand"] += int(c["quantity_on_hand"] or 0)
        entry["quantity_allocated"] += int(c["quantity_allocated"] or 0)
    return list(by_pallet.values())


def _merge_empty_bin_pallets(db, warehouse_id: int, bins_out: list[dict]) -> None:
    """Include STORED LPNs in bin even when inventory rows are not linked yet."""
    rows = db.execute(
        text("""
            SELECT p.pallet_id, p.pallet_code, p.pallet_barcode, p.bin_id, p.item_id,
                   p.lot_code, p.expiry_date, i.sku, i.item_name, i.category
            FROM pallets p
            LEFT JOIN items i ON i.item_id = p.item_id
            WHERE p.warehouse_id = :wid AND p.bin_id IS NOT NULL
              AND COALESCE(p.status, 'STORED') = 'STORED'
        """),
        {"wid": warehouse_id},
    ).fetchall()
    by_bin = defaultdict(list)
    for row in rows:
        by_bin[row.bin_id].append(row)
    for b in bins_out:
        existing = {p["pallet_id"] for p in b["pallets"]}
        for row in by_bin.get(b["bin_id"], []):
            if row.pallet_id in existing:
                continue
            b["pallets"].append({
                "pallet_id": row.pallet_id,
                "pallet_code": row.pallet_code,
                "pallet_barcode": row.pallet_barcode,
                "is_synthetic": False,
                "is_empty": True,
                "bin_id": row.bin_id,
                "item_id": row.item_id,
                "sku": row.sku,
                "item_name": row.item_name,
                "category": row.category,
                "lot_code": row.lot_code,
                "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
                "quantity_on_hand": 0,
                "quantity_allocated": 0,
            })
        b["pallet_count"] = len(b["pallets"])


def group_bins_into_racks(bins_out: list[dict]) -> list[dict]:
    """Group flat bins into rack summaries for zone listing."""
    racks_map = {}
    for b in bins_out:
        identity = (
            f"id:{b['rack_id']}" if b.get("rack_id")
            else f"key:{b.get('rack_key') or b.get('bin_code')}"
        )
        if identity not in racks_map:
            racks_map[identity] = {
                "rack_id": b.get("rack_id"),
                "rack_key": b.get("rack_key"),
                "rack_label": b.get("rack_label") or b.get("bin_code"),
                "zone_id": b["zone_id"],
                "zone_code": b["zone_code"],
                "zone_name": b["zone_name"],
                "aisle": b.get("aisle"),
                "bay": b.get("bay"),
                "bins": [],
            }
        racks_map[identity]["bins"].append(b)

    racks = []
    for rack in racks_map.values():
        occupied = sum(1 for b in rack["bins"] if int(b.get("total_qty") or 0) > 0)
        total = len(rack["bins"])
        rack["total_slots"] = total
        rack["occupied_slots"] = occupied
        rack["empty_slots"] = max(0, total - occupied)
        rack["fill_pct"] = round((occupied / total) * 100) if total else 0
        del rack["bins"]
        racks.append(rack)

    racks.sort(key=lambda r: (r["zone_code"] or "", r["aisle"] or "", r["bay"] or "", r["rack_label"]))
    return racks


def build_rack_detail(
    bins_out: list[dict], rack_key: str | None = None, rack_id: int | None = None
) -> dict | None:
    """Build 4-level x N-position grid for one rack."""
    rack_bins = [
        b for b in bins_out
        if (
            rack_id is not None and b.get("rack_id") == rack_id
        ) or (
            rack_id is None and b.get("rack_key") == rack_key
        )
    ]
    if not rack_bins:
        return None

    first = rack_bins[0]
    levels_map = defaultdict(dict)
    max_level = 4
    max_pos = 2

    for b in rack_bins:
        lvl = int(b.get("level") or 1)
        pos = int(b.get("position") or 1)
        max_level = max(max_level, lvl)
        max_pos = max(max_pos, pos)
        levels_map[lvl][pos] = b

    levels_out = []
    for lvl in range(max_level, 0, -1):
        positions = []
        for pos in range(1, max_pos + 1):
            bin_data = levels_map.get(lvl, {}).get(pos)
            positions.append({
                "position": pos,
                "bin": bin_data,
                "status": (bin_data or {}).get("status", "empty"),
                "is_empty": not bin_data or int((bin_data or {}).get("total_qty") or 0) <= 0,
            })
        levels_out.append({"level": lvl, "positions": positions})

    occupied = sum(1 for b in rack_bins if int(b.get("total_qty") or 0) > 0)
    return {
        "rack_id": first.get("rack_id"),
        "rack_key": first.get("rack_key"),
        "rack_label": first.get("rack_label"),
        "zone_id": first["zone_id"],
        "zone_code": first["zone_code"],
        "zone_name": first["zone_name"],
        "aisle": first.get("aisle"),
        "bay": first.get("bay"),
        "total_slots": len(rack_bins),
        "occupied_slots": occupied,
        "levels": levels_out,
    }


def build_warehouse_map(db, warehouse_id: int) -> dict | None:
    """Load warehouse map payload (zones, bins, racks, categories, layout)."""
    from services.warehouse_layout_service import load_warehouse_layout

    wh = db.execute(
        text("SELECT warehouse_id, warehouse_code, warehouse_name FROM warehouses WHERE warehouse_id = :wid"),
        {"wid": warehouse_id},
    ).fetchone()
    if not wh:
        return None

    zone_rows = db.execute(
        text("""
            SELECT zone_id, zone_code, zone_name, zone_type, is_active,
                   color_hex, map_x, map_y, map_w, map_h
            FROM zones
            WHERE warehouse_id = :wid AND is_active = true
            ORDER BY zone_id
        """),
        {"wid": warehouse_id},
    ).fetchall()

    bin_rows = db.execute(
        text("""
            SELECT b.bin_id, b.zone_id, z.zone_code, z.zone_name, z.zone_type,
                   b.bin_code, b.bin_barcode, b.bin_type,
                   b.aisle, b.row_num, b.level_num, b.position_num,
                   b.map_x, b.map_y, b.map_w, b.map_h, b.is_active,
                   b.rack_id, r.legacy_rack_key, r.rack_code, r.rack_name
            FROM bins b
            JOIN zones z ON z.zone_id = b.zone_id
            LEFT JOIN racks r
              ON r.rack_id = b.rack_id AND r.warehouse_id = b.warehouse_id
            WHERE b.warehouse_id = :wid AND b.is_active = true
            ORDER BY b.zone_id, b.pick_sequence, b.bin_id
        """),
        {"wid": warehouse_id},
    ).fetchall()

    inv_rows = db.execute(
        text("""
            SELECT inv.bin_id, inv.item_id, i.sku, i.item_name, i.category,
                   inv.quantity_on_hand, inv.quantity_allocated, inv.lot_number,
                   inv.expiry_date, inv.pallet_id, p.pallet_code, p.pallet_barcode
            FROM inventory inv
            JOIN items i ON i.item_id = inv.item_id
            LEFT JOIN pallets p ON p.pallet_id = inv.pallet_id
            WHERE inv.warehouse_id = :wid AND inv.quantity_on_hand > 0
        """),
        {"wid": warehouse_id},
    ).fetchall()

    inv_by_bin = defaultdict(list)
    category_totals = defaultdict(int)
    for row in inv_rows:
        cat = row.category or "Uncategorized"
        inv_by_bin[row.bin_id].append({
            "item_id": row.item_id,
            "sku": row.sku,
            "item_name": row.item_name,
            "category": cat,
            "lot_number": row.lot_number,
            "expiry_date": row.expiry_date.isoformat() if row.expiry_date else None,
            "pallet_id": row.pallet_id,
            "pallet_code": row.pallet_code,
            "pallet_barcode": row.pallet_barcode,
            "quantity_on_hand": int(row.quantity_on_hand or 0),
            "quantity_allocated": int(row.quantity_allocated or 0),
        })
        category_totals[cat] += int(row.quantity_on_hand or 0)

    category_index = {}
    categories = [
        {
            "category": cat,
            "total_qty": qty,
            "color": _category_color(cat, category_index),
        }
        for cat, qty in sorted(category_totals.items(), key=lambda x: (-x[1], x[0]))
    ]

    zone_id_to_index = {z.zone_id: idx for idx, z in enumerate(zone_rows)}
    zone_bin_counter = defaultdict(int)

    bins_out = []
    for b in bin_rows:
        idx = zone_bin_counter[b.zone_id]
        zone_bin_counter[b.zone_id] += 1
        z_idx = zone_id_to_index.get(b.zone_id, 0)
        x, y, w, h, stored = _derive_bin_position(b, z_idx, idx)
        addr = parse_bin_address(b)
        rack_key = b.legacy_rack_key or addr["rack_key"]
        rack_label = b.rack_name or b.rack_code or addr["rack_label"]

        contents = inv_by_bin.get(b.bin_id, [])
        total_qty = sum(c["quantity_on_hand"] for c in contents)
        dominant_category = None
        if contents:
            by_cat = defaultdict(int)
            for c in contents:
                by_cat[c["category"]] += c["quantity_on_hand"]
            dominant_category = max(by_cat.items(), key=lambda kv: kv[1])[0]

        pallets = _build_pallets_for_content(b.bin_id, contents)
        bins_out.append({
            "bin_id": b.bin_id,
            "zone_id": b.zone_id,
            "zone_code": b.zone_code,
            "zone_name": b.zone_name,
            "zone_type": b.zone_type,
            "bin_code": b.bin_code,
            "bin_barcode": b.bin_barcode,
            "bin_type": b.bin_type,
            "aisle": addr["aisle"],
            "bay": addr["bay"],
            "level": addr["level"],
            "position": addr["position"],
            "rack_id": b.rack_id,
            "rack_key": rack_key,
            "rack_label": rack_label,
            "slot_label": addr["slot_label"],
            "row_num": b.row_num,
            "level_num": b.level_num,
            "position_num": b.position_num,
            "map": {"x": x, "y": y, "w": w, "h": h, "stored": stored},
            "total_qty": total_qty,
            "dominant_category": dominant_category,
            "category_color": _category_color(dominant_category or "", category_index),
            "contents": contents,
            "pallets": pallets,
            "pallet_count": len(pallets),
            "status": "empty" if total_qty == 0 else ("full" if total_qty >= 50 else "partial"),
        })

    _merge_empty_bin_pallets(db, warehouse_id, bins_out)

    bins_by_zone = defaultdict(list)
    for b in bins_out:
        bins_by_zone[b["zone_id"]].append(b)

    layout = load_warehouse_layout(db, warehouse_id)
    use_meter_zones = (
        layout.get("has_saved_layout")
        and (layout.get("config") or {}).get("coordinate_unit") == "METER"
    )

    zones_out = []
    for z in zone_rows:
        z_bins = bins_by_zone.get(z.zone_id, [])
        bounds = _zone_bounds(z_bins)
        meter_bounds = _meter_zone_bounds(z, layout)
        if meter_bounds:
            bounds = meter_bounds
        elif z.map_x is not None and z.map_y is not None:
            bounds = {
                "x": float(z.map_x),
                "y": float(z.map_y),
                "w": float(z.map_w or 280),
                "h": float(z.map_h or 180),
                "stored": True,
            }
        elif bounds:
            bounds["stored"] = False
            if use_meter_zones:
                bounds["coordinate_unit"] = "LEGACY_CANVAS"
        occupied_bins = sum(1 for b in z_bins if b["total_qty"] > 0)
        zones_out.append({
            "zone_id": z.zone_id,
            "zone_code": z.zone_code,
            "zone_name": z.zone_name,
            "zone_type": z.zone_type,
            "color": z.color_hex or ZONE_TYPE_COLORS.get(z.zone_type, "#95A5A6"),
            "bin_count": len(z_bins),
            "occupied_bins": occupied_bins,
            "rack_count": len({b["rack_key"] for b in z_bins}),
            "fill_pct": round((occupied_bins / len(z_bins)) * 100) if z_bins else 0,
            "bounds": bounds,
        })

    all_x = [b["map"]["x"] for b in bins_out] + [z["bounds"]["x"] for z in zones_out if z.get("bounds")]
    all_y = [b["map"]["y"] for b in bins_out] + [z["bounds"]["y"] for z in zones_out if z.get("bounds")]
    all_x2 = [b["map"]["x"] + b["map"]["w"] for b in bins_out] + [
        z["bounds"]["x"] + z["bounds"]["w"] for z in zones_out if z.get("bounds")
    ]
    all_y2 = [b["map"]["y"] + b["map"]["h"] for b in bins_out] + [
        z["bounds"]["y"] + z["bounds"]["h"] for z in zones_out if z.get("bounds")
    ]

    canvas = {"width": 900, "height": 500}
    if all_x and all_y:
        canvas = {
            "width": max(900, math.ceil(max(all_x2) + 40)),
            "height": max(500, math.ceil(max(all_y2) + 60)),
        }

    racks = group_bins_into_racks(bins_out)

    rack_layout_by_id = {
        r["rack_id"]: r for r in layout["racks"] if r.get("rack_id")
    }
    rack_layout_by_key = {r["rack_key"]: r for r in layout["racks"]}
    for rack in racks:
        saved = (
            rack_layout_by_id.get(rack.get("rack_id"))
            or rack_layout_by_key.get(rack["rack_key"])
        )
        if saved:
            rack["layout"] = saved

    return {
        "warehouse_id": wh.warehouse_id,
        "warehouse_code": wh.warehouse_code,
        "warehouse_name": wh.warehouse_name,
        "canvas": canvas,
        "layout": layout,
        "zones": zones_out,
        "bins": bins_out,
        "racks": racks,
        "categories": categories,
    }
