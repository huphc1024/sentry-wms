# Admin billing endpoints: events, invoices, storage run, cycle generation.
import calendar
import uuid
from datetime import date, timedelta

from flask import g, jsonify, make_response, render_template, request
from sqlalchemy import text

from middleware.auth_middleware import require_admin_or_page_permission, require_auth
from middleware.db import with_db
from routes.admin import admin_bp
from schemas.billing import CreateBillingEventRequest, CreateInvoiceRequest
from services.billing_service import create_billing_event as svc_create_billing_event
from utils.pdf import html_to_pdf
from utils.validation import validate_body


def _period_for_cycle(billing_cycle: str, as_of: date) -> tuple[date, date]:
    """Return (period_start, period_end) for MONTHLY or WEEKLY around as_of."""
    if billing_cycle == "WEEKLY":
        # Monday–Sunday containing as_of
        period_start = as_of - timedelta(days=as_of.weekday())
        period_end = period_start + timedelta(days=6)
        return period_start, period_end
    # MONTHLY: calendar month containing as_of
    period_start = as_of.replace(day=1)
    last_day = calendar.monthrange(as_of.year, as_of.month)[1]
    period_end = as_of.replace(day=last_day)
    return period_start, period_end


def _create_invoice_from_unbilled(
    db,
    *,
    customer_id,
    contract_id,
    period_start,
    period_end,
    terms,
    currency,
    notes=None,
    include_unbilled_events=True,
    extra_lines=None,
):
    """Insert a DRAFT invoice and optionally attach unbilled events in the period.

    Returns (invoice_id, invoice_number, total). Caller must commit.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('billing_invoice_number'))"))
    res = db.execute(
        text("""
            INSERT INTO billing_invoices (
                customer_id, contract_id, period_start, period_end,
                total_amount, status, issued_at, external_id, created_at,
                due_date, currency, notes
            ) VALUES (
                :cid, :contract_id, :ps, :pe, 0, 'DRAFT', NULL, :ext, NOW(),
                :due_date, :currency, :notes
            ) RETURNING invoice_id
        """),
        {
            "cid": customer_id,
            "contract_id": contract_id,
            "ps": period_start,
            "pe": period_end,
            "ext": str(uuid.uuid4()),
            "due_date": period_end + timedelta(days=terms),
            "currency": currency,
            "notes": notes,
        },
    ).fetchone()
    invoice_id = res.invoice_id
    invoice_number = f"INV-{period_end.year}-{invoice_id:06d}"
    total = 0.0

    if include_unbilled_events:
        events = db.execute(
            text("""
                SELECT event_id, event_type, reference_table, reference_id,
                       quantity, unit_price, amount
                FROM billing_events
                WHERE customer_id = :cid AND billed = false
                  AND service_date BETWEEN :ps AND :pe
                ORDER BY service_date, event_id
                FOR UPDATE
            """),
            {"cid": customer_id, "ps": period_start, "pe": period_end},
        ).fetchall()
        for event in events:
            amount = float(event.amount or 0)
            total += amount
            description = event.event_type.replace("_", " ").title()
            if event.reference_table and event.reference_id:
                description += f" · {event.reference_table} #{event.reference_id}"
            db.execute(
                text("""
                    INSERT INTO billing_invoice_lines (
                        invoice_id, event_id, description, quantity, unit_price, amount
                    ) VALUES (:inv, :event_id, :desc, :qty, :up, :amt)
                """),
                {
                    "inv": invoice_id,
                    "event_id": event.event_id,
                    "desc": description,
                    "qty": event.quantity,
                    "up": event.unit_price or 0,
                    "amt": amount,
                },
            )
        if events:
            db.execute(
                text("""
                    UPDATE billing_events
                    SET billed = true, invoice_id = :invoice_id
                    WHERE event_id = ANY(:event_ids)
                """),
                {
                    "invoice_id": invoice_id,
                    "event_ids": [event.event_id for event in events],
                },
            )

    for ln in extra_lines or []:
        qty = float(ln.get("quantity", 0))
        up = float(ln.get("unit_price", 0))
        amt = qty * up
        total += amt
        db.execute(
            text("""
                INSERT INTO billing_invoice_lines (
                    invoice_id, description, quantity, unit_price, amount
                ) VALUES (:inv, :desc, :qty, :up, :amt)
            """),
            {
                "inv": invoice_id,
                "desc": ln.get("description"),
                "qty": qty,
                "up": up,
                "amt": amt,
            },
        )

    db.execute(
        text("""
            UPDATE billing_invoices
            SET total_amount = :total, invoice_number = :invoice_number
            WHERE invoice_id = :inv
        """),
        {"total": total, "invoice_number": invoice_number, "inv": invoice_id},
    )
    return invoice_id, invoice_number, total


@admin_bp.route("/billing/events", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(CreateBillingEventRequest)
@with_db
def create_billing_event(validated):
    data = validated.model_dump()
    amount = svc_create_billing_event(
        g.db,
        data.get("customer_id"),
        data.get("warehouse_id"),
        data["event_type"],
        data.get("reference_table"),
        data.get("reference_id"),
        data.get("quantity", 0),
    )
    g.db.commit()
    return jsonify({"message": "event recorded", "amount": amount}), 201


@admin_bp.route("/billing/invoices", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@validate_body(CreateInvoiceRequest)
@with_db
def create_invoice(validated):
    data = validated.model_dump()
    customer = g.db.execute(
        text("""
            SELECT canonical_id, payment_terms_days, default_currency
            FROM customers WHERE canonical_id = :cid
        """),
        {"cid": data["customer_id"]},
    ).fetchone()
    if not customer:
        return jsonify({"error": "Customer not found"}), 404
    terms = int(customer.payment_terms_days or 30)
    currency = customer.default_currency or "VND"
    if data.get("contract_id"):
        contract = g.db.execute(
            text("""
                SELECT contract_id, payment_terms_days, currency
                FROM customer_contracts
                WHERE contract_id = :contract_id AND customer_id = :cid
            """),
            {"contract_id": data["contract_id"], "cid": data["customer_id"]},
        ).fetchone()
        if not contract:
            return jsonify({"error": "Contract does not belong to customer"}), 400
        terms = int(contract.payment_terms_days)
        currency = contract.currency

    invoice_id, invoice_number, total = _create_invoice_from_unbilled(
        g.db,
        customer_id=data["customer_id"],
        contract_id=data.get("contract_id"),
        period_start=data["period_start"],
        period_end=data["period_end"],
        terms=terms,
        currency=currency,
        notes=data.get("notes"),
        include_unbilled_events=data.get("include_unbilled_events", True),
        extra_lines=data.get("lines") or [],
    )
    g.db.commit()
    return jsonify({
        "invoice_id": invoice_id,
        "invoice_number": invoice_number,
        "total": total,
    }), 201


@admin_bp.route("/billing/invoices/generate-cycle", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def generate_invoices_by_cycle():
    """Create DRAFT invoices for ACTIVE MONTHLY/WEEKLY contracts for the period of as_of."""
    body = request.get_json() or {}
    as_of_raw = body.get("as_of")
    warehouse_id = body.get("warehouse_id")
    if as_of_raw:
        try:
            as_of = date.fromisoformat(as_of_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "as_of must use YYYY-MM-DD"}), 400
    else:
        as_of = date.today()

    params = {}
    warehouse_clause = ""
    if warehouse_id is not None:
        warehouse_clause = "AND (cc.warehouse_id IS NULL OR cc.warehouse_id = :wid)"
        params["wid"] = int(warehouse_id)

    contracts = g.db.execute(
        text(f"""
            SELECT cc.contract_id, cc.customer_id, cc.billing_cycle,
                   cc.payment_terms_days, cc.currency, cc.warehouse_id,
                   cc.contract_number
            FROM customer_contracts cc
            WHERE cc.status = 'ACTIVE'
              AND cc.billing_cycle IN ('MONTHLY', 'WEEKLY')
              AND cc.start_date <= :as_of
              AND (cc.end_date IS NULL OR cc.end_date >= :as_of)
              {warehouse_clause}
            ORDER BY cc.contract_id
        """),
        {"as_of": as_of, **params},
    ).fetchall()

    created = []
    skipped = []
    for contract in contracts:
        period_start, period_end = _period_for_cycle(contract.billing_cycle, as_of)
        existing = g.db.execute(
            text("""
                SELECT invoice_id
                FROM billing_invoices
                WHERE customer_id = :cid
                  AND contract_id = :contract_id
                  AND period_start = :ps
                  AND period_end = :pe
                  AND status <> 'CANCELLED'
                LIMIT 1
            """),
            {
                "cid": contract.customer_id,
                "contract_id": contract.contract_id,
                "ps": period_start,
                "pe": period_end,
            },
        ).fetchone()
        if existing:
            skipped.append({
                "contract_id": contract.contract_id,
                "contract_number": contract.contract_number,
                "reason": "invoice_exists",
                "invoice_id": existing.invoice_id,
            })
            continue

        invoice_id, invoice_number, total = _create_invoice_from_unbilled(
            g.db,
            customer_id=str(contract.customer_id),
            contract_id=contract.contract_id,
            period_start=period_start,
            period_end=period_end,
            terms=int(contract.payment_terms_days),
            currency=contract.currency or "VND",
            notes=f"Auto {contract.billing_cycle.lower()} cycle {period_start}–{period_end}",
        )
        created.append({
            "contract_id": contract.contract_id,
            "contract_number": contract.contract_number,
            "invoice_id": invoice_id,
            "invoice_number": invoice_number,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "total": total,
        })

    g.db.commit()
    return jsonify({
        "as_of": as_of.isoformat(),
        "created": created,
        "skipped": skipped,
        "created_count": len(created),
        "skipped_count": len(skipped),
    })


@admin_bp.route("/billing/run_storage_billing", methods=["POST"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def run_storage_billing():
    """Generate storage-day billing events for a date (YYYY-MM-DD) in body.date or today."""
    body = request.get_json() or {}
    service_date = body.get("date")
    if not service_date:
        service_date = date.today().isoformat()
    from jobs.billing_tasks import _run_storage_billing

    created = _run_storage_billing(g.db, service_date)
    g.db.commit()
    return jsonify({"created": created, "date": service_date}), 200


@admin_bp.route("/billing/invoices", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def list_invoices():
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 1000)
    params = {"limit": per_page, "offset": (page - 1) * per_page}
    rows = g.db.execute(
        text("""
            SELECT bi.invoice_id, bi.invoice_number, bi.customer_id,
                   c.customer_code, c.customer_name, bi.contract_id,
                   cc.contract_number, bi.period_start, bi.period_end,
                   bi.total_amount, bi.currency, bi.due_date, bi.status,
                   bi.issued_at, bi.created_at
            FROM billing_invoices bi
            JOIN customers c ON c.canonical_id = bi.customer_id
            LEFT JOIN customer_contracts cc ON cc.contract_id = bi.contract_id
            ORDER BY bi.invoice_id DESC LIMIT :limit OFFSET :offset
        """),
        params,
    ).fetchall()
    total = g.db.execute(text("SELECT COUNT(*) FROM billing_invoices")).scalar()
    return jsonify({
        "invoices": [
            {
                "invoice_id": r.invoice_id,
                "invoice_number": r.invoice_number,
                "customer_id": str(r.customer_id),
                "customer_code": r.customer_code,
                "customer_name": r.customer_name,
                "contract_id": r.contract_id,
                "contract_number": r.contract_number,
                "period_start": r.period_start.isoformat() if r.period_start else None,
                "period_end": r.period_end.isoformat() if r.period_end else None,
                "total_amount": float(r.total_amount),
                "currency": r.currency,
                "due_date": r.due_date.isoformat() if r.due_date else None,
                "status": r.status,
                "issued_at": r.issued_at.isoformat() if r.issued_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, -(-total // per_page)),
    })


@admin_bp.route("/billing/invoices/<int:invoice_id>", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def get_invoice(invoice_id):
    inv = g.db.execute(
        text("""
            SELECT bi.*, c.customer_code, c.customer_name, c.tax_id,
                   c.billing_address, c.email, c.phone, cc.contract_number
            FROM billing_invoices bi
            JOIN customers c ON c.canonical_id = bi.customer_id
            LEFT JOIN customer_contracts cc ON cc.contract_id = bi.contract_id
            WHERE bi.invoice_id = :iid
        """),
        {"iid": invoice_id},
    ).fetchone()
    if not inv:
        return jsonify({"error": "Invoice not found"}), 404
    lines = g.db.execute(
        text("""
            SELECT line_id, description, quantity, unit_price, amount
            FROM billing_invoice_lines WHERE invoice_id = :iid
        """),
        {"iid": invoice_id},
    ).fetchall()
    return jsonify({
        "invoice": {
            "invoice_id": inv.invoice_id,
            "invoice_number": inv.invoice_number,
            "customer_id": str(inv.customer_id),
            "customer_code": inv.customer_code,
            "customer_name": inv.customer_name,
            "tax_id": inv.tax_id,
            "billing_address": inv.billing_address,
            "email": inv.email,
            "phone": inv.phone,
            "contract_id": inv.contract_id,
            "contract_number": inv.contract_number,
            "period_start": inv.period_start.isoformat() if inv.period_start else None,
            "period_end": inv.period_end.isoformat() if inv.period_end else None,
            "total_amount": float(inv.total_amount),
            "currency": inv.currency,
            "due_date": inv.due_date.isoformat() if inv.due_date else None,
            "notes": inv.notes,
            "status": inv.status,
            "issued_at": inv.issued_at.isoformat() if inv.issued_at else None,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        },
        "lines": [
            {
                "line_id": line.line_id,
                "description": line.description,
                "quantity": float(line.quantity),
                "unit_price": float(line.unit_price),
                "amount": float(line.amount),
            }
            for line in lines
        ],
    })


@admin_bp.route("/billing/invoices/<int:invoice_id>/pdf", methods=["GET"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def invoice_pdf(invoice_id):
    """Render invoice as a downloadable PDF."""
    inv = g.db.execute(
        text("""
            SELECT bi.*, c.customer_code, c.customer_name, c.tax_id,
                   c.billing_address, c.email, c.phone, cc.contract_number
            FROM billing_invoices bi
            JOIN customers c ON c.canonical_id = bi.customer_id
            LEFT JOIN customer_contracts cc ON cc.contract_id = bi.contract_id
            WHERE bi.invoice_id = :iid
        """),
        {"iid": invoice_id},
    ).fetchone()
    if not inv:
        return jsonify({"error": "Invoice not found"}), 404
    lines = g.db.execute(
        text("""
            SELECT line_id, description, quantity, unit_price, amount
            FROM billing_invoice_lines WHERE invoice_id = :iid
        """),
        {"iid": invoice_id},
    ).fetchall()
    html = render_template("invoice_print.html", invoice=inv, lines=lines)
    pdf_bytes = html_to_pdf(html)
    resp = make_response(pdf_bytes)
    resp.headers["Content-Type"] = "application/pdf"
    filename = inv.invoice_number or f"invoice-{invoice_id}"
    resp.headers["Content-Disposition"] = f"attachment; filename={filename}.pdf"
    return resp


@admin_bp.route("/billing/invoices/<int:invoice_id>", methods=["PUT"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def update_invoice(invoice_id):
    body = request.get_json() or {}
    status = body.get("status")
    if status not in {"DRAFT", "SENT", "PAID"}:
        return jsonify({"error": "status must be DRAFT, SENT or PAID"}), 400
    current = g.db.execute(
        text("SELECT status FROM billing_invoices WHERE invoice_id = :iid"),
        {"iid": invoice_id},
    ).fetchone()
    if not current:
        return jsonify({"error": "Invoice not found"}), 404
    g.db.execute(
        text("""
            UPDATE billing_invoices
            SET status = :st,
                issued_at = CASE WHEN :st = 'SENT' THEN NOW() ELSE issued_at END
            WHERE invoice_id = :iid
        """),
        {"st": status, "iid": invoice_id},
    )
    if status == "SENT" and current.status != "SENT":
        from services.vehicle_service import emit_invoice_issued
        emit_invoice_issued(
            g.db,
            invoice_id=invoice_id,
            warehouse_id=None,
            source_txn_id=str(uuid.uuid4()),
        )
    g.db.commit()
    return jsonify({"message": "updated", "status": status})


@admin_bp.route("/billing/invoices/<int:invoice_id>", methods=["DELETE"])
@require_auth
@require_admin_or_page_permission("billing")
@with_db
def cancel_invoice(invoice_id):
    current = g.db.execute(
        text("SELECT status FROM billing_invoices WHERE invoice_id = :iid"),
        {"iid": invoice_id},
    ).fetchone()
    if not current:
        return jsonify({"error": "Invoice not found"}), 404
    if current.status == "PAID":
        return jsonify({"error": "Paid invoice cannot be cancelled"}), 409
    g.db.execute(
        text("UPDATE billing_invoices SET status = 'CANCELLED' WHERE invoice_id = :iid"),
        {"iid": invoice_id},
    )
    g.db.execute(
        text("""
            UPDATE billing_events SET billed = false, invoice_id = NULL
            WHERE invoice_id = :iid
        """),
        {"iid": invoice_id},
    )
    g.db.commit()
    return jsonify({"message": "cancelled"})
