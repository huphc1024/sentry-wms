"""Item request schemas."""

from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


VALID_STORAGE_PROFILES = ("HEAVY", "FMCG", "FULFILLMENT", "PROJECT")


class _ItemOperationalFields(BaseModel):
    description: Optional[str] = Field(None, max_length=1000)
    barcode_aliases: Optional[List[str]] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=128)
    storage_profile: Optional[str] = None
    weight_lbs: Optional[Decimal] = Field(None, ge=0, le=99999)
    length_in: Optional[Decimal] = Field(None, ge=0, le=99999)
    width_in: Optional[Decimal] = Field(None, ge=0, le=99999)
    height_in: Optional[Decimal] = Field(None, ge=0, le=99999)
    default_bin_id: Optional[int] = Field(None, gt=0)
    reorder_point: Optional[int] = Field(None, ge=0)
    reorder_qty: Optional[int] = Field(None, ge=0)
    is_lot_tracked: Optional[bool] = False
    is_serial_tracked: Optional[bool] = False

    @field_validator("storage_profile")
    @classmethod
    def validate_storage_profile(cls, value):
        if value is not None and value not in VALID_STORAGE_PROFILES:
            raise ValueError(
                f"storage_profile must be one of: {', '.join(VALID_STORAGE_PROFILES)}"
            )
        return value

    @field_validator("barcode_aliases")
    @classmethod
    def normalize_barcode_aliases(cls, value):
        if value is None:
            return None
        cleaned = []
        for barcode in value:
            barcode = barcode.strip()
            if not barcode:
                continue
            if len(barcode) > 128:
                raise ValueError("each barcode alias must be at most 128 characters")
            if barcode not in cleaned:
                cleaned.append(barcode)
        return cleaned


class CreateItemRequest(_ItemOperationalFields):
    sku: str = Field(..., min_length=1, max_length=128)
    item_name: str = Field(..., min_length=1, max_length=256)
    upc: Optional[str] = Field(None, max_length=128)


class UpdateItemRequest(_ItemOperationalFields):
    sku: Optional[str] = Field(None, min_length=1, max_length=128)
    item_name: Optional[str] = Field(None, min_length=1, max_length=256)
    upc: Optional[str] = Field(None, max_length=128)
    is_active: Optional[bool] = None


class CreatePreferredBinRequest(BaseModel):
    item_id: int = Field(..., gt=0)
    bin_id: int = Field(..., gt=0)
    priority: int = Field(1, ge=1, le=100)


class UpdatePreferredBinRequest(BaseModel):
    priority: int = Field(..., ge=1, le=100)
