#!/usr/bin/env python3
"""Initialize PostgreSQL for Sơn Lộc WMS without Docker."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import bcrypt
import psycopg2
from dotenv import load_dotenv
from psycopg2 import sql
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _connect(dbname: str, user: str, password: str, host: str = "localhost", port: int = 5432):
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
    )


def main() -> int:
    su_user = os.getenv("POSTGRES_SUPERUSER", "postgres")
    su_password = os.getenv("POSTGRES_SUPERUSER_PASSWORD", "")
    app_user = os.getenv("POSTGRES_USER", "sentry")
    app_password = os.getenv("POSTGRES_PASSWORD", "sentry")
    app_db = os.getenv("POSTGRES_DB", "sentry")
    admin_password = os.getenv("ADMIN_PASSWORD", "admin")

    if not su_password:
        print("Set POSTGRES_SUPERUSER_PASSWORD in .env (postgres install password)", file=sys.stderr)
        return 1

    print(f"Connecting as superuser '{su_user}'...")
    try:
        conn = _connect("postgres", su_user, su_password)
    except psycopg2.Error as exc:
        print(f"Cannot connect to PostgreSQL: {exc}", file=sys.stderr)
        print("Install PostgreSQL 16 and ensure the service is running.", file=sys.stderr)
        return 1

    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()

    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (app_user,))
    if not cur.fetchone():
        print(f"Creating role {app_user}...")
        cur.execute(
            sql.SQL("CREATE USER {} WITH PASSWORD %s").format(sql.Identifier(app_user)),
            (app_password,),
        )
    else:
        print(f"Role {app_user} exists")

    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (app_db,))
    if not cur.fetchone():
        print(f"Creating database {app_db}...")
        cur.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(app_db), sql.Identifier(app_user)
            )
        )
    else:
        print(f"Database {app_db} exists")

    cur.close()
    conn.close()

    print(f"Loading schema into {app_db}...")
    schema_path = ROOT / "db" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")
    app_conn = _connect(app_db, app_user, app_password)
    app_conn.autocommit = True
    app_cur = app_conn.cursor()
    app_cur.execute(schema_sql)

    cur = app_conn.cursor()
    cur.execute("SELECT COUNT(*) FROM warehouses")
    wh_count = cur.fetchone()[0]
    if wh_count == 0:
        print("Running demo seed (seed-apartment-lab.sql)...")
        seed_sql = (ROOT / "db" / "seed-apartment-lab.sql").read_text(encoding="utf-8")
        app_cur.execute(seed_sql)
        pw_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
        app_cur.execute(
            """
            UPDATE users
            SET password_hash = %s, must_change_password = false
            WHERE username = 'admin'
            """,
            (pw_hash,),
        )
        print(f"Admin user: admin / {admin_password}")
    else:
        print(f"Database already has data ({wh_count} warehouse(s)) — skip seed")

    app_cur.close()
    app_conn.close()
    print("Database ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
