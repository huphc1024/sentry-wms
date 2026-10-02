from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CustomerBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    customer_code: str | None = Field(None, min_length=1, max_length=40)
    customer_name: str = Field(..., min_length=1, max_length=200)
    contact_person: str | None = Field(None, max_length=120)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    billing_address: str | None = None
    shipping_address: str | None = None
    tax_id: str | None = Field(None, max_length=64)
    payment_terms_days: int = Field(30, ge=0, le=365)
    default_currency: str = Field("VND", min_length=3, max_length=8)
    notes: str | None = None
    is_active: bool = True


class CreateCustomerRequest(CustomerBase):
    pass


class UpdateCustomerRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    customer_code: str | None = Field(None, min_length=1, max_length=40)
    customer_name: str | None = Field(None, min_length=1, max_length=200)
    contact_person: str | None = Field(None, max_length=120)
    email: str | None = Field(None, max_length=255)
    phone: str | None = Field(None, max_length=50)
    billing_address: str | None = None
    shipping_address: str | None = None
    tax_id: str | None = Field(None, max_length=64)
    payment_terms_days: int | None = Field(None, ge=0, le=365)
    default_currency: str | None = Field(None, min_length=3, max_length=8)
    notes: str | None = None
    is_active: bool | None = None


class ContractBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    contract_number: str | None = Field(None, min_length=1, max_length=64)
    customer_id: UUID
    warehouse_id: int | None = Field(None, gt=0)
    contract_name: str = Field(..., min_length=1, max_length=200)
    start_date: date
    end_date: date | None = None
    status: Literal["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"] = "DRAFT"
    billing_cycle: Literal["MONTHLY", "WEEKLY", "PER_EVENT"] = "MONTHLY"
    payment_terms_days: int = Field(30, ge=0, le=365)
    currency: str = Field("VND", min_length=3, max_length=8)
    notes: str | None = None

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date and self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class CreateContractRequest(ContractBase):
    pass


class UpdateContractRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    warehouse_id: int | None = Field(None, gt=0)
    contract_name: str | None = Field(None, min_length=1, max_length=200)
    start_date: date | None = None
    end_date: date | None = None
    status: Literal["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"] | None = None
    billing_cycle: Literal["MONTHLY", "WEEKLY", "PER_EVENT"] | None = None
    payment_terms_days: int | None = Field(None, ge=0, le=365)
    currency: str | None = Field(None, min_length=3, max_length=8)
    notes: str | None = None
