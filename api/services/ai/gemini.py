"""Google Gemini provider (google-genai SDK, `from google import genai`).

Mirrors client.call_claude / client.create_message: every SDK, network,
safety or parsing problem becomes AIUnavailable so callers fall back to
rules / quick mode. Prompts and keys are never logged; error text goes
through scrub_secrets first. The SDK is imported lazily, only when Gemini is
actually used. Automatic function calling is disabled: the assistant loop in
services.ai.assistant executes the tools itself.
"""

import json
import logging
import os

from services.ai.client import AIUnavailable
from utils.log_sanitize import scrub_secrets

_LOGGER = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.5-flash"
DEFAULT_FALLBACK_MODEL = "gemini-3.1-flash-lite"
DEFAULT_THINKING_LEVEL = "low"
TIMEOUT_MS = 30_000
RETRY_ATTEMPTS = 1           # no SDK retries (attempts includes the first call);
                             # an overloaded model is retried once on the fallback model
_OVERLOADED_CODES = (429, 503)
_OVERLOADED_STATUS = ("UNAVAILABLE", "RESOURCE_EXHAUSTED")
_THINKING_LEVELS = ("minimal", "low", "medium", "high")
JSON_MAX_TOKENS = 8192       # thinking tokens count towards Gemini's output cap
ASSISTANT_MAX_TOKENS = 4096

# JSON Schema keywords kept when a schema is sent to Gemini. Everything else
# (additionalProperties, minLength, maxLength, pattern, default, $schema...) is
# dropped: the Gemini subset may reject it, and outputs / tool arguments are
# validated on our side anyway.
_KEEP = ("type", "description", "enum", "format", "minimum", "maximum",
         "minItems", "maxItems", "title")

_client = None
_client_key = None


def model_name():
    return os.environ.get("GEMINI_MODEL", "").strip() or DEFAULT_MODEL


def fallback_model_name():
    """GEMINI_FALLBACK_MODEL; 'none' / 'off' disables the fallback."""
    raw = os.environ.get("GEMINI_FALLBACK_MODEL")
    raw = DEFAULT_FALLBACK_MODEL if raw is None else raw.strip()
    if raw.lower() in ("", "none", "off", "false", "0") or raw == model_name():
        return None
    return raw


def thinking_level():
    """GEMINI_THINKING_LEVEL (minimal|low|medium|high, default low); 'none'
    or an unknown value sends no thinking config (model default)."""
    raw = os.environ.get("GEMINI_THINKING_LEVEL")
    raw = DEFAULT_THINKING_LEVEL if raw is None else raw.strip().lower()
    return raw if raw in _THINKING_LEVELS else None


def api_key():
    return os.environ.get("GEMINI_API_KEY", "").strip()


def to_gemini_schema(schema):
    """Pure: copy of a JSON schema restricted to the Gemini-safe subset.
    Recurses into properties / items / anyOf; `required` keeps only names
    that exist in `properties`; empty `required` lists are omitted."""
    if not isinstance(schema, dict):
        return schema
    out = {k: schema[k] for k in _KEEP if k in schema}
    props = schema.get("properties")
    if isinstance(props, dict):
        out["properties"] = {name: to_gemini_schema(sub) for name, sub in props.items()}
        req = [r for r in schema.get("required") or [] if r in props]
        if req:
            out["required"] = req
    if isinstance(schema.get("items"), dict):
        out["items"] = to_gemini_schema(schema["items"])
    for key in ("anyOf", "oneOf"):
        if isinstance(schema.get(key), list):
            out["anyOf"] = [to_gemini_schema(s) for s in schema[key]]
    return out


def function_declarations(tool_defs):
    """Pure: Anthropic-style tool definitions ({name, description,
    input_schema}) -> Gemini FunctionDeclaration dicts. Tools without
    parameters get no `parameters_json_schema` at all."""
    out = []
    for t in tool_defs:
        decl = {"name": t["name"], "description": t["description"]}
        params = to_gemini_schema(t.get("input_schema") or {})
        if params.get("properties"):
            decl["parameters_json_schema"] = params
        out.append(decl)
    return out


def _get_client(key):
    global _client, _client_key
    if _client is None or _client_key != key:
        from google import genai  # lazy: only imported when Gemini is used
        from google.genai import types

        _client = genai.Client(
            api_key=key,
            http_options=types.HttpOptions(
                timeout=TIMEOUT_MS,
                retry_options=types.HttpRetryOptions(attempts=RETRY_ATTEMPTS),
            ),
        )
        _client_key = key
    return _client


def is_overloaded(exc):
    """True for 429 / 503 (RESOURCE_EXHAUSTED / UNAVAILABLE) API errors."""
    return (getattr(exc, "code", None) in _OVERLOADED_CODES
            or str(getattr(exc, "status", "") or "").upper() in _OVERLOADED_STATUS)


def _call(contents, config):
    """generate_content on GEMINI_MODEL; on 429/503 one more try on
    GEMINI_FALLBACK_MODEL. Returns (response, model_used)."""
    key = api_key()
    if not key:
        raise AIUnavailable("no_api_key")
    models = [model_name()]
    if fallback_model_name():
        models.append(fallback_model_name())
    for i, model in enumerate(models):
        try:
            resp = _get_client(key).models.generate_content(
                model=model, contents=contents, config=config,
            )
            return resp, model
        except Exception as exc:  # google.genai.errors.APIError, httpx timeouts, etc.
            kind = type(exc).__name__
            _LOGGER.warning("AI call failed (%s): %s: %s", model, kind,
                            scrub_secrets(str(exc))[:300])
            if i + 1 < len(models) and is_overloaded(exc):
                continue
            raise AIUnavailable(kind) from None
    raise AIUnavailable("no_model")  # pragma: no cover - loop always returns/raises


def _thinking_config(types):
    level = thinking_level()
    return types.ThinkingConfig(thinking_level=level.upper()) if level else None


def _get(obj, name, default=None):
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def finish_reason(resp):
    """'STOP', 'MAX_TOKENS', 'SAFETY'... or None (enum or plain string)."""
    cands = _get(resp, "candidates") or []
    if not cands:
        return None
    fr = _get(cands[0], "finish_reason")
    if fr is None:
        return None
    return str(getattr(fr, "value", fr)).upper()


def candidate_content(resp):
    cands = _get(resp, "candidates") or []
    return _get(cands[0], "content") if cands else None


def parts_of(resp):
    content = candidate_content(resp)
    return list(_get(content, "parts") or []) if content is not None else []


def text_of(resp):
    """Answer text, skipping thought-summary parts."""
    return "".join(
        _get(p, "text") or "" for p in parts_of(resp) if not _get(p, "thought")
    ).strip()


def function_calls(resp):
    return [_get(p, "function_call") for p in parts_of(resp) if _get(p, "function_call")]


def usage_of(resp):
    """(input_tokens, output_tokens); output includes thinking tokens, like
    Anthropic's output_tokens."""
    meta = _get(resp, "usage_metadata")
    if meta is None:
        return None, None
    prompt = _get(meta, "prompt_token_count")
    out = [_get(meta, "candidates_token_count"), _get(meta, "thoughts_token_count")]
    out = [v for v in out if isinstance(v, int)]
    return (prompt if isinstance(prompt, int) else None), (sum(out) if out else None)


def generate_json(system, user_text, schema):
    """Structured JSON output. Returns (parsed_dict, usage) or raises
    AIUnavailable."""
    from google.genai import types

    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_json_schema=to_gemini_schema(schema),
        max_output_tokens=JSON_MAX_TOKENS,
        thinking_config=_thinking_config(types),
    )
    resp, model = _call(user_text, config)
    try:
        fr = finish_reason(resp)
        if fr != "STOP":
            raise AIUnavailable(f"finish_reason={fr}")
        parsed = json.loads(text_of(resp))
        if not isinstance(parsed, dict):
            raise AIUnavailable("non_object_output")
    except AIUnavailable:
        raise
    except Exception as exc:  # JSON errors, odd shapes
        raise AIUnavailable(type(exc).__name__) from None
    inp, out = usage_of(resp)
    return parsed, {"model": model, "input_tokens": inp, "output_tokens": out}


# ---- assistant loop helpers ---------------------------------------------------

def user_text_content(role, text):
    """History turn as a Content dict ('assistant' -> 'model')."""
    return {"role": "model" if role == "assistant" else "user", "parts": [{"text": text}]}


def function_response_part(call, response):
    """Part answering one function_call (matching id when the API sent one)."""
    fr = {"name": _get(call, "name"), "response": response}
    if _get(call, "id"):
        fr["id"] = _get(call, "id")
    return {"function_response": fr}


def assistant_generate(contents, system, tool_defs):
    """One assistant round. Returns (raw GenerateContentResponse, model used)
    or raises AIUnavailable. Tools are declared only (no Python callables)
    and automatic function calling is disabled explicitly."""
    from google.genai import types

    config = types.GenerateContentConfig(
        system_instruction=system,
        tools=[types.Tool(function_declarations=function_declarations(tool_defs))],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        max_output_tokens=ASSISTANT_MAX_TOKENS,
        thinking_config=_thinking_config(types),
    )
    return _call(contents, config)
