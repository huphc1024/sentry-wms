"""AI suggestions (phases 1-2). Read-only: this package never writes inventory.

Rules mode is deterministic and free; LLM mode (ANTHROPIC_API_KEY set)
re-ranks/rewrites the same candidates and falls back to rules on any error.
"""

KINDS = ("replenish", "expiry", "cycle_count", "putaway", "backorder")
LANGS = ("vi", "en")
PRIORITIES = ("high", "medium", "low")
MAX_SUGGESTIONS = 20
