"""Server-rendered web UI (Python/Flask templates)."""

from flask import (
    Blueprint,
    g,
    make_response,
    redirect,
    render_template,
    request,
    url_for,
)
from sqlalchemy import text

from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from services.auth_service import authenticate_user, decode_token, generate_token
from services.cookie_auth import (
    AUTH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    generate_csrf_token,
    set_auth_cookies,
)

web_bp = Blueprint("web", __name__, url_prefix="/web")


def _cookie_user():
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return None
    payload = decode_token(token)
    if payload is None:
        return None
    return payload


@web_bp.route("/login", methods=["GET"])
def login_page():
    user = _cookie_user()
    if user:
        return redirect(url_for("web.simulation_page"))
    return render_template("web/login.html", error=None, username="")


@web_bp.route("/login", methods=["POST"])
@with_db
def login_submit():
    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    if not username or not password:
        return render_template(
            "web/login.html",
            error="Vui long nhap day du ten dang nhap va mat khau.",
            username=username,
        )

    user = authenticate_user(g.db, username, password)
    if not user:
        return render_template(
            "web/login.html",
            error="Sai ten dang nhap hoac mat khau.",
            username=username,
        )

    token = generate_token(user)
    csrf = generate_csrf_token()
    response = make_response(redirect(url_for("web.simulation_page")))
    set_auth_cookies(response, token, csrf)
    return response


@web_bp.route("/logout", methods=["POST"])
def logout_submit():
    response = make_response(redirect(url_for("web.login_page")))
    # Clear by setting expired cookies; mirrors /api/auth/logout behavior enough
    # for this server-rendered surface.
    response.set_cookie(AUTH_COOKIE_NAME, "", expires=0, max_age=0, path="/")
    response.set_cookie(CSRF_COOKIE_NAME, "", expires=0, max_age=0, path="/")
    return response


@web_bp.route("/", methods=["GET"])
@require_auth
def web_home():
    return redirect(url_for("web.simulation_page"))


@web_bp.route("/simulation", methods=["GET"])
@require_auth
@require_admin_or_page_permission("warehouse-simulation")
@with_db
def simulation_page():
    user = g.current_user
    is_admin = user.get("role") == "ADMIN"
    if is_admin:
        rows = g.db.execute(
            text(
                """
                SELECT warehouse_id, warehouse_code, warehouse_name
                FROM warehouses
                WHERE is_active = TRUE
                ORDER BY warehouse_name
                """
            )
        ).fetchall()
    else:
        rows = g.db.execute(
            text(
                """
                SELECT warehouse_id, warehouse_code, warehouse_name
                FROM warehouses
                WHERE is_active = TRUE
                  AND warehouse_id = ANY(:wids)
                ORDER BY warehouse_name
                """
            ),
            {"wids": list(user.get("warehouse_ids") or [])},
        ).fetchall()

    warehouses = [
        {
            "id": int(r.warehouse_id),
            "code": r.warehouse_code,
            "name": r.warehouse_name,
        }
        for r in rows
    ]
    selected_id = request.args.get("warehouse_id", type=int)
    if not selected_id and warehouses:
        selected_id = warehouses[0]["id"]

    return render_template(
        "web/simulation.html",
        user=user,
        warehouses=warehouses,
        selected_warehouse_id=selected_id,
    )
