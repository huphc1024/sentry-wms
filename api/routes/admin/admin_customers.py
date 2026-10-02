"""Admin customer and commercial contract management."""

import re

from flask import g, jsonify, make_response, render_template, request
from sqlalchemy import text

from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.customers import (
    CreateContractRequest,
    CreateCustomerRequest,
    UpdateContractRequest,
    UpdateCustomerRequest,
)
from utils.pdf import html_to_pdf
from utils.validation import validate_body


def _next_code(prefix: str, table: str, column: str) -> str:
    g.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"{table}:{prefix}"})
    value = g.db.execute(
        text(
            f"SELECT COALESCE(MAX(CAST(SUBSTRING({column} FROM '([0-9]+)$') AS INTEGER)), 0) + 1 "
            f"FROM {table} WHERE {column} LIKE :prefix"
        ),
        {"prefix": f"{prefix}%"},
    ).scalar()
    return f"{prefix}{int(value):05d}"


def _customer_dict(row):
    return {
        "customer_id": str(row.canonical_id),
        "customer_code": row.customer_code,
        "customer_name": row.customer_name,
        "contact_person": row.contact_person,
        "email": row.email,
        "phone": row.phone,
        "billing_address": row.billing_address,
        "shipping_address": row.shipping_address,
        "tax_id": row.tax_id,
        "payment_terms_days": row.payment_terms_days,
        "default_currency": row.default_currency,
        "notes": row.notes,
        "is_active": bool(row.is_active),
        "contract_count": int(getattr(row, "contract_count", 0) or 0),
        "unbilled_amount": float(getattr(row, "unbilled_amount", 0) or 0),
    }


def _contract_dict(row):
    return {
        "contract_id": row.contract_id,
        "contract_number": row.contract_number,
        "customer_id": str(row.customer_id),
        "customer_code": row.customer_code,
        "customer_name": row.customer_name,
        "warehouse_id": row.warehouse_id,
        "warehouse_name": row.warehouse_name,
        "contract_name": row.contract_name,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat() if row.end_date else None,
        "status": row.status,
        "billing_cycle": row.billing_cycle,
        "payment_terms_days": row.payment_terms_days,
        "currency": row.currency,
        "notes": row.notes,
        "rate_count": int(getattr(row, "rate_count", 0) or 0),
    }


@admin_bp.route("/customers", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def list_customers():
    search = (request.args.get("search") or "").strip()
    active = request.args.get("active")
    clauses, params = [], {}
    if search:
        clauses.append("(c.customer_code ILIKE :search OR c.customer_name ILIKE :search OR c.tax_id ILIKE :search OR c.phone ILIKE :search)")
        params["search"] = f"%{search}%"
    if active in ("true", "false"):
        clauses.append("COALESCE(c.is_active, true) = :active")
        params["active"] = active == "true"
    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = g.db.execute(text(f"""
        SELECT c.*,
               (SELECT COUNT(*) FROM customer_contracts cc
                WHERE cc.customer_id = c.canonical_id) AS contract_count,
               (SELECT COALESCE(SUM(be.amount), 0) FROM billing_events be
                WHERE be.customer_id = c.canonical_id
                  AND be.billed = false) AS unbilled_amount
        FROM customers c
        {where_sql}
        ORDER BY COALESCE(c.is_active, true) DESC, c.customer_code, c.customer_name
    """), params).fetchall()
    return jsonify({"customers": [_customer_dict(row) for row in rows]})


@admin_bp.route("/customers", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(CreateCustomerRequest)
@with_db
def create_customer(validated):
    data = validated.model_dump()
    code = data.pop("customer_code", None) or _next_code("CUS-", "customers", "customer_code")
    row = g.db.execute(text("""
        INSERT INTO customers (
            customer_code, customer_name, contact_person, email, phone,
            billing_address, shipping_address, tax_id, payment_terms_days,
            default_currency, notes, is_active, latest_inbound_id
        ) VALUES (
            :customer_code, :customer_name, :contact_person, :email, :phone,
            :billing_address, :shipping_address, :tax_id, :payment_terms_days,
            :default_currency, :notes, :is_active, 0
        ) RETURNING canonical_id
    """), {"customer_code": code, **data}).fetchone()
    g.db.commit()
    return jsonify({"customer_id": str(row.canonical_id), "customer_code": code}), 201


@admin_bp.route("/customers/<uuid:customer_id>", methods=["PUT"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(UpdateCustomerRequest)
@with_db
def update_customer(customer_id, validated):
    data = validated.model_dump(exclude_unset=True)
    if not data:
        return jsonify({"error": "No fields provided"}), 400
    fields = [f"{key} = :{key}" for key in data]
    result = g.db.execute(
        text(f"UPDATE customers SET {', '.join(fields)}, updated_at = NOW() WHERE canonical_id = :customer_id"),
        {**data, "customer_id": str(customer_id)},
    )
    if not result.rowcount:
        return jsonify({"error": "Customer not found"}), 404
    g.db.commit()
    return jsonify({"message": "updated"})


@admin_bp.route("/customers/<uuid:customer_id>", methods=["DELETE"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def deactivate_customer(customer_id):
    result = g.db.execute(
        text("UPDATE customers SET is_active = false, updated_at = NOW() WHERE canonical_id = :id"),
        {"id": str(customer_id)},
    )
    if not result.rowcount:
        return jsonify({"error": "Customer not found"}), 404
    g.db.commit()
    return jsonify({"message": "deactivated"})


_CONTRACT_SELECT = """
    SELECT cc.*, c.customer_code, c.customer_name, w.warehouse_name,
           COUNT(rc.rate_card_id) AS rate_count
    FROM customer_contracts cc
    JOIN customers c ON c.canonical_id = cc.customer_id
    LEFT JOIN warehouses w ON w.warehouse_id = cc.warehouse_id
    LEFT JOIN billing_rate_cards rc ON rc.contract_id = cc.contract_id
"""


@admin_bp.route("/customer-contracts", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def list_contracts():
    customer_id = request.args.get("customer_id")
    params = {}
    where_sql = ""
    if customer_id:
        where_sql = "WHERE cc.customer_id = :customer_id"
        params["customer_id"] = customer_id
    rows = g.db.execute(text(
        _CONTRACT_SELECT + where_sql + " GROUP BY cc.contract_id, c.customer_code, c.customer_name, w.warehouse_name ORDER BY cc.start_date DESC, cc.contract_id DESC"
    ), params).fetchall()
    return jsonify({"contracts": [_contract_dict(row) for row in rows]})


@admin_bp.route("/customer-contracts", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(CreateContractRequest)
@with_db
def create_contract(validated):
    data = validated.model_dump()
    number = data.pop("contract_number", None) or _next_code("CTR-", "customer_contracts", "contract_number")
    row = g.db.execute(text("""
        INSERT INTO customer_contracts (
            contract_number, customer_id, warehouse_id, contract_name,
            start_date, end_date, status, billing_cycle, payment_terms_days,
            currency, notes, created_by
        ) VALUES (
            :contract_number, :customer_id, :warehouse_id, :contract_name,
            :start_date, :end_date, :status, :billing_cycle, :payment_terms_days,
            :currency, :notes, :created_by
        ) RETURNING contract_id
    """), {
        "contract_number": number,
        **data,
        "customer_id": str(data["customer_id"]),
        "created_by": g.current_user.get("username"),
    }).fetchone()
    g.db.commit()
    return jsonify({"contract_id": row.contract_id, "contract_number": number}), 201


@admin_bp.route("/customer-contracts/<int:contract_id>", methods=["PUT"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(UpdateContractRequest)
@with_db
def update_contract(contract_id, validated):
    data = validated.model_dump(exclude_unset=True)
    if not data:
        return jsonify({"error": "No fields provided"}), 400
    fields = [f"{key} = :{key}" for key in data]
    result = g.db.execute(
        text(f"UPDATE customer_contracts SET {', '.join(fields)}, updated_at = NOW() WHERE contract_id = :contract_id"),
        {**data, "contract_id": contract_id},
    )
    if not result.rowcount:
        return jsonify({"error": "Contract not found"}), 404
    g.db.commit()
    return jsonify({"message": "updated"})


@admin_bp.route("/customer-contracts/<int:contract_id>/pdf", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def contract_pdf(contract_id):
    """Render a Vietnamese logistics/warehousing service contract as PDF."""
    contract = g.db.execute(text("""
        SELECT cc.*, c.customer_code, c.customer_name, c.contact_person,
               c.email, c.phone, c.billing_address, c.shipping_address,
               c.tax_id, w.warehouse_code, w.warehouse_name,
               w.address AS warehouse_address
        FROM customer_contracts cc
        JOIN customers c ON c.canonical_id = cc.customer_id
        LEFT JOIN warehouses w ON w.warehouse_id = cc.warehouse_id
        WHERE cc.contract_id = :contract_id
    """), {"contract_id": contract_id}).fetchone()
    if not contract:
        return jsonify({"error": "Contract not found"}), 404

    rates = g.db.execute(text("""
        SELECT rate_name, service_type, unit, unit_price, currency,
               effective_from, effective_to
        FROM billing_rate_cards
        WHERE contract_id = :contract_id
        ORDER BY service_type, effective_from NULLS FIRST, rate_card_id
    """), {"contract_id": contract_id}).fetchall()
    settings = g.db.execute(text("""
        SELECT key, value FROM app_settings
        WHERE key IN (
            'picking_ticket_company_name',
            'picking_ticket_company_address'
        )
    """)).fetchall()
    setting_values = {row.key: row.value for row in settings}
    provider = {
        "name": setting_values.get("picking_ticket_company_name") or "SƠN LỘC WMS",
        "address": setting_values.get("picking_ticket_company_address") or "",
    }

    html = render_template(
        "contract_print.html",
        contract=contract,
        rates=rates,
        provider=provider,
    )
    pdf_bytes = html_to_pdf(html)
    response = make_response(pdf_bytes)
    response.headers["Content-Type"] = "application/pdf"
    safe_number = re.sub(r"[^A-Za-z0-9._-]+", "-", contract.contract_number).strip("-")
    response.headers["Content-Disposition"] = (
        f'attachment; filename="contract-{safe_number or contract_id}.pdf"'
    )
    return response
