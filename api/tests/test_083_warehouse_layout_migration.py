"""Tests for migration 083 warehouse layout editor tables."""

import os

import pytest

from db_test_context import get_raw_connection

MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "db", "migrations", "083_warehouse_layout.sql",
)


@pytest.fixture(scope="module")
def migration_sql():
    with open(MIGRATION_PATH, encoding="utf-8") as f:
        return f.read()


def test_migration_083_creates_layout_tables(migration_sql):
    assert "CREATE TABLE IF NOT EXISTS warehouse_layouts" in migration_sql
    assert "CREATE TABLE IF NOT EXISTS warehouse_rack_layouts" in migration_sql
    assert "CREATE TABLE IF NOT EXISTS warehouse_map_paths" in migration_sql
    assert "FORKLIFT" in migration_sql
    assert "PEDESTRIAN" in migration_sql


def test_schema_has_layout_tables():
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('warehouse_layouts', 'warehouse_rack_layouts', 'warehouse_map_paths')
    """)
    tables = {r[0] for r in cur.fetchall()}
    cur.close()
    assert tables == {"warehouse_layouts", "warehouse_rack_layouts", "warehouse_map_paths"}
