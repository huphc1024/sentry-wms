from decimal import Decimal
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class CreatePalletRequest(BaseModel):
    pallet_code: Optional[str] = Field(None, min_length=1, max_length=100)
    pallet_barcode: Optional[str] = Field(None, max_length=200)
    item_id: Optional[int] = Field(None, gt=0)
    warehouse_id: int = Field(..., gt=0)
    bin_id: Optional[int] = Field(None, gt=0)
    customer_id: Optional[str] = Field(None, max_length=64)
    quantity: int = Field(0, ge=0)
    weight_kg: Optional[Decimal] = Field(None, ge=0)
    lot_code: Optional[str] = Field(None, max_length=100)
    expiry_date: Optional[date] = None


class FloorCreatePalletRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    customer_id: Optional[str] = Field(None, max_length=64)
    pallet_code: Optional[str] = Field(None, min_length=1, max_length=100)
    pallet_barcode: Optional[str] = Field(None, max_length=200)


class UpdatePalletRequest(BaseModel):
    pallet_barcode: Optional[str] = Field(None, max_length=200)
    bin_id: Optional[int] = Field(None, gt=0)
    quantity: Optional[int] = Field(None, ge=0)
    weight_kg: Optional[Decimal] = Field(None, ge=0)
    status: Optional[str] = Field(None, max_length=32)
    lot_code: Optional[str] = Field(None, max_length=100)
    expiry_date: Optional[date] = None


class AttachInventoryToPalletRequest(BaseModel):
    item_id: int = Field(..., gt=0)
    bin_id: int = Field(..., gt=0)
    lot_number: Optional[str] = Field(None, max_length=100)
    quantity: Optional[int] = Field(None, gt=0, le=1000000)

