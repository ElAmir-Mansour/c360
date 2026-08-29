package recover

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	cyberrecovery "github.com/clario360/platform/internal/recover/cyberrecovery"
)

// ---------------------------------------------------------------------------
// Append-only cross-sub-solution audit trail (Prompt 10, the "Prove" spine).
//
// Every recovery/rehearsal action across all three sub-solutions writes ONE
// immutable AuditEvent here: who (Actor), what (Action), when (OccurredAt), and
// which application/runbook/event it acted on. The store and service expose ONLY
// append + read — there is deliberately NO update or delete code path — and the
// backing table (recover_audit_event, migration 000040) grants no UPDATE/DELETE
// RLS policy, so immutability holds at both the service and database layers and
// is proven by test (audit_test.go).
//
// This layer COMPOSES: it records actions the existing dr/* + cyber-recovery
// services already perform; it owns no recovery logic. The evidence export
// (evidence.go) reads this log as the full timeline.
// ---------------------------------------------------------------------------

// Sub-solution slugs as stored in the audit log (the underscore form the table
// CHECK constraint and the contract entitlement keys use, distinct from the
// hyphenated route slugs).
const (
	AuditSubSolutionITDR          = "it_dr"
	AuditSubSolutionCloudDR       = "cloud_dr"
	AuditSubSolutionCyberRecovery = "cyber_recovery"
)

// validAuditSubSolution reports whether s is a recognised audit sub-solution.
func validAuditSubSolution(s string) bool {
	switch s {
	case AuditSubSolutionITDR, AuditSubSolutionCloudDR, AuditSubSolutionCyberRecovery:
		return true
	default:
		return false
	}
}

// Action verbs — the stable, documented vocabulary producers record. New verbs
// can be added without a migration (the column is bounded free-text); these
// cover the recovery/rehearsal actions the evidence report reproduces.
const (
	// IT DR / Cloud DR runbook execution lifecycle.
	ActionRunbookRunStarted   = "runbook.run.started"
	ActionRunbookRunCompleted = "runbook.run.completed"
	ActionRunbookRunFailed    = "runbook.run.failed"
	ActionRunbookEditedLive   = "runbook.edited.live"
	ActionRehearsalStarted    = "rehearsal.started"
	ActionRehearsalCompleted  = "rehearsal.completed"
	ActionFailoverExecuted    = "failover.executed"

	// Cyber-recovery clean-room flow lifecycle (the integrity-gated path).
	ActionCleanPointSelected = "cyber.clean_point.selected"
	ActionTargetProvisioned  = "cyber.target.provisioned"
	ActionRecoveryRun        = "cyber.recovery.run"
	ActionIntegrityEvaluated = "cyber.integrity.evaluated"
	ActionApprovalRequested  = "cyber.approval.requested"
	ActionApprovalGranted    = "cyber.approval.granted"
	ActionReturnToProduction = "cyber.return_to_production"
	ActionFlowAborted        = "cyber.flow.aborted"
)

// AuditActor identifies the authenticated caller (or a labelled system actor)
// for provenance on a recorded action.
type AuditActor struct {
	// ID is the authenticated user id; nil for a system-driven action.
	ID *uuid.UUID
	// Email is the actor's email, or a system label when ID is nil. Required.
	Email string
}

// AuditEvent is one immutable, append-only audit record: who/what/when/which.
// It is written by the producers and read back (never mutated) by the evidence
// export.
type AuditEvent struct {
	ID            uuid.UUID      `json:"id"`
	EventID       uuid.UUID      `json:"event_id"`
	SubSolution   string         `json:"sub_solution"`
	Action        string         `json:"action"`
	ActorID       *uuid.UUID     `json:"actor_id,omitempty"`
	ActorEmail    string         `json:"actor_email"`
	ApplicationID *uuid.UUID     `json:"application_id,omitempty"`
	RunbookID     *uuid.UUID     `json:"runbook_id,omitempty"`
	Summary       string         `json:"summary"`
	Detail        map[string]any `json:"detail,omitempty"`
	OccurredAt    time.Time      `json:"occurred_at"`
	RecordedAt    time.Time      `json:"recorded_at"`
}

// AuditRecord is the value a producer appends: the event being audited, the
// originating sub-solution, the action verb, the actor, the application/runbook
// the action acted on, and a human summary + structured detail. The store stamps
// ID and RecordedAt; OccurredAt defaults to the service clock when zero.
type AuditRecord struct {
	EventID       uuid.UUID
	SubSolution   string
	Action        string
	Actor         AuditActor
	ApplicationID *uuid.UUID
	RunbookID     *uuid.UUID
	Summary       string
	Detail        map[string]any
	OccurredAt    time.Time
}

// ErrInvalidAuditRecord is a boundary validation failure on Append. Producers
// must supply an event id, a known sub-solution, an action, and an actor email.
var ErrInvalidAuditRecord = errors.New("recover: invalid audit record")

// AuditStore is the APPEND-ONLY persistence surface for the audit log. It
// exposes exactly two operations — Append (one immutable INSERT) and the two
// reads the evidence export needs. There is NO update or delete method by
// design; immutability is enforced here at the service layer and again by the
// database (no UPDATE/DELETE RLS policy on recover_audit_event). Every call
// takes a tenant-scoped repository.DBTX so the write/read is RLS-isolated.
type AuditStore interface {
	// Append inserts ONE immutable audit row and returns the stamped event. There
	// is intentionally no Update/Delete companion.
	Append(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, rec AuditRecord, now time.Time) (AuditEvent, error)
	// ListForEvent returns the audit timeline for one recovery event, oldest
	// first (the chronological order the evidence report renders).
	ListForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) ([]AuditEvent, error)
	// ListRecentEvents returns the tenant's distinct recovery events that have at
	// least one audit row, newest first, bounded to limit — the "Prove" event
	// list. Each summary row carries the latest action and the action count.
	ListRecentEvents(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]AuditEventSummary, error)
}

// AuditEventSummary is one row of the "Prove" event list: a recovery event with
// its sub-solution, action count, the latest action + actor, and the time span
// the event covers. Computed by the store from the append-only log.
type AuditEventSummary struct {
	EventID      uuid.UUID `json:"event_id"`
	SubSolution  string    `json:"sub_solution"`
	ActionCount  int       `json:"action_count"`
	LatestAction string    `json:"latest_action"`
	LatestActor  string    `json:"latest_actor"`
	FirstAt      time.Time `json:"first_at"`
	LastAt       time.Time `json:"last_at"`
}

// AuditService is the append-only audit-trail writer/reader the producers and
// the evidence export use. It validates each record at the boundary, stamps the
// clock, and persists it through one tenant-scoped transaction. It owns no
// recovery logic; it records the actions the dr/* + cyber-recovery services
// perform. The absence of any Update/Delete method on this type and on
// AuditStore is the service-layer half of the append-only guarantee.
type AuditService struct {
	runner  TenantRunner
	store   AuditStore
	metrics *EvidenceMetrics
	logger  zerolog.Logger
	now     func() time.Time
}

// AuditConfig wires an AuditService.
type AuditConfig struct {
	// Runner runs tenant-scoped transactions (append write; timeline/list reads).
	Runner TenantRunner
	// Store is the append-only audit persistence.
	Store AuditStore
	// Metrics records audit-write observability; nil is safe (unmetered).
	Metrics *EvidenceMetrics
	// Logger is required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// NewAuditService validates the config and constructs the service.
func NewAuditService(cfg AuditConfig) (*AuditService, error) {
	if cfg.Runner == nil {
		return nil, errors.New("recover audit service: runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("recover audit service: store is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &AuditService{
		runner:  cfg.Runner,
		store:   cfg.Store,
		metrics: cfg.Metrics,
		logger:  cfg.Logger.With().Str("service", "recover-audit").Logger(),
		now:     now,
	}, nil
}

// Record appends one immutable audit event in its own tenant-scoped transaction.
// This is the producer entry point: the dr/* + cyber-recovery action sites call
// it to write who/what/when/which. It validates the record at the boundary and
// NEVER updates or deletes — there is no such path.
func (s *AuditService) Record(ctx context.Context, tenantID uuid.UUID, rec AuditRecord) (AuditEvent, error) {
	if err := validateAuditRecord(tenantID, rec); err != nil {
		return AuditEvent{}, err
	}
	now := s.now()
	if rec.OccurredAt.IsZero() {
		rec.OccurredAt = now
	}
	var out AuditEvent
	if err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var aerr error
		out, aerr = s.store.Append(ctx, db, tenantID, rec, now)
		return aerr
	}); err != nil {
		return AuditEvent{}, err
	}
	s.metrics.observeAuditWrite()
	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("event_id", rec.EventID.String()).
		Str("sub_solution", rec.SubSolution).
		Str("action", rec.Action).
		Str("actor", rec.Actor.Email).
		Msg("recover audit action recorded")
	return out, nil
}

// RecordTx appends one immutable audit event using a DBTX the CALLER already
// holds, so a producer can write the audit row atomically with the state
// transition it audits (one transaction, no torn write). The caller is
// responsible for the tenant-scoped transaction; this method only validates and
// inserts. Like Record, there is no update/delete counterpart.
func (s *AuditService) RecordTx(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, rec AuditRecord) (AuditEvent, error) {
	if err := validateAuditRecord(tenantID, rec); err != nil {
		return AuditEvent{}, err
	}
	now := s.now()
	if rec.OccurredAt.IsZero() {
		rec.OccurredAt = now
	}
	out, err := s.store.Append(ctx, db, tenantID, rec, now)
	if err != nil {
		return AuditEvent{}, err
	}
	s.metrics.observeAuditWrite()
	return out, nil
}

// Timeline returns one recovery event's audit trail, oldest first.
func (s *AuditService) Timeline(ctx context.Context, tenantID, eventID uuid.UUID) ([]AuditEvent, error) {
	if tenantID == uuid.Nil || eventID == uuid.Nil {
		return nil, errors.New("recover audit: tenant and event id are required")
	}
	var out []AuditEvent
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		out, rerr = s.store.ListForEvent(ctx, db, tenantID, eventID)
		return rerr
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// RecentEvents returns the tenant's recovery events that have audit history,
// newest first, bounded to limit — the "Prove" event list.
func (s *AuditService) RecentEvents(ctx context.Context, tenantID uuid.UUID, limit int) ([]AuditEventSummary, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover audit: tenant id is required")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var out []AuditEventSummary
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		out, rerr = s.store.ListRecentEvents(ctx, db, tenantID, limit)
		return rerr
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// validateAuditRecord enforces the boundary invariants every appended record
// must satisfy.
func validateAuditRecord(tenantID uuid.UUID, rec AuditRecord) error {
	if tenantID == uuid.Nil {
		return errInvalidAudit("tenant id is required")
	}
	if rec.EventID == uuid.Nil {
		return errInvalidAudit("event id is required")
	}
	if !validAuditSubSolution(rec.SubSolution) {
		return errInvalidAudit("unknown sub-solution " + rec.SubSolution)
	}
	if rec.Action == "" || len(rec.Action) > 120 {
		return errInvalidAudit("action must be 1..120 chars")
	}
	if rec.Actor.Email == "" {
		return errInvalidAudit("actor email is required")
	}
	if len(rec.Summary) > 1000 {
		return errInvalidAudit("summary too long")
	}
	return nil
}

func errInvalidAudit(msg string) error {
	return errors.Join(ErrInvalidAuditRecord, errors.New(msg))
}

// CyberAuditSink adapts the AuditService to the cyberrecovery package's AuditSink
// so the cyber-recovery flow records each transition to the unified
// cross-sub-solution append-only audit log — atomically, in the SAME transaction
// as the flow state change. It maps the cyber action into an AuditRecord under
// the cyber_recovery sub-solution, using the flow id as the recovery event id.
// This is the composition seam cmd wires; cyberrecovery never imports recover.
type CyberAuditSink struct {
	audit *AuditService
}

// NewCyberAuditSink wraps an AuditService for the cyber-recovery flow.
func NewCyberAuditSink(audit *AuditService) *CyberAuditSink {
	return &CyberAuditSink{audit: audit}
}

// RecordFlowAction records one cyber-recovery flow transition to the unified
// append-only audit log, reusing the caller's open transaction. actorEmail is
// defaulted to a system label only when a non-human transition carries none, so
// the boundary actor-email invariant holds.
func (s *CyberAuditSink) RecordFlowAction(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID, actor cyberrecovery.Actor, act cyberrecovery.AuditAction) error {
	email := actor.Email
	if email == "" {
		email = "system@recover"
	}
	_, err := s.audit.RecordTx(ctx, db, tenantID, AuditRecord{
		EventID:     eventID,
		SubSolution: AuditSubSolutionCyberRecovery,
		Action:      act.Action,
		Actor:       AuditActor{ID: actor.ID, Email: email},
		Summary:     act.Summary,
		Detail:      act.Detail,
	})
	return err
}
