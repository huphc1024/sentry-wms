#!/usr/bin/env python3
from dotenv import load_dotenv
from pathlib import Path
import os, sys, subprocess

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

su = os.getenv("POSTGRES_SUPERUSER", "postgres")
sp = os.getenv("POSTGRES_SUPERUSER_PASSWORD")
app_user = os.getenv("POSTGRES_USER", "sentry")
app_pass = os.getenv("POSTGRES_PASSWORD", "sentry")
host = os.getenv("POSTGRES_HOST", "localhost")
port = int(os.getenv("POSTGRES_PORT", "5432"))

if not sp:
    print("Missing POSTGRES_SUPERUSER_PASSWORD in .env", file=sys.stderr)
    sys.exit(1)

import psycopg2
from psycopg2 import sql

def ensure_role_and_db():
    conn = psycopg2.connect(host=host, port=port, dbname="postgres", user=su, password=sp)
    conn.autocommit = True
    cur = conn.cursor()
    # create role if not exists
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
    if not cur.fetchone():
        cur.execute(sql.SQL("CREATE USER {} WITH PASSWORD %s").format(sql.Identifier(app_user)), (app_pass,))
        print(f"Created role {app_user}")
    else:
        # ensure password set (ALTER ROLE)
        cur.execute(sql.SQL("ALTER ROLE {} WITH PASSWORD %s").format(sql.Identifier(app_user)), (app_pass,))
    # create test db
    test_db = "sentry_test"
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (test_db,))
    if not cur.fetchone():
        cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(test_db), sql.Identifier(app_user)))
        print(f"Created database {test_db}")
    else:
        print(f"Database {test_db} already exists — dropping and recreating to ensure clean schema")
        # Terminate connections and recreate
        cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()", (test_db,))
        cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(test_db)))
        cur.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(test_db), sql.Identifier(app_user)))
        print(f"Recreated database {test_db}")
    cur.close()
    conn.close()
    return test_db

def apply_schema_if_needed(test_db):
    # connect as app_user to test_db and check for a known table
    # apply schema as superuser to ensure extensions / functions can be created
    conn = psycopg2.connect(host=host, port=port, dbname=test_db, user=su, password=sp)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("SELECT to_regclass('public.warehouses')")
    exists = cur.fetchone()[0]
    if exists:
        print("Schema already present in", test_db)
        cur.close(); conn.close(); return
    print("Applying schema.sql to", test_db)
    schema_path = Path(__file__).resolve().parents[1] / "db" / "schema.sql"
    sql_text = schema_path.read_text(encoding="utf-8")
    # execute whole file
    cur.execute(sql_text)
    # ensure app_user owns all public tables and sequences so tests (connected as app_user) can truncate
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    tables = [r[0] for r in cur.fetchall()]
    for t in tables:
        cur.execute(sql.SQL("ALTER TABLE public.{} OWNER TO {}").format(sql.Identifier(t), sql.Identifier(app_user)))
    cur.execute("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'")
    seqs = [r[0] for r in cur.fetchall()]
    for s in seqs:
        cur.execute(sql.SQL("ALTER SEQUENCE {} OWNER TO {}").format(sql.Identifier(s), sql.Identifier(app_user)))
    cur.close(); conn.close()
    print("Schema applied")

def run_tests(test_db):
    env = os.environ.copy()
    env["TEST_DATABASE_URL"] = f"postgresql://{app_user}:{app_pass}@{host}:{port}/{test_db}"
    print("TEST_DATABASE_URL set for pytest")
    env["PYTHONUTF8"] = "1"
    cmd = [sys.executable, "-m", "pytest", "-q",
           "api/tests/test_admin.py::TestBins::test_create_bin",
           "api/tests/test_admin.py::TestItems::test_create_item"]
    rc = subprocess.call(cmd, env=env)
    sys.exit(rc)

if __name__ == "__main__":
    db = ensure_role_and_db()
    apply_schema_if_needed(db)
    run_tests(db)

