"""Expiry detection, quarantine, and optional disposal job."""

import logging
import uuid
from datetime import date, datetime, timezone

from celery import shared_task
from sqlalchemy import text

from services.events_service import emit_event
from services.billing_service import create_billing_event

logger = logging.getLogger(__name__)


def _ensure_quarantine_bin(db, warehouse_id):
    """Return a bin_id for the warehouse's quarantine bin, creating one if required."""
    row = db.execute(
        text(
            "SELECT bin_id FROM bins WHERE warehouse_id = :wid AND bin_code = 'QUARANTINE' LIMIT 1"
        ),
        {"wid": warehouse_id},
    ).fetchone()
    if row:
        return row.bin_id

    # pick any zone in the warehouse; create a Quarantine zone if none
    zone = db.execute(
        text("SELECT zone_id FROM zones WHERE warehouse_id = :wid LIMIT 1"), {"wid": warehouse_id}
    ).fetchone()
    if not zone:
        # create zone
        res = db.execute(
            text(
                "INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type, is_active) "
                "VALUES (:wid, 'QUARANTINE', 'Quarantine', 'STORAGE', true) RETURNING zone_id"
            ),
            {"wid": warehouse_id},
        )
        zone_id = res.fetchone().zone_id
    else:
        zone_id = zone.zone_id

    res = db.execute(
        text(
            "INSERT INTO bins (zone_id, warehouse_id, bin_code, bin_barcode, bin_type, external_id, is_active) "
            "VALUES (:zid, :wid, 'QUARANTINE', 'QUARANTINE', 'Quarantine', gen_random_uuid(), true) RETURNING bin_id"
        ),
        {"zid": zone_id, "wid": warehouse_id},
    )
    return res.fetchone().bin_id


def process_expiry(db, warehouse_id=None):
    """Move expired inventory to quarantine and mark pallets expired.

    Idempotent within a transaction: moves inventory rows it finds and emits
    an `expiry.expired` integration event per moved inventory row.
    """
    today = date.today()
    # Find expired inventory rows (expiry_date < today) with quantity > 0
    rows = db.execute(
        text(
            """
            SELECT inv.inventory_id, inv.item_id, inv.bin_id, inv.warehouse_id,
                   inv.quantity_on_hand, inv.lot_number, inv.pallet_id,
                   inv.expiry_date
            FROM inventory inv
            JOIN bins b ON b.bin_id = inv.bin_id
            WHERE inv.expiry_date IS NOT NULL
              AND inv.expiry_date < :today
              AND inv.quantity_on_hand > 0
              AND b.bin_code <> 'QUARANTINE'
              AND (:warehouse_id IS NULL OR inv.warehouse_id = :warehouse_id)
            FOR UPDATE OF inv
            """
        ),
        {"today": today, "warehouse_id": warehouse_id},
    ).fetchall()
    logger.info("expiry scan found %d expired inventory rows", len(rows))

    for r in rows:
        wh = r.warehouse_id
        qbin = _ensure_quarantine_bin(db, wh)
        try:
            # Use a nested transaction (savepoint) per row so one bad row
            # doesn't abort the whole run.
            with db.begin_nested():
                # Perform SQL move: upsert destination inventory row, decrement/delete source.
                # Upsert destination
                dest = db.execute(
                    text(
                        """
                        SELECT inventory_id FROM inventory
                         WHERE item_id = :item_id AND bin_id = :qbin
                           AND lot_number IS NOT DISTINCT FROM :lot_number
                           AND pallet_id IS NOT DISTINCT FROM :pallet_id
                        LIMIT 1
                        """
                    ),
                    {"item_id": r.item_id, "qbin": qbin, "lot_number": r.lot_number, "pallet_id": r.pallet_id},
                ).fetchone()
                if dest:
                    db.execute(
                        text(
                            "UPDATE inventory SET quantity_on_hand = quantity_on_hand + :qty, updated_at = NOW() WHERE inventory_id = :iid"
                        ),
                        {"qty": r.quantity_on_hand, "iid": dest.inventory_id},
                    )
                else:
                    db.execute(
                        text(
                            "INSERT INTO inventory (item_id, bin_id, warehouse_id, quantity_on_hand, lot_number, pallet_id, expiry_date) "
                            "VALUES (:item_id, :qbin, :wid, :qty, :lot_number, :pallet_id, :expiry_date)"
                        ),
                        {
                            "item_id": r.item_id,
                            "qbin": qbin,
                            "wid": r.warehouse_id,
                            "qty": r.quantity_on_hand,
                            "lot_number": r.lot_number,
                            "pallet_id": r.pallet_id,
                            "expiry_date": r.expiry_date,
                        },
                    )

                # The complete source row was copied, so delete only that row.
                db.execute(
                    text("DELETE FROM inventory WHERE inventory_id = :inv_id"),
                    {"inv_id": r.inventory_id},
                )

                # Mark pallet expired if present
                if r.pallet_id:
                    db.execute(
                        text(
                            """
                            UPDATE pallets
                            SET status = 'EXPIRED', bin_id = :bin_id, updated_at = NOW()
                            WHERE pallet_id = :pid
                            """
                        ),
                        {"pid": r.pallet_id, "bin_id": qbin},
                    )

                # Emit integration event
                payload = {
                    "inventory_id": r.inventory_id,
                    "item_id": r.item_id,
                    "quantity_moved": float(r.quantity_on_hand),
                    "from_bin_id": r.bin_id,
                    "to_bin_id": qbin,
                    "lot_number": r.lot_number,
                    "pallet_id": r.pallet_id,
                    "expiry_date": r.expiry_date.isoformat() if r.expiry_date else None,
                    "detected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                }
                emit_event(
                    db,
                    event_type="expiry.expired",
                    event_version=1,
                    aggregate_type="inventory_adjustment",
                    aggregate_id=r.inventory_id,
                    aggregate_external_id=str(uuid.uuid4()),
                    warehouse_id=wh,
                    source_txn_id=str(uuid.uuid4()),
                    payload=payload,
                )
        except Exception:
            logger.exception("failed to quarantine expired inventory_id=%s", r.inventory_id)

    # Disposal pass: optionally dispose items that have been in QUARANTINE longer than configured delay.
    # Read settings
    row = db.execute(text("SELECT value FROM app_settings WHERE key = 'auto_dispose_on_expiry'")).fetchone()
    auto_dispose = bool(row and row.value == "true")
    row = db.execute(text("SELECT value FROM app_settings WHERE key = 'disposal_delay_days'")).fetchone()
    try:
        disposal_delay = int(row.value) if row and row.value is not None else 7
    except Exception:
        disposal_delay = 7
    charge_row = db.execute(text("SELECT value FROM app_settings WHERE key = 'charge_customer_on_dispose'")).fetchone()
    charge_customer = bool(charge_row and charge_row.value == "true")

    if not auto_dispose:
        return

    # Find inventory in QUARANTINE bin older than disposal_delay
    q_rows = db.execute(
        text(
            """
            SELECT inv.inventory_id, inv.item_id, inv.quantity_on_hand, inv.lot_number,
                   inv.pallet_id, inv.bin_id, inv.warehouse_id, inv.updated_at
            FROM inventory inv
            JOIN bins b ON b.bin_id = inv.bin_id
            WHERE b.bin_code = 'QUARANTINE'
              AND inv.quantity_on_hand > 0
              AND inv.updated_at <= NOW() - (:days || ' days')::interval
              AND (:warehouse_id IS NULL OR inv.warehouse_id = :warehouse_id)
            FOR UPDATE
            """
        ),
        {"days": disposal_delay, "warehouse_id": warehouse_id},
    ).fetchall()

    for qr in q_rows:
        try:
            with db.begin_nested():
                # record disposed qty and delete row
                qty = float(qr.quantity_on_hand)
                pallet_id = qr.pallet_id
                wid = qr.warehouse_id

                # delete inventory row
                db.execute(text("DELETE FROM inventory WHERE inventory_id = :iid"), {"iid": qr.inventory_id})

                # mark pallet disposed when applicable
                if pallet_id:
                    db.execute(
                        text(
                            """
                            UPDATE pallets
                            SET status = 'DISPOSED', quantity = 0, updated_at = NOW()
                            WHERE pallet_id = :pid
                            """
                        ),
                        {"pid": pallet_id},
                    )

                # emit expiry.disposed event
                payload = {
                    "pallet_id": pallet_id,
                    "item_id": qr.item_id,
                    "quantity_disposed": qty,
                    "lot_number": qr.lot_number,
                    "disposed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "warehouse_id": wid,
                }
                emit_event(
                    db,
                    event_type="expiry.disposed",
                    event_version=1,
                    aggregate_type="inventory_adjustment",
                    aggregate_id=qr.inventory_id,
                    aggregate_external_id=str(uuid.uuid4()),
                    warehouse_id=wid,
                    source_txn_id=str(uuid.uuid4()),
                    payload=payload,
                )

                # optional billing: charge customer for disposal if pallet has customer_id
                if charge_customer and pallet_id:
                    cust = db.execute(text("SELECT customer_id, warehouse_id FROM pallets WHERE pallet_id = :pid"), {"pid": pallet_id}).fetchone()
                    if cust and cust.customer_id:
                        create_billing_event(
                            db, cust.customer_id, wid,
                            "DISPOSAL", "PALLET", pallet_id, 1,
                        )
        except Exception:
            logger.exception("failed to dispose quarantine inventory_id=%s", qr.inventory_id)


@shared_task(name="jobs.expiry_tasks.daily_expiry_scan", bind=True)
def daily_expiry_scan(self, target_date=None):
    """Celery task wrapper. Runs process_expiry using a DB session."""
    import models.database as db

    session = db.SessionLocal()
    try:
        process_expiry(session)
        session.commit()
        return {"success": True}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

