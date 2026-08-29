# WatheeqTech Second Brain — dev + sovereign-deploy helpers.
.PHONY: help prefetch-models test compile build build-offline up

help:
	@echo "Targets:"
	@echo "  prefetch-models  Stage embedding + reranker models into HF_HOME for offline/air-gapped use"
	@echo "  test             Run the pytest suite (pure-logic + integration when deps present)"
	@echo "  compile          Byte-compile the app/ package (import self-check)"
	@echo "  build            Build the Docker image"
	@echo "  build-offline    Build the image with the models baked in (PREFETCH_MODELS=true)"
	@echo "  up               docker compose up --build"

# Offline / air-gapped model staging: downloads AI_EMBEDDING_MODEL + RERANK_MODEL
# into the Hugging Face cache (HF_HOME) so no runtime internet egress is needed.
prefetch-models:
	python scripts/prefetch_models.py

test:
	python -m pytest -q

compile:
	python -m compileall app

build:
	docker build -t watheeq-second-brain .

# Bake the ~2GB embedding + reranker models into the image at build time so the
# container needs no network at runtime (pair with HF_HUB_OFFLINE=1).
build-offline:
	docker build --build-arg PREFETCH_MODELS=true -t watheeq-second-brain:offline .

up:
	docker compose up --build
