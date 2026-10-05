from datetime import date

from sqlalchemy import text


def _find_rate_card(db, customer_id, service_type, as_of=None, warehouse_id=None):
    """Find applicable rate card: prefer customer-specific, fall back to global (customer_id IS NULL)."""
    if as_of is None:
        as_of = date.today()
    # Prefer customer-specific (customer_id = :cid) then global (customer_id IS NULL)
    rows = db.execute(
        text(
            """
            SELECT rc.rate_card_id, rc.unit_price, rc.unit, rc.currency
            FROM billing_rate_cards rc
            LEFT JOIN customer_contracts cc ON cc.contract_id = rc.contract_id
            WHERE rc.service_type = :stype
              AND (rc.customer_id = :cid OR rc.customer_id IS NULL)
              AND (rc.warehouse_id = :wid OR rc.warehouse_id IS NULL)
              AND (rc.effective_from IS NULL OR rc.effective_from <= :as_of)
              AND (rc.effective_to IS NULL OR rc.effective_to >= :as_of)
              AND (
                rc.contract_id IS NULL OR (
                  cc.status = 'ACTIVE'
                  AND cc.start_date <= :as_of
                  AND (cc.end_date IS NULL OR cc.end_date >= :as_of)
                )
              )
            ORDER BY (rc.customer_id IS NOT NULL) DESC,
                     (rc.contract_id IS NOT NULL) DESC,
                     (rc.warehouse_id IS NOT NULL) DESC,
                     rc.effective_from DESC
            LIMIT 1
            """
        ),
        {"stype": service_type, "cid": customer_id, "wid": warehouse_id, "as_of": as_of},
    ).fetchone()
    return rows


def create_billing_event(
    db,
    customer_id,
    warehouse_id,
    event_type,
    reference_table,
    reference_id,
    quantity,
    service_date=None,
):
    """Create a billing_events row, applying rate-card pricing when available.

    Idempotent for the unique source key
    ``(event_type, reference_table, reference_id, service_date)``: a duplicate
    insert is skipped and returns ``None``.

    Returns the computed amount on insert, or ``None`` when skipped.
    """
    if service_date is None:
        service_date = date.today()
    elif isinstance(service_date, str):
        service_date = date.fromisoformat(service_date)

    service_type = {
        "STORAGE_DAY": "STORAGE",
        "PICK": "PICK_PACK",
    }.get(event_type, event_type)
    rate = _find_rate_card(
        db, customer_id, service_type, as_of=service_date, warehouse_id=warehouse_id,
    )
    unit_price = float(rate.unit_price) if rate and rate.unit_price is not None else None
    amount = (float(quantity) * unit_price) if unit_price is not None else 0.0
    result = db.execute(
        text(
            """
            INSERT INTO billing_events (
                customer_id, warehouse_id, event_type, reference_table,
                reference_id, quantity, unit_price, amount, rate_card_id,
                service_date, created_at
            ) VALUES (
                :cid, :wid, :etype, :rt, :rid, :qty, :up, :amt, :rate_id,
                :service_date, NOW()
            )
            ON CONFLICT (event_type, reference_table, reference_id, service_date)
                WHERE reference_table IS NOT NULL AND reference_id IS NOT NULL
            DO NOTHING
            RETURNING event_id
            """
        ),
        {
            "cid": customer_id,
            "wid": warehouse_id,
            "etype": event_type,
            "rt": reference_table,
            "rid": reference_id,
            "qty": float(quantity),
            "up": unit_price,
            "amt": amount,
            "rate_id": rate.rate_card_id if rate else None,
            "service_date": service_date,
        },
    ).fetchone()
    if not result:
        return None
    return amount
