"""Contract tests for migration 084 stable warehouse rack identities."""

import os


MIGRATION_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "db",
    "migrations",
    "084_warehouse_layout_phase2.sql",
)


def test_migration_084_defines_stable_racks_and_units():
    with open(MIGRATION_PATH, encoding="utf-8") as migration:
        sql = migration.read()

    assert "CREATE TABLE IF NOT EXISTS racks" in sql
    assert "coordinate_unit" in sql
    assert "legacy_rack_key" in sql
    assert "ADD COLUMN IF NOT EXISTS rack_id" in sql
    assert "ux_bins_rack_slot" in sql
    assert "jsonb_array_length(points) >= 2" in sql


def test_schema_contains_phase2_layout_contract():
    schema_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "db", "schema.sql"
    )
    with open(schema_path, encoding="utf-8") as schema:
        sql = schema.read()

    assert "CREATE TABLE racks" in sql
    assert "coordinate_unit VARCHAR(20)" in sql
    assert "rack_id BIGINT REFERENCES racks(rack_id)" in sql
