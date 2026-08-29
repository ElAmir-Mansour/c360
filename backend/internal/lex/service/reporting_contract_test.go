package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

func TestMonthStartUTC(t *testing.T) {
	in := time.Date(2026, 7, 9, 15, 45, 30, 123, time.FixedZone("AST", 3*3600))
	got := monthStartUTC(in)
	want := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("monthStartUTC = %s, want %s", got, want)
	}
}

func TestFillExpiryCliffZeroFillsAndRounds(t *testing.T) {
	start := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	out := fillExpiryCliff([]model.ExpiryCliffPoint{
		{Month: "2026-08", Count: 2, Value: 1234.567},
		{Month: "2028-06", Count: 1, Value: 50000},
	}, start, contractExpiryCliffMonths)

	if len(out) != contractExpiryCliffMonths {
		t.Fatalf("len = %d, want %d", len(out), contractExpiryCliffMonths)
	}
	if out[0].Month != "2026-07" || out[0].Count != 0 || out[0].Value != 0 {
		t.Fatalf("first point = %+v, want zero-filled 2026-07", out[0])
	}
	if out[1].Month != "2026-08" || out[1].Count != 2 || out[1].Value != 1234.57 {
		t.Fatalf("second point = %+v, want 2026-08 count=2 value=1234.57", out[1])
	}
	if last := out[len(out)-1]; last.Month != "2028-06" || last.Count != 1 || last.Value != 50000 {
		t.Fatalf("last point = %+v, want 2028-06 count=1 value=50000", last)
	}
	// The 22 in-between months (index 2..22) are dense and zero-filled.
	for i := 2; i < len(out)-1; i++ {
		if out[i].Count != 0 || out[i].Value != 0 {
			t.Fatalf("point %d (%s) = %+v, want zero-filled", i, out[i].Month, out[i])
		}
	}
}

func TestRoundValueBucketsAndCurrencyMap(t *testing.T) {
	buckets := roundValueBuckets([]model.ValueBucket{{
		Key:        "vendor",
		Count:      3,
		TotalValue: 100.006,
		ByCurrency: map[string]float64{"SAR": 99.999, "USD": 0.006},
	}, {
		Key:        "nda",
		Count:      1,
		TotalValue: 0,
		ByCurrency: nil,
	}})

	if buckets[0].TotalValue != 100.01 {
		t.Fatalf("TotalValue = %v, want 100.01", buckets[0].TotalValue)
	}
	if buckets[0].ByCurrency["SAR"] != 100.0 || buckets[0].ByCurrency["USD"] != 0.01 {
		t.Fatalf("ByCurrency = %+v, want rounded 2dp", buckets[0].ByCurrency)
	}
	if buckets[1].ByCurrency == nil || len(buckets[1].ByCurrency) != 0 {
		t.Fatalf("nil ByCurrency = %+v, want normalized empty map", buckets[1].ByCurrency)
	}
}

func TestContractCycleTimeStatsRoundsAndTagsSource(t *testing.T) {
	stats := contractCycleTimeStats(4.5678, 3.001, 9.999, 17, model.CycleTimeSourceDurationFacts)
	if stats.AvgDays != 4.57 || stats.P50Days != 3.0 || stats.P90Days != 10.0 {
		t.Fatalf("stats = %+v, want rounded 2dp", stats)
	}
	if stats.SampleSize != 17 || stats.Source != model.CycleTimeSourceDurationFacts {
		t.Fatalf("stats = %+v, want sample=17 source=duration_facts", stats)
	}
}
