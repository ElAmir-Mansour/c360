"""Pluggable-LLM-provider tests. Pure logic — no network, no real SDK, no DB.

Covers the four things that make the provider abstraction safe to ship:
  1. provider SELECTION from config (anthropic | openai_compatible | aliases | unknown);
  2. the GRACEFUL "unconfigured -> LLMNotConfigured -> 503" contract;
  3. prompt-builder PARITY — the exact same grounded prompt is sent to either provider;
  4. both providers STREAM (token deltas + a final usage/model event), exercised
     against injected fake SDK modules so no server is required.
"""

import sys
import types
from types import SimpleNamespace

import pytest

from app.rag import generator, providers
from app.rag.providers import (
    AnthropicProvider,
    LLMNotConfigured,
    OpenAICompatibleProvider,
    build_provider,
    llm_configured,
)

RETRIEVED = [
    {"doc_id": "d1", "title_ar": "نظام المنافسة", "title_en": "Competition Law",
     "snippet": "ملخص", "page": 3, "score": 0.91, "chunk_text": "نص المادة الأولى"},
    {"doc_id": "d2", "title_ar": "نظام الاستثمار", "title_en": "Investment Law",
     "snippet": "ملخص", "page": 7, "score": 0.80, "chunk_text": "نص المادة الثانية"},
]


def _settings(**over):
    base = dict(
        ai_llm_provider="anthropic",
        anthropic_api_key="",
        ai_llm_base_url="",
        ai_llm_api_key="",
        ai_llm_model="claude-opus-4-8",
        ai_llm_max_tokens=8000,
        ai_llm_max_tokens_cap=8000,
        ai_llm_effort="high",
        guardrail_require_citations=True,
    )
    base.update(over)
    return SimpleNamespace(**base)


# --------------------------------------------------------------------------- #
# 1. Selection
# --------------------------------------------------------------------------- #

def test_selects_anthropic_by_default():
    p = build_provider(_settings())
    assert isinstance(p, AnthropicProvider)
    assert p.name == "anthropic"


def test_selects_openai_compatible():
    p = build_provider(_settings(ai_llm_provider="openai_compatible"))
    assert isinstance(p, OpenAICompatibleProvider)
    assert p.name == "openai_compatible"


@pytest.mark.parametrize("alias", ["OpenAI_Compatible", "vllm", "ollama", "tgi", "allam"])
def test_openai_aliases_and_case_insensitive(alias):
    assert isinstance(build_provider(_settings(ai_llm_provider=alias)), OpenAICompatibleProvider)


@pytest.mark.parametrize("alias", ["Anthropic", "claude"])
def test_anthropic_aliases(alias):
    assert isinstance(build_provider(_settings(ai_llm_provider=alias)), AnthropicProvider)


def test_unknown_provider_is_not_configured():
    # An unknown provider name must not silently fall back to a real backend.
    assert llm_configured(_settings(ai_llm_provider="totally-made-up")) is False


# --------------------------------------------------------------------------- #
# 2. Configured / graceful-unconfigured
# --------------------------------------------------------------------------- #

def test_anthropic_configured_only_with_key():
    assert llm_configured(_settings()) is False
    assert llm_configured(_settings(anthropic_api_key="sk-ant-x")) is True


def test_openai_configured_only_with_base_url():
    s = _settings(ai_llm_provider="openai_compatible")
    assert llm_configured(s) is False
    assert llm_configured(_settings(ai_llm_provider="openai_compatible",
                                    ai_llm_base_url="http://allam.local/v1")) is True


def test_anthropic_stream_raises_when_unconfigured_before_sdk():
    # No key -> LLMNotConfigured on first step, WITHOUT importing/using the SDK.
    gen = AnthropicProvider(_settings()).stream("sys", "user", 8000)
    with pytest.raises(LLMNotConfigured):
        next(gen)


def test_openai_stream_raises_when_unconfigured_before_sdk():
    gen = OpenAICompatibleProvider(_settings(ai_llm_provider="openai_compatible")).stream(
        "sys", "user", 8000
    )
    with pytest.raises(LLMNotConfigured):
        next(gen)


def test_unknown_provider_stream_raises():
    with pytest.raises(LLMNotConfigured):
        next(build_provider(_settings(ai_llm_provider="nope")).stream("s", "u", 10))


# --------------------------------------------------------------------------- #
# 3. Prompt-builder parity across providers
# --------------------------------------------------------------------------- #

class _RecordingProvider:
    """Captures exactly what generator hands the provider, and streams a canned answer."""

    def __init__(self):
        self.calls = []

    def is_configured(self):
        return True

    def stream(self, system, user, max_tokens):
        self.calls.append((system, user, max_tokens))
        yield ("token", "وفقاً للمصدر [1] ")
        yield ("final", {"text": "وفقاً للمصدر [1] .",
                         "model": "test-model", "usage": {"input_tokens": 5, "output_tokens": 7}})


def test_prompt_is_identical_across_providers(monkeypatch):
    rec = _RecordingProvider()
    monkeypatch.setattr(providers, "build_provider", lambda s: rec)

    generator.generate_answer("سؤال قانوني", RETRIEVED, _settings(ai_llm_provider="anthropic"))
    generator.generate_answer(
        "سؤال قانوني", RETRIEVED,
        _settings(ai_llm_provider="openai_compatible", ai_llm_base_url="http://x/v1"),
    )

    (sys_a, user_a, _mt_a), (sys_b, user_b, _mt_b) = rec.calls
    assert sys_a == sys_b == generator.SYSTEM_PROMPT  # same grounded/cite-only system prompt
    assert user_a == user_b                            # same numbered context + question
    assert "[1]" in user_a and "نظام المنافسة" in user_a


def test_max_tokens_is_clamped_to_cap(monkeypatch):
    rec = _RecordingProvider()
    monkeypatch.setattr(providers, "build_provider", lambda s: rec)
    generator.generate_answer("q", RETRIEVED, _settings(ai_llm_max_tokens=99999, ai_llm_max_tokens_cap=8000))
    assert rec.calls[0][2] == 8000


def test_generate_answer_returns_citations_model_usage(monkeypatch):
    rec = _RecordingProvider()
    monkeypatch.setattr(providers, "build_provider", lambda s: rec)
    answer, cites, model, usage = generator.generate_answer("q", RETRIEVED, _settings())
    assert model == "test-model"
    assert usage == {"input_tokens": 5, "output_tokens": 7}
    assert [c["doc_id"] for c in cites] == ["d1"]  # parsed from the [1] marker


def test_stream_answer_yields_tokens_then_final(monkeypatch):
    rec = _RecordingProvider()
    monkeypatch.setattr(providers, "build_provider", lambda s: rec)
    events = list(generator.stream_answer("q", RETRIEVED, _settings()))
    assert events[0][0] == "token"
    assert events[-1][0] == "final"
    final = events[-1][1]
    assert final["model"] == "test-model"
    assert final["citations"][0]["doc_id"] == "d1"


# --------------------------------------------------------------------------- #
# 4. Streaming parsing for BOTH providers (injected fake SDKs — no network)
# --------------------------------------------------------------------------- #

def _install_fake_anthropic(monkeypatch, recorder):
    mod = types.ModuleType("anthropic")

    class _Usage:
        input_tokens = 11
        output_tokens = 7

    class _TextBlock:
        type = "text"
        text = "وفقاً للمادة [1] ."

    class _Final:
        model = "claude-opus-4-8"
        usage = _Usage()
        content = [_TextBlock()]

    class _Stream:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        @property
        def text_stream(self):
            yield "وفقاً "
            yield "للمادة [1] ."

        def get_final_message(self):
            return _Final()

    class _Messages:
        # Explicit output_config kwarg so _supports() detects it (effort path).
        def stream(self, *, model, max_tokens, thinking, system, messages, output_config=None):
            recorder.update(dict(model=model, max_tokens=max_tokens, thinking=thinking,
                                 system=system, messages=messages, output_config=output_config))
            return _Stream()

    class Anthropic:
        def __init__(self, api_key=None):
            self.messages = _Messages()

    mod.Anthropic = Anthropic
    monkeypatch.setitem(sys.modules, "anthropic", mod)


def test_anthropic_provider_streams_and_passes_effort(monkeypatch):
    recorder = {}
    _install_fake_anthropic(monkeypatch, recorder)
    p = AnthropicProvider(_settings(anthropic_api_key="sk-ant-x", ai_llm_effort="max"))

    events = list(p.stream("SYS", "USER", 4321))
    tokens = [d for k, d in events if k == "token"]
    final = [d for k, d in events if k == "final"][0]

    assert "".join(tokens) == "وفقاً للمادة [1] ."
    assert final["model"] == "claude-opus-4-8"
    assert final["usage"] == {"input_tokens": 11, "output_tokens": 7}
    # Preserved Anthropic behaviour: adaptive thinking + effort via output_config.
    assert recorder["thinking"] == {"type": "adaptive"}
    assert recorder["output_config"] == {"effort": "max"}
    assert recorder["max_tokens"] == 4321
    assert recorder["system"] == "SYS"


def _install_fake_openai(monkeypatch, recorder):
    mod = types.ModuleType("openai")

    def _chunk(content=None, usage=None, model="allam-2-7b"):
        delta = SimpleNamespace(content=content)
        choice = SimpleNamespace(delta=delta)
        return SimpleNamespace(model=model, choices=[choice] if content is not None else [], usage=usage)

    class _Completions:
        def create(self, **kwargs):
            recorder.update(kwargs)
            usage = SimpleNamespace(prompt_tokens=21, completion_tokens=9)
            return iter([
                _chunk("وفقاً "),
                _chunk("للمادة [1] ."),
                _chunk(content=None, usage=usage),  # final usage-only chunk
            ])

    class _Chat:
        def __init__(self):
            self.completions = _Completions()

    class OpenAI:
        def __init__(self, base_url=None, api_key=None):
            recorder["base_url"] = base_url
            recorder["api_key"] = api_key
            self.chat = _Chat()

    mod.OpenAI = OpenAI
    monkeypatch.setitem(sys.modules, "openai", mod)


def test_openai_compatible_provider_streams(monkeypatch):
    recorder = {}
    _install_fake_openai(monkeypatch, recorder)
    p = OpenAICompatibleProvider(
        _settings(ai_llm_provider="openai_compatible", ai_llm_base_url="http://allam.local/v1",
                  ai_llm_model="allam-2-7b")
    )

    events = list(p.stream("SYS", "USER", 512))
    tokens = [d for k, d in events if k == "token"]
    final = [d for k, d in events if k == "final"][0]

    assert "".join(tokens) == "وفقاً للمادة [1] ."
    assert final["model"] == "allam-2-7b"
    assert final["usage"] == {"input_tokens": 21, "output_tokens": 9}
    # OpenAI-format request shape: system+user messages, max_tokens, streaming on.
    assert recorder["messages"] == [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": "USER"},
    ]
    assert recorder["max_tokens"] == 512 and recorder["stream"] is True
    assert recorder["base_url"] == "http://allam.local/v1"
    # Keyless local server -> a harmless placeholder key is used.
    assert recorder["api_key"] == "sk-no-key-required"
