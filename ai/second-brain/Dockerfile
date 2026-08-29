FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

# System deps: tesseract + Arabic pack (OCR), poppler (pdf2image rasterisation).
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-ara \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY eval ./eval
COPY conftest.py pytest.ini ./
COPY tests ./tests

# --- Offline / air-gapped model staging (optional) -------------------------
# Build with `--build-arg PREFETCH_MODELS=true` to bake the ~2GB embedding +
# reranker models into the image at build time (into HF_HOME=/models). The
# resulting image needs NO runtime internet egress — run it with
# `HF_HUB_OFFLINE=1` (see docker-compose.yml / README) for a sovereign, offline
# datacenter. Default (false) keeps the image slim and lazily downloads models on
# first use, OR mount a pre-populated cache into /models (the alternative).
ARG PREFETCH_MODELS=false
RUN if [ "$PREFETCH_MODELS" = "true" ]; then python scripts/prefetch_models.py; fi

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
