package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SLAClockRepository owns the per-request materialised deadline set. SLA owns the
// clock row, the ack/breach flags and the escalation level; Execution owns
// clock_started_at (passed in at materialisation).
type SLAClockRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSLAClockRepository(db *pgxpool.Pool, logger zerolog.Logger) *SLAClockRepository {
	return &SLAClockRepository{db: db, logger: logger}
}

// Create materialises a clock for one submission cycle. The unique index on
// (tenant, legal_request_id, cycle) makes re-materialisation of the SAME cycle an
// ON CONFLICT DO NOTHING (returns pgx.ErrNoRows so the service can treat a
// repeated clock-start signal idempotently), while still allowing a later cycle
// after a return/resubmit. A second LIVE clock is separately impossible: the
// partial unique index on outcome = 'pending' rejects it.
func (r *SLAClockRepository) Create(ctx context.Context, q Queryer, clock *model.SLAClock) error {
	// metadata is NOT NULL; default a nil map to '{}' so a clock started without
	// metadata never violates the constraint (mirrors legal_requests/legal_cases).
	metaJSON, err := json.Marshal(orEmptyMap(clock.Metadata))
	if err != nil {
		return fmt.Errorf("marshal sla clock metadata: %w", err)
	}
	query := `
		INSERT INTO legal_sla_clocks (
			id, tenant_id, legal_request_id, sla_target_id, service_code, priority,
			beneficiary_entity_id, clock_started_at, ack_due_at,
			turnaround_from_due_at, turnaround_due_at,
			escalation_l1_due_at, escalation_l2_due_at, escalation_l3_due_at,
			ack_done, ack_done_at, escalation_level, breached, breached_at, outcome,
			resolved_at, cycle, stopped_at, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,
			$10,$11,
			$12,$13,$14,
			$15,$16,$17,$18,$19,$20,
			$21,$22,$23,$24::jsonb,$25
		)
		ON CONFLICT (tenant_id, legal_request_id, cycle) DO NOTHING
		RETURNING created_at, updated_at`
	err = q.QueryRow(ctx, query,
		clock.ID, clock.TenantID, clock.LegalRequestID, clock.SLATargetID, clock.ServiceCode, clock.Priority,
		clock.BeneficiaryEntityID, clock.ClockStartedAt.UTC(), clock.AckDueAt.UTC(),
		utcPtr(clock.TurnaroundFromDueAt), clock.TurnaroundDueAt.UTC(),
		clock.EscalationL1DueAt.UTC(), clock.EscalationL2DueAt.UTC(), clock.EscalationL3DueAt.UTC(),
		clock.AckDone, clock.AckDoneAt, clock.EscalationLevel, clock.Breached, clock.BreachedAt, clock.Outcome,
		clock.ResolvedAt, orFirstCycle(clock.Cycle), utcPtr(clock.StoppedAt), metaJSON, clock.CreatedBy,
	).Scan(&clock.CreatedAt, &clock.UpdatedAt)
	return err
}

// orFirstCycle defaults an unset cycle to 1 so a caller that predates the
// return/resubmit work (or a struct-literal test) still materialises a valid
// first-cycle clock rather than violating the cycle >= 1 CHECK.
func orFirstCycle(cycle int) int {
	if cycle < 1 {
		return 1
	}
	return cycle
}

func (r *SLAClockRepository) Get(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (*model.SLAClock, error) {
	query := slaClockJSONSelect(`c.tenant_id = $1 AND c.id = $2`)
	return queryRowJSON[model.SLAClock](ctx, q, query, tenantID, id)
}

// GetByRequest returns the request's CURRENT clock — the highest cycle. Since
// 000110 a request may own several (one per submission round), so this is
// explicitly ordered rather than relying on a unique index that no longer
// exists; without the ORDER BY it would return an arbitrary historical cycle.
func (r *SLAClockRepository) GetByRequest(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID) (*model.SLAClock, error) {
	query := slaClockJSONSelect(`c.tenant_id = $1 AND c.legal_request_id = $2`) +
		` ORDER BY t.cycle DESC LIMIT 1`
	return queryRowJSON[model.SLAClock](ctx, q, query, tenantID, legalRequestID)
}

// GetActiveByRequest returns the request's LIVE clock, or pgx.ErrNoRows when the
// SLA is not currently running — which is the normal state while the request
// sits with the requester after a return. Callers that must not act on a stopped
// cycle (breach evaluation, resolution, restart) use this rather than
// GetByRequest.
func (r *SLAClockRepository) GetActiveByRequest(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID) (*model.SLAClock, error) {
	query := slaClockJSONSelect(
		`c.tenant_id = $1 AND c.legal_request_id = $2 AND c.outcome = 'pending'`)
	return queryRowJSON[model.SLAClock](ctx, q, query, tenantID, legalRequestID)
}

// MaxCycle reports the highest cycle materialised for a request, or 0 when none
// exists. The restart path adds one to this rather than counting rows, so a
// deleted or skipped cycle can never collide with a live one.
func (r *SLAClockRepository) MaxCycle(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID) (int, error) {
	var maxCycle int
	err := q.QueryRow(ctx, `
		SELECT COALESCE(MAX(cycle), 0) FROM legal_sla_clocks
		WHERE tenant_id = $1 AND legal_request_id = $2`,
		tenantID, legalRequestID,
	).Scan(&maxCycle)
	return maxCycle, err
}

// StopActiveForRequest halts the live cycle because the request was returned to
// the requester. It is a no-op returning pgx.ErrNoRows when nothing is running,
// so a return from a state that never started a clock (e.g. a pre-approval
// bounce) is not an error.
//
// The clock is NOT resolved: resolved_at stays NULL and the outcome becomes
// 'stopped', keeping the cycle out of both the on-time and breached aggregates.
func (r *SLAClockRepository) StopActiveForRequest(ctx context.Context, q Queryer, tenantID, legalRequestID uuid.UUID, stoppedAt time.Time) (*model.SLAClock, error) {
	query := `
		UPDATE legal_sla_clocks
		SET outcome = 'stopped', stopped_at = $3, updated_at = now()
		WHERE tenant_id = $1 AND legal_request_id = $2 AND outcome = 'pending'
		RETURNING id`
	var id uuid.UUID
	if err := q.QueryRow(ctx, query, tenantID, legalRequestID, stoppedAt.UTC()).Scan(&id); err != nil {
		return nil, err
	}
	return r.Get(ctx, q, tenantID, id)
}

// ListDue returns unresolved clocks for a tenant whose ack/turnaround/escalation
// rungs may have come due as of asOf. The monitor scans these and dispatches
// idempotent outbox rows; the breach/escalation state machine itself is applied
// by the service.
func (r *SLAClockRepository) ListDue(ctx context.Context, tenantID uuid.UUID, asOf time.Time, limit int) ([]model.SLAClock, error) {
	if limit <= 0 {
		limit = 500
	}
	// outcome = 'pending' (not merely resolved_at IS NULL) is load-bearing: a
	// cycle STOPPED by a return also has a NULL resolved_at, and scanning it would
	// let the clock keep breaching and escalating while the request sits with the
	// requester — the exact defect the return/resubmit work removes.
	query := slaClockJSONSelect(`
		c.tenant_id = $1
		AND c.outcome = 'pending'
		AND c.resolved_at IS NULL
		AND (
			(NOT c.ack_done AND c.ack_due_at <= $2)
			OR (NOT c.breached AND c.turnaround_due_at <= $2)
			OR (c.breached AND c.escalation_level < 1 AND c.escalation_l1_due_at <= $2)
			OR (c.breached AND c.escalation_level < 2 AND c.escalation_l2_due_at <= $2)
			OR (c.breached AND c.escalation_level < 3 AND c.escalation_l3_due_at <= $2)
		)
	`) + ` ORDER BY t.turnaround_due_at ASC, t.created_at ASC LIMIT $3`
	return queryListJSON[model.SLAClock](ctx, r.db, query, tenantID, asOf.UTC(), limit)
}

// MarkAck records that the request was acknowledged in time (CAP-013/014).
func (r *SLAClockRepository) MarkAck(ctx context.Context, q Queryer, tenantID, clockID uuid.UUID, ackedAt time.Time) (*model.SLAClock, error) {
	query := `
		WITH updated AS (
			UPDATE legal_sla_clocks
			SET ack_done = true,
			    ack_done_at = $3,
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND ack_done = false
			RETURNING *
	)
	` + slaClockJSONFrom("updated")
	clock, err := queryRowJSON[model.SLAClock](ctx, q, query, tenantID, clockID, ackedAt.UTC())
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return clock, err
}

// MarkBreached flips the breach flag and sets the terminal outcome.
func (r *SLAClockRepository) MarkBreached(ctx context.Context, q Queryer, tenantID, clockID uuid.UUID, breachedAt time.Time) (*model.SLAClock, error) {
	query := `
		WITH updated AS (
			UPDATE legal_sla_clocks
			SET breached = true,
			    breached_at = $3,
			    outcome = 'breached',
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND breached = false
			RETURNING *
	)
	` + slaClockJSONFrom("updated")
	clock, err := queryRowJSON[model.SLAClock](ctx, q, query, tenantID, clockID, breachedAt.UTC())
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return clock, err
}

// AdvanceEscalation raises the escalation level to the supplied rung. The guard
// (escalation_level < $3) makes the advance idempotent against the monitor.
func (r *SLAClockRepository) AdvanceEscalation(ctx context.Context, q Queryer, tenantID, clockID uuid.UUID, level int) (*model.SLAClock, error) {
	query := `
		WITH updated AS (
			UPDATE legal_sla_clocks
			SET escalation_level = $3,
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND escalation_level < $3
			RETURNING *
	)
	` + slaClockJSONFrom("updated")
	clock, err := queryRowJSON[model.SLAClock](ctx, q, query, tenantID, clockID, level)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return clock, err
}

// Resolve closes the clock with an on-time or breached outcome (e.g. when the
// request is delivered/closed by Execution via the CloudEvent seam).
func (r *SLAClockRepository) Resolve(ctx context.Context, q Queryer, tenantID, clockID uuid.UUID, outcome model.SLAClockOutcome, resolvedAt time.Time) (*model.SLAClock, error) {
	query := `
		WITH updated AS (
			UPDATE legal_sla_clocks
			SET outcome = $3,
			    resolved_at = $4,
			    breached = CASE WHEN $3 = 'breached' THEN true ELSE breached END,
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND resolved_at IS NULL
			RETURNING *
	)
	` + slaClockJSONFrom("updated")
	clock, err := queryRowJSON[model.SLAClock](ctx, q, query, tenantID, clockID, outcome, resolvedAt.UTC())
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return clock, err
}

// ListTenantIDs returns every tenant that owns at least one clock, the cross-tenant
// fan-out source for the monitor.
func (r *SLAClockRepository) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT tenant_id FROM legal_sla_clocks WHERE resolved_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var tenantID uuid.UUID
		if err := rows.Scan(&tenantID); err != nil {
			return nil, err
		}
		out = append(out, tenantID)
	}
	return out, rows.Err()
}

func slaClockJSONFrom(source string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.legal_request_id, c.sla_target_id, c.service_code, c.priority,
			       c.beneficiary_entity_id, c.clock_started_at, c.ack_due_at,
			       c.turnaround_from_due_at, c.turnaround_due_at,
			       c.escalation_l1_due_at, c.escalation_l2_due_at, c.escalation_l3_due_at,
			       c.ack_done, c.ack_done_at, c.escalation_level, c.breached, c.breached_at, c.outcome,
			       c.resolved_at, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at
			FROM ` + source + ` c
		) t`
}

// utcPtr normalises a nullable instant to UTC for persistence, preserving nil.
func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

func slaClockJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.legal_request_id, c.sla_target_id, c.service_code, c.priority,
			       c.beneficiary_entity_id, c.clock_started_at, c.ack_due_at,
			       c.turnaround_from_due_at, c.turnaround_due_at,
			       c.escalation_l1_due_at, c.escalation_l2_due_at, c.escalation_l3_due_at,
			       c.ack_done, c.ack_done_at, c.escalation_level, c.breached, c.breached_at, c.outcome,
			       c.resolved_at, c.cycle, c.stopped_at, COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at
			FROM legal_sla_clocks c
			WHERE ` + where + `
		) t`
}
