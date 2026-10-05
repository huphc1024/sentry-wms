"""LLM provider selection plus the Anthropic (Claude) implementation.

AI_PROVIDER=claude (default) | gemini picks the provider; the Gemini code
lives in services.ai.gemini. generate_json() returns (parsed_dict,
usage_dict) for either provider or raises AIUnavailable; callers treat
AIUnavailable as "fall back to rules mode". Prompts and API keys are never
logged; error text goes through scrub_secrets first.
"""

import json
import logging
import os

from utils.log_sanitize import scrub_secrets

_LOGGER = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
MAX_TOKENS = 4000
TIMEOUT_SECONDS = 30.0
MAX_RETRIES = 1

_client = None
_client_key = None


class AIUnavailable(Exception):
    """The LLM could not produce a usable answer (any reason)."""


PROVIDERS = ("claude", "gemini")
KEY_ENV = {"claude": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY"}


def provider():
    """'claude' (default, also for unknown values) or 'gemini'."""
    raw = os.environ.get("AI_PROVIDER", "").strip().lower()
    return raw if raw in PROVIDERS else "claude"


def api_key_present():
    """True when the selected provider's API key is set."""
    return bool(os.environ.get(KEY_ENV[provider()], "").strip())


def model_name():
    if provider() == "gemini":
        from services.ai import gemini

        return gemini.model_name()
    return claude_model_name()


def claude_model_name():
    return os.environ.get("AI_MODEL", "").strip() or DEFAULT_MODEL


def generate_json(system, user_text, schema, effort="low"):
    """Provider-neutral structured JSON call (suggestions, phases 1-2)."""
    if provider() == "gemini":
        from services.ai import gemini

        return gemini.generate_json(system, user_text, schema)
    return call_claude(system, user_text, schema, effort)


def _get_client(api_key):
    global _client, _client_key
    if _client is None or _client_key != api_key:
        import anthropic  # lazy: only imported when LLM mode is actually used

        _client = anthropic.Anthropic(
            api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        _client_key = api_key
    return _client


def create_message(**params):
    """Raw messages.create for the assistant's tool loop (phase 3). Returns
    the SDK Message; any missing key / SDK / network error becomes
    AIUnavailable. `model` defaults to AI_MODEL."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise AIUnavailable("no_api_key")
    params.setdefault("model", claude_model_name())
    try:
        return _get_client(api_key).messages.create(**params)
    except Exception as exc:  # anthropic.APIError subclasses, timeouts, etc.
        kind = type(exc).__name__
        _LOGGER.warning("AI call failed: %s: %s", kind, scrub_secrets(str(exc))[:300])
        raise AIUnavailable(kind) from None


def call_claude(system, user_text, schema, effort="low"):
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise AIUnavailable("no_api_key")
    model = claude_model_name()
    try:
        # Opus 5.5 always thinks adaptively: no `thinking`, temperature or
        # budget_tokens are sent. Refusal fallbacks are a beta server-side
        # feature; instead a refusal or any API error degrades to rules mode.
        resp = _get_client(api_key).messages.create(
            model=model,
            max_tokens=MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user_text}],
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
        if resp.stop_reason == "refusal":
            raise AIUnavailable("refusal")
        if resp.stop_reason != "end_turn":
            raise AIUnavailable(f"stop_reason={resp.stop_reason}")
        text = "".join(b.text for b in resp.content if b.type == "text")
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise AIUnavailable("non_object_output")
        usage = {
            "model": model,
            "input_tokens": getattr(resp.usage, "input_tokens", None),
            "output_tokens": getattr(resp.usage, "output_tokens", None),
        }
        return parsed, usage
    except AIUnavailable:
        raise
    except Exception as exc:  # anthropic.APIError subclasses, JSON errors, etc.
        kind = type(exc).__name__
        _LOGGER.warning("AI call failed: %s: %s", kind, scrub_secrets(str(exc))[:300])
        raise AIUnavailable(kind) from None
