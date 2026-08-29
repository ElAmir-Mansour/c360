# Second Brain — retrieval & answer eval

A small **curated Arabic Q&A eval set** (14 items) over the WatheeqTech corpus,
with scripts that score retrieval quality, citation accuracy, and answer
groundedness. Use it to catch regressions when you change chunking, the
embedding model, the retrieval mode, the reranker, or the prompt.

## Files

| File | What it is |
|---|---|
| `eval_set.json` | 14 items: 13 answerable questions (systems-regulations / research) + 1 deliberately **out-of-corpus** item to verify the refusal guardrail. Each answerable item names expected document title fragments + expected answer keywords. |
| `scoring.py` | Pure-logic metrics: retrieval hit-rate, MRR, keyword coverage, citation precision/recall/F1. Unit-tested in `tests/test_eval_scoring.py`. |
| `run_eval.py` | Drives a **running** service (`/search` + `/ask`) and prints per-item + aggregate scores. |

## Metrics

| Metric | Meaning | Needs |
|---|---|---|
| **retrieval hit-rate** | Did the expected document appear in the top-k results? | `/search` only |
| **MRR** | Mean reciprocal rank of the first relevant result. | `/search` only |
| **keyword coverage** | Fraction of expected answer keywords present in the retrieved snippets. | `/search` only |
| **citation F1** | Precision/recall/F1 of the citations `/ask` returned vs. the expected documents. | `/ask` (needs `ANTHROPIC_API_KEY` on the **server**) |
| **groundedness** | LLM-as-judge (`--judge`): is the answer fully supported by its cited snippets, with no invented facts? | `--judge` + `ANTHROPIC_API_KEY` in the eval process (judge model call) |
| **out-of-corpus refusal** | Did the unanswerable item correctly refuse ("not in the library")? | `/ask` |

## Run it

Start the service and ingest the corpus first (see the top-level `README.md`),
then:

```bash
cd ai/second-brain

# retrieval metrics only — no LLM key required, fast
python -m eval.run_eval --no-ask

# full eval incl. citation accuracy (server needs ANTHROPIC_API_KEY for /ask)
python -m eval.run_eval --base-url http://localhost:8000 --top-k 8

# add LLM-as-judge groundedness (the eval process itself calls the judge model)
ANTHROPIC_API_KEY=sk-ant-... python -m eval.run_eval --judge
```

Example aggregate output:

```json
{
  "n": 13,
  "retrieval_hit_rate": 0.92,
  "mrr": 0.81,
  "keyword_coverage": 0.88,
  "citation_f1": 0.79,
  "groundedness": 0.92
}
out-of-corpus refusal: 1/1 correct
```

## What's real vs. what needs a running system

`scoring.py` is pure and fully unit-tested offline (`python -m pytest
tests/test_eval_scoring.py`). `run_eval.py` needs a **live** service with the
corpus ingested (pgvector + the embedding model), and — for `/ask` and
`--judge` — a valid `ANTHROPIC_API_KEY`. Retrieval-only mode (`--no-ask`) still
needs pgvector + the embedding model, but no LLM key.
