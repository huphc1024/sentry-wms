"""Customer portal request schemas (phase 3).

Login and change-password reuse schemas/auth.py -- the wire shape is
identical and duplicating it would let the two drift apart.

Note what OutboundRequestBody does NOT accept: priority, status,
so_number, customer_name / customer_id, order_type, source_system. Every
one of those is set by the server. Naming its own customer id would hand
the client the whole tenancy boundary; setting priority would let it jump
the pick queue ahead of other customers; source_system is FK-gated
against the operator-managed allowlist, so portal orders are tagged via
order_origin instead.

warehouse_code IS accepted, but the handler only honours it after
checking the caller actually owns stock there -- a customer must be able
to say which site to ship from when it stores goods at several, and an
unvalidated value would let it address a site it has nothing in.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class OutboundRequestLine(BaseModel):
    sku: str = Field(..., min_length=1, max_length=50)
    quantity: int = Field(..., gt=0, le=1_000_000)

    @field_validator("sku")
    @classmethod
    def strip_sku(cls, v: str) -> str:
        return v.strip()


class OutboundRequestBody(BaseModel):
    """A customer's request to ship goods out.

    Addresses are accepted because they are genuinely the customer's own
    data -- where their goods should go. ship_method is a free-text hint
    the operator may override.
    """

    lines: List[OutboundRequestLine] = Field(..., min_length=1, max_length=500)
    # Optional when the customer holds stock in exactly one warehouse;
    # required (400) when it holds stock in several, rather than the
    # server guessing which site to ship from.
    warehouse_code: Optional[str] = Field(None, max_length=20)
    reference: Optional[str] = Field(None, max_length=64)
    ship_to_name: Optional[str] = Field(None, max_length=200)
    ship_address: Optional[str] = Field(None, max_length=500)
    ship_method: Optional[str] = Field(None, max_length=50)
    memo: Optional[str] = Field(None, max_length=500)

    @field_validator("lines")
    @classmethod
    def no_duplicate_skus(cls, v):
        seen = set()
        for line in v:
            key = line.sku.upper()
            if key in seen:
                raise ValueError(f"duplicate sku in request: {line.sku}")
            seen.add(key)
        return v
