"""Run the Arabic Q&A eval against a live Second Brain service.

Drives ``/search`` and ``/ask`` for each eval item and reports:

  * **retrieval hit-rate** — did the expected document appear in the results?
  * **MRR** — mean reciprocal rank of the first relevant result.
  * **keyword coverage** — fraction of expected answer keywords present.
  * **citation accuracy** — precision/recall/F1 of returned citations vs. the
    expected documents.
  * **groundedness** — LLM-as-judge (gated on ANTHROPIC_API_KEY): is the answer
    fully supported by its cited snippets and free of unsupported claims?
  * **out-of-corpus refusal** — did the deliberately-unanswerable item refuse?

Usage:

    # against a running service (default http://localhost:8000)
    python -m eval.run_eval
    python -m eval.run_eval --base-url http://localhost:8000 --top-k 8
    python -m eval.run_eval --no-ask            # retrieval metrics only
    ANTHROPIC_API_KEY=sk-... python -m eval.run_eval --judge   # + groundedness

The retrieval/citation scores need no key. Groundedness needs a key for the
judge model (``--judge``); without it that column is reported as n/a.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from . import scoring

_HERE = Path(__file__).resolve().parent
_JUDGE_MODEL = os.getenv("EVAL_JUDGE_MODEL", "claude-opus-4-8")

_JUDGE_SYSTEM = (
    "You are a strict evaluator of a Saudi legal RAG assistant. Given a question, "
    "the assistant's answer, and the source excerpts it cited, decide whether the "
    "answer is FULLY grounded: every factual/legal claim is supported by the cited "
    "excerpts and the answer introduces no outside facts, invented articles, or "
    "unsupported conclusions. Reply with a single digit on the first line: 1 if fully "
    "grounded, 0 otherwise. Then one short sentence of justification."
)


def _load_items():
    data = json.loads((_HERE / "eval_set.json").read_text(encoding="utf-8"))
    return data["items"]


def _titles(results):
    out = []
    for r in results:
        out.append(r.get("title_ar") or r.get("title_en") or r.get("doc_id") or "")
    return out


def _judge_groundedness(question, answer, citations):
    """LLM-as-judge groundedness in [0,1]. Returns None if no key/SDK."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    excerpts = "\n\n".join(
        f"[{i}] {c.get('title_ar','')} {c.get('article_label','')}\n{c.get('snippet','')}"
        for i, c in enumerate(citations, start=1)
    )
    user = f"السؤال:\n{question}\n\nإجابة المساعد:\n{answer}\n\nالمقتطفات المستشهد بها:\n{excerpts}"
    client = anthropic.Anthropic(api_key=api_key)
    # Adaptive thinking spends from max_tokens before any visible text, so a tight
    # cap can truncate the verdict to an empty string (scored as 0). Give thinking
    # ample headroom — the visible reply is still just a digit + one line.
    with client.messages.stream(
        model=_JUDGE_MODEL, max_tokens=2048,
        thinking={"type": "adaptive"},
        system=_JUDGE_SYSTEM,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        final = stream.get_final_message()
    text = "".join(b.text for b in final.content if getattr(b, "type", None) == "text").strip()
    first = text.lstrip()[:1]
    return 1.0 if first == "1" else 0.0


def run(base_url: str, top_k: int, do_ask: bool, do_judge: bool):
    import httpx

    items = _load_items()
    results = []
    with httpx.Client(base_url=base_url, timeout=120.0) as client:
        for it in items:
            q = it["question"]
            row = {"id": it["id"], "category": it.get("category", "")}
            expected_refusal = bool(it.get("expected_refusal"))

            # Retrieval.
            try:
                sr = client.get("/search", params={"q": q, "top_k": top_k})
                sr.raise_for_status()
                retrieved = sr.json().get("data", [])
            except Exception as exc:
                row["error"] = f"search: {exc}"
                results.append(row)
                continue
            titles = _titles(retrieved)
            snippets = " ".join(r.get("snippet", "") for r in retrieved)

            if not expected_refusal:
                row["hit"] = scoring.retrieval_hit(it["expected_docs"], titles)
                row["rr"] = scoring.reciprocal_rank(it["expected_docs"], titles)
                row["keyword_coverage"] = scoring.keyword_coverage(
                    it.get("expected_keywords", []), snippets
                )

            # Answer.
            if do_ask:
                try:
                    ar = client.post("/ask", json={"question": q, "top_k": top_k})
                except Exception as exc:
                    row["error"] = f"ask: {exc}"
                    results.append(row)
                    continue
                if ar.status_code == 503:
                    row["ask"] = "llm_unavailable"
                    results.append(row)
                    continue
                body = ar.json()
                refused = bool(body.get("refused"))
                if expected_refusal:
                    row["refusal_correct"] = refused
                else:
                    cite_titles = [
                        c.get("title_ar") or c.get("doc_id") or "" for c in body.get("citations", [])
                    ]
                    row["citation"] = scoring.citation_scores(it["expected_docs"], cite_titles)
                    if do_judge:
                        row["grounded"] = _judge_groundedness(
                            q, body.get("answer", ""), body.get("citations", [])
                        )
            results.append(row)

    return results


def _print_report(results):
    print("\n=== per-item ===")
    for r in results:
        line = f"{r['id']:<22} {r.get('category',''):<18}"
        if "error" in r:
            line += f" ERROR: {r['error']}"
        elif "refusal_correct" in r:
            line += f" refusal={'OK' if r['refusal_correct'] else 'MISS'}"
        else:
            line += f" hit={r.get('hit')} rr={r.get('rr')}"
            line += f" kw={r.get('keyword_coverage')}"
            if r.get("citation"):
                line += f" cite_f1={r['citation']['f1']}"
            if r.get("grounded") is not None:
                line += f" grounded={r['grounded']}"
        print(line)

    scored = [r for r in results if "hit" in r]
    agg = scoring.aggregate(scored)
    refusals = [r for r in results if "refusal_correct" in r]
    print("\n=== aggregate ===")
    print(json.dumps(agg, ensure_ascii=False, indent=2))
    if refusals:
        ok = sum(1 for r in refusals if r["refusal_correct"])
        print(f"out-of-corpus refusal: {ok}/{len(refusals)} correct")


def main():
    p = argparse.ArgumentParser(description="Run the Second Brain Arabic Q&A eval.")
    p.add_argument("--base-url", default=os.getenv("EVAL_BASE_URL", "http://localhost:8000"))
    p.add_argument("--top-k", type=int, default=8)
    p.add_argument("--no-ask", action="store_true", help="retrieval metrics only (no /ask)")
    p.add_argument("--judge", action="store_true", help="LLM-as-judge groundedness (needs a key)")
    args = p.parse_args()
    results = run(args.base_url, args.top_k, do_ask=not args.no_ask, do_judge=args.judge)
    _print_report(results)


if __name__ == "__main__":
    main()
