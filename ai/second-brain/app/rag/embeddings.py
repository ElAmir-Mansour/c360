"""Embeddings provider.

Default is a local multilingual sentence-transformers model that performs well
on Arabic (``intfloat/multilingual-e5-large``, 1024-dim). The model id, prefixes
and normalisation are all env-driven (see config). Anthropic is NOT used here —
it has no embeddings API, which is why generation and retrieval use different
providers.

Heavy deps (sentence-transformers / torch) are imported lazily so importing this
module — or the FastAPI app — never pulls in torch until an embedder is built.
"""

from __future__ import annotations

import logging
from functools import lru_cache

log = logging.getLogger(__name__)


class EmbeddingsUnavailable(RuntimeError):
    """Raised when the embedding model / its deps cannot be loaded."""


class SentenceTransformerEmbedder:
    def __init__(self, settings):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise EmbeddingsUnavailable(
                f"sentence-transformers is not installed: {exc}"
            ) from exc
        try:
            self.model = SentenceTransformer(settings.ai_embedding_model)
        except Exception as exc:  # download / load failure
            raise EmbeddingsUnavailable(
                f"failed to load embedding model '{settings.ai_embedding_model}': {exc}"
            ) from exc

        self.query_prefix = settings.ai_embedding_query_prefix
        self.passage_prefix = settings.ai_embedding_passage_prefix
        self.normalize = settings.ai_embedding_normalize
        # Sanity-check the configured dimension against the loaded model.
        model_dim = self.model.get_sentence_embedding_dimension()
        if model_dim and model_dim != settings.ai_embedding_dim:
            log.warning(
                "AI_EMBEDDING_DIM=%s but model '%s' produces %s-dim vectors; "
                "set AI_EMBEDDING_DIM=%s (and re-ingest) or the DB insert will fail.",
                settings.ai_embedding_dim, settings.ai_embedding_model, model_dim, model_dim,
            )

    def embed_documents(self, texts: list[str]):
        inputs = [self.passage_prefix + (t or "") for t in texts]
        return self.model.encode(
            inputs, normalize_embeddings=self.normalize, convert_to_numpy=True
        )

    def embed_query(self, text: str):
        vec = self.model.encode(
            [self.query_prefix + (text or "")],
            normalize_embeddings=self.normalize,
            convert_to_numpy=True,
        )
        return vec[0]


@lru_cache
def get_embedder() -> SentenceTransformerEmbedder:
    """Process-wide singleton — the model is loaded once and reused."""
    from ..config import get_settings

    return SentenceTransformerEmbedder(get_settings())
