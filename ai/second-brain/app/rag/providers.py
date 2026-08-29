"""Pluggable LLM providers for grounded generation (the sovereignty de-risker).

Generation is abstracted behind a tiny provider interface so the LLM can be
**Anthropic** (Claude, the default) OR any **OpenAI-format** ``/v1/chat/completions``
endpoint — vLLM / TGI / Ollama / OpenAI — chosen entirely by ``AI_LLM_PROVIDER``
with NO code change. The openai_compatible path is what lets a **KSA-resident,
self-hosted Arabic model** (ALLaM, Jais, Falcon) serve every token in-Kingdom.

One provider interface, two implementations, shared by both the JSON ``/ask`` and
the SSE ``/ask/stream`` paths:

    provider.is_configured()                 -> bool  (key / base_url present)
    provider.stream(system, user, max_tokens) -> generator of events:
        ("token", text)                       # each incremental delta
        ("final", {"text","model","usage"})   # once, when the message is complete

The prompt (system + user) is built provider-independently in ``generator.py``,
so the SAME grounded/cite-only prompt is sent to either provider. Selection and
the graceful "unconfigured -> 503" behaviour are pure/config logic and unit-tested
without touching a network or an SDK (both SDKs are imported lazily, inside the
call path, so a missing SDK degrades to an honest ``LLMNotConfigured``).
"""

from __future__ import annotations

import inspect
import logging
from typing import Iterator, Tuple

log = logging.getLogger(__name__)

# Event tuples yielded by ``Provider.stream``.
Event = Tuple[str, object]

# Canonical provider names + accepted aliases.
_ANTHROPIC_ALIASES = {"anthropic", "claude"}
_OPENAI_ALIASES = {"openai_compatible", "openai", "vllm", "tgi", "ollama", "allam"}


class LLMNotConfigured(RuntimeError):
    """Raised when the selected LLM cannot be called (no key / base_url / SDK).

    The route turns this into an HTTP 503 ``{"error":"llm not configured"}`` — the
    service NEVER fabricates an answer when generation is unavailable.
    """


class LLMProvider:
    """Interface both providers implement. ``stream`` is the only network call."""

    name = "base"

    def __init__(self, settings):
        self.settings = settings

    def is_configured(self) -> bool:  # pragma: no cover - overridden
        raise NotImplementedError

    def stream(self, system: str, user: str, max_tokens: int) -> Iterator[Event]:  # pragma: no cover
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Anthropic (Claude) — preserves the exact prior behaviour byte-for-byte:
# adaptive thinking + effort via output_config (feature-detected), messages.stream.
# --------------------------------------------------------------------------- #

def _supports(client, param: str) -> bool:
    """Whether the installed ``anthropic`` SDK's messages.stream accepts a kwarg.

    Older releases don't type ``output_config``/``effort``; passing an unknown
    kwarg to a typed method raises TypeError. Feature-detect once so a slightly
    older SDK downgrades gracefully instead of breaking /ask.
    """
    try:
        return param in inspect.signature(client.messages.stream).parameters
    except (TypeError, ValueError):
        return False


def _anthropic_usage(final) -> dict:
    u = getattr(final, "usage", None)
    return {
        "input_tokens": int(getattr(u, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(u, "output_tokens", 0) or 0),
    }


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def is_configured(self) -> bool:
        return bool(self.settings.anthropic_api_key)

    def _client_and_params(self, system: str, user: str, max_tokens: int):
        if not self.settings.anthropic_api_key:
            raise LLMNotConfigured("ANTHROPIC_API_KEY is not set")
        try:
            import anthropic
        except ImportError as exc:  # SDK not installed
            raise LLMNotConfigured(f"anthropic SDK is not installed: {exc}") from exc

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        params = dict(
            model=self.settings.ai_llm_model,
            max_tokens=max_tokens,
            thinking={"type": "adaptive"},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        # Generation effort (GA on Opus 4.8) — only if this SDK version supports it.
        if _supports(client, "output_config"):
            params["output_config"] = {"effort": self.settings.ai_llm_effort}
        return client, params

    def stream(self, system: str, user: str, max_tokens: int) -> Iterator[Event]:
        client, params = self._client_and_params(system, user, max_tokens)
        parts = []
        # Streaming avoids the SDK's long-request timeout guard at high max_tokens.
        with client.messages.stream(**params) as stream:
            for text in stream.text_stream:
                parts.append(text)
                yield ("token", text)
            final = stream.get_final_message()

        answer = "".join(parts).strip()
        if not answer:
            answer = "".join(
                b.text for b in final.content if getattr(b, "type", None) == "text"
            ).strip()
        yield ("final", {"text": answer, "model": final.model, "usage": _anthropic_usage(final)})


# --------------------------------------------------------------------------- #
# OpenAI-compatible — any /v1/chat/completions server (vLLM, TGI, Ollama, OpenAI,
# or a KSA-hosted ALLaM/Jais/Falcon). "Configured" == a base_url is set; the API
# key is optional (local sovereign servers usually need none).
# --------------------------------------------------------------------------- #

class OpenAICompatibleProvider(LLMProvider):
    name = "openai_compatible"

    def is_configured(self) -> bool:
        # A base_url is the only hard requirement; self-hosted vLLM/Ollama often
        # need no key. (Hosted OpenAI needs AI_LLM_API_KEY too, but that server
        # simply returns 401 if it's missing — we don't second-guess the operator.)
        return bool(self.settings.ai_llm_base_url)

    def _client(self):
        if not self.settings.ai_llm_base_url:
            raise LLMNotConfigured("AI_LLM_BASE_URL is not set")
        try:
            import openai
        except ImportError as exc:
            raise LLMNotConfigured(f"openai SDK is not installed: {exc}") from exc

        # The openai SDK requires a non-empty api_key string even when the target
        # server ignores it; use a harmless placeholder for keyless local servers.
        api_key = self.settings.ai_llm_api_key or "sk-no-key-required"
        return openai.OpenAI(base_url=self.settings.ai_llm_base_url, api_key=api_key)

    def stream(self, system: str, user: str, max_tokens: int) -> Iterator[Event]:
        client = self._client()
        base_kwargs = dict(
            model=self.settings.ai_llm_model,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            stream=True,
        )
        # Ask for a usage summary in the final SSE chunk (OpenAI/vLLM/TGI support
        # it); older SDKs don't type the kwarg -> retry without it (usage stays 0).
        try:
            completion = client.chat.completions.create(
                stream_options={"include_usage": True}, **base_kwargs
            )
        except TypeError:
            completion = client.chat.completions.create(**base_kwargs)

        parts = []
        model = self.settings.ai_llm_model
        usage = {"input_tokens": 0, "output_tokens": 0}
        for chunk in completion:
            if getattr(chunk, "model", None):
                model = chunk.model
            u = getattr(chunk, "usage", None)
            if u:
                usage = {
                    "input_tokens": int(getattr(u, "prompt_tokens", 0) or 0),
                    "output_tokens": int(getattr(u, "completion_tokens", 0) or 0),
                }
            choices = getattr(chunk, "choices", None) or []
            if not choices:
                continue
            delta = getattr(choices[0], "delta", None)
            text = getattr(delta, "content", None) if delta is not None else None
            if text:
                parts.append(text)
                yield ("token", text)

        yield ("final", {"text": "".join(parts).strip(), "model": model, "usage": usage})


# --------------------------------------------------------------------------- #
# Unknown / misconfigured provider name -> surfaces as an honest 503 rather than
# silently using a different backend.
# --------------------------------------------------------------------------- #

class _UnknownProvider(LLMProvider):
    name = "unknown"

    def __init__(self, settings, requested: str):
        super().__init__(settings)
        self._requested = requested

    def is_configured(self) -> bool:
        return False

    def stream(self, system: str, user: str, max_tokens: int) -> Iterator[Event]:
        raise LLMNotConfigured(f"unknown AI_LLM_PROVIDER: {self._requested!r}")
        yield  # pragma: no cover - marks this a generator


def build_provider(settings) -> LLMProvider:
    """Select the provider from ``settings.ai_llm_provider`` (case-insensitive)."""
    requested = (getattr(settings, "ai_llm_provider", "") or "anthropic").strip().lower()
    if requested in _ANTHROPIC_ALIASES:
        return AnthropicProvider(settings)
    if requested in _OPENAI_ALIASES:
        return OpenAICompatibleProvider(settings)
    log.warning("unknown AI_LLM_PROVIDER=%r; /ask will report llm not configured", requested)
    return _UnknownProvider(settings, requested)


def llm_configured(settings) -> bool:
    """Whether the selected provider can be called — the /ask 503 gate.

    Pure/config check: no network, no SDK import, so /health and the pre-flight
    can call it cheaply on every request.
    """
    return build_provider(settings).is_configured()
