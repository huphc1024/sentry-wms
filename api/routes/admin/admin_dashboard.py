"""Dashboard aggregates (read-only). See docs/dashboard-api.md."""

from flask import g, jsonify, request

from middleware.auth_middleware import check_warehouse_access, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from services import dashboard_service as svc


def _params(allowed):
    """Return (warehouse_id, days, error_response)."""
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id:
        return None, None, (jsonify({"error": "warehouse_id query parameter is required"}), 400)
    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return None, None, denied
    days, valid = svc.parse_days(request.args.get("days"), allowed)
    if not valid:
        return None, None, (jsonify({
            "error": "days must be one of " + ", ".join(str(d) for d in allowed)}), 400)
    return warehouse_id, days, None


@admin_bp.route("/dashboard/overview", methods=["GET"])
@require_auth
@with_db
def dashboard_overview():
    warehouse_id, days, err = _params(svc.OVERVIEW_DAYS)
    if err:
        return err
    return jsonify(svc.overview(g.db, warehouse_id, days))


@admin_bp.route("/dashboard/sales", methods=["GET"])
@require_auth
@with_db
def dashboard_sales():
    warehouse_id, days, err = _params(svc.SALES_DAYS)
    if err:
        return err
    return jsonify(svc.sales(g.db, warehouse_id, days))
