package repository

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// Reports upgrade — contract analytics v2 reads. All methods here are
// READ-only tenant-scoped aggregates over the contracts source table (plus
// lex_duration_facts for the audit-event-derived cycle-time refinement) and
// follow the same parameterized ReportFilter conventions as reporting_repo.go.

// ContractValueByDimension returns per-key contract value rollups with a
// currency split: SUM(total_value) grouped by the given column and currency,
// folded into one ValueBucket per key. col is a trusted, hard-coded column
// name ("type" or "department" — same convention as groupCount). Buckets are
// ordered by total value descending, then key ascending.
func (r *ReportingRepository) ContractValueByDimension(ctx context.Context, tenantID uuid.UUID, col string, rf ReportFilter) ([]model.ValueBucket, error) {
	filterSQL, filterArgs := rf.where("created_at", "department", "status", "type", 2)
	query := "SELECT COALESCE(NULLIF(" + col + "::text, ''), 'unspecified') AS k," +
		" COALESCE(NULLIF(currency, ''), 'SAR') AS cur," +
		" COUNT(*) AS c," +
		" COALESCE(SUM(total_value), 0)::float8 AS v" +
		" FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL" + filterSQL +
		" GROUP BY 1, 2 ORDER BY 1 ASC, 2 ASC"
	args := append([]any{tenantID}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	index := map[string]int{}
	out := make([]model.ValueBucket, 0)
	for rows.Next() {
		var (
			key, currency string
			count         int
			value         float64
		)
		if err := rows.Scan(&key, &currency, &count, &value); err != nil {
			return nil, err
		}
		i, ok := index[key]
		if !ok {
			out = append(out, model.ValueBucket{Key: key, ByCurrency: map[string]float64{}})
			i = len(out) - 1
			index[key] = i
		}
		out[i].Count += count
		out[i].TotalValue += value
		out[i].ByCurrency[currency] += value
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].TotalValue != out[j].TotalValue {
			return out[i].TotalValue > out[j].TotalValue
		}
		return out[i].Key < out[j].Key
	})
	return out, nil
}

// ContractValueTotals returns the overall SUM(total_value) for the filtered
// scope plus the per-currency split of the same sum. The total is a raw sum
// across currencies — no FX conversion is applied.
func (r *ReportingRepository) ContractValueTotals(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (total float64, byCurrency map[string]float64, err error) {
	filterSQL, filterArgs := rf.where("created_at", "department", "status", "type", 2)
	query := "SELECT COALESCE(NULLIF(currency, ''), 'SAR') AS cur," +
		" COALESCE(SUM(total_value), 0)::float8 AS v" +
		" FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL" + filterSQL +
		" GROUP BY 1 ORDER BY 1 ASC"
	args := append([]any{tenantID}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	byCurrency = map[string]float64{}
	for rows.Next() {
		var (
			currency string
			value    float64
		)
		if err := rows.Scan(&currency, &value); err != nil {
			return 0, nil, err
		}
		byCurrency[currency] += value
		total += value
	}
	return total, byCurrency, rows.Err()
}

// ContractExpiryCliff buckets live contracts by expiry month over
// [start, start+months). Contracts in a terminal status that can no longer
// expire (terminated/cancelled) are excluded. rf's created_at window is
// intentionally NOT applied — the cliff is anchored on the forward expiry
// horizon — but department/status/type scope filters still apply. Rows are
// sparse; the service zero-fills the series.
func (r *ReportingRepository) ContractExpiryCliff(ctx context.Context, tenantID uuid.UUID, start time.Time, months int, rf ReportFilter) ([]model.ExpiryCliffPoint, error) {
	filterSQL, filterArgs := rf.where("", "department", "status", "type", 4)
	end := start.AddDate(0, months, 0)
	query := `
		SELECT to_char(date_trunc('month', expiry_date), 'YYYY-MM') AS month,
		       COUNT(*) AS c,
		       COALESCE(SUM(total_value), 0)::float8 AS v
		FROM contracts
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND expiry_date IS NOT NULL
		  AND expiry_date >= $2
		  AND expiry_date < $3
		  AND status NOT IN ('terminated', 'cancelled')` + filterSQL + `
		GROUP BY 1
		ORDER BY 1 ASC`
	args := append([]any{tenantID, start, end}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.ExpiryCliffPoint, 0)
	for rows.Next() {
		var p model.ExpiryCliffPoint
		if err := rows.Scan(&p.Month, &p.Count, &p.Value); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ContractCycleTimeFromTimeline computes draft->active cycle-time stats
// (avg/p50/p90 in DAYS plus the sample size) from the contracts status
// timeline: created_at -> status_changed_at for contracts that reached an
// active/approved lifecycle state — the same primary source CAP-140 uses for
// the review-duration average.
func (r *ReportingRepository) ContractCycleTimeFromTimeline(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (avgDays, p50Days, p90Days float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("created_at", "department", "", "type", 2)
	query := `
		SELECT COALESCE(AVG(days), 0)::float8 AS avg_days,
		       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days), 0)::float8 AS p50_days,
		       COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY days), 0)::float8 AS p90_days,
		       COUNT(*) AS sample
		FROM (
			SELECT EXTRACT(EPOCH FROM (status_changed_at - created_at)) / 86400.0 AS days
			FROM contracts
			WHERE tenant_id = $1
			  AND deleted_at IS NULL
			  AND status_changed_at IS NOT NULL
			  AND status_changed_at >= created_at
			  AND status IN ('active', 'renewed')` + filterSQL + `
		) samples`
	args := append([]any{tenantID}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avgDays, &p50Days, &p90Days, &sample); err != nil {
		return 0, 0, 0, 0, err
	}
	return avgDays, p50Days, p90Days, sample, nil
}

// ContractCycleTimeFromFacts computes the same draft->active cycle-time stats
// from lex_duration_facts kind=contract_review — the CloudEvents/audit-event
// derived fact store. Wall-clock duration_minutes is used (converted to days)
// so the units match the status-timeline fallback. The service prefers these
// stats whenever facts exist (same refinement pattern as AverageWorkingHours).
func (r *ReportingRepository) ContractCycleTimeFromFacts(ctx context.Context, tenantID uuid.UUID, rf ReportFilter) (avgDays, p50Days, p90Days float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("started_at", "department", "", "category", 3)
	query := `
		SELECT COALESCE(AVG(duration_minutes), 0)::float8 / 1440.0 AS avg_days,
		       COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_minutes), 0)::float8 / 1440.0 AS p50_days,
		       COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration_minutes), 0)::float8 / 1440.0 AS p90_days,
		       COUNT(*) AS sample
		FROM lex_duration_facts
		WHERE tenant_id = $1
		  AND kind = $2` + filterSQL
	args := append([]any{tenantID, model.DurationFactContractReview}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avgDays, &p50Days, &p90Days, &sample); err != nil {
		return 0, 0, 0, 0, err
	}
	return avgDays, p50Days, p90Days, sample, nil
}
