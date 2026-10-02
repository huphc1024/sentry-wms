"""Tests for migrations 087-089: customer portal phase 1 (ownership + logins).

087 puts a customer owner on items / sales_orders / purchase_orders,
088 adds the portal login tables, 089 scopes a WMS token to one customer.
"""

import os

import pytest

from db_test_context import get_raw_connection

MIGRATIONS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "db", "migrations",
)


def _read(name):
    with open(os.path.join(MIGRATIONS_DIR, name), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def mig_087():
    return _read("087_customer_ownership.sql")


@pytest.fixture(scope="module")
def mig_088():
    return _read("088_customer_users.sql")


@pytest.fixture(scope="module")
def mig_089():
    return _read("089_customer_token_scope.sql")


# ------------------------------------------------------------------
# 087: ownership columns
# ------------------------------------------------------------------

def test_migration_087_adds_owner_columns(mig_087):
    assert "ADD COLUMN IF NOT EXISTS owner_customer_id UUID" in mig_087
    assert "ALTER TABLE items" in mig_087
    assert "ALTER TABLE purchase_orders" in mig_087
    assert "ADD COLUMN IF NOT EXISTS customer_ref UUID" in mig_087


def test_migration_087_keeps_legacy_sales_orders_customer_id(mig_087):
    """customer_id VARCHAR is written straight from the inbound mapping
    docs; dropping or retyping it would break every existing connector."""
    assert "DROP COLUMN customer_id" not in mig_087
    assert "ALTER COLUMN customer_id" not in mig_087


def test_migration_087_backfill_does_not_match_on_customer_name(mig_087):
    """customer_name is operator-typed free text on both sides. Matching on
    it would attribute an order to the wrong customer, which on the portal
    means showing customer A's order to customer B."""
    assert "customer_code = so.customer_id" in mig_087
    assert "customer_name" not in mig_087.split("UPDATE sales_orders")[1]


def test_migration_087_backfill_guarded_on_customer_code(mig_087):
    """mig 085 adds customers.customer_code, so the ordered sequence always
    has it -- but a database bootstrapped from a stale schema.sql can reach
    087 without it, and the migration must still apply."""
    assert "information_schema.columns" in mig_087
    assert "'customer_code'" in mig_087


# ------------------------------------------------------------------
# 088: portal logins
# ------------------------------------------------------------------

def test_migration_088_creates_login_tables(mig_088):
    assert "CREATE TABLE IF NOT EXISTS customer_users" in mig_088
    assert "CREATE TABLE IF NOT EXISTS customer_user_permissions" in mig_088


def test_migration_088_does_not_touch_staff_users_table(mig_088):
    """Customer logins live in their own table precisely so that no staff
    authorisation check in auth_middleware can mistake a customer row for a
    staff row. The migration must not widen `users`."""
    assert "ALTER TABLE users" not in mig_088
    assert "'CUSTOMER'" not in mig_088


def test_migration_088_forces_password_change_by_default(mig_088):
    assert "must_change_password BOOLEAN     NOT NULL DEFAULT TRUE" in mig_088


def test_customer_feature_keys_fit_the_column():
    """088 comments name constants.ALL_CUSTOMER_FEATURE_KEYS as the source
    of truth for feature_key, so the constant must exist and every key must
    fit feature_key VARCHAR(64)."""
    from constants import ALL_CUSTOMER_FEATURE_KEYS, ALL_PAGE_KEYS

    assert ALL_CUSTOMER_FEATURE_KEYS, "constant is empty"
    assert len(set(ALL_CUSTOMER_FEATURE_KEYS)) == len(ALL_CUSTOMER_FEATURE_KEYS)
    for key in ALL_CUSTOMER_FEATURE_KEYS:
        assert len(key) <= 64, f"{key!r} exceeds feature_key VARCHAR(64)"
    # Separate namespace from the staff page keys on purpose: 'inventory'
    # means "the whole warehouse" for staff and "my own stock" for a
    # customer, so the tuples must stay independent objects.
    assert ALL_CUSTOMER_FEATURE_KEYS is not ALL_PAGE_KEYS


# ------------------------------------------------------------------
# 089: token scope
# ------------------------------------------------------------------

def test_migration_089_adds_token_customer_scope(mig_089):
    assert "ALTER TABLE wms_tokens" in mig_089
    assert "ADD COLUMN IF NOT EXISTS customer_id UUID" in mig_089


# ------------------------------------------------------------------
# Live schema: the loaded db/schema.sql must agree with the migrations
# ------------------------------------------------------------------

def test_schema_has_customer_portal_tables():
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('customer_users', 'customer_user_permissions')
    """)
    tables = {r[0] for r in cur.fetchall()}
    cur.close()
    assert tables == {"customer_users", "customer_user_permissions"}


def test_schema_has_ownership_columns():
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
              ('items', 'owner_customer_id'),
              ('sales_orders', 'customer_ref'),
              ('purchase_orders', 'owner_customer_id'),
              ('wms_tokens', 'customer_id')
          )
    """)
    found = {(r[0], r[1]): (r[2], r[3]) for r in cur.fetchall()}
    cur.close()
    expected = {
        ("items", "owner_customer_id"),
        ("sales_orders", "customer_ref"),
        ("purchase_orders", "owner_customer_id"),
        ("wms_tokens", "customer_id"),
    }
    assert set(found) == expected
    # All four are nullable: NULL means "owned by the warehouse operator",
    # which the portal must read as "visible to no customer".
    for key, (dtype, nullable) in found.items():
        assert dtype == "uuid", f"{key} is {dtype}, expected uuid"
        assert nullable == "YES", f"{key} is NOT NULL, expected nullable"


def test_ownership_fks_restrict_customer_deletion():
    """A customer that still owns stock, orders or logins must not be
    deletable out from under them."""
    conn = get_raw_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT c.conrelid::regclass::text, a.attname, c.confdeltype
        FROM pg_constraint c
        JOIN unnest(c.conkey) AS k(attnum) ON TRUE
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f'
          AND c.confrelid = 'customers'::regclass
          AND (c.conrelid::regclass::text, a.attname) IN (
              ('items', 'owner_customer_id'),
              ('sales_orders', 'customer_ref'),
              ('purchase_orders', 'owner_customer_id'),
              ('wms_tokens', 'customer_id'),
              ('customer_users', 'customer_id')
          )
    """)
    rows = cur.fetchall()
    cur.close()
    assert len(rows) == 5, f"expected 5 FKs into customers, got {rows}"
    for rel, col, deltype in rows:
        assert deltype == "r", f"{rel}.{col} has ON DELETE {deltype!r}, expected 'r'"
