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


AssistantTool = Literal[
    "low_stock_items", "near_expiry_stock", "zone_utilisation", "waiting_stock_orders",
    "open_purchase_orders", "item_stock_lookup", "recent_receipts",
    "cycle_count_variances", "sales_summary",
]


class AssistantTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(..., min_length=1, max_length=2000)


class AssistantAskRequest(BaseModel):
    """Exactly one of `question` (LLM mode) or `quick` (a preset tool, no
    LLM) is expected; the route enforces it."""
    warehouse_id: int = Field(..., gt=0)
    lang: Literal["vi", "en"] = "vi"
    question: Optional[str] = Field(default=None, max_length=1000)
    quick: Optional[AssistantTool] = None
    history: list[AssistantTurn] = Field(default_factory=list, max_length=6)


class FeedbackRequest(BaseModel):
    suggestion_id: str = Field(..., min_length=1, max_length=64)
    kind: Literal["replenish", "expiry", "cycle_count", "putaway", "backorder"]
    mode: Literal["llm", "rules"]
    rating: Literal[1, -1]
    warehouse_id: Optional[int] = Field(default=None, gt=0)
