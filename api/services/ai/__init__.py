"""AI suggestions (phases 1-2). Read-only: this package never writes inventory.

Rules mode is deterministic and free; LLM mode (the AI_PROVIDER's key set:
ANTHROPIC_API_KEY for claude, GEMINI_API_KEY for gemini) re-ranks/rewrites the same candidates and falls back to rules on any error.
"""

KINDS = ("replenish", "expiry", "cycle_count", "putaway", "backorder")
LANGS = ("vi", "en")
PRIORITIES = ("high", "medium", "low")
MAX_SUGGESTIONS = 20
