"""Unit tests for Arabic-aware chunking. Pure logic — no network, no heavy deps."""

from app.rag.chunking import chunk_pages, chunk_units, split_sentences

ARABIC = (
    "نظام الاستثمار في المملكة العربية السعودية يهدف إلى تنظيم الاستثمار. "
    "تسري أحكام هذا النظام على جميع المستثمرين في المملكة. "
    "يجب على المستثمر الالتزام باللوائح التنفيذية الصادرة. "
)


def test_split_sentences_arabic():
    sentences = split_sentences(ARABIC * 2)
    assert len(sentences) >= 3
    assert all(s.strip() for s in sentences)


def test_split_sentences_empty():
    assert split_sentences("") == []
    assert split_sentences("   \n  \n ") == []


def test_chunk_units_respects_max_chars():
    sentences = split_sentences(ARABIC * 10)
    chunks = chunk_units(sentences, max_chars=200, overlap=50)
    assert chunks
    assert all(len(c) <= 200 for c in chunks)


def test_chunk_units_overlap_shares_text():
    sentences = [f"هذه الجملة رقم {i} في النص." for i in range(40)]
    chunks = chunk_units(sentences, max_chars=120, overlap=60)
    assert len(chunks) >= 2
    overlaps = 0
    for a, b in zip(chunks, chunks[1:]):
        tail = a.split()[-2:]
        if tail and " ".join(tail) in b:
            overlaps += 1
    assert overlaps >= 1, "expected adjacent chunks to share overlap text"


def test_chunk_units_hard_splits_long_sentence():
    long_sentence = "ألف" * 500  # single token far larger than max_chars
    chunks = chunk_units([long_sentence], max_chars=100, overlap=20)
    assert len(chunks) >= 2
    assert all(len(c) <= 100 for c in chunks)


def test_chunk_pages_carries_metadata_and_pages():
    meta = {
        "doc_id": "nizam-istithmar",
        "title_ar": "نظام الاستثمار",
        "title_en": "Investment Law",
        "category": "systems-regulations",
        "doc_type": "system",
        "authority": "وزارة الاستثمار",
        "tags": ["استثمار"],
        "metadata": {"issue": None},
    }
    pages = [(1, ARABIC * 3), (2, ARABIC * 3)]
    chunks = chunk_pages(pages, meta, max_chars=200, overlap=40)

    assert chunks
    assert {c.page for c in chunks} == {1, 2}
    assert all(c.doc_id == "nizam-istithmar" for c in chunks)
    assert all(c.title_ar == "نظام الاستثمار" for c in chunks)
    assert all(c.category == "systems-regulations" for c in chunks)
    # chunk_index is globally sequential and unique across pages.
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))


def test_chunk_pages_skips_empty_pages():
    meta = {"doc_id": "d", "title_ar": "ت"}
    chunks = chunk_pages([(1, ""), (2, "جملة واحدة فقط.")], meta)
    assert all(c.page == 2 for c in chunks)
    assert chunks
