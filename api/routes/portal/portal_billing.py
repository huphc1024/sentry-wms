"""Portal billing: the caller's own invoices (phase 3).

billing_invoices.customer_id has been a real FK since mig 085, so this is
the one portal surface that needed no new ownership column.

DRAFT invoices are withheld. An operator builds an invoice by
accumulating billing_events and revising the total before issuing it; a
customer seeing a draft would be reading a number the operator has not
committed to, and would field questions about figures that then change.
Only invoices with issued_at set are published.
"""

from flask import g, jsonify
from sqlalchemy import text

from constants import CUSTOMER_FEATURE_INVOICES
from middleware.auth_middleware import (
    customer_scope_clause,
    require_customer_auth,
    require_customer_feature,
)
from middleware.db import with_db
from routes.portal import paging, portal_bp


@portal_bp.route("/invoices")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_INVOICES)
@with_db
def invoices():
    scope, params = customer_scope_clause("bi.customer_id")
    page, size, offset = paging()

    rows = g.db.execute(
        text(f"""
            SELECT bi.invoice_number, bi.period_start, bi.period_end,
                   bi.due_date, bi.total_amount, bi.currency, bi.status,
                   bi.issued_at
            FROM billing_invoices bi
            WHERE bi.issued_at IS NOT NULL
              {scope}
            ORDER BY bi.issued_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": size, "offset": offset},
    ).fetchall()

    total = g.db.execute(
        text(f"""
            SELECT COUNT(*) FROM billing_invoices bi
            WHERE bi.issued_at IS NOT NULL
              {scope}
        """),
        params,
    ).fetchone()[0]

    return jsonify({
        "page": page,
        "page_size": size,
        "total": total,
        "invoices": [{
            "invoice_number": r.invoice_number,
            "period_start": r.period_start.isoformat() if r.period_start else None,
            "period_end": r.period_end.isoformat() if r.period_end else None,
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "total_amount": float(r.total_amount) if r.total_amount is not None else None,
            "currency": r.currency,
            "status": r.status,
            "issued_at": r.issued_at.isoformat() if r.issued_at else None,
        } for r in rows],
    })


@portal_bp.route("/invoices/<invoice_number>")
@require_customer_auth
@require_customer_feature(CUSTOMER_FEATURE_INVOICES)
@with_db
def invoice_detail(invoice_number):
    scope, params = customer_scope_clause("bi.customer_id")
    params["invoice_number"] = invoice_number

    header = g.db.execute(
        text(f"""
            SELECT bi.invoice_id, bi.invoice_number, bi.period_start,
                   bi.period_end, bi.due_date, bi.total_amount, bi.currency,
                   bi.status, bi.issued_at, bi.notes
            FROM billing_invoices bi
            WHERE bi.invoice_number = :invoice_number
              AND bi.issued_at IS NOT NULL
              {scope}
        """),
        params,
    ).fetchone()
    if not header:
        return jsonify({"error": "Invoice not found"}), 404

    lines = g.db.execute(
        text("""
            SELECT description, quantity, unit_price, amount
            FROM billing_invoice_lines
            WHERE invoice_id = :invoice_id
            ORDER BY line_id
        """),
        {"invoice_id": header.invoice_id},
    ).fetchall()

    return jsonify({
        "invoice_number": header.invoice_number,
        "period_start": header.period_start.isoformat() if header.period_start else None,
        "period_end": header.period_end.isoformat() if header.period_end else None,
        "due_date": header.due_date.isoformat() if header.due_date else None,
        "total_amount": float(header.total_amount) if header.total_amount is not None else None,
        "currency": header.currency,
        "status": header.status,
        "issued_at": header.issued_at.isoformat() if header.issued_at else None,
        "notes": header.notes,
        "lines": [{
            "description": r.description,
            "quantity": float(r.quantity) if r.quantity is not None else None,
            "unit_price": float(r.unit_price) if r.unit_price is not None else None,
            "amount": float(r.amount) if r.amount is not None else None,
        } for r in lines],
    })
