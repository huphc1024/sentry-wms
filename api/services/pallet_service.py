"""Pallet LPN creation helpers shared by admin and floor endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text


def next_pallet_code(db, warehouse_id: int) -> str | None:
    """Generate the next human-readable, warehouse-prefixed pallet label."""
    warehouse = db.execute(
        text("SELECT warehouse_code FROM warehouses WHERE warehouse_id = :wid"),
        {"wid": warehouse_id},
    ).fetchone()
    if not warehouse:
        return None

    prefix = f"{warehouse.warehouse_code}-PLT-"
    sequence = db.execute(
        text("""
            SELECT COALESCE(MAX(
                CASE
                    WHEN pallet_code ~ :pattern
                    THEN CAST(SUBSTRING(pallet_code FROM :digits_pattern) AS INTEGER)
                    ELSE 0
                END
            ), 0) + 1
            FROM pallets
            WHERE warehouse_id = :wid
        """),
        {
            "wid": warehouse_id,
            "pattern": rf"^{prefix}[0-9]{{5}}$",
            "digits_pattern": r"([0-9]{5})$",
        },
    ).scalar()
    return f"{prefix}{int(sequence):05d}"


def create_empty_pallet(
    db,
    *,
    warehouse_id: int,
    created_by: str,
    customer_id: str | None = None,
    pallet_code: str | None = None,
    pallet_barcode: str | None = None,
    bin_id: int | None = None,
) -> dict[str, Any]:
    """Insert a STORED empty LPN ready for receive binding."""
    code = (pallet_code or "").strip() or next_pallet_code(db, warehouse_id)
    if not code:
        raise ValueError("Warehouse not found")

    barcode = (pallet_barcode or code).strip()
    ext = str(uuid.uuid4())
    row = db.execute(
        text("""
            INSERT INTO pallets (
                pallet_code, pallet_barcode, item_id, warehouse_id, bin_id,
                quantity, customer_id, status, created_by, external_id
            ) VALUES (
                :code, :barcode, NULL, :wid, :bin_id,
                0, :customer_id, 'STORED', :username, :ext
            )
            RETURNING pallet_id, pallet_code, pallet_barcode
        """),
        {
            "code": code,
            "barcode": barcode,
            "wid": warehouse_id,
            "bin_id": bin_id,
            "customer_id": customer_id,
            "username": created_by,
            "ext": ext,
        },
    ).fetchone()
    return {
        "pallet_id": row.pallet_id,
        "pallet_code": row.pallet_code,
        "pallet_barcode": row.pallet_barcode,
        "external_id": ext,
    }


def lookup_pallet_by_code(db, code: str, *, for_update: bool = False):
    lock = "FOR UPDATE" if for_update else ""
    return db.execute(
        text(f"""
            SELECT pallet_id, pallet_code, pallet_barcode, item_id, warehouse_id,
                   bin_id, quantity, customer_id, status
            FROM pallets
            WHERE (UPPER(pallet_code) = UPPER(:code)
                   OR UPPER(COALESCE(pallet_barcode, '')) = UPPER(:code))
            {lock}
        """),
        {"code": code.strip()},
    ).fetchone()


def _normalize_lot(lot_number) -> str | None:
    if lot_number is None:
        return None
    value = str(lot_number).strip()
    return value or None


def _find_unpalletized_inventory(db, item_id: int, bin_id: int, lot_number=None):
    """Match bin-level stock; treat NULL and blank lot as equivalent."""
    lot = _normalize_lot(lot_number)
    inv = db.execute(
        text("""
            SELECT inventory_id, quantity_on_hand, expiry_date, warehouse_id, lot_number
            FROM inventory
            WHERE item_id = :iid AND bin_id = :bid
              AND pallet_id IS NULL
              AND quantity_on_hand > 0
              AND (
                (:lot IS NULL AND (lot_number IS NULL OR TRIM(lot_number) = ''))
                OR lot_number IS NOT DISTINCT FROM :lot
              )
            ORDER BY inventory_id
            FOR UPDATE
        """),
        {"iid": item_id, "bid": bin_id, "lot": lot},
    ).fetchone()
    if inv:
        return inv, _normalize_lot(inv.lot_number)
    return None, lot


def sync_pallet_quantity(db, pallet_id: int) -> None:
    """Keep pallets.quantity aligned with inventory rows for the LPN."""
    row = db.execute(
        text("""
            SELECT COALESCE(SUM(quantity_on_hand), 0) AS qty,
                   MAX(item_id) AS item_id,
                   MAX(lot_number) AS lot_code,
                   MAX(expiry_date) AS expiry_date
            FROM inventory
            WHERE pallet_id = :pid AND quantity_on_hand > 0
        """),
        {"pid": pallet_id},
    ).fetchone()
    qty = int(row.qty or 0) if row else 0
    db.execute(
        text("""
            UPDATE pallets
            SET quantity = :qty,
                item_id = CASE WHEN :qty > 0 THEN :item_id ELSE item_id END,
                lot_code = CASE WHEN :qty > 0 THEN :lot_code ELSE lot_code END,
                expiry_date = CASE WHEN :qty > 0 THEN :expiry_date ELSE expiry_date END,
                updated_at = NOW()
            WHERE pallet_id = :pid
        """),
        {
            "pid": pallet_id,
            "qty": qty,
            "item_id": row.item_id if row else None,
            "lot_code": row.lot_code if row else None,
            "expiry_date": row.expiry_date if row else None,
        },
    )


def attach_bin_inventory_to_pallet(
    db,
    *,
    pallet_id: int,
    item_id: int,
    bin_id: int,
    lot_number=None,
    quantity=None,
) -> dict:
    """Move unpalletized stock in a bin onto an existing LPN."""
    from services.inventory_service import add_inventory

    pallet = db.execute(
        text("""
            SELECT pallet_id, warehouse_id, bin_id, status
            FROM pallets WHERE pallet_id = :pid FOR UPDATE
        """),
        {"pid": pallet_id},
    ).fetchone()
    if not pallet:
        raise ValueError("Pallet not found")
    if pallet.status and pallet.status not in ("STORED",):
        raise ValueError(f"Pallet status {pallet.status} cannot receive stock")
    pallet_bin = int(pallet.bin_id) if pallet.bin_id is not None else None
    target_bin = int(bin_id)
    if pallet_bin is not None and pallet_bin != target_bin:
        raise ValueError("Pallet is assigned to another bin")

    inv, resolved_lot = _find_unpalletized_inventory(db, item_id, target_bin, lot_number)
    if not inv:
        raise ValueError("Không có tồn chưa gắn LPN cho SKU/lot này trong ô")

    available = int(inv.quantity_on_hand or 0)
    qty = int(quantity) if quantity is not None else available
    if qty <= 0 or qty > available:
        raise ValueError(f"Số lượng không hợp lệ (tối đa: {available})")

    remaining = available - qty
    if remaining == 0:
        db.execute(
            text("DELETE FROM inventory WHERE inventory_id = :inv_id"),
            {"inv_id": inv.inventory_id},
        )
    else:
        db.execute(
            text("""
                UPDATE inventory SET quantity_on_hand = :qty, updated_at = NOW()
                WHERE inventory_id = :inv_id
            """),
            {"qty": remaining, "inv_id": inv.inventory_id},
        )

    add_inventory(
        db, item_id, target_bin, inv.warehouse_id, qty,
        lot_number=resolved_lot, pallet_id=pallet_id, expiry_date=inv.expiry_date,
    )
    db.execute(
        text("""
            UPDATE pallets SET bin_id = :bid, updated_at = NOW()
            WHERE pallet_id = :pid
        """),
        {"bid": target_bin, "pid": pallet_id},
    )
    sync_pallet_quantity(db, pallet_id)
    return {"pallet_id": pallet_id, "quantity_attached": qty, "item_id": item_id, "bin_id": target_bin}
