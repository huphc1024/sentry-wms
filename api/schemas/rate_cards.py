from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class CreateRateCardRequest(BaseModel):
    customer_id: Optional[str] = None
    contract_id: Optional[int] = Field(None, gt=0)
    warehouse_id: Optional[int] = Field(None, gt=0)
    rate_name: Optional[str] = Field(None, max_length=120)
    service_type: str = Field(..., max_length=50)
    unit: str = Field(..., max_length=30)
    unit_price: Decimal = Field(..., ge=0)
    currency: Optional[str] = Field('VND', max_length=8)
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None


class UpdateRateCardRequest(BaseModel):
    contract_id: Optional[int] = Field(None, gt=0)
    warehouse_id: Optional[int] = Field(None, gt=0)
    rate_name: Optional[str] = Field(None, max_length=120)
    service_type: Optional[str] = Field(None, max_length=50)
    unit: Optional[str] = Field(None, max_length=30)
    unit_price: Optional[Decimal] = Field(None, ge=0)
    currency: Optional[str] = Field(None, max_length=8)
    effective_from: Optional[str] = None
    effective_to: Optional[str] = None

