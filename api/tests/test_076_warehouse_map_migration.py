"""Schema-level tests for migration 076 (warehouse map coordinates)."""

import os

import pytest

from db_test_context import get_raw_connection

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "db", "migrations", "076_warehouse_map.sql",
)


@pytest.fixture(scope="module")
def migration_sql():
    with open(MIGRATION_PATH, encoding="utf-8") as f:
        return f.read()


def test_migration_076_adds_map_columns(migration_sql):
    assert "ALTER TABLE zones" in migration_sql
    assert "ALTER TABLE bins" in migration_sql
    assert "map_x" in migration_sql
    assert "color_hex" in migration_sql


def test_schema_has_map_columns():
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'bins' AND column_name IN ('map_x', 'map_y', 'map_w', 'map_h')
    """)
    bin_cols = {r[0] for r in cur.fetchall()}
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'zones' AND column_name IN ('color_hex', 'map_x', 'map_y')
    """)
    zone_cols = {r[0] for r in cur.fetchall()}
    cur.close()
    assert bin_cols == {"map_x", "map_y", "map_w", "map_h"}
    assert zone_cols >= {"color_hex", "map_x", "map_y"}
