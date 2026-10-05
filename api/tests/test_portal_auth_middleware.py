"""Phase 2: customer portal identity + scoping middleware.

The property under test is mutual exclusion. Staff and portal JWTs are
signed with the same secret, so a valid signature proves nothing about
audience -- @require_auth must reject a customer token and
@require_customer_auth must reject a staff token. Mounts throw-away
probe routes so the decorators run end-to-end through the Flask test
client rather than being unit-tested in isolation, matching
test_wms_token_decorator.py.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")
os.environ.setdefault("SENTRY_ENCRYPTION_KEY", "t5hPIEVn_O41qfiMqAiPEnwzQh68o3Es46YfSOBvEK8=")
os.environ.setdefault("SENTRY_TOKEN_PEPPER", "NEVER_USE_THIS_PEPPER_IN_PRODUCTION")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import bcrypt
import jwt
import psycopg2
import pytest
from flask import Flask, g, jsonify

from constants import ALL_CUSTOMER_FEATURE_KEYS
from middleware.auth_middleware import (
    customer_scope_clause,
    require_auth,
    require_customer_auth,
    require_customer_feature,
)
from services.auth_service import (
    JWT_ALGORITHM,
    JWT_SECRET,
    SUBJECT_CUSTOMER,
    SUBJECT_STAFF,
    generate_customer_token,
)
from services.cookie_auth import PORTAL_AUTH_COOKIE_NAME

DATABASE_URL = os.environ["DATABASE_URL"]


# ------------------------------------------------------------------
# Fixtures: a customer + a portal login, inserted on their own
# autocommit connection so the decorator's fresh SessionLocal sees them.
# ------------------------------------------------------------------

def _conn():
    c = psycopg2.connect(DATABASE_URL)
    c.autocommit = True
    return c


@pytest.fixture()
def portal_login():
    """Yields a factory: make(**overrides) -> (customer_id, cu_id, token).

    Also exposes make.new_customer(code) for a bare customer row. Anything
    either factory creates is torn down here, in dependency order --
    customers.canonical_id is referenced ON DELETE RESTRICT from several
    tables, so a leaked row blocks the next run on customer_code
    uniqueness rather than failing quietly.
    """
    created = []
    bare_customers = []

    def make(
        features=(),
        is_active=True,
        must_change_password=False,
        username="portal-probe",
        password="portal-pw-1",
    ):
        conn = _conn()
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO customers (customer_name, customer_code, is_active) "
                "VALUES (%s, %s, TRUE) RETURNING canonical_id",
                (f"Probe Co {username}", f"PROBE-{username}"),
            )
            customer_id = cur.fetchone()[0]
            pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            cur.execute(
                "INSERT INTO customer_users "
                "(customer_id, username, password_hash, full_name, is_active, "
                " must_change_password) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING customer_user_id",
                (customer_id, username, pw_hash, "Probe User", is_active,
                 must_change_password),
            )
            cu_id = cur.fetchone()[0]
            for key in features:
                cur.execute(
                    "INSERT INTO customer_user_permissions "
                    "(customer_user_id, feature_key) VALUES (%s, %s)",
                    (cu_id, key),
                )
        conn.close()
        created.append((customer_id, cu_id))
        token = generate_customer_token({
            "customer_user_id": cu_id,
            "customer_id": str(customer_id),
            "username": username,
        })
        return str(customer_id), cu_id, token

    def new_customer(code):
        """A customer with no logins, tracked for teardown."""
        conn = _conn()
        with conn.cursor() as cur:
            # Clear any row left behind by an earlier interrupted run:
            # customer_code is UNIQUE, so a leak would fail this insert
            # instead of the assertion the test is actually about.
            cur.execute("DELETE FROM customers WHERE customer_code = %s", (code,))
            cur.execute(
                "INSERT INTO customers (customer_name, customer_code, is_active) "
                "VALUES (%s, %s, TRUE) RETURNING canonical_id",
                (f"Bare {code}", code),
            )
            customer_id = str(cur.fetchone()[0])
        conn.close()
        bare_customers.append(customer_id)
        return customer_id

    make.new_customer = new_customer

    yield make

    conn = _conn()
    with conn.cursor() as cur:
        for customer_id, cu_id in created:
            cur.execute(
                "DELETE FROM customer_user_permissions WHERE customer_user_id = %s",
                (cu_id,),
            )
            cur.execute(
                "DELETE FROM customer_users WHERE customer_user_id = %s", (cu_id,)
            )
            cur.execute(
                "DELETE FROM customers WHERE canonical_id = %s", (customer_id,)
            )
        # After the logins, so a login reassigned onto a bare customer no
        # longer holds a RESTRICT reference to it.
        for customer_id in bare_customers:
            cur.execute(
                "DELETE FROM customers WHERE canonical_id = %s", (customer_id,)
            )
    conn.close()


def _staff_token(role="ADMIN", user_id=1, subject_type=SUBJECT_STAFF):
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user_id,
        "username": "admin",
        "role": role,
        "warehouse_id": 1,
        "warehouse_ids": [1],
        "iat": int(now.timestamp()),
        "exp": now + timedelta(hours=1),
    }
    if subject_type is not None:
        payload["subject_type"] = subject_type
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


@pytest.fixture()
def probe_app():
    app = Flask("test-portal-auth")

    @app.route("/staff-probe")
    @require_auth
    def staff_probe():
        return jsonify({"role": g.current_user["role"]})

    @app.route("/portal-probe", endpoint="portal_auth.me")
    @require_customer_auth
    def portal_probe():
        return jsonify({
            "customer_id": g.current_customer["customer_id"],
            "features": g.current_customer["features"],
            # Proves a portal request never populates the staff subject.
            "has_staff_subject": hasattr(g, "current_user"),
        })

    @app.route("/portal-gated")
    @require_customer_auth
    @require_customer_feature("inventory")
    def portal_gated():
        return jsonify({"ok": True})

    @app.route("/portal-scope")
    @require_customer_auth
    def portal_scope():
        frag, params = customer_scope_clause("i.owner_customer_id")
        return jsonify({"fragment": frag, "params": params})

    @app.route("/unscoped-probe")
    def unscoped_probe():
        try:
            customer_scope_clause("i.owner_customer_id")
        except RuntimeError as e:
            return jsonify({"raised": str(e)}), 500
        return jsonify({"raised": None})

    return app.test_client()


# ------------------------------------------------------------------
# Mutual exclusion of the two audiences
# ------------------------------------------------------------------

def test_customer_token_rejected_on_staff_route(probe_app, portal_login):
    _, _, token = portal_login()
    r = probe_app.get("/staff-probe", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.get_json()


def test_staff_token_rejected_on_portal_route(probe_app):
    r = probe_app.get(
        "/portal-probe", headers={"Authorization": f"Bearer {_staff_token()}"}
    )
    assert r.status_code == 403, r.get_json()


def test_legacy_token_without_subject_type_still_works_as_staff(probe_app):
    """Tokens minted before subject_type existed carry no claim. They were
    staff tokens, so @require_auth must keep accepting them -- otherwise
    the deploy logs every active operator out."""
    token = _staff_token(subject_type=None)
    r = probe_app.get("/staff-probe", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["role"] == "ADMIN"


def test_legacy_token_without_subject_type_rejected_on_portal_route(probe_app):
    """Same missing claim must NOT open the portal: absent means staff."""
    token = _staff_token(subject_type=None)
    r = probe_app.get("/portal-probe", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403, r.get_json()


def test_customer_jwt_carries_no_staff_claims(portal_login):
    """users.user_id and customer_users.customer_user_id are both SERIALs
    in the same range. If a portal token carried `user_id`, a staff lookup
    fed with it would match a real operator instead of failing."""
    _, _, token = portal_login()
    claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert claims["subject_type"] == SUBJECT_CUSTOMER
    assert "user_id" not in claims
    assert "role" not in claims
    assert "warehouse_ids" not in claims


# ------------------------------------------------------------------
# Portal auth happy path + session isolation
# ------------------------------------------------------------------

def test_portal_token_accepted_and_sets_only_customer_subject(probe_app, portal_login):
    customer_id, _, token = portal_login(features=("inventory",))
    r = probe_app.get("/portal-probe", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["customer_id"] == customer_id
    assert body["features"] == ["inventory"]
    assert body["has_staff_subject"] is False


def test_portal_reads_from_the_portal_cookie(probe_app, portal_login):
    """A staff session cookie must not authenticate a portal request, and
    vice versa -- the two use distinct cookie names."""
    customer_id, _, token = portal_login()
    probe_app.set_cookie(PORTAL_AUTH_COOKIE_NAME, token, domain="localhost")
    r = probe_app.get("/portal-probe")
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["customer_id"] == customer_id


def test_deactivated_portal_login_is_rejected(probe_app, portal_login):
    _, _, token = portal_login(is_active=False)
    r = probe_app.get("/portal-probe", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401, r.get_json()


def test_must_change_password_blocks_other_endpoints(probe_app, portal_login):
    """mig 088 provisions accounts with must_change_password=TRUE, so this
    is the default state of every freshly created login."""
    _, _, token = portal_login(must_change_password=True, features=("inventory",))
    auth = {"Authorization": f"Bearer {token}"}

    blocked = probe_app.get("/portal-gated", headers=auth)
    assert blocked.status_code == 403
    assert blocked.get_json()["error"] == "password_change_required"

    # /portal-probe is registered as endpoint portal_auth.me, which is on
    # the forced-change allow-list.
    allowed = probe_app.get("/portal-probe", headers=auth)
    assert allowed.status_code == 200, allowed.get_json()


# ------------------------------------------------------------------
# Feature grants
# ------------------------------------------------------------------

def test_feature_gate_denies_without_grant(probe_app, portal_login):
    _, _, token = portal_login(features=())
    r = probe_app.get("/portal-gated", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert r.get_json()["feature_key"] == "inventory"


def test_feature_gate_allows_with_grant(probe_app, portal_login):
    _, _, token = portal_login(features=("inventory",))
    r = probe_app.get("/portal-gated", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_json()


def test_revoking_a_grant_takes_effect_without_reissuing_the_token(
    probe_app, portal_login
):
    """Grants are re-read from the DB per request, not carried in the JWT."""
    _, cu_id, token = portal_login(features=("inventory",))
    auth = {"Authorization": f"Bearer {token}"}
    assert probe_app.get("/portal-gated", headers=auth).status_code == 200

    conn = _conn()
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM customer_user_permissions WHERE customer_user_id = %s",
            (cu_id,),
        )
    conn.close()

    assert probe_app.get("/portal-gated", headers=auth).status_code == 403


# ------------------------------------------------------------------
# Scoping helper
# ------------------------------------------------------------------

def test_customer_scope_clause_binds_the_callers_customer(probe_app, portal_login):
    customer_id, _, token = portal_login()
    r = probe_app.get("/portal-scope", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["fragment"] == "AND i.owner_customer_id = :_cscope"
    assert body["params"] == {"_cscope": customer_id}


def test_customer_scope_clause_refuses_unauthenticated_request(probe_app):
    """Fails closed. warehouse_scope_clause returns '' for ADMIN because
    admins legitimately see every warehouse; there is no equivalent
    all-seeing customer, so an empty fragment could only mean an unscoped
    portal query -- i.e. every customer's rows served to one caller."""
    r = probe_app.get("/unscoped-probe")
    assert r.status_code == 500
    assert "unscoped query" in r.get_json()["raised"]


def test_scope_uses_db_customer_id_not_the_jwt_claim(probe_app, portal_login):
    """An operator may reassign a login to a different customer. Scoping
    must follow the DB, or a token minted before the change keeps reading
    the old customer's data until it expires."""
    original_customer_id, cu_id, token = portal_login()
    new_customer_id = portal_login.new_customer("PROBE-REASSIGN")

    conn = _conn()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE customer_users SET customer_id = %s WHERE customer_user_id = %s",
            (new_customer_id, cu_id),
        )
    conn.close()

    r = probe_app.get("/portal-scope", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["params"] == {"_cscope": new_customer_id}

    # Point the login back at its own customer so fixture teardown can
    # drop both rows: customer_id is ON DELETE RESTRICT, so a customer
    # still referenced by a login will not delete.
    conn = _conn()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE customer_users SET customer_id = %s WHERE customer_user_id = %s",
            (original_customer_id, cu_id),
        )
    conn.close()


# ------------------------------------------------------------------
# Feature-key namespace
# ------------------------------------------------------------------

def test_feature_gate_keys_are_declared_constants(probe_app, portal_login):
    """Guards against gating a route on a key no operator can ever grant
    because it is absent from the admin UI's key list."""
    assert "inventory" in ALL_CUSTOMER_FEATURE_KEYS
