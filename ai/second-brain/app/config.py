"""Config — every knob is env-driven via pydantic-settings.

Field ``foo_bar`` reads env var ``FOO_BAR`` (case-insensitive). A local ``.env``
file (see ``.env.example``) is loaded automatically. Nothing here has a secret
default; ANTHROPIC_API_KEY is intentionally empty so ``/ask`` reports 503 until
it is provided.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Vector store (pgvector on Postgres) -------------------------------
    ai_database_url: str = "postgresql://second_brain:second_brain@localhost:5432/second_brain"

    # --- Generation — pluggable LLM provider (sovereignty de-risker) --------
    # AI_LLM_PROVIDER selects the backend with NO code change:
    #   "anthropic"          -> Claude via the anthropic SDK (default; needs
    #                           ANTHROPIC_API_KEY). Behaviour is unchanged.
    #   "openai_compatible"  -> any OpenAI-format /v1/chat/completions endpoint
    #                           (vLLM / TGI / Ollama / OpenAI). This is the path
    #                           for a KSA-resident, self-hosted Arabic model
    #                           (ALLaM, Jais, Falcon) so all inference stays
    #                           in-Kingdom. Needs AI_LLM_BASE_URL (+ AI_LLM_API_KEY
    #                           if the server requires auth); AI_LLM_MODEL is the
    #                           served model name.
    ai_llm_provider: str = "anthropic"
    ai_llm_base_url: str = ""   # e.g. https://allam.gov.local/v1 (openai_compatible)
    ai_llm_api_key: str = ""    # optional for keyless local servers (vLLM/Ollama)

    # Anthropic key (used only when AI_LLM_PROVIDER=anthropic; no embeddings API).
    anthropic_api_key: str = ""
    ai_llm_model: str = "claude-opus-4-8"
    ai_llm_max_tokens: int = 8000
    # Hard per-request cost cap: a caller-supplied max_tokens is clamped to this.
    ai_llm_max_tokens_cap: int = 8000
    # Answer generation effort (low|medium|high|xhigh|max) — see claude docs.
    ai_llm_effort: str = "high"

    # --- Embeddings (local multilingual model, strong on Arabic) -----------
    # e5 models expect the "query:" / "passage:" prefixes below. If you switch
    # to a non-e5 model (e.g. paraphrase-multilingual-mpnet-base-v2, dim 768),
    # blank both prefixes and set AI_EMBEDDING_DIM to the model's dimension.
    ai_embedding_model: str = "intfloat/multilingual-e5-large"
    ai_embedding_dim: int = 1024
    ai_embedding_query_prefix: str = "query: "
    ai_embedding_passage_prefix: str = "passage: "
    ai_embedding_normalize: bool = True

    # --- Corpus source -----------------------------------------------------
    # When LEX_API_URL is set the catalog + bytes come from the lex service.
    # Otherwise the local manifest + PDF directory are used (dev fallback).
    lex_api_url: str = ""
    lex_api_token: str = ""
    lex_tenant_id: str = ""
    library_path: str = "../../docs/ClarioWatheeq/WatheeqTech Library"
    manifest_path: str = "../../docs/ClarioWatheeq/reference_library_manifest.json"

    # --- Chunking (Arabic-aware) -------------------------------------------
    chunk_max_chars: int = 1200
    chunk_overlap: int = 200
    # Article-aware chunking splits Saudi statutes on نظام/مادة/فصل/الباب
    # structure and carries article numbers into chunk metadata + citations.
    # Falls back to plain page chunking when no article markers are present,
    # so it is safe to leave on for the whole corpus.
    chunk_article_aware: bool = True

    # --- Retrieval ---------------------------------------------------------
    default_top_k: int = 8
    max_top_k: int = 50
    snippet_chars: int = 320
    # Retrieval mode: "hybrid" (vector + keyword fused), "vector", or "keyword".
    retrieval_mode: str = "hybrid"
    # How many candidates each retriever fetches before fusion/rerank. The final
    # response is trimmed to top_k. Larger => better recall, slightly slower.
    retrieval_candidate_k: int = 40
    # Reciprocal-Rank-Fusion constant (higher = flatter rank weighting).
    hybrid_rrf_k: int = 60
    # Postgres text-search configuration for keyword search. 'simple' does no
    # stemming (correct for Arabic — there is no ships-with-Postgres Arabic
    # stemmer); it still gives exact-term keyword recall to complement vectors.
    keyword_ts_config: str = "simple"

    # --- Reranking (cross-encoder; optional, graceful fallback) ------------
    rerank_enabled: bool = True
    # Any sentence-transformers CrossEncoder id. bge-reranker-v2-m3 is strong on
    # Arabic. If the model/deps are unavailable, retrieval degrades to the fused
    # order (no crash) — reranking is a quality boost, never a hard dependency.
    rerank_model: str = "BAAI/bge-reranker-v2-m3"
    rerank_top_n: int = 20  # rerank at most this many fused candidates

    # --- Guardrails --------------------------------------------------------
    # Below this max retrieval score the corpus is judged not to contain the
    # answer and /ask refuses ("not in the library") WITHOUT calling the LLM —
    # saving cost and preventing hallucination. Scores are cosine (0..1) after
    # optional reranking; tune per embedding model.
    guardrail_min_score: float = 0.30
    # Refuse questions longer than this (defends against prompt-stuffing).
    guardrail_max_question_chars: int = 2000
    # Enforce that a non-refusal answer cites at least one source.
    guardrail_require_citations: bool = True

    # --- Answer cache (question-hash -> answer) ----------------------------
    answer_cache_enabled: bool = True
    answer_cache_max_entries: int = 512
    answer_cache_ttl_seconds: int = 3600

    # --- Rate limiting (per client key: IP or bearer token) ----------------
    rate_limit_enabled: bool = True
    rate_limit_per_minute: int = 30      # applies to /ask + /ask/stream
    rate_limit_search_per_minute: int = 120

    # --- OCR (scanned مجلة قضاء issues) ------------------------------------
    ocr_enabled: bool = True
    ocr_min_chars: int = 60  # a page with fewer extracted chars is treated as scanned
    ocr_lang: str = "ara"
    ocr_dpi: int = 300

    # --- Observability -----------------------------------------------------
    metrics_enabled: bool = True
    log_json: bool = True       # structured JSON logs (false => human text)
    log_level: str = "INFO"

    # --- HTTP --------------------------------------------------------------
    request_timeout: float = 60.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
