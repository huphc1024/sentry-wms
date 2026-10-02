#!/usr/bin/env python3
"""Apply Vietnamese translations to existing seed data."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def main() -> int:
    url = os.getenv("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
    sql_path = ROOT / "db" / "update-data-vi.sql"
    sql = sql_path.read_text(encoding="utf-8")

    try:
        conn = psycopg2.connect(url)
    except psycopg2.Error as exc:
        print(f"Cannot connect to database: {exc}", file=sys.stderr)
        return 1

    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(sql)

    cur.execute("SELECT warehouse_name FROM warehouses WHERE warehouse_code = 'APT-LAB'")
    wh = cur.fetchone()
    cur.execute("SELECT COUNT(*) FROM items WHERE category = %s", ("Ruồi giả",))
    item_count = cur.fetchone()[0]
    cur.execute("SELECT customer_name FROM sales_orders WHERE so_number = 'SO-2026-001'")
    customer = cur.fetchone()

    cur.close()
    conn.close()

    print("Database updated to Vietnamese.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
