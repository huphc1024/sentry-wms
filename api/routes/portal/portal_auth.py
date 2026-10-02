"""Customer portal auth endpoints (phase 3).

The blueprint name is "portal_auth" on purpose: Flask endpoint names
become portal_auth.login / .logout / .me / .change_password, which is
exactly what PORTAL_FORCED_CHANGE_ALLOWED_ENDPOINTS in
middleware/auth_middleware.py matches on. Renaming the blueprint without
updating that frozenset would silently lock every account that still has
must_change_password set -- mig 088 sets it TRUE by default, so that is
every newly provisioned login.

Rate limiting reuses the staff login_attempts table with a 'customer:'
key prefix. The table's key column is an opaque VARCHAR, so the two
namespaces cannot collide: a customer spraying passwords cannot lock out
a staff account with the same username, and vice versa.
"""

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_customer_auth
from middleware.db import with_db
from schemas.auth import ChangePasswordRequest, LoginRequest
from services.auth_service import (
    authenticate_customer_user,
    decode_token,
    generate_customer_token,
    validate_password,
)
from services.cookie_auth import (
    PORTAL_AUTH_COOKIE_NAME,
    PORTAL_CSRF_COOKIE_NAME,
    clear_auth_cookies,
    csrf_token_matches,
    generate_csrf_token,
    set_auth_cookies,
)
from services.login_rate_limit import (
    LOCKOUT_MINUTES,
    check_rate_limit,
    record_failure,
    reset_attempts,
)
from utils.validation import validate_body

portal_auth_bp = Blueprint("portal_auth", __name__)


def _set_portal_cookies(response, token, csrf):
    set_auth_cookies(
        response,
        token,
        csrf,
        auth_cookie_name=PORTAL_AUTH_COOKIE_NAME,
        csrf_cookie_name=PORTAL_CSRF_COOKIE_NAME,
    )


@portal_auth_bp.route("/login", methods=["POST"])
@validate_body(LoginRequest)
@with_db
def login(validated):
    username = validated.username.lower().strip()
    client_ip = request.remote_addr or "unknown"
    # 'customer:' prefix keeps the portal's buckets out of the staff
    # namespace. Same (IP, username) tuple rationale as the staff login
    # (#35): keying on the IP alone collapses every customer behind one
    # corporate NAT into a single bucket.
    user_key = f"customer:user:{username}"
    lock_key = f"customer:ip:{client_ip}|user:{username}"

    locked, remaining = check_rate_limit(g.db, lock_key)
    if locked:
        minutes, seconds = remaining // 60, remaining % 60
        return jsonify({
            "error": f"Too many failed login attempts for this account. Try again in {minutes}m {seconds}s",
        }), 429

    customer_user = authenticate_customer_user(
        g.db, validated.username, validated.password
    )

    if not customer_user:
        record_failure(g.db, user_key, allow_lockout=False)
        locked, _ = record_failure(g.db, lock_key, allow_lockout=True)
        if locked:
            return jsonify({
                "error": f"Too many failed login attempts for this account. Locked for {LOCKOUT_MINUTES} minutes",
            }), 429
        return jsonify({"error": "Invalid username or password"}), 401

    reset_attempts(g.db, user_key)
    reset_attempts(g.db, lock_key)

    token = generate_customer_token(customer_user)
    csrf = generate_csrf_token()
    response = jsonify({"token": token, "customer_user": customer_user})
    _set_portal_cookies(response, token, csrf)
    return response


@portal_auth_bp.route("/logout", methods=["POST"])
def logout():
    """Same V-100 shape as the staff logout: no cookie -> 200 no-op with no
    Set-Cookie, so an attacker-origin form post cannot force a victim's
    browser to apply expired cookies; valid cookie -> require a CSRF
    match; dead cookie -> clear silently."""
    response = jsonify({"message": "logged out"})
    auth_cookie = request.cookies.get(PORTAL_AUTH_COOKIE_NAME)
    if not auth_cookie:
        return response
    payload = decode_token(auth_cookie)
    if payload is not None and not csrf_token_matches(PORTAL_CSRF_COOKIE_NAME):
        return jsonify({"error": "CSRF token missing or invalid"}), 403
    clear_auth_cookies(
        response,
        auth_cookie_name=PORTAL_AUTH_COOKIE_NAME,
        csrf_cookie_name=PORTAL_CSRF_COOKIE_NAME,
    )
    return response


@portal_auth_bp.route("/me")
@require_customer_auth
@with_db
def me():
    cu_id = g.current_customer["customer_user_id"]
    row = g.db.execute(
        text(
            "SELECT cu.customer_user_id, cu.username, cu.full_name, cu.email, "
            "       cu.must_change_password, c.canonical_id AS customer_id, "
            "       c.customer_name, c.customer_code "
            "FROM customer_users cu "
            "JOIN customers c ON c.canonical_id = cu.customer_id "
            "WHERE cu.customer_user_id = :cuid"
        ),
        {"cuid": cu_id},
    ).fetchone()
    if not row:
        return jsonify({"error": "Account not found"}), 404

    return jsonify({
        "customer_user_id": row.customer_user_id,
        "username": row.username,
        "full_name": row.full_name,
        "email": row.email,
        "customer_id": str(row.customer_id),
        "customer_name": row.customer_name,
        "customer_code": row.customer_code,
        # Read from the request context, which @require_customer_auth
        # refreshed from the DB -- so a grant revoked mid-session is
        # reflected here without the client re-authenticating.
        "features": g.current_customer["features"],
        "must_change_password": bool(row.must_change_password),
    })


@portal_auth_bp.route("/change-password", methods=["POST"])
@require_customer_auth
@validate_body(ChangePasswordRequest)
@with_db
def change_password(validated):
    import bcrypt

    from services.audit_service import write_audit_log

    pw_error = validate_password(validated.new_password)
    if pw_error:
        return jsonify({"error": pw_error}), 400

    cu_id = g.current_customer["customer_user_id"]
    row = g.db.execute(
        text(
            "SELECT password_hash, must_change_password, username "
            "FROM customer_users WHERE customer_user_id = :cuid"
        ),
        {"cuid": cu_id},
    ).fetchone()

    if not row or not bcrypt.checkpw(
        validated.current_password.encode("utf-8"), row.password_hash.encode("utf-8")
    ):
        return jsonify({"error": "Current password is incorrect"}), 403

    was_forced = bool(row.must_change_password)
    new_hash = bcrypt.hashpw(
        validated.new_password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    # password_changed_at is what invalidates already-issued tokens:
    # @require_customer_auth rejects any JWT whose iat predates it, so a
    # password change ends every other session for this login.
    g.db.execute(
        text(
            "UPDATE customer_users SET password_hash = :pw, "
            "password_changed_at = NOW(), must_change_password = FALSE "
            "WHERE customer_user_id = :cuid"
        ),
        {"pw": new_hash, "cuid": cu_id},
    )

    write_audit_log(
        g.db,
        action_type=(
            "portal_forced_password_change_completed"
            if was_forced
            else "portal_password_change"
        ),
        entity_type="customer_user",
        entity_id=cu_id,
        user_id=f"portal:{row.username}",
        warehouse_id=None,
    )

    g.db.commit()
    return jsonify({"message": "Password changed"})
