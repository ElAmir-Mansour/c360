package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// DurationFactRepository owns the lex_duration_facts table — a processing-time
// fact store keyed by (tenant_id, kind, subject_id). It is populated by the
// reporting consumer (from lex CloudEvents and source-table reconstruction) and
// read back by reports for working-duration/SLA metrics. Request-processing facts
// are the CAP-151 source of truth for quarterly SLA compliance.
type DurationFactRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewDurationFactRepository(db *pgxpool.Pool, logger zerolog.Logger) *DurationFactRepository {
	return &DurationFactRepository{db: db, logger: logger.With().Str("repository", "lex-duration-fact").Logger()}
}

// Upsert idempotently writes one processing-time fact. A later transition for the
// same (kind, subject_id) refreshes the row in place (ON CONFLICT). The newer of
// the two rows wins on occurred_at so out-of-order events do not regress a fact.
func (r *DurationFactRepository) Upsert(ctx context.Context, fact *model.DurationFact) error {
	query := `
		INSERT INTO lex_duration_facts (
			id, tenant_id, kind, subject_id, department, category,
			started_at, ended_at, duration_minutes, working_minutes,
			sla_target_minutes, sla_outcome, occurred_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
		)
		ON CONFLICT (tenant_id, kind, subject_id) DO UPDATE SET
			department       = EXCLUDED.department,
			category         = EXCLUDED.category,
			started_at       = EXCLUDED.started_at,
			ended_at         = EXCLUDED.ended_at,
			duration_minutes = EXCLUDED.duration_minutes,
			working_minutes  = EXCLUDED.working_minutes,
			sla_target_minutes = EXCLUDED.sla_target_minutes,
			sla_outcome      = EXCLUDED.sla_outcome,
			occurred_at      = EXCLUDED.occurred_at,
			updated_at       = now()
		WHERE lex_duration_facts.occurred_at <= EXCLUDED.occurred_at
		RETURNING created_at, updated_at`
	err := r.db.QueryRow(ctx, query,
		fact.ID, fact.TenantID, fact.Kind, fact.SubjectID, fact.Department, fact.Category,
		fact.StartedAt, fact.EndedAt, fact.DurationMinutes, fact.WorkingMinutes,
		fact.SLATargetMinutes, durationFactSLAOutcomeValue(fact.SLAOutcome), fact.OccurredAt,
	).Scan(&fact.CreatedAt, &fact.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil
	}
	return err
}

func durationFactSLAOutcomeValue(outcome *model.SLAClockOutcome) any {
	if outcome == nil {
		return nil
	}
	return string(*outcome)
}

// AvgWorkingMinutes returns the average working-minutes and sample size for a kind
// across the optional [from,to] occurred_at window. Returns (0,0) when no facts
// match — callers fall back to the source-table computation.
func (r *DurationFactRepository) AvgWorkingMinutes(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, rf ReportFilter) (avg float64, sample int, err error) {
	filterSQL, filterArgs := rf.where("occurred_at", "department", "", "", 3)
	query := `
		SELECT COALESCE(AVG(working_minutes), 0)::float8 AS avg, COUNT(*) AS sample
		FROM lex_duration_facts
		WHERE tenant_id = $1 AND kind = $2` + filterSQL
	args := append([]any{tenantID, kind}, filterArgs...)
	if err := r.db.QueryRow(ctx, query, args...).Scan(&avg, &sample); err != nil {
		return 0, 0, err
	}
	return avg, sample, nil
}

// AvgWorkingMinutesByDepartment returns per-department average working-minutes for
// a kind across the window, ordered by sample size descending.
func (r *DurationFactRepository) AvgWorkingMinutesByDepartment(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, rf ReportFilter) ([]model.DurationFactAggregate, error) {
	filterSQL, filterArgs := rf.where("occurred_at", "department", "", "", 3)
	query := `
		SELECT COALESCE(NULLIF(department, ''), 'unspecified') AS bucket,
		       COUNT(*) AS sample,
		       COALESCE(AVG(working_minutes), 0)::float8 AS avg
		FROM lex_duration_facts
		WHERE tenant_id = $1 AND kind = $2` + filterSQL + `
		GROUP BY 1
		ORDER BY sample DESC, bucket ASC`
	args := append([]any{tenantID, kind}, filterArgs...)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]model.DurationFactAggregate, 0)
	for rows.Next() {
		var a model.DurationFactAggregate
		if err := rows.Scan(&a.Bucket, &a.SampleSize, &a.AvgWorkingMinutes); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// DurationFactSource is the reconstructed transition window for a subject when
// the terminal event carries only IDs. It keeps C-2 fact writing centralized in
// the reporting consumer without requiring sibling modules to duplicate payloads.
type DurationFactSource struct {
	Kind             model.DurationFactKind
	SubjectID        uuid.UUID
	Department       *string
	Category         *string
	StartedAt        time.Time
	EndedAt          time.Time
	SLATargetSeconds *int64
	SLAOutcome       *model.SLAClockOutcome
}

// LoadTransitionSource reconstructs the lifecycle bounds for the supported
// duration-fact kinds from their canonical source tables.
func (r *DurationFactRepository) LoadTransitionSource(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, subjectID uuid.UUID) (*DurationFactSource, error) {
	switch kind {
	case model.DurationFactRequestProcessing:
		return r.loadRequestProcessingSource(ctx, tenantID, subjectID)
	case model.DurationFactContractReview:
		return r.loadContractReviewSource(ctx, tenantID, subjectID)
	case model.DurationFactConsultationAnswer:
		return r.loadConsultationAnswerSource(ctx, tenantID, subjectID)
	case model.DurationFactCaseResolution:
		return r.loadCaseResolutionSource(ctx, tenantID, subjectID)
	default:
		return nil, pgx.ErrNoRows
	}
}

func (r *DurationFactRepository) loadRequestProcessingSource(ctx context.Context, tenantID uuid.UUID, requestID uuid.UUID) (*DurationFactSource, error) {
	query := `
		SELECT es.clock_started_at,
		       COALESCE(es.delivered_at, es.closed_at) AS ended_at,
		       lr.department,
		       lr.request_type,
		       es.sla_target_seconds,
		       sc.outcome
		FROM legal_request_execution_state es
		JOIN legal_requests lr
		  ON lr.tenant_id = es.tenant_id
		 AND lr.id = es.legal_request_id
		 AND lr.deleted_at IS NULL
		-- Current cycle only. A returned/resubmitted request owns one clock per
		-- round (000110); joining them all would emit one duration fact per round
		-- for a single delivery.
		LEFT JOIN (
			SELECT DISTINCT ON (tenant_id, legal_request_id) tenant_id, legal_request_id, outcome
			FROM legal_sla_clocks
			ORDER BY tenant_id, legal_request_id, cycle DESC
		) sc
		  ON sc.tenant_id = es.tenant_id
		 AND sc.legal_request_id = es.legal_request_id
		WHERE es.tenant_id = $1
		  AND es.legal_request_id = $2
		  AND es.clock_started_at IS NOT NULL
		  AND COALESCE(es.delivered_at, es.closed_at) IS NOT NULL`
	source, err := scanDurationFactSource(ctx, r.db, query, tenantID, requestID)
	if err != nil {
		return nil, err
	}
	source.Kind = model.DurationFactRequestProcessing
	source.SubjectID = requestID
	return source, nil
}

func (r *DurationFactRepository) loadContractReviewSource(ctx context.Context, tenantID uuid.UUID, contractID uuid.UUID) (*DurationFactSource, error) {
	query := `
		SELECT created_at,
		       status_changed_at,
		       department,
		       type,
		       NULL::bigint AS sla_target_seconds,
		       NULL::text AS sla_outcome
		FROM contracts
		WHERE tenant_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND status_changed_at IS NOT NULL
		  AND status_changed_at >= created_at
		  AND status IN ('active', 'renewed')`
	source, err := scanDurationFactSource(ctx, r.db, query, tenantID, contractID)
	if err != nil {
		return nil, err
	}
	source.Kind = model.DurationFactContractReview
	source.SubjectID = contractID
	return source, nil
}

func (r *DurationFactRepository) loadConsultationAnswerSource(ctx context.Context, tenantID uuid.UUID, consultationID uuid.UUID) (*DurationFactSource, error) {
	query := `
		SELECT created_at,
		       responded_at,
		       department,
		       type,
		       NULL::bigint AS sla_target_seconds,
		       NULL::text AS sla_outcome
		FROM legal_consultations
		WHERE tenant_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND responded_at IS NOT NULL
		  AND responded_at >= created_at`
	source, err := scanDurationFactSource(ctx, r.db, query, tenantID, consultationID)
	if err != nil {
		return nil, err
	}
	source.Kind = model.DurationFactConsultationAnswer
	source.SubjectID = consultationID
	return source, nil
}

func (r *DurationFactRepository) loadCaseResolutionSource(ctx context.Context, tenantID uuid.UUID, caseID uuid.UUID) (*DurationFactSource, error) {
	query := `
		SELECT created_at,
		       updated_at,
		       department,
		       case_type,
		       NULL::bigint AS sla_target_seconds,
		       NULL::text AS sla_outcome
		FROM legal_cases
		WHERE tenant_id = $1
		  AND id = $2
		  AND deleted_at IS NULL
		  AND status = 'closed'
		  AND updated_at >= created_at`
	source, err := scanDurationFactSource(ctx, r.db, query, tenantID, caseID)
	if err != nil {
		return nil, err
	}
	source.Kind = model.DurationFactCaseResolution
	source.SubjectID = caseID
	return source, nil
}

func scanDurationFactSource(ctx context.Context, q Queryer, query string, tenantID uuid.UUID, subjectID uuid.UUID) (*DurationFactSource, error) {
	var (
		startedAt time.Time
		endedAt   time.Time
		dept      sql.NullString
		category  sql.NullString
		target    sql.NullInt64
		outcome   sql.NullString
	)
	if err := q.QueryRow(ctx, query, tenantID, subjectID).Scan(&startedAt, &endedAt, &dept, &category, &target, &outcome); err != nil {
		return nil, err
	}
	source := &DurationFactSource{
		Department: optionalTrimmedString(dept),
		Category:   optionalTrimmedString(category),
		StartedAt:  startedAt.UTC(),
		EndedAt:    endedAt.UTC(),
	}
	if target.Valid {
		v := target.Int64
		source.SLATargetSeconds = &v
	}
	if parsed := optionalSLAOutcome(outcome); parsed != nil {
		source.SLAOutcome = parsed
	}
	return source, nil
}

func optionalTrimmedString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	out := strings.TrimSpace(value.String)
	if out == "" {
		return nil
	}
	return &out
}

func optionalSLAOutcome(value sql.NullString) *model.SLAClockOutcome {
	if !value.Valid {
		return nil
	}
	outcome := model.SLAClockOutcome(strings.TrimSpace(value.String))
	if !outcome.Valid() {
		return nil
	}
	return &outcome
}
