"""Throwaway validator for Customer Portal DDL (migrations 087-090).

Checks both install paths and drops its scratch objects after:

  1. fresh install  -- load the current db/schema.sql
  2. upgrade        -- load db/schema.sql truncated to its pre-phase-1
                       state, then apply migrations 087 through 090

then asserts both paths converge on the same tables, columns and FKs.

Runs inside two temporary SCHEMAS of the existing database rather than
temporary databases: the `sentry` role has no CREATEDB privilege, and this
way the app's own `public` schema is never touched. schema.sql carries no
`public.`-qualified references, so a search_path of `<scratch>, public`
sends every table into the scratch schema while still resolving pgcrypto's
gen_random_uuid() from public.

Not part of the test suite; delete after use.
Run: api/.venv/Scripts/python.exe tools/_mig_phase1_check.py
"""
import os
import sys

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DSN = os.environ.get("MIG_CHECK_DSN", "postgresql://sentry:sentry@localhost:5432/sentry")
FRESH = "migchk_fresh"
UPGRADE = "migchk_upgrade"
MIGRATIONS = [
    "087_customer_ownership.sql",
    "088_customer_users.sql",
    "089_customer_token_scope.sql",
    "090_portal_order_seq.sql",
]

# Objects that are neither tables nor columns, so the column/table
# convergence checks below would not notice them going missing.
EXPECTED_SEQUENCES = ["portal_order_seq"]

# (table, column) pairs migrations 087-089 must add.
EXPECTED_COLUMNS = [
    ("items", "owner_customer_id"),
    ("sales_orders", "customer_ref"),
    ("purchase_orders", "owner_customer_id"),
    ("wms_tokens", "customer_id"),
]
EXPECTED_TABLES = ["customer_users", "customer_user_permissions"]


def connect(scratch=None):
    c = psycopg2.connect(DSN)
    c.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    if scratch:
        with c.cursor() as cur:
            cur.execute(f'SET search_path TO "{scratch}", public')
    return c


def drop_schema(name):
    with connect() as c, c.cursor() as cur:
        cur.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')


def create_schema(name):
    drop_schema(name)
    with connect() as c, c.cursor() as cur:
        cur.execute(f'CREATE SCHEMA "{name}"')


def run_sql(scratch, sql, label):
    conn = connect(scratch)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    except psycopg2.Error as e:
        print(f"  FAIL {label}: {(e.pgerror or str(e)).strip()}")
        raise
    finally:
        conn.close()
    print(f"  ok   {label}")


def introspect(scratch):
    conn = connect(scratch)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name, column_name, data_type, is_nullable "
                "FROM information_schema.columns WHERE table_schema = %s "
                "ORDER BY table_name, column_name",
                (scratch,),
            )
            cols = cur.fetchall()
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = %s ORDER BY 1",
                (scratch,),
            )
            tables = [r[0] for r in cur.fetchall()]
            # Prove the new columns really point at customers, and with the
            # intended ON DELETE action ('r' = RESTRICT).
            cur.execute(
                """
                SELECT c.conrelid::regclass::text, a.attname, c.confdeltype
                FROM pg_constraint c
                JOIN unnest(c.conkey) AS k(attnum) ON TRUE
                JOIN pg_attribute a
                  ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                WHERE c.contype = 'f'
                  AND c.connamespace = %s::regnamespace
                  AND c.confrelid = 'customers'::regclass
                ORDER BY 1, 2
                """,
                (scratch,),
            )
            fks = [(r[0].split(".")[-1].strip('"'), r[1], r[2]) for r in cur.fetchall()]
            cur.execute(
                "SELECT sequence_name FROM information_schema.sequences "
                "WHERE sequence_schema = %s ORDER BY 1",
                (scratch,),
            )
            sequences = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    return cols, tables, fks, sequences


PHASE1_MARKER = "-- CUSTOMER PORTAL (phase 1)"


def pre_phase1_schema():
    """Current db/schema.sql truncated just before the phase-1 section.

    NOT `git show HEAD:...` -- schema.sql at HEAD predates migrations 078
    (pallets), 079 (billing) and 085 (customer_contracts, and with it
    customers.customer_code), so it does not represent any deploy that
    would actually be applying 087. The working tree minus the phase-1
    block is the real "current as of mig 086" baseline.
    """
    with open(os.path.join(REPO, "db", "schema.sql"), encoding="utf-8") as f:
        sql = f.read()
    idx = sql.find(PHASE1_MARKER)
    if idx == -1:
        sys.exit(f"marker not found in schema.sql: {PHASE1_MARKER!r}")
    # Back up to the start of the banner comment above the marker.
    banner = sql.rfind("-- " + "=" * 60, 0, idx)
    return sql[: banner if banner != -1 else idx]


def main():
    failures = []

    print("[1] fresh install: current db/schema.sql")
    create_schema(FRESH)
    with open(os.path.join(REPO, "db", "schema.sql"), encoding="utf-8") as f:
        current = f.read()
    try:
        run_sql(FRESH, current, "schema.sql")
    except psycopg2.Error:
        failures.append("fresh install (schema.sql does not load)")

    print("[2] upgrade: pre-phase-1 schema.sql + migrations 087-090")
    create_schema(UPGRADE)
    try:
        run_sql(UPGRADE, pre_phase1_schema(), "schema.sql (pre-phase-1)")
        for m in MIGRATIONS:
            path = os.path.join(REPO, "db", "migrations", m)
            with open(path, encoding="utf-8") as f:
                run_sql(UPGRADE, f.read(), m)
    except psycopg2.Error:
        failures.append("upgrade path (migration does not apply)")

    if failures:
        print("\nFAILED: " + "; ".join(failures))
        drop_schema(FRESH)
        drop_schema(UPGRADE)
        return 1

    print("[3] expected objects present on both paths")
    fresh_cols, fresh_tables, fresh_fks, fresh_seqs = introspect(FRESH)
    up_cols, up_tables, up_fks, up_seqs = introspect(UPGRADE)

    for seq in EXPECTED_SEQUENCES:
        for label, seqs in (("fresh", fresh_seqs), ("upgrade", up_seqs)):
            if seq not in seqs:
                failures.append(f"{label}: missing sequence {seq}")
            else:
                print(f"  ok   {label:7} sequence {seq}")

    for tbl, col in EXPECTED_COLUMNS:
        for label, cols in (("fresh", fresh_cols), ("upgrade", up_cols)):
            hit = [c for c in cols if c[0] == tbl and c[1] == col]
            if not hit:
                failures.append(f"{label}: missing {tbl}.{col}")
            else:
                print(f"  ok   {label:7} {tbl}.{col}: {hit[0][2]}, nullable={hit[0][3]}")

    for tbl in EXPECTED_TABLES:
        for label, tables in (("fresh", fresh_tables), ("upgrade", up_tables)):
            if tbl not in tables:
                failures.append(f"{label}: missing table {tbl}")
            else:
                print(f"  ok   {label:7} table {tbl}")

    print("[4] fresh install and upgrade converge")
    if fresh_cols != up_cols:
        failures.append("column drift between paths")
        for c in sorted(set(fresh_cols) - set(up_cols)):
            print(f"  DRIFT fresh-only  : {c}")
        for c in sorted(set(up_cols) - set(fresh_cols)):
            print(f"  DRIFT upgrade-only: {c}")
    else:
        print(f"  ok   identical column sets ({len(fresh_cols)} columns)")

    if sorted(fresh_tables) != sorted(up_tables):
        failures.append("table drift between paths")
        print(f"  DRIFT fresh-only  : {sorted(set(fresh_tables) - set(up_tables))}")
        print(f"  DRIFT upgrade-only: {sorted(set(up_tables) - set(fresh_tables))}")
    else:
        print(f"  ok   identical table sets ({len(fresh_tables)} tables)")

    print("[5] FKs into customers (confdeltype 'r' = RESTRICT, 'a' = NO ACTION)")
    if sorted(fresh_fks) != sorted(up_fks):
        failures.append("FK drift between paths")
    for rel, col, deltype in sorted(fresh_fks):
        print(f"  {rel}.{col} -> customers  on_delete={deltype!r}")

    print("[6] cleanup")
    drop_schema(FRESH)
    drop_schema(UPGRADE)
    print("  ok   scratch schemas dropped")

    if failures:
        print("\nFAILED:")
        for f_ in failures:
            print("  - " + f_)
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
