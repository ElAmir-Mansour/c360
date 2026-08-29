"""Unit tests for article-aware Saudi-legal chunking. Pure logic, no deps."""

from app.rag.article_chunking import (
    article_chunk_pages,
    build_article_index,
    parse_arabic_ordinal,
    segment_page,
)

STATUTE_P1 = (
    "نظام الاستثمار\n"
    "الباب الأول: التعريفات\n"
    "المادة الأولى:\n"
    "يقصد بالمستثمر كل شخص طبيعي أو اعتباري يمارس نشاطًا استثماريًا.\n"
    "المادة الثانية:\n"
    "تسري أحكام هذا النظام على جميع المستثمرين في المملكة العربية السعودية."
)
STATUTE_P2 = (
    "ويشمل ذلك الاستثمار الأجنبي والمحلي على حد سواء.\n"
    "الفصل الثاني: الأحكام العامة\n"
    "المادة الثالثة عشرة:\n"
    "على المستثمر الالتزام باللوائح التنفيذية الصادرة."
)


def test_parse_arabic_ordinal_words():
    assert parse_arabic_ordinal("الأولى") == 1
    assert parse_arabic_ordinal("الاولى") == 1  # hamza-folded variant
    assert parse_arabic_ordinal("العاشرة") == 10
    assert parse_arabic_ordinal("الخامسة عشرة") == 15
    assert parse_arabic_ordinal("الثانية والعشرون") == 22
    assert parse_arabic_ordinal("الخامسة والثلاثون") == 35
    assert parse_arabic_ordinal("المائة") == 100


def test_parse_arabic_ordinal_digits():
    assert parse_arabic_ordinal("(5)") == 5
    assert parse_arabic_ordinal("١٢") == 12       # Arabic-Indic
    assert parse_arabic_ordinal("12") == 12
    assert parse_arabic_ordinal("لا يوجد رقم") is None


def test_segment_page_detects_articles_and_headings():
    segs = segment_page(STATUTE_P1)
    kinds = [s.kind for s in segs]
    assert "heading" in kinds and kinds.count("article") == 2
    articles = [s for s in segs if s.kind == "article"]
    assert articles[0].article_no == 1 and articles[0].article_label == "المادة الأولى"
    assert articles[1].article_no == 2
    # The article body must not swallow the next article's header.
    assert "المادة الثانية" not in articles[0].text


def test_inline_article_reference_is_not_a_boundary():
    # A mid-line reference (not at line start, no colon) must NOT split.
    txt = "تنص المادة الأولى من النظام على أحكام مهمة تخص المستثمر الأجنبي."
    segs = segment_page(txt)
    assert len(segs) == 1 and segs[0].kind == "preamble"


def test_article_chunk_pages_carries_locus_across_page_break():
    meta = {"doc_id": "nizam-istithmar", "title_ar": "نظام الاستثمار",
            "category": "systems-regulations", "doc_type": "system"}
    chunks = article_chunk_pages([(1, STATUTE_P1), (2, STATUTE_P2)], meta, max_chars=200, overlap=40)
    assert chunks
    # Article 2 continues onto page 2 with its label + part preserved.
    p2_cont = [c for c in chunks if c.page == 2 and c.article_no == 2]
    assert p2_cont, "article 2 should continue on page 2"
    assert all(c.part == "الباب الأول" for c in p2_cont)
    # Article 13 on page 2 sits under the second chapter.
    a13 = [c for c in chunks if c.article_no == 13]
    assert a13 and a13[0].chapter == "الفصل الثاني"
    # Global, contiguous chunk indices.
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_build_article_index():
    meta = {"doc_id": "d", "title_ar": "نظام"}
    chunks = article_chunk_pages([(1, STATUTE_P1), (2, STATUTE_P2)], meta, max_chars=200, overlap=40)
    index = build_article_index(chunks)
    labels = {row["article_label"] for row in index}
    assert "المادة الأولى" in labels and "المادة الثالثة عشرة" in labels
    a2 = next(r for r in index if r["article_no"] == 2)
    assert a2["first_page"] == 1 and a2["chunk_count"] >= 1


def test_no_markers_falls_back_to_page_chunking():
    # Research text with no legal structure -> everything is preamble (safe).
    meta = {"doc_id": "research-1", "title_ar": "بحث"}
    text = ("هذا بحث قانوني حول العلامة التجارية. " * 5).strip()
    chunks = article_chunk_pages([(1, text)], meta, max_chars=120, overlap=20)
    assert chunks
    assert all(c.article_no is None and c.article_label == "" for c in chunks)
    assert {c.page for c in chunks} == {1}
