"""Phase 4: admin CRUD for portal logins and stock ownership.

Two things get the most attention here, because both are places where a
plausible implementation is quietly wrong:

  - resetting a portal password must kill sessions already issued to that
    login, or an operator responding to a compromise leaves the attacker
    logged in for the token's remaining lifetime;
  - changing a SKU's owner is a tenancy decision, so it must gate on
    'customer-users' rather than 'items'.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
import pytest

from constants import ALL_CUSTOMER_FEATURE_KEYS
from db_test_context import get_raw_connection
from services.auth_service import JWT_ALGORITHM, JWT_SECRET, SUBJECT_CUSTOMER


@pytest.fixture()
def cur():
    return get_raw_connection().cursor()


@pytest.fixture()
def customer(cur):
    cur.execute(
        "INSERT INTO customers (customer_name, customer_code, is_active) "
        "VALUES ('Phase4 Co', 'P4-CUST', TRUE) RETURNING canonical_id"
    )
    return str(cur.fetchone()[0])


@pytest.fixture()
def staff_token(client):
    """A non-admin operator, so the page-key gate is actually exercised.

    An ADMIN bypasses @require_admin_or_page_permission entirely, which
    would make every authorisation assertion below vacuous.
    """
    def make(page_keys):
        raw = get_raw_connection().cursor()
        pw = bcrypt.hashpw(b"staff-pw-1", bcrypt.gensalt()).decode()
        raw.execute(
            "INSERT INTO users (username, password_hash, full_name, role, "
            "warehouse_ids, is_active, must_change_password, external_id) "
            "VALUES (%s, %s, 'Phase4 Operator', 'USER', '{1}', TRUE, FALSE, "
            "gen_random_uuid()) RETURNING user_id",
            (f"p4-op-{'-'.join(page_keys) or 'none'}", pw),
        )
        user_id = raw.fetchone()[0]
        for key in page_keys:
            raw.execute(
                "INSERT INTO user_page_permissions (user_id, page_key) VALUES (%s, %s)",
                (user_id, key),
            )
        r = client.post(
            "/api/auth/login",
            json={"username": f"p4-op-{'-'.join(page_keys) or 'none'}",
                  "password": "staff-pw-1"},
        )
        assert r.status_code == 200, r.get_json()
        return {"Authorization": f"Bearer {r.get_json()['token']}"}

    return make


@pytest.fixture()
def admin_auth(auth_headers):
    return auth_headers


def _create(client, auth, customer_id, username="p4-portal-1", **over):
    body = {
        "customer_id": customer_id,
        "username": username,
        "password": "portal-pw-1",
        "full_name": "Portal Person",
        "feature_keys": ["inventory"],
    }
    body.update(over)
    return client.post("/api/admin/customer-users", headers=auth, json=body)


# ------------------------------------------------------------------
# CRUD
# ------------------------------------------------------------------

def test_create_customer_user(client, admin_auth, customer):
    r = _create(client, admin_auth, customer)
    assert r.status_code == 201, r.get_json()
    body = r.get_json()
    assert body["customer_id"] == customer
    assert body["customer_code"] == "P4-CUST"
    assert body["feature_keys"] == ["inventory"]
    # mig 088 default: the operator must not end up knowing a working
    # credential for the customer.
    assert body["must_change_password"] is True


def test_create_rejects_unknown_customer(client, admin_auth):
    r = _create(client, admin_auth, "00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_create_rejects_malformed_customer_id(client, admin_auth):
    """Arrives from a request body, so a bad UUID must be a 404, not a
    DataError 500."""
    r = _create(client, admin_auth, "not-a-uuid")
    assert r.status_code == 404


def test_create_rejects_unknown_feature_key(client, admin_auth, customer):
    r = _create(client, admin_auth, customer, feature_keys=["inventory", "nope"])
    assert r.status_code == 400
    assert r.get_json()["unknown"] == ["nope"]


def test_create_rejects_duplicate_username(client, admin_auth, customer):
    assert _create(client, admin_auth, customer, username="p4-dup").status_code == 201
    again = _create(client, admin_auth, customer, username="p4-dup")
    assert again.status_code == 400


def test_create_rejects_weak_password(client, admin_auth, customer):
    r = _create(client, admin_auth, customer, password="short")
    assert r.status_code == 400


def test_staff_username_may_collide_with_a_portal_username(
    client, admin_auth, customer
):
    """Harmless: the two logins query different tables and mint
    different-audience tokens."""
    r = _create(client, admin_auth, customer, username="admin")
    assert r.status_code == 201, r.get_json()


def test_list_filters_by_customer(client, admin_auth, customer, cur):
    _create(client, admin_auth, customer, username="p4-a")
    cur.execute(
        "INSERT INTO customers (customer_name, customer_code, is_active) "
        "VALUES ('Other Co', 'P4-OTHER', TRUE) RETURNING canonical_id"
    )
    other = str(cur.fetchone()[0])
    _create(client, admin_auth, other, username="p4-b")

    r = client.get(
        f"/api/admin/customer-users?customer_id={customer}", headers=admin_auth
    )
    assert r.status_code == 200, r.get_json()
    names = [u["username"] for u in r.get_json()["customer_users"]]
    assert names == ["p4-a"]


def test_update_changes_profile_fields(client, admin_auth, customer):
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"full_name": "Renamed", "email": "x@example.com"},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["full_name"] == "Renamed"
    assert r.get_json()["email"] == "x@example.com"


def test_update_cannot_move_a_login_to_another_customer(client, admin_auth, customer):
    """customer_id is absent from UpdateCustomerUserRequest: reassigning a
    login silently redirects every scoped query it makes, so that is a
    delete-and-recreate rather than an edit. extra='forbid' turns the
    attempt into a 400."""
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"customer_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 400


def test_update_with_no_fields_is_rejected(client, admin_auth, customer):
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}", headers=admin_auth, json={}
    )
    assert r.status_code == 400


def test_deactivate_does_not_delete_the_row(client, admin_auth, customer, cur):
    """Audit rows reference this login as 'portal:<username>'; deleting it
    would make them unattributable."""
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.delete(f"/api/admin/customer-users/{cu_id}", headers=admin_auth)
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["is_active"] is False

    cur.execute(
        "SELECT is_active FROM customer_users WHERE customer_user_id = %s", (cu_id,)
    )
    assert cur.fetchone() == (False,)


# ------------------------------------------------------------------
# Password reset must end existing sessions
# ------------------------------------------------------------------

def test_password_reset_stamps_password_changed_at(
    client, admin_auth, customer, cur
):
    """That column is the only thing that ends sessions already issued to
    this login, so the reset endpoint must write it."""
    cu_id = _create(
        client, admin_auth, customer, must_change_password=False
    ).get_json()["customer_user_id"]

    cur.execute(
        "SELECT password_changed_at FROM customer_users WHERE customer_user_id = %s",
        (cu_id,),
    )
    assert cur.fetchone()[0] is None

    reset = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"password": "portal-pw-2"},
    )
    assert reset.status_code == 200, reset.get_json()

    cur.execute(
        "SELECT password_changed_at FROM customer_users WHERE customer_user_id = %s",
        (cu_id,),
    )
    assert cur.fetchone()[0] is not None


def test_password_reset_invalidates_tokens_already_issued(
    client, admin_auth, customer
):
    """The point of an operator-driven reset is usually a compromise, so
    the attacker's existing JWT must not stay valid for the rest of its
    8-hour life.

    The token is hand-crafted with iat 10s in the past rather than
    obtained from /login, for the same reason test_auth.py does it that
    way: the autouse _db_transaction fixture runs the whole test inside
    one transaction, and Postgres NOW() is the *transaction* timestamp.
    A token minted mid-test therefore carries an iat later than the
    password_changed_at the reset writes, which cannot happen in
    production where every request is its own transaction.
    """
    cu_id = _create(
        client, admin_auth, customer, must_change_password=False
    ).get_json()["customer_user_id"]

    stale_payload = {
        "subject_type": SUBJECT_CUSTOMER,
        "customer_user_id": cu_id,
        "customer_id": customer,
        "username": "p4-portal-1",
        "iat": int(datetime.now(timezone.utc).timestamp()) - 10,
        "jti": "stale-portal-token",
        "exp": datetime.now(timezone.utc) + timedelta(hours=8),
    }
    stale = jwt.encode(stale_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    live = {"Authorization": f"Bearer {stale}"}
    assert client.get("/api/portal/auth/me", headers=live).status_code == 200

    reset = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"password": "portal-pw-2"},
    )
    assert reset.status_code == 200, reset.get_json()

    after = client.get("/api/portal/auth/me", headers=live)
    assert after.status_code == 401, after.get_json()


def test_password_reset_forces_a_change_on_next_login(client, admin_auth, customer):
    cu_id = _create(
        client, admin_auth, customer, must_change_password=False
    ).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"password": "portal-pw-2"},
    )
    assert r.get_json()["must_change_password"] is True


def test_explicit_must_change_password_wins_over_the_reset_default(
    client, admin_auth, customer
):
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}",
        headers=admin_auth,
        json={"password": "portal-pw-2", "must_change_password": False},
    )
    assert r.get_json()["must_change_password"] is False


def test_deactivation_kills_a_live_session(client, admin_auth, customer):
    cu_id = _create(
        client, admin_auth, customer, must_change_password=False
    ).get_json()["customer_user_id"]
    login = client.post(
        "/api/portal/auth/login",
        json={"username": "p4-portal-1", "password": "portal-pw-1"},
    )
    live = {"Authorization": f"Bearer {login.get_json()['token']}"}
    assert client.get("/api/portal/auth/me", headers=live).status_code == 200

    client.delete(f"/api/admin/customer-users/{cu_id}", headers=admin_auth)
    assert client.get("/api/portal/auth/me", headers=live).status_code == 401


# ------------------------------------------------------------------
# Feature grants
# ------------------------------------------------------------------

def test_features_get_returns_the_server_side_catalogue(
    client, admin_auth, customer
):
    """The UI renders its checkboxes from this, so it cannot drift out of
    sync with constants.py."""
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.get(
        f"/api/admin/customer-users/{cu_id}/features", headers=admin_auth
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["all_feature_keys"] == list(ALL_CUSTOMER_FEATURE_KEYS)


def test_features_put_replaces_the_whole_set(client, admin_auth, customer):
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}/features",
        headers=admin_auth,
        json={"feature_keys": ["orders", "invoices"]},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["feature_keys"] == ["orders", "invoices"]

    # 'inventory' from creation is gone, not merged.
    again = client.get(
        f"/api/admin/customer-users/{cu_id}/features", headers=admin_auth
    )
    assert "inventory" not in again.get_json()["feature_keys"]


def test_features_put_can_revoke_everything(client, admin_auth, customer):
    """There is no bypass on the portal side, so an empty set really means
    "log in, change password, see nothing"."""
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}/features",
        headers=admin_auth,
        json={"feature_keys": []},
    )
    assert r.status_code == 200
    assert r.get_json()["feature_keys"] == []


def test_features_put_rejects_unknown_key(client, admin_auth, customer):
    cu_id = _create(client, admin_auth, customer).get_json()["customer_user_id"]
    r = client.put(
        f"/api/admin/customer-users/{cu_id}/features",
        headers=admin_auth,
        json={"feature_keys": ["inventory", "bogus"]},
    )
    assert r.status_code == 400
    assert r.get_json()["unknown"] == ["bogus"]


def test_revoked_feature_takes_effect_on_the_next_portal_request(
    client, admin_auth, customer
):
    cu_id = _create(
        client, admin_auth, customer, must_change_password=False
    ).get_json()["customer_user_id"]
    login = client.post(
        "/api/portal/auth/login",
        json={"username": "p4-portal-1", "password": "portal-pw-1"},
    )
    live = {"Authorization": f"Bearer {login.get_json()['token']}"}
    assert client.get("/api/portal/inventory", headers=live).status_code == 200

    client.put(
        f"/api/admin/customer-users/{cu_id}/features",
        headers=admin_auth,
        json={"feature_keys": []},
    )
    assert client.get("/api/portal/inventory", headers=live).status_code == 403


# ------------------------------------------------------------------
# Stock ownership
# ------------------------------------------------------------------

@pytest.fixture()
def item(cur):
    cur.execute(
        "INSERT INTO items (sku, item_name, is_active, external_id) "
        "VALUES ('P4-SKU-1', 'Phase4 Item', TRUE, gen_random_uuid()) RETURNING item_id"
    )
    return cur.fetchone()[0]


def test_set_item_owner(client, admin_auth, customer, item):
    r = client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": customer},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["owner_customer_id"] == customer
    assert r.get_json()["owner_customer_code"] == "P4-CUST"


def test_clear_item_owner(client, admin_auth, customer, item):
    client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": customer},
    )
    r = client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": None},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["owner_customer_id"] is None


def test_item_owner_change_audits_the_previous_owner(
    client, admin_auth, customer, item, cur
):
    """Without the old value there is no way to reconstruct who could see
    the stock before the change."""
    client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": customer},
    )
    client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": None},
    )
    cur.execute(
        "SELECT details FROM audit_log WHERE action_type = 'item_owner_changed' "
        "AND entity_id = %s ORDER BY log_id DESC LIMIT 1",
        (item,),
    )
    details = cur.fetchone()[0]
    assert details["previous_owner_customer_id"] == customer
    assert details["owner_customer_id"] is None


def test_set_item_owner_rejects_unknown_customer(client, admin_auth, item):
    r = client.put(
        f"/api/admin/items/{item}/owner",
        headers=admin_auth,
        json={"owner_customer_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert r.status_code == 404


def test_set_owner_on_unknown_item(client, admin_auth, customer):
    r = client.put(
        "/api/admin/items/99999999/owner",
        headers=admin_auth,
        json={"owner_customer_id": customer},
    )
    assert r.status_code == 404


def test_set_purchase_order_owner(client, admin_auth, customer, cur):
    cur.execute(
        "INSERT INTO purchase_orders (po_number, status, warehouse_id, external_id) "
        "VALUES ('P4-PO-1', 'OPEN', 1, gen_random_uuid()) RETURNING po_id"
    )
    po_id = cur.fetchone()[0]
    r = client.put(
        f"/api/admin/purchase-orders/{po_id}/owner",
        headers=admin_auth,
        json={"owner_customer_id": customer},
    )
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["owner_customer_id"] == customer


# ------------------------------------------------------------------
# Authorisation
# ------------------------------------------------------------------

def test_operator_without_the_page_key_is_denied(client, staff_token, customer):
    auth = staff_token(["dashboard"])
    r = client.get("/api/admin/customer-users", headers=auth)
    assert r.status_code == 403
    assert r.get_json()["page_key"] == "customer-users"


def test_operator_with_the_page_key_is_allowed(client, staff_token, customer):
    auth = staff_token(["customer-users"])
    r = client.get("/api/admin/customer-users", headers=auth)
    assert r.status_code == 200, r.get_json()


def test_item_maintenance_rights_do_not_confer_ownership_rights(
    client, staff_token, customer, item
):
    """The whole reason the ownership endpoints gate on 'customer-users':
    attributing a SKU decides who sees that stock through the portal, so
    an operator trusted to fix a SKU's weight must not thereby be able to
    hand its stock to a different customer."""
    auth = staff_token(["items"])
    r = client.put(
        f"/api/admin/items/{item}/owner",
        headers=auth,
        json={"owner_customer_id": customer},
    )
    assert r.status_code == 403
    assert r.get_json()["page_key"] == "customer-users"


def test_portal_token_cannot_reach_the_admin_customer_users_surface(
    client, admin_auth, customer
):
    """Otherwise a customer could provision its own logins."""
    _create(client, admin_auth, customer, must_change_password=False)
    login = client.post(
        "/api/portal/auth/login",
        json={"username": "p4-portal-1", "password": "portal-pw-1"},
    )
    portal_auth = {"Authorization": f"Bearer {login.get_json()['token']}"}
    r = client.get("/api/admin/customer-users", headers=portal_auth)
    assert r.status_code == 403


def test_customer_users_page_key_is_registered(client):
    """A page key missing from ALL_PAGE_KEYS cannot be granted through the
    Users permission grid, so the page would be unreachable for anyone
    except ADMIN."""
    from constants import ALL_PAGE_KEYS

    assert "customer-users" in ALL_PAGE_KEYS
