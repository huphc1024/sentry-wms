#!/usr/bin/env python3
"""Seed a production-like demo database for Sơn Lộc WMS.

Builds a separate database (default ``sentry_prodlike``) from db/schema.sql
(which already contains every migration up to 097) and fills it with
deterministic, obviously-fake Vietnamese data for a mid-size distributor:
2 warehouses, ~300 SKUs, lots with expiry, 120 days of POs / receipts /
sales orders, backorders, cycle counts with pending variances, staged
stock awaiting put-away, billing events + invoices and staff activity for
the Productivity dashboard.

Usage:
    python scripts/seed_prodlike.py                 # create + seed if missing
    python scripts/seed_prodlike.py --reset         # drop, recreate, seed
    python scripts/seed_prodlike.py my_db_prodlike --reset

Reads POSTGRES_USER / POSTGRES_PASSWORD (app role), POSTGRES_SUPERUSER /
POSTGRES_SUPERUSER_PASSWORD (to create / drop the database) and
ADMIN_PASSWORD (admin login) from the repo .env. Staff accounts use
DEMO_USER_PASSWORD, falling back to ADMIN_PASSWORD. Secrets are never
printed. Only databases whose name ends in ``_prodlike`` are accepted.

See docs/prodlike-data.md.
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import bcrypt
import psycopg2
from dotenv import load_dotenv
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from psycopg2.extras import Json, execute_values

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

DEFAULT_DB = "sentry_prodlike"
PROTECTED_DBS = {"sentry", "sentry_test", "sentry_demo", "erasd_dev",
                 "postgres", "template0", "template1"}
RANDOM_SEED = 20261005
HISTORY_DAYS = 120
VN_TZ = timezone(timedelta(hours=7))

rng = random.Random(RANDOM_SEED)


# =============================================================== helpers

def uid() -> str:
    """Deterministic UUID4 from the seeded RNG."""
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def wchoice(pairs):
    """Weighted choice from [(value, weight), ...]."""
    total = sum(w for _, w in pairs)
    r = rng.uniform(0, total)
    upto = 0.0
    for v, w in pairs:
        upto += w
        if r <= upto:
            return v
    return pairs[-1][0]


def round_vnd(x, step=1000):
    return int(round(x / step) * step)


def insert(cur, table, cols, rows, returning=None):
    """Bulk insert list[dict]; returns the RETURNING column list when asked."""
    if not rows:
        return []
    q = f"INSERT INTO {table} ({', '.join(cols)}) VALUES %s"
    if returning:
        q += f" RETURNING {returning}"
    vals = [tuple(r.get(c) for c in cols) for r in rows]
    res = execute_values(cur, q, vals, page_size=1000, fetch=bool(returning))
    return [x[0] for x in res] if returning else []


def at(d: date, hour: float) -> datetime:
    """Local VN datetime on day d at fractional hour."""
    h = int(hour)
    m = int((hour - h) * 60)
    return datetime.combine(d, time(min(h, 23), min(m, 59)), tzinfo=VN_TZ)


# =============================================================== connection

def _conn_params():
    url = os.getenv("DATABASE_URL", "")
    host, port = "localhost", 5432
    if url:
        p = urlparse(url)
        host = p.hostname or host
        port = p.port or port
    host = os.getenv("POSTGRES_HOST", host)
    port = int(os.getenv("POSTGRES_PORT", port))
    return host, port


def connect(dbname, user, password):
    host, port = _conn_params()
    return psycopg2.connect(host=host, port=port, dbname=dbname, user=user, password=password)


def check_target(name: str):
    if name in PROTECTED_DBS or not name.endswith("_prodlike"):
        raise SystemExit(
            f"Refusing to touch database '{name}': target must end in '_prodlike' "
            f"and must not be one of {sorted(PROTECTED_DBS)}."
        )


def ensure_database(dbname, reset, app_user, app_pw, su_user, su_pw):
    """Create (or drop + create) the target DB. Returns True when it is new."""
    if su_pw:
        admin = connect("postgres", su_user, su_pw)
    else:
        admin = connect("postgres", app_user, app_pw)
    admin.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = admin.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
    exists = cur.fetchone() is not None
    if exists and reset:
        print(f"Dropping database {dbname} ...")
        cur.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = %s AND pid <> pg_backend_pid()", (dbname,))
        cur.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(dbname)))
        exists = False
    created = False
    if not exists:
        print(f"Creating database {dbname} (owner {app_user}) ...")
        cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(
            sql.Identifier(dbname), sql.Identifier(app_user)))
        created = True
    cur.close()
    admin.close()
    if created and su_pw:
        # pgcrypto first as superuser, so schema.sql's CREATE EXTENSION IF
        # NOT EXISTS is a no-op even where the extension is not trusted.
        c = connect(dbname, su_user, su_pw)
        c.autocommit = True
        c.cursor().execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        c.close()
    return created


# =============================================================== reference data

WAREHOUSES = [
    {"code": "SL-HCM", "short": "HCM", "name": "Kho Sơn Lộc Thủ Đức",
     "address": "Lô B2 KCN Demo, P. Thử Nghiệm, TP. Thủ Đức, TP.HCM (địa chỉ giả)",
     "orders_per_day": 24, "pick_aisles": "ABCD", "pick_rows": 5, "bulk_racks": 4,
     "bulk_pos": 6},
    {"code": "SL-HN", "short": "HN", "name": "Kho Sơn Lộc Long Biên",
     "address": "Số 1 Đường Demo, P. Thử Nghiệm, Q. Long Biên, Hà Nội (địa chỉ giả)",
     "orders_per_day": 8, "pick_aisles": "AB", "pick_rows": 4, "bulk_racks": 2,
     "bulk_pos": 4},
]

ZONES = [
    ("RCV", "Khu nhận hàng", "RECEIVING", "#4C9AFF"),
    ("BULK", "Khu lưu trữ pallet", "STORAGE", "#8777D9"),
    ("PICK", "Khu soạn hàng", "PICKING", "#36B37E"),
    ("STAGE", "Khu tập kết xuất", "STAGING", "#FFAB00"),
    ("SHIP", "Cửa xuất hàng", "SHIPPING", "#FF5630"),
    ("QC", "Khu kiểm tra chất lượng", "STORAGE", "#6B778C"),
]

BRANDS = ["Sơn Lộc", "An Phát", "Hảo Vị", "Minh Tâm", "Việt Xanh", "Phú Gia",
          "Thiên Hương", "Kim Long", "Bảo Ngọc", "Đại Nam"]

# code, name, count, lot_tracked, shelf_days, profile, price_range(VND), weight_lbs, products, sizes
CATEGORIES = [
    ("DU", "Đồ uống", 50, True, (240, 540), "FMCG", (85_000, 320_000), (8, 30),
     ["Nước suối tinh khiết", "Nước khoáng có ga", "Trà xanh đóng chai", "Trà chanh",
      "Nước tăng lực", "Cà phê sữa lon", "Nước ngọt cola", "Nước cam ép", "Sữa đậu nành",
      "Nước yến"],
     ["lon 330ml (thùng 24)", "chai 500ml (thùng 24)", "chai 1.5L (thùng 12)"]),
    ("SU", "Sữa & chế phẩm sữa", 35, True, (45, 180), "FMCG", (60_000, 650_000), (4, 14),
     ["Sữa tươi tiệt trùng có đường", "Sữa tươi không đường", "Sữa chua uống",
      "Sữa đặc có đường", "Sữa chua ăn", "Sữa bột trẻ em", "Phô mai que", "Sữa hạt óc chó"],
     ["hộp 180ml (thùng 48)", "hộp 1L (thùng 12)", "lon 380g (thùng 24)", "hũ 100g (thùng 48)"]),
    ("TP", "Thực phẩm khô", 60, True, (180, 720), "FMCG", (45_000, 420_000), (3, 25),
     ["Mì gói tôm chua cay", "Mì ly bò", "Phở ăn liền", "Bún khô", "Gạo thơm", "Gạo nếp",
      "Bánh quy bơ", "Bánh xốp", "Snack khoai tây", "Ngũ cốc dinh dưỡng", "Đậu phộng rang",
      "Hạt điều rang muối", "Cháo ăn liền", "Miến dong"],
     ["gói 75g (thùng 30)", "túi 5kg", "hộp 300g (thùng 12)", "túi 500g (thùng 20)"]),
    ("GV", "Gia vị", 30, True, (365, 720), "FMCG", (35_000, 380_000), (4, 22),
     ["Nước mắm cá cơm", "Nước tương", "Dầu ăn đậu nành", "Dầu hào", "Tương ớt", "Hạt nêm",
      "Bột ngọt", "Muối i-ốt", "Đường tinh luyện", "Giấm gạo"],
     ["chai 500ml (thùng 12)", "chai 1L (thùng 12)", "can 5L (thùng 4)", "gói 1kg (bao 10)"]),
    ("HM", "Hóa mỹ phẩm", 45, True, (540, 1080), "FULFILLMENT", (40_000, 450_000), (1, 12),
     ["Dầu gội", "Sữa tắm", "Kem đánh răng", "Nước súc miệng", "Sữa rửa mặt", "Lăn khử mùi",
      "Dầu xả", "Kem dưỡng da tay", "Bàn chải đánh răng", "Khăn giấy ướt"],
     ["chai 650g", "chai 900ml", "tuýp 180g (lốc 3)", "gói 100 tờ (lốc 4)"]),
    ("TR", "Chất tẩy rửa", 30, False, None, "FMCG", (30_000, 260_000), (4, 30),
     ["Nước rửa chén", "Bột giặt", "Nước giặt", "Nước xả vải", "Nước lau sàn",
      "Nước tẩy bồn cầu", "Nước lau kính", "Viên tẩy lồng giặt"],
     ["chai 750ml (thùng 12)", "túi 3kg (bao 4)", "can 3.6L (thùng 4)", "túi 6kg (bao 2)"]),
    ("VP", "Văn phòng phẩm", 25, False, None, "FULFILLMENT", (15_000, 120_000), (0.5, 12),
     ["Giấy A4 70gsm", "Giấy A4 80gsm", "Bút bi xanh", "Bút bi đỏ", "Bút dạ quang",
      "Bìa hồ sơ", "Kẹp giấy", "Băng keo trong", "Sổ tay", "Giấy note"],
     ["ram 500 tờ", "hộp 20 cây", "hộp 10 cái", "cuộn 100 yard (lốc 6)"]),
    ("DG", "Điện gia dụng", 25, False, None, "HEAVY", (180_000, 1_350_000), (2, 28),
     ["Ấm siêu tốc", "Nồi cơm điện", "Quạt đứng", "Máy xay sinh tố", "Bàn ủi hơi nước",
      "Nồi chiên không dầu", "Bếp điện từ", "Máy sấy tóc", "Đèn bàn LED", "Ổ cắm điện"],
     ["1.7L", "1.8L", "3.5L", "2000W", "loại cơ bản", "loại cao cấp"]),
]

VENDORS = [
    ("Công ty TNHH Demo Nước Giải Khát An Phát", ["DU"]),
    ("Công ty CP Demo Sữa Việt Xanh", ["SU"]),
    ("Công ty TNHH Demo Thực Phẩm Hảo Vị", ["TP"]),
    ("Công ty TNHH Demo Gia Vị Thiên Hương", ["GV", "TP"]),
    ("Công ty CP Demo Hóa Mỹ Phẩm Bảo Ngọc", ["HM"]),
    ("Công ty TNHH Demo Tẩy Rửa Phú Gia", ["TR"]),
    ("Công ty TNHH Demo Văn Phòng Phẩm Kim Long", ["VP"]),
    ("Công ty CP Demo Điện Gia Dụng Đại Nam", ["DG"]),
    ("Công ty TNHH Demo Thương Mại Minh Tâm", ["DU", "TP", "TR"]),
    ("Công ty TNHH Demo Phân Phối Sơn Lộc Miền Bắc", ["SU", "GV", "HM"]),
]

DEALERS = [
    # code, name, warehouse index, has_contract
    ("KH-0001", "Đại lý Demo Minh Phát", 0, True),
    ("KH-0002", "Siêu thị mini Demo Hòa Bình", 0, True),
    ("KH-0003", "Tạp hóa Demo Cô Ba", 0, False),
    ("KH-0004", "Nhà phân phối Demo Tân Tiến", 0, True),
    ("KH-0005", "Cửa hàng Demo Phúc An", 0, False),
    ("KH-0006", "Chuỗi cửa hàng Demo Xanh Mart", 0, True),
    ("KH-0007", "Đại lý Demo Thuận Thành", 0, False),
    ("KH-0008", "Căn tin Demo KCN Sóng Thần", 0, True),
    ("KH-0009", "Nhà hàng Demo Bếp Quê", 0, False),
    ("KH-0010", "Đại lý Demo Hồng Hà", 1, True),
    ("KH-0011", "Siêu thị mini Demo Phố Cổ", 1, True),
    ("KH-0012", "Tạp hóa Demo Bà Tư", 1, False),
    ("KH-0013", "Nhà phân phối Demo Kinh Bắc", 1, False),
    ("KH-0014", "Cửa hàng Demo Gia Lâm", 1, False),
]

SURNAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng",
            "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"]
MIDDLE = ["Văn", "Thị", "Hữu", "Minh", "Ngọc", "Thanh", "Quốc", "Gia", "Bảo", "Thu", "Đức", "Kim"]
GIVEN = ["An", "Bình", "Châu", "Dũng", "Giang", "Hà", "Hải", "Hạnh", "Hoa", "Hùng", "Khánh",
         "Lan", "Linh", "Long", "Mai", "Nam", "Nga", "Phong", "Phúc", "Quân", "Quỳnh", "Sơn",
         "Tâm", "Thảo", "Thắng", "Trang", "Trung", "Tuấn", "Vy", "Yến"]

REGIONS = [
    # warehouse index -> [(province, [districts])]
    [("TP.HCM", ["Quận 1", "Quận 3", "Quận 7", "Quận 10", "Q. Bình Thạnh", "Q. Gò Vấp",
                 "TP. Thủ Đức", "Q. Tân Bình"]),
     ("Bình Dương", ["TP. Thủ Dầu Một", "TP. Dĩ An", "TP. Thuận An"]),
     ("Đồng Nai", ["TP. Biên Hòa", "H. Long Thành"]),
     ("Long An", ["TP. Tân An", "H. Đức Hòa"]),
     ("Cần Thơ", ["Q. Ninh Kiều", "Q. Cái Răng"])],
    [("Hà Nội", ["Q. Ba Đình", "Q. Cầu Giấy", "Q. Long Biên", "Q. Hoàng Mai", "Q. Đống Đa",
                 "H. Gia Lâm"]),
     ("Hải Phòng", ["Q. Lê Chân", "Q. Ngô Quyền"]),
     ("Bắc Ninh", ["TP. Bắc Ninh", "TP. Từ Sơn"]),
     ("Hưng Yên", ["TP. Hưng Yên", "H. Văn Lâm"])],
]

# channel, source_system, order_source, order_origin, weight
CHANNELS = [
    ("shopee", "shopee", "web", "shopee", 30),
    ("lazada", "lazada", "web", "lazada", 14),
    ("tiktok", "tiktok-shop", "web", "tiktok", 12),
    ("erp", "erp-sonloc", "web", "dai-ly", 26),
    ("web", None, "web", "website", 10),
    ("pos", None, "pos", "cua-hang", 8),
]
SOURCE_SYSTEMS = [("shopee", "Sàn Shopee (demo connector)"),
                  ("lazada", "Sàn Lazada (demo connector)"),
                  ("tiktok-shop", "TikTok Shop (demo connector)"),
                  ("erp-sonloc", "ERP nội bộ Sơn Lộc (demo connector)")]

CARRIERS = ["GHN", "GHTK", "Viettel Post", "J&T Express"]

USERS = [
    # username, full name, role, warehouse idx list, mobile functions, page keys, activity
    ("admin", "Quản trị viên", "ADMIN", [0, 1], [], [], None),
    ("quanly.hcm", "Lê Minh Quản Lý (demo)", "ADMIN", [0, 1], [], [], None),
    ("giamsat.hcm", "Phạm Thu Giám Sát (demo)", "USER", [0],
     ["receive", "putaway", "pick", "pack", "ship", "count", "transfer"],
     ["dashboard", "inventory", "cycle-counts", "count-approvals", "purchase-orders",
      "receiving", "putaway", "sales-orders", "backorders", "expiry", "pallets",
      "ai-assistant", "adjustments", "items", "bins", "zones", "preferred-bins"], None),
    ("ketoan", "Trần Ngọc Kế Toán (demo)", "USER", [0, 1], [],
     ["dashboard", "billing", "sales-orders", "purchase-orders", "vendors"], None),
    ("nv.nhanhang1", "Nguyễn Văn Nhận (demo)", "USER", [0], ["receive", "putaway"], [], "receive"),
    ("nv.nhanhang2", "Võ Thị Hàng (demo)", "USER", [0], ["receive", "putaway", "transfer"], [], "receive"),
    ("nv.soanhang1", "Đặng Quốc Soạn (demo)", "USER", [0], ["pick", "pack"], [], "pick"),
    ("nv.soanhang2", "Bùi Thị Lựa (demo)", "USER", [0], ["pick", "pack"], [], "pick"),
    ("nv.soanhang3", "Hồ Gia Nhặt (demo)", "USER", [0], ["pick"], [], "pick"),
    ("nv.donggoi1", "Ngô Kim Gói (demo)", "USER", [0], ["pack", "ship"], [], "pack"),
    ("nv.giaohang1", "Dương Đức Giao (demo)", "USER", [0], ["ship"], [], "ship"),
    ("nv.kiemke1", "Lý Thanh Đếm (demo)", "USER", [0], ["count"], [], "count"),
    ("giamsat.hn", "Hoàng Hải Giám Sát (demo)", "USER", [1],
     ["receive", "putaway", "pick", "pack", "ship", "count"],
     ["dashboard", "inventory", "cycle-counts", "count-approvals", "sales-orders",
      "backorders", "expiry", "ai-assistant"], None),
    ("nv.hn.kho1", "Phan Văn Kho (demo)", "USER", [1], ["receive", "putaway", "pick", "pack", "ship"], [], "all"),
    ("nv.hn.kho2", "Vũ Thị Bãi (demo)", "USER", [1], ["pick", "pack", "ship", "count"], [], "all"),
]


# =============================================================== generators

class Gen:
    """Builds every row in memory, then writes in FK order."""

    def __init__(self, cur, admin_pw, staff_pw):
        self.cur = cur
        self.admin_pw = admin_pw
        self.staff_pw = staff_pw
        self.now = datetime.now(VN_TZ).replace(microsecond=0)
        self.today = self.now.date()
        self.start_day = self.today - timedelta(days=HISTORY_DAYS - 1)
        self.audit = []           # audit_log rows
        self.wh_ids = []
        self.bins = []            # per warehouse: dict kind -> [bin dict]
        self.items = []
        self.counts = {}

    # ------------------------------------------------------------- base
    def base(self):
        cur = self.cur
        self.wh_ids = insert(cur, "warehouses",
                             ["warehouse_code", "warehouse_name", "address", "timezone"],
                             [{"warehouse_code": w["code"], "warehouse_name": w["name"],
                               "address": w["address"], "timezone": "Asia/Ho_Chi_Minh"}
                              for w in WAREHOUSES], "warehouse_id")
        for wi, w in enumerate(WAREHOUSES):
            wid = self.wh_ids[wi]
            zrows = [{"warehouse_id": wid, "zone_code": z[0], "zone_name": z[1], "zone_type": z[2],
                      "color_hex": z[3]} for z in ZONES]
            zids = insert(cur, "zones", ["warehouse_id", "zone_code", "zone_name", "zone_type",
                                         "color_hex"], zrows, "zone_id")
            zone = {z[0]: zid for z, zid in zip(ZONES, zids)}
            rows = []

            def add(kind, zcode, code, btype, desc, seq=0, aisle=None, row=None, level=None,
                    pos=None, mw=None, mv=None):
                rows.append({"kind": kind, "zone_id": zone[zcode], "warehouse_id": wid,
                             "bin_code": code, "bin_barcode": f"{w['short']}-{code}",
                             "bin_type": btype, "aisle": aisle, "row_num": row,
                             "level_num": level, "position_num": pos,
                             "pick_sequence": seq, "putaway_sequence": seq,
                             "max_weight_lbs": mw, "max_volume_cuft": mv,
                             "description": desc, "external_id": uid()})

            for i in range(1, 7 if wi == 0 else 4):
                add("rcv", "RCV", f"RCV-{i:02d}", "Staging", f"Ô nhận hàng cửa {i}")
            seq = 100
            for a in w["pick_aisles"]:
                for r in range(1, w["pick_rows"] + 1):
                    for lv in range(1, 4):
                        add("pick", "PICK", f"{a}-{r:02d}-{lv:02d}", "Pickable",
                            f"Kệ soạn {a}, khoang {r}, tầng {lv}", seq, a, f"{r:02d}",
                            f"{lv:02d}", "01", 400, 30)
                        seq += 10
            seq = 5000
            for rk in range(1, w["bulk_racks"] + 1):
                for p in range(1, w["bulk_pos"] + 1):
                    for lv in range(1, 3):
                        add("bulk", "BULK", f"R{rk}-{p:02d}-{lv}", "Pickable",
                            f"Kệ pallet R{rk}, vị trí {p}, tầng {lv}", seq, f"R{rk}",
                            f"{p:02d}", f"{lv:02d}", "01", 2500, 90)
                        seq += 10
            for i in range(1, 5 if wi == 0 else 3):
                add("stage", "STAGE", f"STG-{i:02d}", "Staging", f"Ô tập kết xuất {i}")
            for i in range(1, 5 if wi == 0 else 3):
                add("ship", "SHIP", f"DOCK-{i:02d}", "Pickable", f"Cửa xuất {i}")
            add("qc", "QC", "QC-01", "Staging", "Bàn kiểm tra chất lượng")
            cols = ["zone_id", "warehouse_id", "bin_code", "bin_barcode", "bin_type", "aisle",
                    "row_num", "level_num", "position_num", "pick_sequence", "putaway_sequence",
                    "max_weight_lbs", "max_volume_cuft", "description", "external_id"]
            ids = insert(cur, "bins", cols, rows, "bin_id")
            by = {}
            for r, bid in zip(rows, ids):
                r["bin_id"] = bid
                by.setdefault(r["kind"], []).append(r)
            self.bins.append(by)

    def users(self):
        cur = self.cur
        admin_hash = bcrypt.hashpw(self.admin_pw.encode(), bcrypt.gensalt()).decode()
        staff_hash = bcrypt.hashpw(self.staff_pw.encode(), bcrypt.gensalt()).decode()
        rows = []
        for u in USERS:
            whs = [self.wh_ids[i] for i in u[3]]
            rows.append({"username": u[0], "password_hash": admin_hash if u[0] == "admin" else staff_hash,
                         "full_name": u[1], "role": u[2], "warehouse_id": whs[0],
                         "warehouse_ids": whs, "allowed_functions": u[4] or "{}",
                         "must_change_password": False,
                         "last_login": self.now - timedelta(hours=rng.randint(1, 40)),
                         "password_changed_at": self.now - timedelta(days=30),
                         "external_id": uid()})
        ids = insert(cur, "users", ["username", "password_hash", "full_name", "role",
                                    "warehouse_id", "warehouse_ids", "allowed_functions",
                                    "must_change_password", "last_login", "password_changed_at",
                                    "external_id"], rows, "user_id")
        self.user_ids = dict(zip([u[0] for u in USERS], ids))
        perms = []
        for u in USERS:
            for pk in u[5]:
                perms.append({"user_id": self.user_ids[u[0]], "page_key": pk,
                              "granted_by": self.user_ids["admin"]})
        insert(cur, "user_page_permissions", ["user_id", "page_key", "granted_by"], perms)

        def staff(wi, act):
            return [u[0] for u in USERS if u[6] and (u[6] == act or u[6] == "all")
                    and wi in u[3]]
        self.staff = {wi: {a: staff(wi, a) for a in ("receive", "pick", "pack", "ship", "count")}
                      for wi in range(len(WAREHOUSES))}

    def settings(self):
        rcv1 = self.bins[0]["rcv"][0]["bin_id"]
        rows = [("session_timeout_hours", "8"), ("require_packing_before_shipping", "true"),
                ("default_receiving_bin", str(rcv1)), ("allow_over_receiving", "true"),
                ("ai_suggestions_enabled", "true"), ("ai_daily_call_limit", "200")]
        insert(self.cur, "app_settings", ["key", "value"], [{"key": k, "value": v} for k, v in rows])
        insert(self.cur, "inbound_source_systems_allowlist", ["source_system", "kind", "notes"],
               [{"source_system": s, "kind": "connector", "notes": n} for s, n in SOURCE_SYSTEMS])

    # ------------------------------------------------------------- master data
    def master(self):
        cur = self.cur
        # vendors
        vrows = []
        for i, (name, cats) in enumerate(VENDORS, 1):
            vrows.append({"canonical_id": uid(), "external_id": uid(), "vendor_name": name,
                          "contact_name": f"{rng.choice(SURNAMES)} {rng.choice(MIDDLE)} {rng.choice(GIVEN)} (demo)",
                          "email": f"ncc{i:02d}@example.com", "phone": f"000{rng.randint(1000000, 9999999)}",
                          "billing_address": f"Số {rng.randint(1, 200)} Đường Demo {i}, KCN Thử Nghiệm (địa chỉ giả)",
                          "tax_id": f"000000{i:04d}", "payment_terms": rng.choice(["NET 30", "NET 45", "NET 15"]),
                          "is_active": True, "cats": cats})
        insert(cur, "vendors", ["canonical_id", "external_id", "vendor_name", "contact_name", "email",
                                "phone", "billing_address", "tax_id", "payment_terms", "is_active"], vrows)
        self.vendors = vrows

        # customers (B2B dealers / 3PL clients)
        crows = []
        for code, name, wi, contract in DEALERS:
            prov, dists = rng.choice(REGIONS[wi])
            crows.append({"canonical_id": uid(), "external_id": uid(), "customer_code": code,
                          "customer_name": name,
                          "contact_person": f"{rng.choice(SURNAMES)} {rng.choice(MIDDLE)} {rng.choice(GIVEN)} (demo)",
                          "email": f"{code.lower().replace('-', '')}@example.com",
                          "phone": f"000{rng.randint(1000000, 9999999)}",
                          "billing_address": f"Số {rng.randint(1, 300)} Đường Demo {rng.randint(1, 40)}, {rng.choice(dists)}, {prov} (địa chỉ giả)",
                          "tax_id": f"0000{rng.randint(100000, 999999)}",
                          "payment_terms_days": rng.choice([15, 30, 30, 45]),
                          "is_active": True, "wi": wi, "contract": contract, "prov": prov,
                          "dists": dists})
        for c in crows:
            c["shipping_address"] = c["billing_address"]
        insert(cur, "customers", ["canonical_id", "external_id", "customer_code", "customer_name",
                                  "contact_person", "email", "phone", "billing_address",
                                  "shipping_address", "tax_id", "payment_terms_days", "is_active"], crows)
        self.dealers = crows

        # items
        items = []
        for code, cname, count, lot, shelf, profile, prange, wrange, prods, sizes in CATEGORIES:
            combos = [(p, b, s) for p in prods for b in BRANDS for s in sizes]
            rng.shuffle(combos)
            for n, (p, b, s) in enumerate(combos[:count], 1):
                price = round_vnd(rng.uniform(*prange))
                has_dims = rng.random() < 0.7
                weight = round(rng.uniform(*wrange), 2)
                items.append({
                    "sku": f"{code}-{n:04d}", "item_name": f"{p} {b} {s}",
                    "description": f"{p} thương hiệu {b} (dữ liệu demo), quy cách {s}",
                    "upc": f"893{rng.randint(0, 9_999_999_999):010d}",
                    "category": cname, "storage_profile": profile,
                    "weight_lbs": weight if has_dims or rng.random() < 0.5 else None,
                    "length_in": round(rng.uniform(8, 20), 1) if has_dims else None,
                    "width_in": round(rng.uniform(6, 14), 1) if has_dims else None,
                    "height_in": round(rng.uniform(4, 12), 1) if has_dims else None,
                    "is_lot_tracked": lot, "shelf": shelf, "price": price, "cat": code,
                    "external_id": uid(),
                })
        rng.shuffle(items)
        # popularity (Zipf-ish) drives demand
        for rank, it in enumerate(items, 1):
            it["pop"] = 1.0 / (rank ** 0.85)
        items.sort(key=lambda r: r["sku"])
        self.items = items

        # default pick bins (aisles except the last one stay occupied; last aisle empty
        # so put-away has empty destinations)
        w0 = self.bins[0]
        last_aisle = WAREHOUSES[0]["pick_aisles"][-1]
        pick_slots = [b for b in w0["pick"] if b["aisle"] != last_aisle]
        for i, it in enumerate(items):
            it["pick_bin"] = pick_slots[i % len(pick_slots)]
        cols = ["sku", "item_name", "description", "upc", "category", "storage_profile",
                "weight_lbs", "length_in", "width_in", "height_in", "default_bin_id",
                "reorder_point", "reorder_qty", "is_lot_tracked", "external_id"]
        for it in items:
            it["default_bin_id"] = it["pick_bin"]["bin_id"]
            it["reorder_point"] = 0
            it["reorder_qty"] = 0
        ids = insert(cur, "items", cols, items, "item_id")
        for it, iid in zip(items, ids):
            it["item_id"] = iid
        self.item_by_id = {it["item_id"]: it for it in items}

    # ------------------------------------------------------------- sales
    def _customer(self, wi, n):
        prov, dists = REGIONS[wi][n % len(REGIONS[wi])]
        r = random.Random(RANDOM_SEED * 7 + wi * 100_000 + n)
        name = f"{r.choice(SURNAMES)} {r.choice(MIDDLE)} {r.choice(GIVEN)}"
        return {"name": name, "phone": f"000{r.randint(1000000, 9999999)}",
                "email": f"khach{wi}{n:05d}@example.com",
                "line1": f"Số {r.randint(1, 500)} Đường Demo {r.randint(1, 60)}",
                "line2": f"Phường Thử Nghiệm {r.randint(1, 20)}",
                "city": r.choice(dists), "state": prov}

    def sales(self):
        """Sales orders over HISTORY_DAYS for both warehouses."""
        weekday_f = [1.05, 1.0, 1.0, 1.05, 1.15, 0.7, 0.45]
        self.orders = []
        weights_all = [(it, it["pop"]) for it in self.items]
        for wi, w in enumerate(WAREHOUSES):
            wid = self.wh_ids[wi]
            dealers = [d for d in self.dealers if d["wi"] == wi]
            pool = weights_all if wi == 0 else [(it, it["pop"]) for it in self.items
                                                if it["pop"] > 0.012 or it["cat"] in ("DU", "TP")]
            pool_items = [p[0] for p in pool]
            cum = []
            acc = 0.0
            for _, wt in pool:
                acc += wt
                cum.append(acc)

            def draw():
                x = rng.uniform(0, acc)
                lo, hi = 0, len(cum) - 1
                while lo < hi:
                    mid = (lo + hi) // 2
                    if cum[mid] < x:
                        lo = mid + 1
                    else:
                        hi = mid
                return pool_items[lo]

            seq_by_day = {}
            for d in range(HISTORY_DAYS):
                day = self.start_day + timedelta(days=d)
                growth = 1 + 0.35 * d / (HISTORY_DAYS - 1)
                f = weekday_f[day.weekday()]
                if day.day == day.month:          # "ngày đôi" marketplace promos
                    f *= 1.8
                n = max(1, round(w["orders_per_day"] * growth * f * rng.gauss(1, 0.12)))
                if day == self.today:
                    n = max(4, round(n * min(1.0, (self.now.hour + 1) / 20)))
                for _ in range(n):
                    hour = rng.choice([8, 9, 9, 10, 10, 11, 12, 14, 15, 15, 16, 19, 20, 21, 21, 22]) + rng.random()
                    created = at(day, hour)
                    if day == self.today and created > self.now - timedelta(minutes=5):
                        created = self.now - timedelta(minutes=rng.randint(5, 600))
                        if created.date() != self.today:
                            created = at(self.today, 0.2 + rng.random())
                    ch = wchoice([(c, c[4]) for c in CHANNELS])
                    seq_by_day[day] = seq_by_day.get(day, 0) + 1
                    so = {"wi": wi, "warehouse_id": wid, "created": created, "channel": ch,
                          "so_number": f"SO-{w['short']}-{day:%y%m%d}-{seq_by_day[day]:04d}"}
                    if ch[0] == "erp":
                        dl = rng.choice(dealers)
                        so["dealer"] = dl
                        nlines = rng.randint(3, 9)
                        qty = lambda: rng.randint(2, 15)  # noqa: E731
                    else:
                        so["cust"] = self._customer(wi, rng.randint(0, 599 if wi == 0 else 249))
                        nlines = wchoice([(1, 45), (2, 30), (3, 15), (4, 7), (5, 3)])
                        qty = lambda: wchoice([(1, 60), (2, 25), (3, 10), (5, 5)])  # noqa: E731
                    lines = {}
                    for _ in range(nlines):
                        it = draw()
                        lines[it["item_id"]] = lines.get(it["item_id"], 0) + qty()
                    so["lines"] = list(lines.items())
                    self._status(so)
                    self.orders.append(so)

    def _status(self, so):
        created = so["created"]
        age_h = (self.now - created).total_seconds() / 3600
        r = rng.random()
        if age_h > 96:
            st = "CANCELLED" if r < 0.035 else "REFUNDED" if r < 0.045 else "SHIPPED"
        elif age_h > 24:
            st = ("CANCELLED" if r < 0.04 else "OPEN" if r < 0.10 else "PICKED" if r < 0.16
                  else "PACKED" if r < 0.26 else "SHIPPED")
        else:
            st = ("CANCELLED" if r < 0.02 else "FRAUD_REVIEW" if r < 0.05 else
                  "OPEN" if r < 0.50 else "PICKED" if r < 0.68 else "PACKED" if r < 0.82
                  else "SHIPPED")
        so["status"] = st
        picked = created + timedelta(hours=rng.uniform(0.5, 6))
        packed = picked + timedelta(hours=rng.uniform(0.2, 2))
        shipped = packed + timedelta(hours=rng.uniform(1, 20))
        if shipped > self.now - timedelta(minutes=2):
            span = (self.now - timedelta(minutes=2) - created).total_seconds()
            picked = created + timedelta(seconds=span * 0.35)
            packed = created + timedelta(seconds=span * 0.55)
            shipped = created + timedelta(seconds=span * 0.9)
        so["picked_at"] = picked if st in ("PICKED", "PACKED", "SHIPPED", "REFUNDED") else None
        so["packed_at"] = packed if st in ("PACKED", "SHIPPED", "REFUNDED") else None
        so["shipped_at"] = shipped if st in ("SHIPPED", "REFUNDED") else None

    # ------------------------------------------------------------- stock plan
    def stock_plan(self):
        """Derive reorder points from demand and decide target on-hand."""
        demand = [{}, {}]
        recent = self.now - timedelta(days=30)
        for so in self.orders:
            if so["created"] < recent or so["status"] == "CANCELLED":
                continue
            for iid, q in so["lines"]:
                demand[so["wi"]][iid] = demand[so["wi"]].get(iid, 0) + q
        for it in self.items:
            daily = demand[0].get(it["item_id"], 0) / 30.0
            it["daily"] = daily
            it["daily_hn"] = demand[1].get(it["item_id"], 0) / 30.0
            if daily > 0.05:
                it["reorder_point"] = max(5, math.ceil(daily * rng.uniform(8, 14)))
                it["reorder_qty"] = max(10, int(math.ceil(daily * 30 / 10.0) * 10))
            elif rng.random() < 0.5:
                it["reorder_point"] = rng.choice([3, 5, 8])
                it["reorder_qty"] = rng.choice([10, 20])
        # pick replenishment / backorder groups among items with demand
        movers = sorted([it for it in self.items if it["reorder_point"] > 0],
                        key=lambda r: -r["daily"])
        cand = movers[5:120]
        rng.shuffle(cand)
        self.low = cand[:28]                       # W1 at/below reorder point
        self.bo_wait_po = self.low[:5]             # backorder covered by PO arriving soon
        self.bo_transfer = self.low[5:9]           # backorder covered by stock in HN
        self.bo_partial = self.low[9:13]           # some local stock, no PO
        self.bo_none = self.low[13:16]             # nothing anywhere -> create PO
        self.low_po_far = self.low[16:22]          # low stock, PO due in 2-3 weeks
        self.low_po_late = self.low[22:25]         # low stock, PO overdue
        for it in self.items:
            it["w1_target"] = (max(0, int(it["reorder_point"] * rng.uniform(1.6, 4.0)) + rng.randint(0, 20))
                               if it["reorder_point"] else rng.randint(0, 25))
        for it in self.low:
            it["w1_target"] = int(it["reorder_point"] * rng.uniform(0.15, 0.85))
        for it in self.bo_wait_po + self.bo_none + self.bo_transfer:
            it["w1_target"] = rng.randint(0, 2)
        for it in self.bo_partial:
            it["w1_target"] = rng.randint(3, 6)
        for it in self.items:
            if it["daily_hn"] > 0 or it in self.bo_transfer:
                it["w2_target"] = max(5, int(it["daily_hn"] * rng.uniform(15, 40)) + rng.randint(0, 15))
                # reorder points are per item (global): keep most HN stock above them
                if it["reorder_point"] and rng.random() < 0.9:
                    it["w2_target"] = max(it["w2_target"],
                                          int(it["reorder_point"] * rng.uniform(1.2, 2.5)) + 1)
            else:
                it["w2_target"] = 0
        for it in self.bo_transfer:
            it["w2_target"] = max(it["w2_target"], 120)
        for it in self.bo_none:
            it["w2_target"] = 0
        cur = self.cur
        execute_values(cur, """UPDATE items AS i SET reorder_point = v.rp, reorder_qty = v.rq
                               FROM (VALUES %s) AS v(id, rp, rq) WHERE i.item_id = v.id""",
                       [(it["item_id"], it["reorder_point"], it["reorder_qty"]) for it in self.items])

    # ------------------------------------------------------------- inventory
    def inventory(self):
        cur = self.cur
        inv_rows = []
        pallets = []
        self.lot_seq = 0
        expired_left = 7
        near_left = 16

        def lots_for(it, total):
            """Split total into lots with expiry dates."""
            nonlocal expired_left, near_left
            if not it["is_lot_tracked"] or total <= 0:
                return [(None, None, total)]
            k = 1 if total < 15 else rng.choice([1, 2, 2, 3])
            parts = [total // k] * k
            parts[0] += total - sum(parts)
            out = []
            for i, q in enumerate(parts):
                self.lot_seq += 1
                lo, hi = it["shelf"]
                exp = self.today + timedelta(days=rng.randint(int(lo * 0.3), hi))
                if i == 0 and expired_left > 0 and rng.random() < 0.08:
                    exp = self.today - timedelta(days=rng.randint(1, 25))
                    expired_left -= 1
                elif i == 0 and near_left > 0 and rng.random() < 0.15:
                    exp = self.today + timedelta(days=rng.randint(2, 29))
                    near_left -= 1
                mfg = exp - timedelta(days=hi)
                out.append((f"L{mfg:%y%m%d}-{self.lot_seq:04d}", exp, q))
            return out

        for wi in range(len(WAREHOUSES)):
            wid = self.wh_ids[wi]
            bins = self.bins[wi]
            bulk = list(bins["bulk"])
            bulk_used = bulk[:-6]                 # keep a few bulk slots empty
            pick_bins = bins["pick"]
            for n, it in enumerate(self.items):
                total = it["w1_target"] if wi == 0 else it["w2_target"]
                if wi == 1 and total <= 0:
                    continue
                pick_bin = it["pick_bin"] if wi == 0 else pick_bins[n % (len(pick_bins) - 3)]
                it.setdefault("pick_bins", {})[wi] = pick_bin
                in_pick = total if total < 40 else int(total * rng.uniform(0.3, 0.5))
                in_bulk = total - in_pick
                for lot, exp, q in lots_for(it, in_pick):
                    inv_rows.append({"item_id": it["item_id"], "bin_id": pick_bin["bin_id"],
                                     "warehouse_id": wid, "quantity_on_hand": q,
                                     "lot_number": lot, "expiry_date": exp, "wi": wi})
                if in_bulk > 0:
                    bb = bulk_used[n % len(bulk_used)]
                    it.setdefault("bulk_bins", {})[wi] = bb
                    for lot, exp, q in lots_for(it, in_bulk):
                        pal = {"pallet_code": f"PL-{WAREHOUSES[wi]['short']}-{len(pallets) + 1:05d}",
                               "item_id": it["item_id"], "warehouse_id": wid,
                               "bin_id": bb["bin_id"], "quantity": q,
                               "weight_kg": round((it["weight_lbs"] or 5) * q * 0.4536, 1),
                               "lot_code": lot, "expiry_date": exp, "status": "STORED",
                               "created_by": "nv.nhanhang1" if wi == 0 else "nv.hn.kho1",
                               "created_at": self.now - timedelta(days=rng.randint(3, 90)),
                               "external_id": uid()}
                        pal["pallet_barcode"] = pal["pallet_code"]
                        pallets.append(pal)
                        inv_rows.append({"item_id": it["item_id"], "bin_id": bb["bin_id"],
                                         "warehouse_id": wid, "quantity_on_hand": q,
                                         "lot_number": lot, "expiry_date": exp, "wi": wi,
                                         "pallet": pal})
        pids = insert(cur, "pallets", ["pallet_code", "pallet_barcode", "item_id", "warehouse_id",
                                       "bin_id", "quantity", "weight_kg", "lot_code", "expiry_date",
                                       "status", "created_by", "created_at", "external_id"],
                      pallets, "pallet_id")
        for p, pid in zip(pallets, pids):
            p["pallet_id"] = pid
        for r in inv_rows:
            r["pallet_id"] = r["pallet"]["pallet_id"] if r.get("pallet") else None
            r["quantity_allocated"] = 0
            r["last_counted_at"] = None
        self.inv_rows = inv_rows

    # ------------------------------------------------------------- backorders
    def backorders(self):
        """WAITING_STOCK backorder children of recently shipped W1/W2 orders."""
        groups = ([(it, 0) for it in self.bo_wait_po + self.bo_transfer + self.bo_partial + self.bo_none])
        parents = [so for so in self.orders if so["wi"] == 0 and so["status"] == "SHIPPED"
                   and timedelta(days=1) < self.now - so["created"] < timedelta(days=18)]
        rng.shuffle(parents)
        hn_parents = [so for so in self.orders if so["wi"] == 1 and so["status"] == "SHIPPED"
                      and timedelta(days=1) < self.now - so["created"] < timedelta(days=12)]
        rng.shuffle(hn_parents)
        bos = []
        for i, (it, _) in enumerate(groups):
            parent = parents[i]
            lines = [(it["item_id"], rng.randint(8, 30))]
            if i % 4 == 0:
                other = groups[(i + 1) % len(groups)][0]
                lines.append((other["item_id"], rng.randint(4, 12)))
            bos.append((parent, lines, "WAITING_STOCK"))
        # a couple more waiting on W2 (HN) low items
        hn_low = [it for it in self.items if it["w2_target"] and it["daily_hn"] > 0.2][:3]
        for j, it in enumerate(hn_low):
            if j < len(hn_parents):
                bos.append((hn_parents[j], [(it["item_id"], it["w2_target"] + rng.randint(10, 25))],
                            "WAITING_STOCK"))
        # cancelled backorders for history
        for parent in parents[len(groups):len(groups) + 3]:
            it = rng.choice(self.low)
            bos.append((parent, [(it["item_id"], rng.randint(5, 15))], "CANCELLED"))
        for parent, lines, st in bos:
            opened = parent["shipped_at"] or parent["created"] + timedelta(hours=2)
            so = {"wi": parent["wi"], "warehouse_id": parent["warehouse_id"],
                  "created": opened, "channel": parent["channel"],
                  "so_number": f"{parent['so_number']}-BO", "lines": lines, "status": st,
                  "picked_at": None, "packed_at": None, "shipped_at": None,
                  "order_type": "backorder", "parent": parent, "backorder_opened_at": opened,
                  "cancellation_reason": "customer_asked" if st == "CANCELLED" else None}
            if "dealer" in parent:
                so["dealer"] = parent["dealer"]
            else:
                so["cust"] = parent["cust"]
            self.orders.append(so)

    # ------------------------------------------------------------- write sales
    def write_sales(self):
        cur = self.cur
        rows = []
        for so in self.orders:
            ch = so["channel"]
            wi = so["wi"]
            total = sum(self.item_by_id[i]["price"] * q for i, q in so["lines"])
            if "dealer" in so:
                d = so["dealer"]
                name, phone, email = d["customer_name"], d["phone"], d["email"]
                line1, line2, city, state = d["billing_address"], None, rng.choice(d["dists"]), d["prov"]
                cust_id, cust_ref = d["customer_code"], d["canonical_id"]
                total = total * 0.92               # dealer discount
                ship_paid = 0
                method = "Xe tải công ty"
            else:
                c = so["cust"]
                name, phone, email = c["name"], c["phone"], c["email"]
                line1, line2, city, state = c["line1"], c["line2"], c["city"], c["state"]
                cust_id = cust_ref = None
                ship_paid = 0 if ch[0] == "pos" else rng.choice([0, 15000, 22000, 30000])
                method = "Nhận tại cửa hàng" if ch[0] == "pos" else rng.choice(["Giao tiêu chuẩn", "Giao nhanh"])
            addr = ", ".join(x for x in (line1, line2, city, state) if x)
            carrier = None
            tracking = None
            if so["shipped_at"]:
                carrier = "Xe nhà Sơn Lộc" if "dealer" in so else (None if ch[0] == "pos" else rng.choice(CARRIERS))
                if carrier and carrier != "Xe nhà Sơn Lộc":
                    tracking = f"DEMO{rng.randint(10**9, 10**10 - 1)}"
            so["row"] = {
                "so_number": so["so_number"], "so_barcode": so["so_number"],
                "customer_name": name, "customer_id": cust_id, "customer_phone": phone,
                "customer_email": email, "customer_address": addr, "customer_ref": cust_ref,
                "status": so["status"], "priority": 1 if ch[0] == "erp" else 0,
                "warehouse_id": so["warehouse_id"], "ship_method": method, "ship_address": addr,
                "shipping_address_name": name, "shipping_address_line1": line1,
                "shipping_address_line2": line2, "shipping_address_city": city,
                "shipping_address_state": state, "shipping_address_country": "VN",
                "shipping_address_phone": phone,
                "billing_address_name": name, "billing_address_line1": line1,
                "billing_address_city": city, "billing_address_state": state,
                "billing_address_country": "VN", "billing_address_phone": phone,
                "order_total": round_vnd(total), "customer_shipping_paid": ship_paid,
                "memo": rng.choice([None, None, None, "Gọi trước khi giao", "Giao giờ hành chính",
                                    "Hàng dễ vỡ, đóng gói kỹ"]),
                "order_date": so["created"], "ship_by_date": (so["created"] + timedelta(days=4 if ch[0] == "erp" else 2)).date(),
                "created_at": so["created"], "picked_at": so["picked_at"], "packed_at": so["packed_at"],
                "shipped_at": so["shipped_at"], "carrier": carrier, "tracking_number": tracking,
                "created_by": "erp-sync" if ch[1] else "admin", "external_id": uid(),
                "source_system": ch[1], "order_origin": ch[3], "order_source": ch[2],
                "order_type": so.get("order_type", "sale"),
                "refunded_at": so["shipped_at"] + timedelta(days=2) if so["status"] == "REFUNDED" else None,
                "backorder_opened_at": so.get("backorder_opened_at"),
                "cancellation_reason": so.get("cancellation_reason") or (
                    rng.choice(["customer_asked", "other"]) if so["status"] == "CANCELLED" else None),
                "printed_at": so["picked_at"] - timedelta(minutes=20) if so["picked_at"] else None,
            }
            rows.append(so["row"])
        cols = list(rows[0].keys())
        ids = insert(cur, "sales_orders", cols, rows, "so_id")
        for so, sid in zip(self.orders, ids):
            so["so_id"] = sid
        execute_values(cur, "UPDATE sales_orders AS s SET parent_so_id = v.p FROM (VALUES %s) AS v(id, p) WHERE s.so_id = v.id",
                       [(so["so_id"], so["parent"]["so_id"]) for so in self.orders if so.get("parent")])
        # lines
        lrows = []
        for so in self.orders:
            st = so["status"]
            for n, (iid, q) in enumerate(so["lines"], 1):
                shipped = st in ("SHIPPED", "REFUNDED")
                lrows.append({"so_id": so["so_id"], "item_id": iid, "quantity_ordered": q,
                              "quantity_allocated": q if st in ("OPEN", "PICKED", "PACKED") else (q if shipped else 0),
                              "quantity_picked": q if st in ("PICKED", "PACKED") or shipped else 0,
                              "quantity_packed": q if st == "PACKED" or shipped else 0,
                              "quantity_shipped": q if shipped else 0, "line_number": n,
                              "status": ("SHIPPED" if shipped else "PACKED" if st == "PACKED"
                                         else "PICKED" if st == "PICKED" else "PENDING"),
                              "so": so})
        lids = insert(cur, "sales_order_lines",
                      ["so_id", "item_id", "quantity_ordered", "quantity_allocated", "quantity_picked",
                       "quantity_packed", "quantity_shipped", "line_number", "status"], lrows, "so_line_id")
        for r, lid in zip(lrows, lids):
            r["so_line_id"] = lid
            r["so"].setdefault("line_rows", []).append(r)

        # fulfillments for shipped orders
        frows = []
        for so in self.orders:
            if so["shipped_at"]:
                frows.append({"so_id": so["so_id"], "warehouse_id": so["warehouse_id"],
                              "tracking_number": so["row"]["tracking_number"],
                              "carrier": so["row"]["carrier"], "ship_method": so["row"]["ship_method"],
                              "status": "SHIPPED", "shipped_by": self._who(so["wi"], "ship"),
                              "shipped_at": so["shipped_at"], "external_id": uid(),
                              "shipping_cost": rng.choice([15000, 18000, 22000, 25000, 30000]) if so["row"]["tracking_number"] else None,
                              "so": so})
                so["shipper"] = frows[-1]["shipped_by"]
        fids = insert(cur, "item_fulfillments", ["so_id", "warehouse_id", "tracking_number", "carrier",
                                                 "ship_method", "status", "shipped_by", "shipped_at",
                                                 "external_id", "shipping_cost"], frows, "fulfillment_id")
        flines = []
        fallback = {wi: self.bins[wi]["pick"][0] for wi in range(len(WAREHOUSES))}
        for f, fid in zip(frows, fids):
            so = f["so"]
            for ln in so["line_rows"]:
                it = self.item_by_id[ln["item_id"]]
                # an item may have no stock row in W2: fall back to a W2 pick bin
                pb = it.get("pick_bins", {}).get(so["wi"]) or (
                    it["pick_bin"] if so["wi"] == 0 else fallback[so["wi"]])
                flines.append({"fulfillment_id": fid, "so_line_id": ln["so_line_id"],
                               "item_id": ln["item_id"], "quantity_shipped": ln["quantity_shipped"],
                               "bin_id": pb["bin_id"]})
        insert(cur, "item_fulfillment_lines", ["fulfillment_id", "so_line_id", "item_id",
                                               "quantity_shipped", "bin_id"], flines)

        # audit trail for productivity
        for so in self.orders:
            wid = so["warehouse_id"]
            if so["picked_at"]:
                picker = self._who(so["wi"], "pick")
                for ln in so["line_rows"]:
                    self.audit.append(("PICK", "SO", so["so_id"], picker, wid,
                                       {"so_number": so["so_number"], "item_id": ln["item_id"],
                                        "quantity": ln["quantity_ordered"]}, so["picked_at"]))
            if so["packed_at"]:
                self.audit.append(("PACK", "SO", so["so_id"], self._who(so["wi"], "pack"), wid,
                                   {"so_number": so["so_number"],
                                    "total_items": sum(q for _, q in so["lines"])}, so["packed_at"]))
            if so["shipped_at"]:
                self.audit.append(("SHIP", "SO", so["so_id"], so.get("shipper") or self._who(so["wi"], "ship"),
                                   wid, {"so_number": so["so_number"], "carrier": so["row"]["carrier"]},
                                   so["shipped_at"]))

    def _who(self, wi, act):
        return rng.choice(self.staff[wi][act] or self.staff[wi]["pick"])

    # ------------------------------------------------------------- purchasing
    def purchasing(self):
        cur = self.cur
        pos = []
        items_by_cat = {}
        for it in self.items:
            items_by_cat.setdefault(it["cat"], []).append(it)
        vendor_for_cat = {}
        for v in self.vendors:
            for c in v["cats"]:
                vendor_for_cat.setdefault(c, v)
        seq = 0

        def mk(wi, vendor, created, expected, lines, forced_status=None):
            nonlocal seq
            seq += 1
            pos.append({"wi": wi, "vendor": vendor, "created": created, "expected": expected,
                        "lines": lines, "forced": forced_status,
                        "po_number": f"PO-{WAREHOUSES[wi]['short']}-{created:%y%m}-{seq:04d}"})

        # routine replenishment POs every ~2 days (W1) / ~5 days (W2)
        for wi, step in ((0, 2), (1, 5)):
            d = -HISTORY_DAYS + 1
            while d <= 0:
                created = self.today + timedelta(days=d)
                vendor = rng.choice(self.vendors)
                pool = [it for c in vendor["cats"] for it in items_by_cat[c]
                        if (it["w1_target"] if wi == 0 else it["w2_target"]) > 0 or it["reorder_point"]]
                pool = [it for it in pool if it not in self.bo_none and it not in self.low]
                picks = rng.sample(pool, min(len(pool), rng.randint(4, 12)))
                lines = [(it, max(10, (it["reorder_qty"] or 20) + rng.randint(-5, 20))) for it in picks]
                mk(wi, vendor, created, created + timedelta(days=rng.randint(5, 14)), lines)
                d += step + rng.choice([0, 0, 1])
        # targeted POs for low-stock / backorder items
        def target(items, eta_days, status):
            by_v = {}
            for it in items:
                by_v.setdefault(vendor_for_cat[it["cat"]]["vendor_name"], []).append(it)
            for vname, its in by_v.items():
                v = next(x for x in self.vendors if x["vendor_name"] == vname)
                created = self.today - timedelta(days=rng.randint(3, 9))
                lines = [(it, max(it["reorder_qty"], 60)) for it in its]
                mk(0, v, created, self.today + timedelta(days=eta_days), lines, status)
        target(self.bo_wait_po, 3, "OPEN")
        target(self.low_po_far, 16, "OPEN")
        target(self.low_po_late, -4, "OPEN")
        target(self.low[25:], 6, "PARTIAL")

        # statuses + receipts
        receipts = []
        for po in pos:
            exp = po["expected"]
            days_to = (exp - self.today).days
            st = po["forced"]
            if st is None:
                if days_to <= -6:
                    st = "CLOSED" if rng.random() < 0.7 else "RECEIVED"
                elif days_to <= 0:
                    st = wchoice([("RECEIVED", 45), ("PARTIAL", 30), ("OPEN", 25)])
                else:
                    st = "PARTIAL" if rng.random() < 0.12 else "OPEN"
            po["status"] = st
            po["line_recv"] = []
            for it, q in po["lines"]:
                if st in ("CLOSED", "RECEIVED"):
                    rq = q
                elif st == "PARTIAL":
                    rq = int(q * rng.uniform(0.3, 0.8)) if rng.random() < 0.75 else 0
                else:
                    rq = 0
                po["line_recv"].append(rq)
            if st == "PARTIAL" and not any(po["line_recv"]):
                po["line_recv"][0] = max(1, po["lines"][0][1] // 2)
            recv_day = min(self.today, exp + timedelta(days=rng.randint(-2, 2)))
            if recv_day < po["created"]:
                recv_day = po["created"]
            if st == "PARTIAL" and recv_day > self.today - timedelta(days=1):
                recv_day = self.today - timedelta(days=rng.randint(0, 2))
            po["recv_at"] = at(recv_day, rng.uniform(7.5, 16)) if any(po["line_recv"]) else None
            if po["recv_at"] and po["recv_at"] > self.now:
                po["recv_at"] = self.now - timedelta(hours=rng.uniform(0.5, 3))

        prow = []
        for po in pos:
            v = po["vendor"]
            prow.append({"po_number": po["po_number"], "po_barcode": po["po_number"],
                         "vendor_name": v["vendor_name"], "vendor_id": v["canonical_id"],
                         "status": po["status"], "expected_date": po["expected"],
                         "warehouse_id": self.wh_ids[po["wi"]],
                         "notes": rng.choice([None, None, "Giao trong giờ hành chính", "Hàng khuyến mãi tháng"]),
                         "created_at": at(po["created"], rng.uniform(8, 17)),
                         "received_at": po["recv_at"] if po["status"] in ("RECEIVED", "CLOSED") else None,
                         "created_by": "quanly.hcm" if po["wi"] == 0 else "giamsat.hn",
                         "external_id": uid()})
        ids = insert(cur, "purchase_orders", list(prow[0].keys()), prow, "po_id")
        lrows = []
        for po, pid in zip(pos, ids):
            po["po_id"] = pid
            for n, ((it, q), rq) in enumerate(zip(po["lines"], po["line_recv"]), 1):
                lrows.append({"po_id": pid, "item_id": it["item_id"], "quantity_ordered": q,
                              "quantity_received": rq, "unit_cost": round(it["price"] * 0.72, 0),
                              "line_number": n,
                              "status": "RECEIVED" if rq >= q else "PARTIAL" if rq else "PENDING",
                              "po": po, "it": it})
        lids = insert(cur, "purchase_order_lines", ["po_id", "item_id", "quantity_ordered",
                                                    "quantity_received", "unit_cost", "line_number",
                                                    "status"], lrows, "po_line_id")
        transfers = []
        staged = []
        recs = []
        for ln, lid in zip(lrows, lids):
            if not ln["quantity_received"]:
                continue
            po, it = ln["po"], ln["it"]
            wi = po["wi"]
            rcv_bins = self.bins[wi]["rcv"]
            rbin = rcv_bins[po["po_id"] % len(rcv_bins)]
            lot = exp = None
            if it["is_lot_tracked"]:
                lo, hi = it["shelf"]
                exp = po["recv_at"].date() + timedelta(days=rng.randint(int(hi * 0.6), hi))
                lot = f"L{po['recv_at']:%y%m%d}-R{lid:05d}"
            who = self._who(wi, "receive")
            ts = po["recv_at"] + timedelta(minutes=rng.randint(0, 50))
            if ts > self.now:
                ts = self.now - timedelta(minutes=10)
            recs.append({"ln": ln, "lid": lid, "po": po, "it": it, "wi": wi, "rbin": rbin,
                         "lot": lot, "exp": exp, "who": who, "ts": ts})
            receipts.append({"po_id": po["po_id"], "po_line_id": lid, "item_id": it["item_id"],
                             "quantity_received": ln["quantity_received"], "bin_id": rbin["bin_id"],
                             "warehouse_id": self.wh_ids[wi], "lot_number": lot, "expiry_date": exp,
                             "received_by": who, "received_at": ts, "external_id": uid()})
            self.audit.append(("RECEIVE", "PO", po["po_id"], who, self.wh_ids[wi],
                               {"po_number": po["po_number"], "item_id": it["item_id"],
                                "quantity": ln["quantity_received"], "bin_id": rbin["bin_id"]}, ts))
        # the most recent receipts per warehouse are still waiting for put-away
        staged_keep = {0: 14, 1: 5}
        staged_idx = set()
        for wi, n in staged_keep.items():
            idx = sorted((i for i, r in enumerate(recs) if r["wi"] == wi),
                         key=lambda i: recs[i]["ts"], reverse=True)[:n]
            staged_idx.update(idx)
        for i, r in enumerate(recs):
            ln, it, wi, rbin, lot, exp, who, ts = (r["ln"], r["it"], r["wi"], r["rbin"], r["lot"],
                                                  r["exp"], r["who"], r["ts"])
            if i in staged_idx:
                staged.append({"item_id": it["item_id"], "bin_id": rbin["bin_id"],
                               "warehouse_id": self.wh_ids[wi], "quantity_on_hand": ln["quantity_received"],
                               "quantity_allocated": 0, "lot_number": lot, "expiry_date": exp,
                               "pallet_id": None, "last_counted_at": None, "wi": wi})
            else:
                dest = (it.get("bulk_bins", {}).get(wi) if ln["quantity_received"] > 40 else None)                     or it.get("pick_bins", {}).get(wi) or self.bins[wi]["pick"][0]
                tts = ts + timedelta(hours=rng.uniform(0.5, 5))
                if tts > self.now:
                    tts = self.now - timedelta(minutes=5)
                transfers.append({"item_id": it["item_id"], "from_bin_id": rbin["bin_id"],
                                  "to_bin_id": dest["bin_id"], "warehouse_id": self.wh_ids[wi],
                                  "quantity": ln["quantity_received"], "transfer_type": "PUTAWAY",
                                  "lot_number": lot, "reason": "Cất hàng sau nhận",
                                  "transferred_by": who, "transferred_at": tts, "external_id": uid()})
                self.audit.append(("PUTAWAY", "ITEM", it["item_id"], who, self.wh_ids[wi],
                                   {"quantity": ln["quantity_received"], "from_bin_id": rbin["bin_id"],
                                    "to_bin_id": dest["bin_id"]}, tts))
        insert(cur, "item_receipts", list(receipts[0].keys()), receipts)
        insert(cur, "bin_transfers", list(transfers[0].keys()), transfers)
        # merge staged lines that hit the same (item, bin, lot)
        merged = {}
        for s in staged:
            k = (s["item_id"], s["bin_id"], s["lot_number"])
            if k in merged:
                merged[k]["quantity_on_hand"] += s["quantity_on_hand"]
            else:
                merged[k] = s
        self.staged = list(merged.values())
        self.pos = pos

    # ------------------------------------------------------------- write inventory
    def write_inventory(self):
        cur = self.cur
        # allocate open demand against the pick-bin rows
        alloc = {}
        for so in self.orders:
            if so["status"] in ("OPEN",) and so.get("order_type", "sale") == "sale":
                for iid, q in so["lines"]:
                    alloc[(so["wi"], iid)] = alloc.get((so["wi"], iid), 0) + q
        for r in self.inv_rows:
            k = (r["wi"], r["item_id"])
            if k in alloc and r["quantity_on_hand"] > 0 and r.get("pallet") is None:
                a = min(alloc[k], r["quantity_on_hand"])
                r["quantity_allocated"] = a
                alloc[k] -= a
        rows = [r for r in self.inv_rows + self.staged]
        for r in rows:
            r["updated_at"] = self.now - timedelta(hours=rng.randint(1, 200))
        cols = ["item_id", "bin_id", "warehouse_id", "quantity_on_hand", "quantity_allocated",
                "lot_number", "expiry_date", "pallet_id", "last_counted_at", "updated_at"]
        ids = insert(cur, "inventory", cols, rows, "inventory_id")
        for r, i in zip(rows, ids):
            r["inventory_id"] = i
        self.all_inv = rows

        # preferred bins: pick bin (priority 1) and bulk (priority 2)
        # (item_id, priority) is unique, so priorities count up per item.
        pref = []
        for it in self.items:
            prio = 0
            for wi, b in sorted(it.get("pick_bins", {}).items()):
                if wi == 1 or rng.random() < 0.4:
                    prio += 1
                    pref.append({"item_id": it["item_id"], "bin_id": b["bin_id"], "priority": prio,
                                 "notes": "Vị trí soạn chính"})
            for wi, b in sorted(it.get("bulk_bins", {}).items()):
                if rng.random() < 0.3:
                    prio += 1
                    pref.append({"item_id": it["item_id"], "bin_id": b["bin_id"], "priority": prio,
                                 "notes": "Vị trí dự trữ pallet"})
        insert(cur, "preferred_bins", ["item_id", "bin_id", "priority", "notes"], pref)

    # ------------------------------------------------------------- cycle counts
    def cycle_counts(self):
        cur = self.cur
        by_bin = {}
        for r in self.all_inv:
            if r["bin_id"] in {b["bin_id"] for w in self.bins for b in w["rcv"]}:
                continue
            by_bin.setdefault((r["wi"], r["bin_id"]), {}).setdefault(r["item_id"], 0)
            by_bin[(r["wi"], r["bin_id"])][r["item_id"]] += r["quantity_on_hand"]
        counts, lines, adjs = [], [], []
        last_counted = {}
        for wi, n_total, n_var in ((0, 48, 7), (1, 14, 2)):
            keys = [k for k in by_bin if k[0] == wi]
            rng.shuffle(keys)
            keys = keys[:n_total]
            counter = (self.staff[wi]["count"] or self.staff[wi]["pick"])[0]
            for j, key in enumerate(keys):
                items = list(by_bin[key].items())[:8]
                if j < n_var:
                    status, created = "VARIANCE", self.now - timedelta(days=rng.randint(0, 9), hours=rng.randint(1, 6))
                elif j < n_var + 3:
                    status, created = "IN_PROGRESS", self.now - timedelta(hours=rng.randint(1, 5))
                elif j < n_var + 7:
                    status, created = "PENDING", self.now - timedelta(hours=rng.randint(1, 30))
                else:
                    status, created = "COMPLETED", self.now - timedelta(days=rng.randint(3, HISTORY_DAYS - 1))
                completed = created + timedelta(hours=rng.uniform(0.3, 3)) if status in ("COMPLETED", "VARIANCE") else None
                c = {"warehouse_id": self.wh_ids[wi], "bin_id": key[1], "status": status,
                     "assigned_to": counter, "created_at": created, "completed_at": completed,
                     "external_id": uid(), "items": items, "wi": wi}
                counts.append(c)
        ids = insert(cur, "cycle_counts", ["warehouse_id", "bin_id", "status", "assigned_to",
                                           "created_at", "completed_at", "external_id"], counts, "count_id")
        for c, cid in zip(counts, ids):
            c["count_id"] = cid
            st = c["status"]
            for n, (iid, exp_q) in enumerate(c["items"]):
                counted = None
                if st in ("COMPLETED", "VARIANCE") or (st == "IN_PROGRESS" and n % 2 == 0):
                    counted = exp_q
                    if st == "VARIANCE" and (n == 0 or rng.random() < 0.35):
                        delta = rng.choice([-1, 1]) * max(1, int(exp_q * rng.uniform(0.05, 0.3)))
                        counted = max(0, exp_q + delta)
                        if counted == exp_q:
                            counted = exp_q + 2
                    elif st == "COMPLETED" and rng.random() < 0.12:
                        counted = max(0, exp_q + rng.choice([-2, -1, 1]))
                ts = (c["completed_at"] or self.now) - timedelta(minutes=rng.randint(1, 15)) if counted is not None else None
                lines.append({"count_id": cid, "item_id": iid, "expected_quantity": exp_q,
                              "counted_quantity": counted, "scanned": counted is not None,
                              "unexpected": False, "counted_by": c["assigned_to"] if counted is not None else None,
                              "counted_at": ts})
                if counted is not None and counted != exp_q:
                    adjs.append({"item_id": iid, "bin_id": c["bin_id"], "warehouse_id": c["warehouse_id"],
                                 "quantity_change": counted - exp_q, "reason_code": "CYCLE_COUNT",
                                 "reason_detail": f"Chênh lệch kiểm kê #{cid}",
                                 "status": "PENDING" if st == "VARIANCE" else "APPROVED",
                                 "adjusted_by": c["assigned_to"], "adjusted_at": ts,
                                 "cycle_count_id": cid, "external_id": uid()})
            # an unexpected item found during one variance count
            if st == "VARIANCE" and c["wi"] == 0 and cid % 2 == 0:
                extra = rng.choice([it for it in self.items if it["item_id"] not in dict(c["items"])])
                lines.append({"count_id": cid, "item_id": extra["item_id"], "expected_quantity": 0,
                              "counted_quantity": rng.randint(1, 6), "scanned": True, "unexpected": True,
                              "counted_by": c["assigned_to"], "counted_at": c["completed_at"]})
                adjs.append({"item_id": extra["item_id"], "bin_id": c["bin_id"], "warehouse_id": c["warehouse_id"],
                             "quantity_change": lines[-1]["counted_quantity"], "reason_code": "CYCLE_COUNT",
                             "reason_detail": f"Hàng lạ phát hiện khi kiểm kê #{cid}", "status": "PENDING",
                             "adjusted_by": c["assigned_to"], "adjusted_at": c["completed_at"],
                             "cycle_count_id": cid, "external_id": uid()})
            if c["completed_at"]:
                last_counted[c["bin_id"]] = max(last_counted.get(c["bin_id"], c["completed_at"]), c["completed_at"])
                self.audit.append(("COUNT", "BIN", c["bin_id"], c["assigned_to"], c["warehouse_id"],
                                   {"count_id": cid, "lines": len(c["items"])}, c["completed_at"]))
        insert(cur, "cycle_count_lines", ["count_id", "item_id", "expected_quantity", "counted_quantity",
                                          "scanned", "unexpected", "counted_by", "counted_at"], lines)
        # a few manual adjustments (damage / found)
        for _ in range(12):
            r = rng.choice([r for r in self.all_inv if r["quantity_on_hand"] > 5])
            adjs.append({"item_id": r["item_id"], "bin_id": r["bin_id"], "warehouse_id": r["warehouse_id"],
                         "quantity_change": rng.choice([-3, -2, -1, 1, 2]),
                         "reason_code": rng.choice(["DAMAGE", "FOUND", "CORRECTION"]),
                         "reason_detail": "Điều chỉnh thủ công (demo)",
                         "status": rng.choice(["APPROVED", "APPROVED", "PENDING"]),
                         "adjusted_by": "giamsat.hcm", "adjusted_at": self.now - timedelta(days=rng.randint(0, 60)),
                         "cycle_count_id": None, "external_id": uid()})
        insert(cur, "inventory_adjustments", list(adjs[0].keys()), adjs)
        execute_values(cur, """UPDATE inventory AS i SET last_counted_at = v.ts
                               FROM (VALUES %s) AS v(bin, ts) WHERE i.bin_id = v.bin""",
                       list(last_counted.items()), template="(%s, %s::timestamptz)")
        self.n_counts = len(counts)

    # ------------------------------------------------------------- billing
    def billing(self):
        cur = self.cur
        contracted = [d for d in self.dealers if d["contract"]]
        crow = []
        for n, d in enumerate(contracted, 1):
            crow.append({"contract_number": f"HD-DV-{2026}-{n:03d}", "customer_id": d["canonical_id"],
                         "warehouse_id": self.wh_ids[d["wi"]],
                         "contract_name": f"Hợp đồng dịch vụ kho {d['customer_name']}",
                         "start_date": self.today - timedelta(days=200 + n * 3),
                         "end_date": self.today + timedelta(days=165 + n * 10),
                         "status": "ACTIVE", "billing_cycle": "MONTHLY",
                         "payment_terms_days": d["payment_terms_days"], "currency": "VND",
                         "created_by": "ketoan", "external_id": uid(), "d": d})
        # history: one expired + one draft contract
        crow.append({"contract_number": f"HD-DV-{2025}-099", "customer_id": contracted[0]["canonical_id"],
                     "warehouse_id": self.wh_ids[0], "contract_name": "Hợp đồng dịch vụ kho 2025 (đã hết hạn)",
                     "start_date": self.today - timedelta(days=560), "end_date": self.today - timedelta(days=201),
                     "status": "EXPIRED", "billing_cycle": "MONTHLY", "payment_terms_days": 30,
                     "currency": "VND", "created_by": "ketoan", "external_id": uid(), "d": None})
        nd = next(d for d in self.dealers if not d["contract"])
        crow.append({"contract_number": f"HD-DV-{2026}-100", "customer_id": nd["canonical_id"],
                     "warehouse_id": self.wh_ids[nd["wi"]], "contract_name": f"Dự thảo hợp đồng {nd['customer_name']}",
                     "start_date": self.today + timedelta(days=10), "end_date": None, "status": "DRAFT",
                     "billing_cycle": "MONTHLY", "payment_terms_days": 30, "currency": "VND",
                     "created_by": "ketoan", "external_id": uid(), "d": None})
        cols = ["contract_number", "customer_id", "warehouse_id", "contract_name", "start_date", "end_date",
                "status", "billing_cycle", "payment_terms_days", "currency", "created_by", "external_id"]
        ids = insert(cur, "customer_contracts", cols, crow, "contract_id")
        rates = []
        for c, cid in zip(crow, ids):
            c["contract_id"] = cid
            if not c["d"]:
                continue
            for stype, unit, price, name in (("STORAGE", "PALLET_DAY", rng.choice([38000, 42000, 45000]), "Lưu kho theo pallet/ngày"),
                                             ("PICK_PACK", "ORDER_LINE", rng.choice([3000, 3500, 4000]), "Soạn & đóng gói theo dòng"),
                                             ("INBOUND", "UNIT", rng.choice([1000, 1200, 1500]), "Nhập kho theo đơn vị"),
                                             ("HANDLING", "ORDER", rng.choice([12000, 15000]), "Phí xử lý đơn")):
                rates.append({"customer_id": c["customer_id"], "contract_id": cid, "warehouse_id": c["warehouse_id"],
                              "rate_name": name, "service_type": stype, "unit": unit, "unit_price": price,
                              "currency": "VND", "effective_from": c["start_date"], "external_id": uid(),
                              "c": c})
        rids = insert(cur, "billing_rate_cards", ["customer_id", "contract_id", "warehouse_id", "rate_name",
                                                  "service_type", "unit", "unit_price", "currency",
                                                  "effective_from", "external_id"], rates, "rate_card_id")
        rate = {}
        for r, rid in zip(rates, rids):
            rate[(r["customer_id"], r["service_type"])] = (rid, r["unit_price"], r["c"])
        events = []
        for c in crow:
            d = c["d"]
            if not d:
                continue
            cust = d["canonical_id"]
            wid = c["warehouse_id"]
            pallets = rng.randint(8, 40)
            for k in range(HISTORY_DAYS):
                day = self.start_day + timedelta(days=k)
                pallets = max(4, pallets + rng.randint(-2, 2))
                rid, up, _ = rate[(cust, "STORAGE")]
                events.append({"customer_id": cust, "warehouse_id": wid, "event_type": "STORAGE_DAY",
                               "reference_table": None, "reference_id": None, "service_date": day,
                               "quantity": pallets, "unit_price": up, "amount": pallets * up,
                               "rate_card_id": rid, "created_at": at(day, 23.5)})
            for so in self.orders:
                if so.get("dealer") is d and so["shipped_at"] and so.get("order_type", "sale") == "sale":
                    day = so["shipped_at"].date()
                    rid, up, _ = rate[(cust, "PICK_PACK")]
                    nl = len(so["lines"])
                    events.append({"customer_id": cust, "warehouse_id": wid, "event_type": "PICK",
                                   "reference_table": "sales_orders", "reference_id": so["so_id"],
                                   "service_date": day, "quantity": nl, "unit_price": up, "amount": nl * up,
                                   "rate_card_id": rid, "created_at": so["shipped_at"]})
                    rid, up, _ = rate[(cust, "HANDLING")]
                    events.append({"customer_id": cust, "warehouse_id": wid, "event_type": "HANDLING",
                                   "reference_table": "sales_orders", "reference_id": so["so_id"],
                                   "service_date": day, "quantity": 1, "unit_price": up, "amount": up,
                                   "rate_card_id": rid, "created_at": so["shipped_at"]})
            for k in range(0, HISTORY_DAYS, 7):
                day = self.start_day + timedelta(days=k + rng.randint(0, 6))
                if day > self.today:
                    continue
                q = rng.randint(80, 600)
                rid, up, _ = rate[(cust, "INBOUND")]
                events.append({"customer_id": cust, "warehouse_id": wid, "event_type": "INBOUND",
                               "reference_table": None, "reference_id": None, "service_date": day,
                               "quantity": q, "unit_price": up, "amount": q * up, "rate_card_id": rid,
                               "created_at": at(day, 17)})
        # monthly invoices for every closed month in range
        months = []
        m = date(self.start_day.year, self.start_day.month, 1)
        cur_month = date(self.today.year, self.today.month, 1)
        while m < cur_month:
            nxt = date(m.year + (m.month // 12), m.month % 12 + 1, 1)
            months.append((max(m, self.start_day), nxt - timedelta(days=1)))
            m = nxt
        invoices = []
        inv_seq = 0
        last_idx = len(months) - 1
        for c in crow:
            d = c["d"]
            if not d:
                continue
            for mi, (ps, pe) in enumerate(months):
                inv_seq += 1
                if mi < last_idx - 1:
                    st = "PAID"
                elif mi == last_idx - 1:
                    st = "PAID" if rng.random() < 0.6 else "SENT"
                else:
                    st = "SENT" if rng.random() < 0.5 else "DRAFT"
                created = at(pe + timedelta(days=rng.randint(1, 3)), 10)
                if created > self.now:
                    created = self.now - timedelta(hours=2)
                invoices.append({"invoice_number": f"INV-{pe:%Y%m}-{inv_seq:03d}", "customer_id": d["canonical_id"],
                                 "contract_id": c["contract_id"], "period_start": ps, "period_end": pe,
                                 "due_date": created.date() + timedelta(days=c["payment_terms_days"]),
                                 "currency": "VND", "status": st,
                                 "notes": "Hóa đơn dịch vụ kho (demo)",
                                 "issued_at": created if st != "DRAFT" else None,
                                 "created_at": created, "external_id": uid(), "total_amount": 0,
                                 "cust": d["canonical_id"]})
            # one cancelled duplicate for the previous month
            if months and d is contracted[1]:
                ps, pe = months[-2] if len(months) > 1 else months[-1]
                inv_seq += 1
                invoices.append({"invoice_number": f"INV-{pe:%Y%m}-{inv_seq:03d}", "customer_id": d["canonical_id"],
                                 "contract_id": c["contract_id"], "period_start": ps, "period_end": pe,
                                 "due_date": pe + timedelta(days=30), "currency": "VND", "status": "CANCELLED",
                                 "notes": "Lập trùng, đã hủy (demo)", "issued_at": None,
                                 "created_at": at(pe + timedelta(days=1), 9), "external_id": uid(),
                                 "total_amount": 0, "cust": None})
        # totals from events
        for inv in invoices:
            if not inv["cust"]:
                continue
            inv["events"] = [e for e in events if e["customer_id"] == inv["cust"]
                             and inv["period_start"] <= e["service_date"] <= inv["period_end"]]
            inv["total_amount"] = sum(e["amount"] for e in inv["events"])
        iids = insert(cur, "billing_invoices", ["invoice_number", "customer_id", "contract_id", "period_start",
                                                "period_end", "due_date", "total_amount", "currency", "status",
                                                "notes", "issued_at", "created_at", "external_id"],
                      invoices, "invoice_id")
        ilines = []
        for inv, iid in zip(invoices, iids):
            inv["invoice_id"] = iid
            agg = {}
            for e in inv.get("events", []):
                e["invoice_id"] = iid
                e["billed"] = True
                a = agg.setdefault(e["event_type"], [0, 0, e["unit_price"]])
                a[0] += e["quantity"]
                a[1] += e["amount"]
            labels = {"STORAGE_DAY": "Lưu kho (pallet-ngày)", "PICK": "Soạn hàng (dòng)",
                      "HANDLING": "Phí xử lý đơn", "INBOUND": "Nhập kho (đơn vị)"}
            for et, (q, amt, up) in agg.items():
                ilines.append({"invoice_id": iid, "event_id": None, "description": labels.get(et, et),
                               "quantity": q, "unit_price": up, "amount": amt})
        for e in events:
            e.setdefault("billed", False)
            e.setdefault("invoice_id", None)
        insert(cur, "billing_events", ["customer_id", "warehouse_id", "event_type", "reference_table",
                                       "reference_id", "service_date", "quantity", "unit_price", "amount",
                                       "rate_card_id", "invoice_id", "billed", "created_at"], events)
        insert(cur, "billing_invoice_lines", ["invoice_id", "event_id", "description", "quantity",
                                              "unit_price", "amount"], ilines)

    # ------------------------------------------------------------- pick batches
    # (wave status, number of orders) per warehouse. IN_PROGRESS has its
    # first stops already picked; COMPLETED batches walk recently PICKED
    # orders so the 3D view has finished routes to replay.
    PICK_BATCH_PLAN = {
        0: [("IN_PROGRESS", 4), ("OPEN", 3), ("OPEN", 5), ("COMPLETED", 4), ("COMPLETED", 3)],
        1: [("OPEN", 3), ("COMPLETED", 3)],
    }

    def pick_batches(self):
        """Pick batches / batch orders / pick tasks for open and picked orders.

        Runs last and draws from its own RNG, so every row generated before
        it is identical to a build without this step. Open orders are
        batched only when the stock allocated to them in their pick bins
        covers every line, exactly as create_pick_batch would require.
        """
        cur = self.cur
        prng = random.Random(RANDOM_SEED + 101)
        bin_by_id = {b["bin_id"]: b for by in self.bins for rows in by.values() for b in rows}
        alloc_left = {}
        rows_by_item = {}
        for r in self.all_inv:
            if r.get("pallet") is None and r.get("quantity_allocated"):
                alloc_left[r["inventory_id"]] = r["quantity_allocated"]
                rows_by_item.setdefault((r["wi"], r["item_id"]), []).append(r)

        def cover(so):
            """Inventory rows + quantities that cover every line, or None."""
            plan, taken = [], {}
            for ln in so["line_rows"]:
                need = ln["quantity_ordered"]
                for r in rows_by_item.get((so["wi"], ln["item_id"]), []):
                    left = alloc_left[r["inventory_id"]] - taken.get(r["inventory_id"], 0)
                    if need <= 0 or left <= 0:
                        continue
                    q = min(need, left)
                    taken[r["inventory_id"]] = taken.get(r["inventory_id"], 0) + q
                    plan.append((ln, r, q))
                    need -= q
                if need > 0:
                    return None
            for iid, q in taken.items():
                alloc_left[iid] -= q
            return plan

        batches, links, tasks = [], [], []
        picked_inv, picked_lines = {}, {}
        for wi, plan_rows in self.PICK_BATCH_PLAN.items():
            pickers = self.staff[wi]["pick"] or ["admin"]
            open_pool = sorted(
                (so for so in self.orders if so["wi"] == wi and so["status"] == "OPEN"
                 and so.get("order_type", "sale") == "sale" and not so.get("parent")),
                key=lambda so: so["created"])
            done_pool = sorted(
                (so for so in self.orders if so["wi"] == wi and so["status"] == "PICKED"
                 and so.get("picked_at")),
                key=lambda so: so["picked_at"], reverse=True)
            for n, (status, size) in enumerate(plan_rows, 1):
                picker = prng.choice(pickers)
                members = []
                if status == "COMPLETED":
                    members = [(so, None) for so in done_pool[:size]]
                    done_pool = done_pool[size:]
                else:
                    while open_pool and len(members) < size:
                        so = open_pool.pop(0)
                        covered = cover(so)
                        if covered:
                            members.append((so, covered))
                if not members:
                    continue
                if status == "COMPLETED":
                    done_at = max(so["picked_at"] for so, _ in members)
                    created = done_at - timedelta(minutes=prng.randint(25, 70))
                    started = created + timedelta(minutes=prng.randint(2, 8))
                else:
                    created = max(so["created"] for so, _ in members) + timedelta(
                        minutes=prng.randint(3, 20))
                    created = min(created, self.now - timedelta(minutes=prng.randint(5, 40)))
                    started = created + timedelta(minutes=4) if status == "IN_PROGRESS" else None
                    done_at = None
                batch = {"batch_number": f"BATCH-{created:%Y%m%d-%H%M%S}-{wi}{n:02d}",
                         "warehouse_id": self.wh_ids[wi], "status": status,
                         "assigned_to": picker, "total_orders": len(members),
                         "created_at": created, "started_at": started, "completed_at": done_at,
                         "tasks": []}
                for tote, (so, covered) in enumerate(members, 1):
                    links.append({"batch": batch, "so_id": so["so_id"], "tote_number": f"TOTE-{tote}"})
                    if covered is None:      # already picked: walk the item's pick bin
                        covered = []
                        for ln in so["line_rows"]:
                            it = self.item_by_id[ln["item_id"]]
                            pb = it.get("pick_bins", {}).get(wi) or self.bins[wi]["pick"][0]
                            covered.append((ln, {"bin_id": pb["bin_id"], "inventory_id": None}, ln["quantity_ordered"]))
                    for ln, r, q in covered:
                        batch["tasks"].append({
                            "batch": batch, "so_id": so["so_id"], "so_line_id": ln["so_line_id"],
                            "item_id": ln["item_id"], "bin_id": r["bin_id"], "quantity_to_pick": q,
                            "pick_sequence": bin_by_id[r["bin_id"]]["pick_sequence"],
                            "tote_number": f"TOTE-{tote}", "inventory_id": r["inventory_id"]})
                walk = sorted(batch["tasks"], key=lambda t: (t["pick_sequence"], t["so_id"]))
                done_upto = len(walk) // 2 if status == "IN_PROGRESS" else (
                    len(walk) if status == "COMPLETED" else 0)
                for i, t in enumerate(walk):
                    picked = i < done_upto
                    t["status"] = "PICKED" if picked else "PENDING"
                    t["quantity_picked"] = t["quantity_to_pick"] if picked else 0
                    t["picked_by"] = picker if picked else None
                    t["scan_confirmed"] = picked
                    if picked:
                        span = ((done_at or self.now) - (started or created)).total_seconds()
                        t["picked_at"] = (started or created) + timedelta(
                            seconds=span * (i + 1) / (len(walk) + 1))
                        if status == "IN_PROGRESS":
                            picked_inv[t["inventory_id"]] = picked_inv.get(t["inventory_id"], 0) + t["quantity_to_pick"]
                            picked_lines[t["so_line_id"]] = picked_lines.get(t["so_line_id"], 0) + t["quantity_to_pick"]
                    else:
                        t["picked_at"] = None
                batch["total_items"] = sum(t["quantity_to_pick"] for t in walk)
                batches.append(batch)
                tasks.extend(walk)

        ids = insert(cur, "pick_batches", ["batch_number", "warehouse_id", "status", "assigned_to",
                                           "total_orders", "total_items", "created_at",
                                           "started_at", "completed_at"], batches, "batch_id")
        for b, bid in zip(batches, ids):
            b["batch_id"] = bid
        for row in links + tasks:
            row["batch_id"] = row["batch"]["batch_id"]
        insert(cur, "pick_batch_orders", ["batch_id", "so_id", "tote_number"], links)
        insert(cur, "pick_tasks", ["batch_id", "so_id", "so_line_id", "item_id", "bin_id",
                                   "quantity_to_pick", "quantity_picked", "pick_sequence",
                                   "tote_number", "status", "picked_by", "picked_at",
                                   "scan_confirmed"], tasks)
        # Stops already walked in an IN_PROGRESS batch moved stock into the
        # tote, the same bookkeeping confirm_pick does.
        if picked_inv:
            execute_values(cur, """
                UPDATE inventory AS i
                   SET quantity_on_hand = GREATEST(0, i.quantity_on_hand - v.q),
                       quantity_allocated = GREATEST(0, i.quantity_allocated - v.q)
                  FROM (VALUES %s) AS v(id, q) WHERE i.inventory_id = v.id
            """, list(picked_inv.items()))
            execute_values(cur, """
                UPDATE sales_order_lines AS l SET quantity_picked = l.quantity_picked + v.q
                  FROM (VALUES %s) AS v(id, q) WHERE l.so_line_id = v.id
            """, list(picked_lines.items()))

    # ------------------------------------------------------------- audit
    def write_audit(self):
        self.audit.sort(key=lambda a: a[6])
        rows = [{"action_type": a[0], "entity_type": a[1], "entity_id": a[2], "user_id": a[3],
                 "warehouse_id": a[4], "details": Json(a[5]), "created_at": a[6],
                 "device_id": "C6000-DEMO-%02d" % (len(a[3]) % 7)}
                for a in self.audit]
        insert(self.cur, "audit_log", ["action_type", "entity_type", "entity_id", "user_id", "device_id",
                                       "warehouse_id", "details", "created_at"], rows)

    def run(self):
        steps = [("warehouses / zones / bins", self.base), ("users", self.users),
                 ("settings", self.settings), ("vendors / customers / items", self.master),
                 ("sales orders (plan)", self.sales), ("stock plan", self.stock_plan),
                 ("inventory (plan)", self.inventory), ("backorders", self.backorders),
                 ("sales orders (write)", self.write_sales), ("purchasing / receipts", self.purchasing),
                 ("inventory (write)", self.write_inventory), ("cycle counts", self.cycle_counts),
                 ("billing", self.billing), ("pick batches", self.pick_batches),
                 ("audit log", self.write_audit)]
        for label, fn in steps:
            print(f"  - {label}")
            fn()


# =============================================================== main

SUMMARY_TABLES = ["warehouses", "zones", "bins", "users", "user_page_permissions", "items",
                  "vendors", "customers", "pallets", "inventory", "preferred_bins",
                  "purchase_orders", "purchase_order_lines", "item_receipts", "bin_transfers",
                  "sales_orders", "sales_order_lines", "item_fulfillments", "item_fulfillment_lines",
                  "cycle_counts", "cycle_count_lines", "inventory_adjustments", "customer_contracts",
                  "billing_rate_cards", "billing_events", "billing_invoices", "billing_invoice_lines",
                  "pick_batches", "pick_batch_orders", "pick_tasks", "audit_log", "app_settings"]


def summary(cur):
    print("\nRow counts:")
    for t in SUMMARY_TABLES:
        cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(t)))
        print(f"  {t:<26} {cur.fetchone()[0]:>8}")
    cur.execute("SELECT status, COUNT(*) FROM sales_orders GROUP BY 1 ORDER BY 2 DESC")
    print("  sales_orders by status: " + ", ".join(f"{s}={n}" for s, n in cur.fetchall()))
    cur.execute("SELECT status, COUNT(*) FROM purchase_orders GROUP BY 1 ORDER BY 2 DESC")
    print("  purchase_orders by status: " + ", ".join(f"{s}={n}" for s, n in cur.fetchall()))
    cur.execute("SELECT status, COUNT(*) FROM pick_batches GROUP BY 1 ORDER BY 2 DESC")
    print("  pick_batches by status: " + ", ".join(f"{s}={n}" for s, n in cur.fetchall()))
    cur.execute("SELECT status, COUNT(*) FROM billing_invoices GROUP BY 1 ORDER BY 2 DESC")
    print("  billing_invoices by status: " + ", ".join(f"{s}={n}" for s, n in cur.fetchall()))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("dbname", nargs="?", default=DEFAULT_DB,
                    help=f"target database (must end in _prodlike; default {DEFAULT_DB})")
    ap.add_argument("--reset", action="store_true", help="drop and recreate the database first")
    args = ap.parse_args(argv)
    check_target(args.dbname)

    app_user = os.getenv("POSTGRES_USER", "sentry")
    app_pw = os.getenv("POSTGRES_PASSWORD", "sentry")
    su_user = os.getenv("POSTGRES_SUPERUSER", "postgres")
    su_pw = os.getenv("POSTGRES_SUPERUSER_PASSWORD", "")
    admin_pw = os.getenv("ADMIN_PASSWORD") or "admin"
    staff_pw = os.getenv("DEMO_USER_PASSWORD") or admin_pw

    try:
        ensure_database(args.dbname, args.reset, app_user, app_pw, su_user, su_pw)
    except psycopg2.Error as exc:
        print(f"Cannot create database: {exc.pgerror or type(exc).__name__}", file=sys.stderr)
        return 1

    conn = connect(args.dbname, app_user, app_pw)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.warehouses')")
    if cur.fetchone()[0] is None:
        print("Applying db/schema.sql (includes migrations through 097) ...")
        cur.execute((ROOT / "db" / "schema.sql").read_text(encoding="utf-8"))
    conn.autocommit = False
    cur.execute("SELECT COUNT(*) FROM warehouses")
    if cur.fetchone()[0] > 0:
        print(f"{args.dbname} already has data; nothing to do (use --reset to rebuild).")
        summary(cur)
        conn.close()
        return 0

    print(f"Generating data into {args.dbname} (seed {RANDOM_SEED}) ...")
    try:
        Gen(cur, admin_pw, staff_pw).run()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    conn.autocommit = True
    cur.execute("ANALYZE")
    summary(cur)
    conn.close()
    print(f"\nDone. Admin login: username 'admin', password = ADMIN_PASSWORD from .env.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
