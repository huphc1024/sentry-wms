"""Pure unit tests: no database, no network. Run from api/ with
    python -m pytest tests_unit -p no:cacheprovider
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
for _ai_var in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "AI_PROVIDER"):
    os.environ.pop(_ai_var, None)
