package service

import (
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

// Reports upgrade — contract analytics v2 pure helpers. The DB fan-out lives
// in ReportingService.ContractReport (reporting_service.go); everything here
// is side-effect free so it can be unit-tested without a database.

// contractExpiryCliffMonths is the fixed forward horizon of the expiry-cliff
// series (24 months, anchored on the month the report is generated in).
const contractExpiryCliffMonths = 24

// monthStartUTC truncates t to the first instant of its UTC calendar month.
func monthStartUTC(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// fillExpiryCliff densifies the sparse per-month repository rows into a
// continuous months-long series starting at start (zero count/value for months
// with no expiring contracts) so charts render a complete axis. Values are
// rounded to 2dp.
func fillExpiryCliff(points []model.ExpiryCliffPoint, start time.Time, months int) []model.ExpiryCliffPoint {
	byMonth := make(map[string]model.ExpiryCliffPoint, len(points))
	for _, p := range points {
		byMonth[p.Month] = p
	}
	out := make([]model.ExpiryCliffPoint, 0, months)
	for i := 0; i < months; i++ {
		month := start.AddDate(0, i, 0).Format("2006-01")
		if p, ok := byMonth[month]; ok {
			out = append(out, model.ExpiryCliffPoint{Month: month, Count: p.Count, Value: round2(p.Value)})
			continue
		}
		out = append(out, model.ExpiryCliffPoint{Month: month})
	}
	return out
}

// roundValueBuckets rounds every monetary figure in the buckets to 2dp
// (in place; returns the slice for call-site brevity).
func roundValueBuckets(buckets []model.ValueBucket) []model.ValueBucket {
	for i := range buckets {
		buckets[i].TotalValue = round2(buckets[i].TotalValue)
		buckets[i].ByCurrency = roundCurrencyMap(buckets[i].ByCurrency)
	}
	return buckets
}

// roundCurrencyMap rounds each per-currency sum to 2dp, normalizing nil to an
// empty map so the JSON payload is always `{}` rather than `null`.
func roundCurrencyMap(values map[string]float64) map[string]float64 {
	if values == nil {
		return map[string]float64{}
	}
	for k, v := range values {
		values[k] = round2(v)
	}
	return values
}

// contractCycleTimeStats assembles a rounded cycle-time stats block for the
// given source.
func contractCycleTimeStats(avgDays, p50Days, p90Days float64, sample int, source string) *model.ContractCycleTimeStats {
	return &model.ContractCycleTimeStats{
		AvgDays:    round2(avgDays),
		P50Days:    round2(p50Days),
		P90Days:    round2(p90Days),
		SampleSize: sample,
		Source:     source,
	}
}
