"""Unit tests for citation assembly + context building. Pure logic — no network."""

from app.rag.generator import assemble_citations, build_context

RETRIEVED = [
    {
        "doc_id": "d1",
        "title_ar": "نظام المنافسة",
        "title_en": "Competition Law",
        "snippet": "ملخص نظام المنافسة",
        "page": 3,
        "score": 0.91,
        "chunk_text": "نص المادة الأولى من نظام المنافسة",
    },
    {
        "doc_id": "d2",
        "title_ar": "نظام الاستثمار",
        "title_en": "Investment Law",
        "snippet": "ملخص نظام الاستثمار",
        "page": 7,
        "score": 0.80,
        "chunk_text": "نص المادة الثانية من نظام الاستثمار",
    },
    {
        "doc_id": "d3",
        "title_ar": "مجلة قضاء العدد 39",
        "title_en": "Qadaa Journal 39",
        "snippet": "حكم قضائي",
        "page": 12,
        "score": 0.72,
        "chunk_text": "نص حكم قضائي من مجلة قضاء",
    },
]


def test_assemble_citations_parses_markers():
    answer = "وفقاً للمصدر [1] وكذلك [3] فإن الحكم كذا."
    cites = assemble_citations(answer, RETRIEVED)
    assert [c["doc_id"] for c in cites] == ["d1", "d3"]
    assert cites[0]["page"] == 3
    assert cites[1]["title_ar"] == "مجلة قضاء العدد 39"


def test_assemble_citations_dedupes_and_sorts():
    answer = "[3] ثم [1] ثم [1] مرة أخرى ثم [3]."
    cites = assemble_citations(answer, RETRIEVED)
    assert [c["doc_id"] for c in cites] == ["d1", "d3"]


def test_assemble_citations_ignores_out_of_range():
    answer = "المصدر [9] غير موجود، لكن [2] موجود."
    cites = assemble_citations(answer, RETRIEVED)
    assert [c["doc_id"] for c in cites] == ["d2"]


def test_assemble_citations_fallback_when_no_markers():
    answer = "لا توجد أي إشارات مرجعية هنا."
    cites = assemble_citations(answer, RETRIEVED)
    assert len(cites) == 3  # transparent fallback to all retrieved


def test_assemble_citations_empty_retrieved():
    assert assemble_citations("لا شيء [1].", []) == []


def test_build_context_numbers_and_includes_sources():
    ctx = build_context(RETRIEVED)
    assert "[1]" in ctx and "[2]" in ctx and "[3]" in ctx
    assert "نظام المنافسة" in ctx
    assert "نص المادة الأولى من نظام المنافسة" in ctx
    # page marker is rendered
    assert "ص 3" in ctx
