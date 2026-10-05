"""Request schemas for /api/admin/ai/*."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ReplenishmentRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"


class ExpiryActionsRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"
    days: int = Field(default=30, ge=1, le=365)


class CycleCountReviewRequest(BaseModel):
    count_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"


class PutawayRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"


class BackordersRequest(BaseModel):
    warehouse_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"


class FeedbackRequest(BaseModel):
    suggestion_id: str = Field(..., min_length=1, max_length=64)
    kind: Literal["replenish", "expiry", "cycle_count", "putaway", "backorder"]
    mode: Literal["llm", "rules"]
    rating: Literal[1, -1]
    warehouse_id: Optional[int] = Field(default=None, gt=0)
