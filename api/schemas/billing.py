from decimal import Decimal
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class CreateBillingEventRequest(BaseModel):
    customer_id: Optional[str] = None
    warehouse_id: Optional[int] = None
    event_type: str = Field(..., max_length=50)
    reference_table: Optional[str] = None
    reference_id: Optional[int] = None
    quantity: Decimal = Field(..., ge=0)
    unit_price: Optional[Decimal] = None


class CreateInvoiceRequest(BaseModel):
    customer_id: str
    contract_id: Optional[int] = Field(None, gt=0)
    period_start: date
    period_end: date
    include_unbilled_events: bool = True
    notes: Optional[str] = None
    lines: Optional[list] = None

    @model_validator(mode="after")
    def validate_period(self):
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start")
        return self

