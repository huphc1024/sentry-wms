"""Pure unit tests: no database, no network. Run from api/ with
    python -m pytest tests_unit -p no:cacheprovider
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.pop("ANTHROPIC_API_KEY", None)
