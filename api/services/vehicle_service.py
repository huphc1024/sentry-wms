"""Vehicle / gate session helpers: validate PO/SO refs and open/close sessions."""

from datetime import datetime, timezone

from sqlalchemy import text

from services.billing_service import create_billing_event
from services.events_service import emit_event


class VehicleValidationError(ValueError):
    """Raised when a gate check-in payload fails business validation."""


def validate_reference(db, movement_type: str, reference_type: str | None, reference_id: int | None):
    """Ensure PO/SO references match movement direction and exist."""
    if not reference_type and not reference_id:
        return None
    if bool(reference_type) != bool(reference_id):
        raise VehicleValidationError("reference_type and reference_id must be provided together")

    ref = reference_type.upper().strip()
    if movement_type == "INBOUND" and ref != "PO":
        raise VehicleValidationError("INBOUND gate sessions must reference a PO")
    if movement_type == "OUTBOUND" and ref != "SO":
        raise VehicleValidationError("OUTBOUND gate sessions must reference an SO")

    if ref == "PO":
        row = db.execute(
            text("""
                SELECT po_id, po_number, warehouse_id, status
                FROM purchase_orders WHERE po_id = :rid
            """),
            {"rid": reference_id},
        ).fetchone()
        if not row:
            raise VehicleValidationError(f"PO {reference_id} not found")
        return {
            "reference_type": "PO",
            "reference_id": row.po_id,
            "reference_number": row.po_number,
            "warehouse_id": row.warehouse_id,
            "status": row.status,
        }

    if ref == "SO":
        row = db.execute(
            text("""
                SELECT so_id, so_number, warehouse_id, status
                FROM sales_orders WHERE so_id = :rid
            """),
            {"rid": reference_id},
        ).fetchone()
        if not row:
            raise VehicleValidationError(f"SO {reference_id} not found")
        return {
            "reference_type": "SO",
            "reference_id": row.so_id,
            "reference_number": row.so_number,
            "warehouse_id": row.warehouse_id,
            "status": row.status,
        }

    raise VehicleValidationError("reference_type must be PO or SO")


def check_in(
    db,
    *,
    movement_type: str,
    vehicle_plate: str,
    warehouse_id: int,
    recorded_by: str,
    driver_name: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
    related_pallet_id: int | None = None,
    notes: str | None = None,
) -> dict:
    """Open a gate session. Returns movement row dict."""
    movement_type = (movement_type or "").upper().strip()
    if movement_type not in ("INBOUND", "OUTBOUND"):
        raise VehicleValidationError("movement_type must be INBOUND or OUTBOUND")

    plate = (vehicle_plate or "").strip().upper()
    if not plate:
        raise VehicleValidationError("vehicle_plate is required")

    ref = validate_reference(db, movement_type, reference_type, reference_id)
    if ref and ref["warehouse_id"] and int(ref["warehouse_id"]) != int(warehouse_id):
        raise VehicleValidationError("Reference belongs to a different warehouse")

    open_same = db.execute(
        text("""
            SELECT movement_id
            FROM vehicle_movements
            WHERE warehouse_id = :wid
              AND UPPER(vehicle_plate) = :plate
              AND status IN ('CHECKED_IN', 'IN_PROGRESS')
            LIMIT 1
        """),
        {"wid": warehouse_id, "plate": plate},
    ).fetchone()
    if open_same:
        raise VehicleValidationError(
            f"Vehicle {plate} already has an open gate session #{open_same.movement_id}"
        )

    if related_pallet_id:
        pallet = db.execute(
            text("SELECT pallet_id FROM pallets WHERE pallet_id = :pid"),
            {"pid": related_pallet_id},
        ).fetchone()
        if not pallet:
            raise VehicleValidationError(f"Pallet {related_pallet_id} not found")

    row = db.execute(
        text("""
            INSERT INTO vehicle_movements (
                movement_type, vehicle_plate, driver_name, reference_type,
                reference_id, related_pallet_id, recorded_by, recorded_at,
                notes, warehouse_id, status
            ) VALUES (
                :mt, :plate, :driver, :rt, :rid, :pallet, :user, NOW(),
                :notes, :wid, 'CHECKED_IN'
            )
            RETURNING movement_id, movement_type, vehicle_plate, driver_name,
                      reference_type, reference_id, related_pallet_id,
                      warehouse_id, status, recorded_at, notes
        """),
        {
            "mt": movement_type,
            "plate": plate,
            "driver": driver_name,
            "rt": ref["reference_type"] if ref else None,
            "rid": ref["reference_id"] if ref else None,
            "pallet": related_pallet_id,
            "user": recorded_by,
            "notes": notes,
            "wid": warehouse_id,
        },
    ).fetchone()

    if related_pallet_id:
        pallet = db.execute(
            text("SELECT customer_id, warehouse_id FROM pallets WHERE pallet_id = :pid"),
            {"pid": related_pallet_id},
        ).fetchone()
        if pallet and pallet.customer_id:
            create_billing_event(
                db,
                pallet.customer_id,
                pallet.warehouse_id or warehouse_id,
                "HANDLING",
                "VEHICLE_MOVEMENT",
                row.movement_id,
                1,
            )

    return {
        "movement_id": row.movement_id,
        "movement_type": row.movement_type,
        "vehicle_plate": row.vehicle_plate,
        "driver_name": row.driver_name,
        "reference_type": row.reference_type,
        "reference_id": row.reference_id,
        "reference_number": ref["reference_number"] if ref else None,
        "related_pallet_id": row.related_pallet_id,
        "warehouse_id": row.warehouse_id,
        "status": row.status,
        "recorded_at": row.recorded_at.isoformat() if row.recorded_at else None,
        "notes": row.notes,
        "session": {
            "open_receive": movement_type == "INBOUND" and row.reference_type == "PO",
            "open_ship": movement_type == "OUTBOUND" and row.reference_type == "SO",
            "po_id": row.reference_id if row.reference_type == "PO" else None,
            "so_id": row.reference_id if row.reference_type == "SO" else None,
        },
    }


def complete_session(db, movement_id: int, *, completed_by: str, notes: str | None = None) -> dict:
    """Mark a gate session COMPLETED."""
    row = db.execute(
        text("""
            SELECT movement_id, status, movement_type, vehicle_plate,
                   reference_type, reference_id, warehouse_id
            FROM vehicle_movements
            WHERE movement_id = :mid
            FOR UPDATE
        """),
        {"mid": movement_id},
    ).fetchone()
    if not row:
        raise VehicleValidationError("Gate session not found")
    if row.status == "COMPLETED":
        return {"movement_id": movement_id, "status": "COMPLETED", "already_completed": True}
    if row.status == "CANCELLED":
        raise VehicleValidationError("Cancelled session cannot be completed")

    db.execute(
        text("""
            UPDATE vehicle_movements
            SET status = 'COMPLETED',
                completed_at = NOW(),
                completed_by = :user,
                notes = COALESCE(:notes, notes)
            WHERE movement_id = :mid
        """),
        {"user": completed_by, "notes": notes, "mid": movement_id},
    )
    return {
        "movement_id": movement_id,
        "status": "COMPLETED",
        "movement_type": row.movement_type,
        "vehicle_plate": row.vehicle_plate,
        "reference_type": row.reference_type,
        "reference_id": row.reference_id,
        "warehouse_id": row.warehouse_id,
    }


def find_open_session_for_reference(db, reference_type: str, reference_id: int):
    """Return the latest open gate session for a PO/SO, if any."""
    return db.execute(
        text("""
            SELECT movement_id, vehicle_plate, movement_type, warehouse_id, status
            FROM vehicle_movements
            WHERE reference_type = :rt
              AND reference_id = :rid
              AND status IN ('CHECKED_IN', 'IN_PROGRESS')
            ORDER BY movement_id DESC
            LIMIT 1
        """),
        {"rt": reference_type, "rid": reference_id},
    ).fetchone()


def mark_in_progress(db, movement_id: int):
    db.execute(
        text("""
            UPDATE vehicle_movements
            SET status = 'IN_PROGRESS'
            WHERE movement_id = :mid AND status = 'CHECKED_IN'
        """),
        {"mid": movement_id},
    )


def emit_inbound_completed(db, *, po_id: int, warehouse_id: int, source_txn_id, username: str):
    """Partner-facing inbound.completed when a PO is fully received."""
    po = db.execute(
        text("""
            SELECT po_id, po_number, external_id, warehouse_id
            FROM purchase_orders WHERE po_id = :pid
        """),
        {"pid": po_id},
    ).fetchone()
    if not po:
        return None

    gate = find_open_session_for_reference(db, "PO", po_id)
    vehicle_plate = gate.vehicle_plate if gate else None
    if gate:
        mark_in_progress(db, gate.movement_id)
        complete_session(db, gate.movement_id, completed_by=username)

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return emit_event(
        db,
        event_type="inbound.completed",
        event_version=1,
        aggregate_type="purchase_order",
        aggregate_id=po_id,
        aggregate_external_id=po.external_id,
        warehouse_id=warehouse_id or po.warehouse_id,
        source_txn_id=source_txn_id,
        payload={
            "po_id": po_id,
            "po_number": po.po_number,
            "warehouse_id": warehouse_id or po.warehouse_id,
            "vehicle_plate": vehicle_plate,
            "completed_at": now,
        },
    )


def emit_outbound_shipped(
    db,
    *,
    so_id: int,
    warehouse_id: int,
    source_txn_id,
    username: str,
    carrier: str | None = None,
    tracking_number: str | None = None,
):
    """Partner-facing outbound.shipped when an SO ships."""
    so = db.execute(
        text("""
            SELECT so_id, so_number, external_id, warehouse_id
            FROM sales_orders WHERE so_id = :sid
        """),
        {"sid": so_id},
    ).fetchone()
    if not so:
        return None

    gate = find_open_session_for_reference(db, "SO", so_id)
    vehicle_plate = gate.vehicle_plate if gate else None
    if gate:
        mark_in_progress(db, gate.movement_id)
        complete_session(db, gate.movement_id, completed_by=username)

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return emit_event(
        db,
        event_type="outbound.shipped",
        event_version=1,
        aggregate_type="sales_order",
        aggregate_id=so_id,
        aggregate_external_id=so.external_id,
        warehouse_id=warehouse_id or so.warehouse_id,
        source_txn_id=source_txn_id,
        payload={
            "so_id": so_id,
            "so_number": so.so_number,
            "warehouse_id": warehouse_id or so.warehouse_id,
            "vehicle_plate": vehicle_plate,
            "carrier": carrier,
            "tracking_number": tracking_number,
            "completed_at": now,
        },
    )


def emit_invoice_issued(db, *, invoice_id: int, warehouse_id: int | None, source_txn_id):
    """Partner-facing invoice.issued when an invoice is SENT."""
    inv = db.execute(
        text("""
            SELECT bi.invoice_id, bi.invoice_number, bi.customer_id,
                   bi.contract_id, bi.total_amount, bi.currency,
                   bi.period_start, bi.period_end, bi.external_id,
                   cc.warehouse_id
            FROM billing_invoices bi
            LEFT JOIN customer_contracts cc ON cc.contract_id = bi.contract_id
            WHERE bi.invoice_id = :iid
        """),
        {"iid": invoice_id},
    ).fetchone()
    if not inv:
        return None

    wid = warehouse_id or inv.warehouse_id
    if not wid:
        # integration_events.warehouse_id is NOT NULL in practice for scoped events;
        # fall back to first warehouse if invoice has no contract warehouse.
        fallback = db.execute(text("SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1")).fetchone()
        wid = fallback.warehouse_id if fallback else 1

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return emit_event(
        db,
        event_type="invoice.issued",
        event_version=1,
        aggregate_type="billing_invoice",
        aggregate_id=invoice_id,
        aggregate_external_id=inv.external_id,
        warehouse_id=wid,
        source_txn_id=source_txn_id,
        payload={
            "invoice_id": invoice_id,
            "invoice_number": inv.invoice_number,
            "customer_id": str(inv.customer_id),
            "contract_id": inv.contract_id,
            "total_amount": float(inv.total_amount or 0),
            "currency": inv.currency,
            "period_start": inv.period_start.isoformat() if inv.period_start else None,
            "period_end": inv.period_end.isoformat() if inv.period_end else None,
            "issued_at": now,
        },
    )
