"""Customer portal login request schemas (phase 4).

Note there is no `role` field anywhere here, unlike schemas/users.py: a
portal login has no role, only a customer it belongs to and a set of
feature grants. Nor is there a way to set `customer_id` on update --
moving a login between customers silently redirects every scoped query it
makes, so that is a delete-and-recreate, not an edit.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class CreateCustomerUserRequest(BaseModel):
    customer_id: str = Field(..., min_length=1, max_length=64)
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=256)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    feature_keys: List[str] = Field(default_factory=list, max_length=50)
    # Defaults TRUE to match mig 088: an operator-provisioned account is
    # forced through the change-password flow on first login, so the
    # operator never knows the customer's working password.
    must_change_password: bool = True

    @field_validator("username")
    @classmethod
    def normalize_username(cls, v: str) -> str:
        return v.strip().lower()


class UpdateCustomerUserRequest(BaseModel):
    """customer_id is deliberately absent -- see the module docstring."""

    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=1, max_length=256)
    must_change_password: Optional[bool] = None


class UpdateCustomerUserFeaturesRequest(BaseModel):
    """Replace-all, same shape as UpdateUserPagePermissionsRequest. The
    handler validates each key against constants.ALL_CUSTOMER_FEATURE_KEYS
    so a typo lands as a 400 rather than an inert row the portal will
    never honour."""

    feature_keys: List[str] = Field(default_factory=list, max_length=50)


class SetItemOwnerRequest(BaseModel):
    """null clears the owner, i.e. marks the SKU as the operator's own
    stock. The portal reads a NULL owner as visible to no customer."""

    owner_customer_id: Optional[str] = Field(None, max_length=64)


class SetPurchaseOrderOwnerRequest(BaseModel):
    owner_customer_id: Optional[str] = Field(None, max_length=64)
