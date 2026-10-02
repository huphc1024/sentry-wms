"""Admin CRUD for customer portal logins and stock ownership (phase 4).

Two surfaces, both gated on the 'customer-users' page key:

  /admin/customer-users*        provision / edit / deactivate a portal
                                login and set its feature grants
  /admin/items/<id>/owner       attribute a SKU to a customer
  /admin/purchase-orders/<id>/owner   attribute inbound goods

The ownership endpoints live here rather than in admin_items /
admin_orders because they gate on 'customer-users', not 'items' /
'purchase-orders'. Attributing a SKU to a customer decides who can see
that stock through the portal, so it is a tenancy decision, not item
maintenance -- an operator trusted to fix a SKU's weight should not
thereby be able to hand its stock to a different customer.

Deactivate rather than delete: customer_users is referenced by audit rows
via user_id = 'portal:<username>', and a deleted login makes those
entries unattributable. DELETE therefore flips is_active.
"""

import math
import uuid

import bcrypt
from flask import g, jsonify, request
from sqlalchemy import text

from constants import ALL_CUSTOMER_FEATURE_KEYS
from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.customer_users import (
    CreateCustomerUserRequest,
    SetItemOwnerRequest,
    SetPurchaseOrderOwnerRequest,
    UpdateCustomerUserFeaturesRequest,
    UpdateCustomerUserRequest,
)
from services.audit_service import write_audit_log
from services.auth_service import validate_password
from utils.validation import validate_body

PAGE_KEY = "customer-users"


def _valid_customer(customer_id):
    """Resolve a customer by canonical_id. Returns the row or None.

    Wrapped so a malformed UUID becomes a clean 404 instead of a
    DataError 500 -- the value arrives from a request body.
    """
    try:
        return g.db.execute(
            text(
                "SELECT canonical_id, customer_name, customer_code "
                "FROM customers WHERE canonical_id = :cid"
            ),
            {"cid": customer_id},
        ).fetchone()
    except Exception:
        g.db.rollback()
        return None


def _features(customer_user_id):
    rows = g.db.execute(
        text(
            "SELECT feature_key FROM customer_user_permissions "
            "WHERE customer_user_id = :cuid ORDER BY feature_key"
        ),
        {"cuid": customer_user_id},
    ).fetchall()
    return [r.feature_key for r in rows]


def _serialise(row, features=None):
    return {
        "customer_user_id": row.customer_user_id,
        "customer_id": str(row.customer_id),
        "customer_name": getattr(row, "customer_name", None),
        "customer_code": getattr(row, "customer_code", None),
        "username": row.username,
        "full_name": row.full_name,
        "email": row.email,
        "is_active": row.is_active,
        "must_change_password": bool(row.must_change_password),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_login": row.last_login.isoformat() if row.last_login else None,
        "feature_keys": features if features is not None else [],
    }


# ── Customer portal logins ────────────────────────────────────────────────────

@admin_bp.route("/customer-users", methods=["GET"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@with_db
def list_customer_users():
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 1000)
    customer_id = request.args.get("customer_id")

    where, params = "", {}
    if customer_id:
        if not _valid_customer(customer_id):
            return jsonify({"error": "Customer not found"}), 404
        where = "WHERE cu.customer_id = :cid"
        params["cid"] = customer_id

    total = g.db.execute(
        text(f"SELECT COUNT(*) FROM customer_users cu {where}"), params
    ).scalar()
    pages = max(1, math.ceil((total or 0) / per_page))

    rows = g.db.execute(
        text(f"""
            SELECT cu.customer_user_id, cu.customer_id, cu.username, cu.full_name,
                   cu.email, cu.is_active, cu.must_change_password, cu.created_at,
                   cu.last_login, c.customer_name, c.customer_code
            FROM customer_users cu
            JOIN customers c ON c.canonical_id = cu.customer_id
            {where}
            ORDER BY cu.customer_user_id
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": per_page, "offset": (page - 1) * per_page},
    ).fetchall()

    return jsonify({
        "customer_users": [_serialise(r, _features(r.customer_user_id)) for r in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": pages,
    })


@admin_bp.route("/customer-users", methods=["POST"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@validate_body(CreateCustomerUserRequest)
@with_db
def create_customer_user(validated):
    data = validated.model_dump()

    pw_error = validate_password(data["password"])
    if pw_error:
        return jsonify({"error": pw_error}), 400

    customer = _valid_customer(data["customer_id"])
    if not customer:
        return jsonify({"error": "Customer not found"}), 404

    unknown = [k for k in data["feature_keys"] if k not in ALL_CUSTOMER_FEATURE_KEYS]
    if unknown:
        return jsonify({"error": "Unknown feature_key(s)", "unknown": unknown}), 400

    # customer_users.username is globally UNIQUE, but a staff username
    # colliding with a portal one is allowed and harmless: the two logins
    # query different tables and mint different-audience tokens.
    dup = g.db.execute(
        text("SELECT 1 FROM customer_users WHERE username = :u"),
        {"u": data["username"]},
    ).fetchone()
    if dup:
        return jsonify({"error": f"Duplicate username: {data['username']}"}), 400

    pw_hash = bcrypt.hashpw(
        data["password"].encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    row = g.db.execute(
        text("""
            INSERT INTO customer_users
                (customer_id, username, password_hash, full_name, email,
                 must_change_password, created_by, external_id)
            VALUES (:cid, :u, :pw, :name, :email, :mcp, :by, :ext)
            RETURNING customer_user_id, customer_id, username, full_name, email,
                      is_active, must_change_password, created_at, last_login
        """),
        {
            "cid": data["customer_id"], "u": data["username"], "pw": pw_hash,
            "name": data["full_name"], "email": data["email"],
            "mcp": data["must_change_password"],
            "by": g.current_user["user_id"], "ext": str(uuid.uuid4()),
        },
    ).fetchone()

    granted = list(dict.fromkeys(data["feature_keys"]))
    if granted:
        g.db.execute(
            text(
                "INSERT INTO customer_user_permissions "
                "(customer_user_id, feature_key, granted_by) "
                "VALUES (:cuid, :fk, :gb)"
            ),
            [{"cuid": row.customer_user_id, "fk": fk,
              "gb": g.current_user["user_id"]} for fk in granted],
        )

    write_audit_log(
        g.db,
        action_type="customer_user_created",
        entity_type="customer_user",
        entity_id=row.customer_user_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        details={
            "username": row.username,
            "customer_code": customer.customer_code,
            "feature_keys": granted,
        },
    )
    g.db.commit()

    body = _serialise(row, granted)
    body["customer_name"] = customer.customer_name
    body["customer_code"] = customer.customer_code
    return jsonify(body), 201


@admin_bp.route("/customer-users/<int:customer_user_id>", methods=["PUT"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@validate_body(UpdateCustomerUserRequest)
@with_db
def update_customer_user(customer_user_id, validated):
    data = validated.model_dump(exclude_unset=True)

    existing = g.db.execute(
        text(
            "SELECT customer_user_id, username FROM customer_users "
            "WHERE customer_user_id = :cuid"
        ),
        {"cuid": customer_user_id},
    ).fetchone()
    if not existing:
        return jsonify({"error": "Customer user not found"}), 404

    sets, params = [], {"cuid": customer_user_id}
    for field, column in (
        ("full_name", "full_name"),
        ("email", "email"),
        ("is_active", "is_active"),
        ("must_change_password", "must_change_password"),
    ):
        if field in data:
            sets.append(f"{column} = :{field}")
            params[field] = data[field]

    if "password" in data and data["password"] is not None:
        pw_error = validate_password(data["password"])
        if pw_error:
            return jsonify({"error": pw_error}), 400
        params["password_hash"] = bcrypt.hashpw(
            data["password"].encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")
        sets.append("password_hash = :password_hash")
        # password_changed_at is what invalidates tokens already issued to
        # this login: @require_customer_auth rejects any JWT minted before
        # it. Without this an operator resetting a compromised password
        # would leave the attacker's existing session alive for its full
        # 8-hour lifetime.
        sets.append("password_changed_at = NOW()")
        # An operator-set password must be changed by the customer, so the
        # operator does not end up knowing a working credential. Explicit
        # must_change_password in the same request still wins.
        if "must_change_password" not in data:
            sets.append("must_change_password = TRUE")

    if not sets:
        return jsonify({"error": "No fields to update"}), 400

    row = g.db.execute(
        text(f"""
            UPDATE customer_users SET {', '.join(sets)}
            WHERE customer_user_id = :cuid
            RETURNING customer_user_id, customer_id, username, full_name, email,
                      is_active, must_change_password, created_at, last_login
        """),
        params,
    ).fetchone()

    write_audit_log(
        g.db,
        action_type="customer_user_updated",
        entity_type="customer_user",
        entity_id=customer_user_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        # Field names only -- never the password itself, and not the hash.
        details={"username": existing.username, "fields": sorted(data.keys())},
    )
    g.db.commit()
    return jsonify(_serialise(row, _features(customer_user_id)))


@admin_bp.route("/customer-users/<int:customer_user_id>", methods=["DELETE"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@with_db
def deactivate_customer_user(customer_user_id):
    """Deactivate, not delete -- audit rows reference this login by
    'portal:<username>' and would become unattributable. is_active=FALSE
    is enough: @require_customer_auth re-reads it per request, so any
    live session dies on its next call."""
    row = g.db.execute(
        text(
            "UPDATE customer_users SET is_active = FALSE "
            "WHERE customer_user_id = :cuid "
            "RETURNING customer_user_id, customer_id, username, full_name, email, "
            "          is_active, must_change_password, created_at, last_login"
        ),
        {"cuid": customer_user_id},
    ).fetchone()
    if not row:
        return jsonify({"error": "Customer user not found"}), 404

    write_audit_log(
        g.db,
        action_type="customer_user_deactivated",
        entity_type="customer_user",
        entity_id=customer_user_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        details={"username": row.username},
    )
    g.db.commit()
    return jsonify(_serialise(row, _features(customer_user_id)))


@admin_bp.route("/customer-users/<int:customer_user_id>/features", methods=["GET"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@with_db
def get_customer_user_features(customer_user_id):
    exists = g.db.execute(
        text("SELECT 1 FROM customer_users WHERE customer_user_id = :cuid"),
        {"cuid": customer_user_id},
    ).fetchone()
    if not exists:
        return jsonify({"error": "Customer user not found"}), 404
    return jsonify({
        "customer_user_id": customer_user_id,
        "feature_keys": _features(customer_user_id),
        # The catalogue travels with the response so the UI renders the
        # checkbox list from the server's definition rather than a copy
        # that can drift out of sync with constants.py.
        "all_feature_keys": list(ALL_CUSTOMER_FEATURE_KEYS),
    })


@admin_bp.route("/customer-users/<int:customer_user_id>/features", methods=["PUT"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@validate_body(UpdateCustomerUserFeaturesRequest)
@with_db
def replace_customer_user_features(customer_user_id, validated):
    """Replace-all, mirroring replace_user_permissions on the staff side.

    Unlike that one there is no ADMIN-style no-op branch: no portal login
    bypasses its grants, so an empty list really does mean "can log in,
    change password, and see nothing else".
    """
    existing = g.db.execute(
        text(
            "SELECT customer_user_id, username FROM customer_users "
            "WHERE customer_user_id = :cuid"
        ),
        {"cuid": customer_user_id},
    ).fetchone()
    if not existing:
        return jsonify({"error": "Customer user not found"}), 404

    requested = list(dict.fromkeys(validated.feature_keys))
    unknown = [k for k in requested if k not in ALL_CUSTOMER_FEATURE_KEYS]
    if unknown:
        return jsonify({"error": "Unknown feature_key(s)", "unknown": unknown}), 400

    g.db.execute(
        text(
            "DELETE FROM customer_user_permissions WHERE customer_user_id = :cuid"
        ),
        {"cuid": customer_user_id},
    )
    if requested:
        g.db.execute(
            text(
                "INSERT INTO customer_user_permissions "
                "(customer_user_id, feature_key, granted_by) "
                "VALUES (:cuid, :fk, :gb)"
            ),
            [{"cuid": customer_user_id, "fk": fk,
              "gb": g.current_user["user_id"]} for fk in requested],
        )

    write_audit_log(
        g.db,
        action_type="customer_user_features_replaced",
        entity_type="customer_user",
        entity_id=customer_user_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        details={"username": existing.username, "feature_keys": requested},
    )
    g.db.commit()
    return jsonify({
        "customer_user_id": customer_user_id,
        "feature_keys": requested,
        "all_feature_keys": list(ALL_CUSTOMER_FEATURE_KEYS),
    })


# ── Stock ownership ───────────────────────────────────────────────────────────

@admin_bp.route("/items/<int:item_id>/owner", methods=["PUT"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@validate_body(SetItemOwnerRequest)
@with_db
def set_item_owner(item_id, validated):
    """Attribute a SKU to a customer, or clear it (null = operator's own).

    This is what makes stock visible on the portal, so re-pointing it
    moves that visibility from one customer to another. The audit row
    records both the old and new owner: without the old value there is no
    way to reconstruct who could see the stock before the change.
    """
    existing = g.db.execute(
        text("SELECT item_id, sku, owner_customer_id FROM items WHERE item_id = :iid"),
        {"iid": item_id},
    ).fetchone()
    if not existing:
        return jsonify({"error": "Item not found"}), 404

    owner_id = validated.owner_customer_id
    customer = None
    if owner_id:
        customer = _valid_customer(owner_id)
        if not customer:
            return jsonify({"error": "Customer not found"}), 404

    g.db.execute(
        text("UPDATE items SET owner_customer_id = :owner, updated_at = NOW() "
             "WHERE item_id = :iid"),
        {"owner": owner_id, "iid": item_id},
    )

    write_audit_log(
        g.db,
        action_type="item_owner_changed",
        entity_type="ITEM",
        entity_id=item_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        details={
            "sku": existing.sku,
            "previous_owner_customer_id": (
                str(existing.owner_customer_id) if existing.owner_customer_id else None
            ),
            "owner_customer_id": owner_id,
        },
    )
    g.db.commit()

    return jsonify({
        "item_id": item_id,
        "sku": existing.sku,
        "owner_customer_id": owner_id,
        "owner_customer_name": customer.customer_name if customer else None,
        "owner_customer_code": customer.customer_code if customer else None,
    })


@admin_bp.route("/purchase-orders/<int:po_id>/owner", methods=["PUT"])
@require_auth
@require_admin_or_page_permission(PAGE_KEY)
@validate_body(SetPurchaseOrderOwnerRequest)
@with_db
def set_purchase_order_owner(po_id, validated):
    """Attribute inbound goods to a customer.

    mig 087 could not backfill this column -- there was no prior field to
    derive it from -- so every PO created before phase 1 needs an
    operator to attribute it here before it appears on the portal.
    """
    existing = g.db.execute(
        text(
            "SELECT po_id, po_number, owner_customer_id FROM purchase_orders "
            "WHERE po_id = :pid"
        ),
        {"pid": po_id},
    ).fetchone()
    if not existing:
        return jsonify({"error": "Purchase order not found"}), 404

    owner_id = validated.owner_customer_id
    customer = None
    if owner_id:
        customer = _valid_customer(owner_id)
        if not customer:
            return jsonify({"error": "Customer not found"}), 404

    g.db.execute(
        text("UPDATE purchase_orders SET owner_customer_id = :owner WHERE po_id = :pid"),
        {"owner": owner_id, "pid": po_id},
    )

    write_audit_log(
        g.db,
        action_type="purchase_order_owner_changed",
        entity_type="PO",
        entity_id=po_id,
        user_id=g.current_user["username"],
        warehouse_id=None,
        details={
            "po_number": existing.po_number,
            "previous_owner_customer_id": (
                str(existing.owner_customer_id) if existing.owner_customer_id else None
            ),
            "owner_customer_id": owner_id,
        },
    )
    g.db.commit()

    return jsonify({
        "po_id": po_id,
        "po_number": existing.po_number,
        "owner_customer_id": owner_id,
        "owner_customer_name": customer.customer_name if customer else None,
        "owner_customer_code": customer.customer_code if customer else None,
    })
