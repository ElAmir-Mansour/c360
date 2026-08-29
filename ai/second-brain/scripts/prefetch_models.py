#!/usr/bin/env python
"""Offline / air-gapped model staging.

Downloads the embedding (``AI_EMBEDDING_MODEL``) and reranker (``RERANK_MODEL``)
models into the Hugging Face cache (``HF_HOME``) so the service needs **NO runtime
internet egress** — a hard requirement for a sovereign / in-Kingdom offline
datacenter. Once staged, run the service with ``HF_HUB_OFFLINE=1`` and every model
load resolves from the local cache.

Usage:
    python scripts/prefetch_models.py                 # embedding + reranker
    python scripts/prefetch_models.py --skip-reranker # embedding only
    python scripts/prefetch_models.py --models intfloat/multilingual-e5-large ...
    make prefetch-models                              # same, from the Makefile

Run it ONLINE (this is the staging step); it clears any HF_HUB_OFFLINE flag for
its own process so the download succeeds even inside an image whose runtime is
configured for offline. In the Dockerfile, `--build-arg PREFETCH_MODELS=true`
runs this at build time to bake the weights into the image layer.
"""

from __future__ import annotations

import argparse
import os
import sys

# Make ``app`` importable whether run as ``python scripts/prefetch_models.py`` or
# ``python -m scripts.prefetch_models`` from the service root.
_SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _SERVICE_ROOT)


def _download(model_id: str) -> str:
    """Fetch a whole model repo into the HF cache; return the local snapshot dir.

    Uses ``huggingface_hub.snapshot_download`` (honours ``HF_HOME``) so nothing is
    loaded into memory — just the files land on disk where sentence-transformers /
    transformers look them up at runtime. Falls back to instantiating via
    sentence-transformers if the hub helper is unavailable.
    """
    try:
        from huggingface_hub import snapshot_download

        return snapshot_download(repo_id=model_id)
    except Exception as exc:  # pragma: no cover - network / import fallback
        print(f"  snapshot_download unavailable ({exc}); trying sentence-transformers load")
        from sentence_transformers import SentenceTransformer

        SentenceTransformer(model_id)  # loads + caches
        return "(loaded via sentence-transformers)"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Stage embedding + reranker models offline.")
    parser.add_argument(
        "--models",
        nargs="*",
        help="Explicit model ids to fetch (overrides the config-derived defaults).",
    )
    parser.add_argument(
        "--skip-reranker",
        action="store_true",
        help="Fetch only the embedding model.",
    )
    args = parser.parse_args(argv)

    # This is the ONLINE staging step — never let a runtime offline flag block it.
    for flag in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"):
        if os.environ.pop(flag, None):
            print(f"note: cleared {flag} for the download step")

    if args.models:
        models = list(args.models)
    else:
        # Import config lazily so a bad env doesn't crash arg parsing.
        from app.config import get_settings

        settings = get_settings()
        models = [settings.ai_embedding_model]
        if settings.rerank_enabled and not args.skip_reranker:
            models.append(settings.rerank_model)

    hf_home = os.environ.get("HF_HOME", "~/.cache/huggingface (default)")
    print(f"Staging {len(models)} model(s) into HF cache: {hf_home}")
    for model_id in models:
        print(f"- {model_id}")
        path = _download(model_id)
        print(f"  cached -> {path}")

    print("Done. Run the service with HF_HUB_OFFLINE=1 to use the staged cache.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
