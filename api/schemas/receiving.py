"""Receiving request schemas."""

from datetime import date
from typing import List, Optional

from pydantic import BaseModel, Field


class ReceiveItemEntry(BaseModel):
    item_id: int = Field(..., gt=0)
    quantity: int = Field(..., gt=0, le=100000)
    bin_id: int = Field(..., gt=0)
    lot_number: Optional[str] = Field(None, max_length=100)
    pallet_code: Optional[str] = Field(None, max_length=100)
    expiry_date: Optional[date] = None
    serial_number: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)


class ReceiveItemsRequest(BaseModel):
    po_id: int = Field(..., gt=0)
    items: List[ReceiveItemEntry] = Field(..., min_length=1)
    customer_id: Optional[str] = Field(None, max_length=64)


class CancelReceivingRequest(BaseModel):
    # po_id is required so the route can refuse a cancel whose
    # receipt_ids span multiple POs. The mobile receive screen accumulates
    # receipt_ids across every PO loaded in a session, so a single Cancel
    # tap can otherwise reach receipts the operator never intended to
    # reverse. See routes/receiving.py:cancel_receiving for the guard.
    po_id: int = Field(..., gt=0)
    receipt_ids: List[int] = Field(default_factory=list)
    warehouse_id: Optional[int] = Field(None, gt=0)
