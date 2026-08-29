"""Pure-logic tests for the article table-of-contents labels. No deps.

Covers the Arabic feminine-ordinal *formatter* that turns an article number into
its label (the inverse of ``parse_arabic_ordinal``), and its round-trip against
the parser where their vocabularies overlap. The HTTP ``GET /articles`` contract
(ordering + graceful-empty paths) lives in ``test_articles_endpoint.py``, which
skips when FastAPI / pydantic-settings are absent — these always run.
"""

from app.rag.article_chunking import (
    arabic_ordinal_feminine,
    format_article_label,
    parse_arabic_ordinal,
)


def test_arabic_ordinal_feminine_units_and_teens():
    assert arabic_ordinal_feminine(1) == "الأولى"
    assert arabic_ordinal_feminine(3) == "الثالثة"
    assert arabic_ordinal_feminine(10) == "العاشرة"
    assert arabic_ordinal_feminine(11) == "الحادية عشرة"
    assert arabic_ordinal_feminine(13) == "الثالثة عشرة"
    assert arabic_ordinal_feminine(15) == "الخامسة عشرة"
    assert arabic_ordinal_feminine(19) == "التاسعة عشرة"


def test_arabic_ordinal_feminine_tens_and_compounds():
    assert arabic_ordinal_feminine(20) == "العشرون"
    assert arabic_ordinal_feminine(21) == "الحادية والعشرون"
    assert arabic_ordinal_feminine(22) == "الثانية والعشرون"
    assert arabic_ordinal_feminine(30) == "الثلاثون"
    assert arabic_ordinal_feminine(35) == "الخامسة والثلاثون"
    assert arabic_ordinal_feminine(99) == "التاسعة والتسعون"
    assert arabic_ordinal_feminine(100) == "المائة"


def test_arabic_ordinal_feminine_out_of_range_returns_none():
    # Below 1, above the supported vocabulary, and non-ints get no fabricated
    # ordinal — the caller falls back to a digit form.
    assert arabic_ordinal_feminine(0) is None
    assert arabic_ordinal_feminine(-3) is None
    assert arabic_ordinal_feminine(101) is None
    assert arabic_ordinal_feminine(True) is None   # bool is not a real number here
    assert arabic_ordinal_feminine("3") is None
    assert arabic_ordinal_feminine(None) is None


def test_format_article_label_prefers_derived_ordinal():
    assert format_article_label(3) == "المادة الثالثة"
    assert format_article_label(13) == "المادة الثالثة عشرة"
    assert format_article_label(21) == "المادة الحادية والعشرون"
    # Canonicalises even when the ingest label used digits ("مادة ٥").
    assert format_article_label(5, "مادة ٥") == "المادة الخامسة"


def test_format_article_label_falls_back_to_digits_then_captured_label():
    # Out of the ordinal vocabulary -> honest digit form.
    assert format_article_label(105) == "مادة 105"
    # No number at all -> reuse the label captured at ingest, else bare مادة.
    assert format_article_label(None, "المادة الخاصة") == "المادة الخاصة"
    assert format_article_label(None, "") == "مادة"
    # A bool must not be mistaken for a number (isinstance(True, int) is True).
    assert format_article_label(True, "الباب") == "الباب"


def test_format_round_trips_through_parser_where_vocab_overlaps():
    # Every number the *parser* can read must survive format -> parse unchanged,
    # keeping the two ends of the pipeline consistent.
    for n in (1, 2, 3, 5, 9, 10, 13, 15, 20, 22, 30, 35):
        assert parse_arabic_ordinal(arabic_ordinal_feminine(n)) == n
