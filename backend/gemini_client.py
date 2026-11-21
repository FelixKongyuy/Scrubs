"""
The ONLY code that sends anything to Gemini. It only ever receives pseudonymized text.
"""
import time

from google import genai
from google.genai import types

import config

RETRIES = 1                                  # extra tries per model, before moving to the next
RETRY_CODES = {429, 500, 502, 503, 504}      # temporary: busy, rate limited, server hiccup
RETRY_WAIT_SECONDS = 1.5
# A model this key can't use ("not found"): skip straight to the next one.
SKIP_CODES = {404}
# One call that hangs must not hang the app: give up on it after this long and try the next model.
CALL_TIMEOUT_SECONDS = 25
# The whole request, across retries and fallbacks. Kept under the frontend's 90 s chat timeout.
TOTAL_DEADLINE_SECONDS = 60

last_model = None                            # which model answered last (for the counts-only audit log)

SYSTEM_PROMPT = """You are a patient, plain-spoken assistant helping someone understand and work with their own
documents: medical records, letters, bills, forms, statements and similar personal paperwork.
Identifying details have been replaced with pseudonyms like [PERSON_01], [PROVIDER_01], [HCN_01],
[SIN_01], [ACCOUNT_01], [LOC_01], [ROLE_01], [FAMILY_01]. Dates may have been shifted.
Rules:
- Keep every pseudonym EXACTLY as written, including the brackets. Never invent new ones.
- Never try to guess who or what a pseudonym refers to.
- Keep all the non-identifying content: medical terms, drugs, doses, amounts, deadlines and plans.
- Explain jargon in everyday words, and keep answers short and clear unless asked for more.
- Answer only from the documents; say so if they don't contain the answer.

Pseudonymized documents:
---
{note}
---"""

_client = None
_available: set[str] | None = None           # model names this key can use; None = not known yet


class InvalidKey(Exception):
    """Google rejected the API key (wrong, revoked, or for another API)."""


class Busy(Exception):
    """Every model was busy, slow or unavailable within the time limit."""


def set_key(key: str) -> None:
    """Use a new key from now on (Settings screen). The next request builds a new client."""
    global _client, _available
    config.GEMINI_API_KEY = key
    _client = None
    _available = None


def _is_timeout(e: Exception) -> bool:
    """httpx timeouts and dropped connections have no HTTP code; treat them like a busy model."""
    name = type(e).__name__.lower()
    return "timeout" in name or "connect" in name or "remoteprotocol" in name


def _available_models() -> set[str] | None:
    """
    The generateContent models this key can use, fetched once per key (a model list call: no
    document text). None if that can't be checked, in which case the configured list is used as is.
    """
    global _available
    if _available is None:
        try:
            names = set()
            for m in _get_client().models.list():
                actions = getattr(m, "supported_actions", None) or []
                if not actions or "generateContent" in actions:
                    names.add((m.name or "").removeprefix("models/"))
            _available = names or None
        except Exception:
            return None
    return _available


def _models_to_try() -> list[str]:
    """Configured models in order, keeping only ones this key can use. If none of them exist,
    fall back to the newest available "flash" model so chat still works."""
    wanted = [config.GEMINI_MODEL] + [m for m in config.GEMINI_FALLBACK_MODELS if m != config.GEMINI_MODEL]
    available = _available_models()
    if not available:
        return wanted
    usable = [m for m in wanted if m in available]
    if usable:
        return usable
    flash = sorted((m for m in available if "flash" in m and "lite" not in m and "image" not in m
                    and "tts" not in m and "audio" not in m and "live" not in m), reverse=True)
    return flash[:2] or wanted


def check_key(key: str) -> None:
    """
    One cheap call that sends NO document text: list a single model. Raises InvalidKey when
    Google rejects the key, and any other exception (offline, timeout) as it is.
    """
    client = genai.Client(api_key=key)       # keep a reference: the library closes unreferenced clients
    try:
        next(iter(client.models.list(config={"page_size": 1})), None)
    except Exception as e:
        if getattr(e, "code", None) in (400, 401, 403):
            raise InvalidKey() from e
        raise


def _get_client():
    global _client
    if _client is None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError("No Gemini API key. Add one in Settings.")
        _client = genai.Client(api_key=config.GEMINI_API_KEY,
                               http_options=types.HttpOptions(timeout=CALL_TIMEOUT_SECONDS * 1000))
    return _client


def ask(tagged_note: str, history: list[dict], tagged_question: str) -> str:
    """
    history = [{"role": "user" | "model", "text": "..."}]  (already tagged; the browser keeps it)
    The server keeps nothing between calls, so the full history comes in every time.
    """
    contents = [types.Content(role=h["role"], parts=[types.Part(text=h["text"])]) for h in history]
    contents.append(types.Content(role="user", parts=[types.Part(text=tagged_question)]))

    request_config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT.format(note=tagged_note),
        temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    # Gemini often answers 503 "high demand" (or 429/500) for a while, and a call can hang. Retry
    # each model a little, then fall back to the next model, so one busy or slow model doesn't fail
    # the request. A model the key can't use (404) is skipped. Everything stops at the deadline.
    # Other errors (bad key, blocked request) raise right away. Every model gets the same
    # pseudonymized text; nothing else changes.
    global last_model
    deadline = time.monotonic() + TOTAL_DEADLINE_SECONDS
    models = _models_to_try()
    last_error: Exception | None = None
    for model in models:
        for attempt in range(RETRIES + 1):
            if time.monotonic() >= deadline:
                raise Busy() from last_error
            try:
                response = _get_client().models.generate_content(
                    model=model, contents=contents, config=request_config)
                last_model = model
                return response.text or ""
            except Exception as e:
                code = getattr(e, "code", None)
                if code in SKIP_CODES or _is_timeout(e):
                    last_error = e
                    break                                      # unusable or slow: next model now
                if code not in RETRY_CODES:
                    raise
                last_error = e
                if attempt == RETRIES:
                    break                                      # this model stays busy: try the next
                time.sleep(RETRY_WAIT_SECONDS * (attempt + 1))
    if last_error is not None and getattr(last_error, "code", None) not in SKIP_CODES and not _is_timeout(last_error):
        raise last_error                                       # every model busy: keep Google's code
    raise Busy() from last_error
