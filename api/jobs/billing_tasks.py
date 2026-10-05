"""Daily storage billing Celery task.

Generates STORAGE_DAY billing_events for pallets in STORED status with
a customer_id. Duplicate prevention mirrors the admin manual trigger
(``POST /api/admin/billing/run_storage_billing``): one event per pallet
per service_date.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import text

from jobs import celery_app

logger = logging.getLogger(__name__)

_STORAGE_BILLING_SQL = text("""
    SELECT pallet_id, customer_id, warehouse_id
    FROM pallets
    WHERE status = 'STORED' AND customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM billing_events be
        WHERE be.event_type = 'STORAGE_DAY'
          AND be.reference_table = 'PALLET'
          AND be.reference_id = pallets.pallet_id
          AND be.service_date = CAST(:service_date AS date)
      )
""")


def _run_storage_billing(session, service_date: str) -> int:
    from services.billing_service import _find_rate_card

    rows = session.execute(
        _STORAGE_BILLING_SQL, {"service_date": service_date},
    ).fetchall()
    created = 0
    for r in rows:
        rate = _find_rate_card(
            session, r.customer_id, "STORAGE",
            as_of=service_date, warehouse_id=r.warehouse_id,
        )
        unit_price = float(rate.unit_price) if rate else 0
        session.execute(
            text("""
                INSERT INTO billing_events (
                    customer_id, warehouse_id, event_type, reference_table,
                    reference_id, quantity, unit_price, amount, rate_card_id,
                    service_date, created_at
                ) VALUES (
                    :cid, :wid, 'STORAGE_DAY', 'PALLET', :rid, 1, :price,
                    :price, :rate_id, CAST(:service_date AS date), NOW()
                )
            """),
            {
                "cid": r.customer_id,
                "wid": r.warehouse_id,
                "rid": r.pallet_id,
                "price": unit_price,
                "rate_id": rate.rate_card_id if rate else None,
                "service_date": service_date,
            },
        )
        created += 1
    return created


@celery_app.task(bind=True)
def daily_storage_billing(self, target_date=None) -> dict:
    """Generate STORAGE_DAY billing events for all stored pallets with customers."""
    if target_date is None:
        target_date = datetime.now(timezone.utc).date().isoformat()

    import models.database as db

    session = db.SessionLocal()
    try:
        created = _run_storage_billing(session, target_date)
        session.commit()
        logger.info(
            "daily_storage_billing created %d event(s) for %s",
            created, target_date,
        )
        return {"created": created, "date": target_date}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
