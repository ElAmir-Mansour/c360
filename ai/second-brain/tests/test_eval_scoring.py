"""Unit tests for eval scoring metrics. Pure logic, no deps."""

from eval import scoring


def test_normalize_ar_folds_variants():
    assert scoring.normalize_ar("الأحكام") == scoring.normalize_ar("الاحكام")
    assert scoring.normalize_ar("قضـاء") == scoring.normalize_ar("قضاء")  # tatweel stripped


def test_matches_any_substring():
    assert scoring.matches_any(["نظام الاستثمار"], "نظام الاستثمار ولائحته التنفيذية")
    assert not scoring.matches_any(["نظام المنافسة"], "نظام المحاماة")


def test_retrieval_hit_and_rr():
    ranked = ["نظام المحاماة", "نظام الاستثمار ولائحته", "مجلة قضاء 40"]
    assert scoring.retrieval_hit(["نظام الاستثمار"], ranked)
    assert scoring.reciprocal_rank(["نظام الاستثمار"], ranked) == 0.5  # rank 2
    assert scoring.reciprocal_rank(["غير موجود"], ranked) == 0.0


def test_keyword_coverage():
    text = "تسري أحكام نظام الاستثمار على المستثمر الأجنبي"
    assert scoring.keyword_coverage(["الاستثمار", "المستثمر"], text) == 1.0
    assert scoring.keyword_coverage(["الاستثمار", "غائب"], text) == 0.5
    assert scoring.keyword_coverage([], text) == 1.0


def test_citation_scores_precision_recall_f1():
    expected = ["نظام الاستثمار", "نظام المنافسة"]
    got = ["نظام الاستثمار ولائحته", "مجلة قضاء 40"]  # 1 relevant, 1 not
    s = scoring.citation_scores(expected, got)
    assert s["precision"] == 0.5   # 1 of 2 citations relevant
    assert s["recall"] == 0.5      # 1 of 2 expected docs covered
    assert 0 < s["f1"] < 1


def test_citation_scores_perfect_and_empty():
    assert scoring.citation_scores([], [])["f1"] == 1.0
    perfect = scoring.citation_scores(["نظام الاستثمار"], ["نظام الاستثمار ولائحته"])
    assert perfect["precision"] == 1.0 and perfect["recall"] == 1.0 and perfect["f1"] == 1.0


def test_aggregate():
    items = [
        {"hit": True, "rr": 1.0, "keyword_coverage": 1.0, "citation": {"f1": 0.8}, "grounded": 1.0},
        {"hit": False, "rr": 0.0, "keyword_coverage": 0.5, "citation": {"f1": 0.0}, "grounded": 0.0},
    ]
    agg = scoring.aggregate(items)
    assert agg["n"] == 2
    assert agg["retrieval_hit_rate"] == 0.5
    assert agg["mrr"] == 0.5
    assert agg["citation_f1"] == 0.4
    assert agg["groundedness"] == 0.5
