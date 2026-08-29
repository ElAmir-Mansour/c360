package cyberrecovery

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/dr/repository"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrInvalidInput is a 400-class validation failure at the boundary.
	ErrInvalidInput = errors.New("cyberrecovery: invalid input")
	// ErrCleanPointNotClean blocks selecting a point whose latest clean-room
	// verdict is not CLEAN as the recovery source.
	ErrCleanPointNotClean = errors.New("cyberrecovery: clean point has not passed a clean-room scan")
	// ErrInvalidTransition rejects a phase action that is illegal from the flow's
	// current phase (a 409-class conflict).
	ErrInvalidTransition = errors.New("cyberrecovery: invalid phase transition")
	// ErrIntegrityGateNotPassed is the HARD blocker: return-to-production is
	// refused because the mandatory clean-room integrity scan has not passed.
	ErrIntegrityGateNotPassed = errors.New("cyberrecovery: integrity gate not passed — return to production blocked")
	// ErrApprovalRequired is the HARD blocker: return-to-production is refused
	// because no authorized approver has signed off against the passing scan.
	ErrApprovalRequired = errors.New("cyberrecovery: approval required — return to production blocked")
	// ErrSelfApproval rejects an approver signing off their own flow when the
	// service is configured to forbid it (separation of duties).
	ErrSelfApproval = errors.New("cyberrecovery: the flow creator may not approve their own return-to-production")
)

// IntegrityScanner runs the MANDATORY clean-room integrity scan for a recovery
// point and returns the verdict. The dr/cleanroom Service satisfies it
// (ScanRecoveryPoint restores the sealed chunks into a sandbox, integrity- and
// malware-checks them, and records an immutable verdict). This package NEVER
// reimplements that logic — it composes the real scanner.
type IntegrityScanner interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (IntegrityResult, error)
}

// IntegrityResult is the minimal projection of a clean-room scan the gate needs.
type IntegrityResult struct {
	ScanID    uuid.UUID
	Verdict   string
	Detail    string
	ScannedAt time.Time
}

// RansomwareReader reads a tenant's persisted ransomware early-warning signals.
// The dr/ransomware Store satisfies it (ListSignals). Composed, not forked.
type RansomwareReader interface {
	ListSignals(ctx context.Context, db repository.DBTX, tenantID string, limit int) ([]ransomware.Signal, error)
}

// Actor identifies the authenticated caller for provenance on a transition.
type Actor struct {
	ID    *uuid.UUID
	Email string
}

// AuditAction is the unified cross-sub-solution audit action a flow transition
// maps to (the recover.Action* vocabulary), recorded against the flow id as the
// recovery event. It decouples this package from the recover package (which
// imports it) — cmd wires a recover.AuditService adapter as the sink.
type AuditAction struct {
	// Action is the stable action verb (recover.Action* constant value).
	Action string
	// Summary is a short human-readable description for the evidence timeline.
	Summary string
	// Detail is the structured detail rendered verbatim in the export.
	Detail map[string]any
}

// AuditSink writes ONE immutable cross-sub-solution audit row for a flow
// transition, using the SAME DBTX as the transition so the audit write commits
// atomically with the state change it records (no torn write). The recover
// package's AuditService satisfies it via an adapter wired in cmd. It is OPTIONAL:
// a nil sink leaves the flow's own append-only transition log as the sole record
// (the unified evidence export then sources this flow's timeline from that log).
// The sink is append-only by construction — there is no update/delete path.
type AuditSink interface {
	RecordFlowAction(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID, actor Actor, act AuditAction) error
}

// Config wires a Service.
type Config struct {
	// Runner runs tenant-scoped transactions for flow state.
	Runner TenantRunner
	// Store persists flows + the append-only transition log and reads clean points.
	Store Store
	// Scanner is the composed clean-room integrity scanner (dr/cleanroom).
	Scanner IntegrityScanner
	// Ransomware reads persisted ransomware signals (dr/ransomware).
	Ransomware RansomwareReader
	// Logger is required.
	Logger zerolog.Logger
	// Metrics records gate/transition observability; nil is a no-op.
	Metrics *Metrics
	// Audit, when set, also records each flow transition to the unified
	// cross-sub-solution append-only audit log (atomically, in the same
	// transaction). Optional; nil leaves the flow's own transition log as the
	// record.
	Audit AuditSink
	// ForbidSelfApproval enforces separation of duties: when true the flow
	// creator may not approve their own return-to-production.
	ForbidSelfApproval bool
	// Now is injectable for deterministic tests.
	Now func() time.Time
}

// Service owns the clean-room recovery flow state machine and enforces the
// MANDATORY integrity gate server-side. It COMPOSES the clean-room scanner,
// ransomware reader, and the shared recovery-point store; it never reimplements
// their logic.
type Service struct {
	runner             TenantRunner
	store              Store
	scanner            IntegrityScanner
	ransomware         RansomwareReader
	logger             zerolog.Logger
	metrics            *Metrics
	audit              AuditSink
	forbidSelfApproval bool
	now                func() time.Time
}

// NewService validates the config and constructs the service.
func NewService(cfg Config) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("cyberrecovery service: runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("cyberrecovery service: store is required")
	}
	if cfg.Scanner == nil {
		return nil, errors.New("cyberrecovery service: integrity scanner is required")
	}
	if cfg.Ransomware == nil {
		return nil, errors.New("cyberrecovery service: ransomware reader is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		runner:             cfg.Runner,
		store:              cfg.Store,
		scanner:            cfg.Scanner,
		ransomware:         cfg.Ransomware,
		logger:             cfg.Logger.With().Str("service", "recover-cyberrecovery").Logger(),
		metrics:            cfg.Metrics,
		audit:              cfg.Audit,
		forbidSelfApproval: cfg.ForbidSelfApproval,
		now:                now,
	}, nil
}

// --- read paths ------------------------------------------------------------

// Overview assembles the live Cyber Recovery dashboard for a tenant from real
// persisted state: clean points (with freshness), ransomware signals, and the
// flow inventory. It runs each composed read against tenant-scoped state — no
// canned data.
func (s *Service) Overview(ctx context.Context, tenantID uuid.UUID) (*Overview, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	ov := &Overview{
		CleanPoints:       []CleanPoint{},
		RansomwareSignals: []RansomwareSignal{},
		Flows:             []Flow{},
		GeneratedAt:       s.now(),
	}

	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		points, err := s.store.ListCleanPoints(ctx, tx, tenantID, 25)
		if err != nil {
			return err
		}
		ov.CleanPoints = points

		signals, err := s.ransomware.ListSignals(ctx, tx, tenantID.String(), 25)
		if err != nil {
			return err
		}
		ov.RansomwareSignals = projectSignals(signals)
		for _, sig := range signals {
			if sig.Severity == ransomware.SeverityConfirmed {
				ov.ConfirmedRansomwareSignals++
			}
		}

		flows, err := s.store.ListFlows(ctx, tx, tenantID, 50)
		if err != nil {
			return err
		}
		ov.Flows = flows
		return nil
	}); err != nil {
		return nil, err
	}

	// Latest clean (validated + clean-room CLEAN) point + its freshness.
	for i := range ov.CleanPoints {
		if ov.CleanPoints[i].IsClean() {
			cp := ov.CleanPoints[i]
			ov.LatestCleanPoint = &cp
			age := int64(ov.GeneratedAt.Sub(cp.SealedAt).Seconds())
			if age < 0 {
				age = 0
			}
			ov.CleanPointFreshnessSeconds = &age
			break
		}
	}

	for _, f := range ov.Flows {
		if !isTerminal(f.Phase) {
			ov.ActiveFlows++
		}
		if f.Phase == PhaseAwaitingApproval || f.Phase == PhaseIntegrityPassed {
			ov.FlowsAwaitingApproval++
		}
	}
	return ov, nil
}

// ListCleanPoints returns the tenant's last-known-good restore candidates.
func (s *Service) ListCleanPoints(ctx context.Context, tenantID uuid.UUID, limit int) ([]CleanPoint, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	var out []CleanPoint
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		out, err = s.store.ListCleanPoints(ctx, tx, tenantID, limit)
		return err
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// GetFlow returns a flow plus its transition history.
func (s *Service) GetFlow(ctx context.Context, tenantID, flowID uuid.UUID) (*Flow, []FlowEvent, error) {
	if tenantID == uuid.Nil || flowID == uuid.Nil {
		return nil, nil, fmt.Errorf("%w: tenant and flow id are required", ErrInvalidInput)
	}
	var flow *Flow
	var events []FlowEvent
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		f, err := s.store.GetFlow(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		flow = f
		ev, err := s.store.ListEvents(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		events = ev
		return nil
	}); err != nil {
		return nil, nil, err
	}
	return flow, events, nil
}

// ListFlows returns the tenant's recovery flows newest first.
func (s *Service) ListFlows(ctx context.Context, tenantID uuid.UUID, limit int) ([]Flow, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	var out []Flow
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		out, err = s.store.ListFlows(ctx, tx, tenantID, limit)
		return err
	}); err != nil {
		return nil, err
	}
	return out, nil
}

// --- flow lifecycle --------------------------------------------------------

// SelectCleanPointInput parameterises flow creation.
type SelectCleanPointInput struct {
	CleanPointID uuid.UUID
	TargetLabel  string
	TargetKind   TargetKind
}

// SelectCleanPoint starts a clean-room recovery flow from a last-known-good
// clean point. The point must be a VALIDATED recovery point whose latest
// clean-room verdict is CLEAN — selecting a never-scanned or dirty point as the
// recovery source is rejected at the boundary (the integrity gate is also
// re-asserted later, so this is a fail-fast, not the gate itself).
func (s *Service) SelectCleanPoint(ctx context.Context, tenantID uuid.UUID, actor Actor, in SelectCleanPointInput) (*Flow, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidInput)
	}
	if in.CleanPointID == uuid.Nil {
		return nil, fmt.Errorf("%w: clean point id is required", ErrInvalidInput)
	}
	if len(in.TargetLabel) == 0 || len(in.TargetLabel) > 200 {
		return nil, fmt.Errorf("%w: target label must be 1..200 chars", ErrInvalidInput)
	}
	kind := in.TargetKind
	if kind == "" {
		kind = TargetCleanRoom
	}
	if !validTargetKind(kind) {
		return nil, fmt.Errorf("%w: unknown target kind %q", ErrInvalidInput, kind)
	}

	var flow *Flow
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		cp, err := s.store.GetCleanPoint(ctx, tx, tenantID, in.CleanPointID)
		if err != nil {
			return err
		}
		if !cp.IsClean() {
			return fmt.Errorf("%w (latest verdict %q)", ErrCleanPointNotClean, cp.LatestScanVerdict)
		}
		f := &Flow{
			TenantID:    tenantID,
			CleanPoint:  cp.ID,
			GroupID:     cp.GroupID,
			TargetLabel: in.TargetLabel,
			TargetKind:  kind,
			Phase:       PhaseCleanPointSelected,
			CreatedBy:   actor.ID,
		}
		if err := s.store.CreateFlow(ctx, tx, f); err != nil {
			return err
		}
		if err := s.appendEvent(ctx, tx, f, "", PhaseCleanPointSelected, actor, map[string]any{
			"clean_point_id": cp.ID.String(),
			"target_label":   in.TargetLabel,
			"target_kind":    string(kind),
		}); err != nil {
			return err
		}
		flow = f
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncTransition(string(PhaseCleanPointSelected))
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("flow_id", flow.ID.String()).
		Str("clean_point_id", flow.CleanPoint.String()).Msg("clean-room recovery flow started")
	return flow, nil
}

// Provision advances a selected flow to provisioned: the clean point is staged
// to the clean/bare-metal target. (The actual provisioning is performed by the
// composed instant/recovery path; this records the orchestration transition.)
func (s *Service) Provision(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
	return s.transition(ctx, tenantID, flowID, actor, transitionSpec{
		from: []Phase{PhaseCleanPointSelected, PhaseProvisioning},
		to:   PhaseProvisioned,
		via:  PhaseProvisioning,
	})
}

// RunRecovery advances a provisioned flow through runbook recovery to recovered.
// runbookRunID links the composed runbookstudio run that executed the recovery;
// this package does not fork runbook logic, it records the link.
func (s *Service) RunRecovery(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, runbookRunID string) (*Flow, error) {
	return s.transition(ctx, tenantID, flowID, actor, transitionSpec{
		from: []Phase{PhaseProvisioned, PhaseRecovering, PhaseIntegrityFailed},
		to:   PhaseRecovered,
		via:  PhaseRecovering,
		mutate: func(f *Flow) {
			if runbookRunID != "" {
				f.RunbookRunID = runbookRunID
			}
		},
		detail: map[string]any{"runbook_run_id": runbookRunID},
	})
}

// RunIntegrityCheck runs the MANDATORY clean-room integrity scan against the
// flow's clean point and records the verdict. This COMPOSES dr/cleanroom — the
// scan restores the sealed chunks, integrity- and malware-checks them, and
// persists its own immutable verdict; this method only records the outcome on
// the flow and advances the gate. A CLEAN verdict moves the flow to
// integrity_passed; anything else moves it to integrity_failed (return-to-prod
// stays blocked). The scan itself runs OUTSIDE the flow transaction (it is slow
// sandbox I/O); the verdict is then recorded transactionally.
func (s *Service) RunIntegrityCheck(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
	if tenantID == uuid.Nil || flowID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and flow id are required", ErrInvalidInput)
	}

	// Phase 1: load the flow and assert it is at a phase where the gate may run.
	var flow *Flow
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		f, err := s.store.GetFlow(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		flow = f
		return nil
	}); err != nil {
		return nil, err
	}
	switch flow.Phase {
	case PhaseRecovered, PhaseIntegrityChecking, PhaseIntegrityFailed,
		PhaseIntegrityPassed, PhaseAwaitingApproval, PhaseApproved:
		// Gate runnable / re-runnable. Re-running after approval is allowed (and
		// deliberately CLEARS the approval below) so an operator can re-validate a
		// flow before returning it — the stale approval can never be replayed.
	default:
		return nil, fmt.Errorf("%w: integrity check requires a recovered flow (phase=%s)", ErrInvalidTransition, flow.Phase)
	}
	expected := flow.Version
	fromPhase := flow.Phase

	// Phase 2: run the real clean-room scan outside any DB transaction.
	result, err := s.scanner.ScanRecoveryPoint(ctx, tenantID, flow.CleanPoint)
	if err != nil {
		return nil, fmt.Errorf("running clean-room integrity scan: %w", err)
	}

	passed := result.Verdict == VerdictClean
	to := PhaseIntegrityFailed
	if passed {
		to = PhaseIntegrityPassed
	}
	checkedAt := result.ScannedAt
	if checkedAt.IsZero() {
		checkedAt = s.now()
	}

	// Phase 3: record the verdict transactionally under optimistic concurrency.
	// A passing gate RESETS any prior approval (a fresh scan must be re-approved)
	// so a stale approval can never be replayed against a newer verdict.
	if err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		scanID := result.ScanID
		flow.IntegrityScanID = &scanID
		flow.IntegrityVerdict = result.Verdict
		flow.IntegrityCheckedAt = &checkedAt
		flow.IntegrityDetail = result.Detail
		flow.ApprovedBy = nil
		flow.ApprovedByEmail = ""
		flow.ApprovedAt = nil
		flow.ApprovalNote = ""
		flow.ApprovedForScanID = nil
		flow.Phase = to
		if err := s.store.UpdateFlow(ctx, tx, flow, expected); err != nil {
			return err
		}
		return s.appendEvent(ctx, tx, flow, fromPhase, to, actor, map[string]any{
			"scan_id": result.ScanID.String(),
			"verdict": result.Verdict,
			"passed":  passed,
		})
	}); err != nil {
		return nil, err
	}

	s.metrics.IncIntegrityGate(result.Verdict)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("flow_id", flowID.String()).
		Str("verdict", result.Verdict).Bool("passed", passed).Msg("clean-room integrity gate evaluated")
	return flow, nil
}

// RequestApproval moves a passed flow to awaiting_approval (the gate's hold
// state). It requires a passing integrity scan first.
func (s *Service) RequestApproval(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
	return s.transition(ctx, tenantID, flowID, actor, transitionSpec{
		from: []Phase{PhaseIntegrityPassed, PhaseAwaitingApproval},
		to:   PhaseAwaitingApproval,
		guard: func(f *Flow) error {
			if !f.IntegrityPassed() {
				return ErrIntegrityGateNotPassed
			}
			return nil
		},
	})
}

// Approve records an authorized approver's sign-off for return-to-production.
// This is HALF of the hard gate: it pins the approval to the flow's CURRENT
// passing integrity scan (provenance) so a re-scan invalidates the approval. The
// approver MUST be authorized (the router gates this with the approval
// permission) and, when separation of duties is configured, may not be the flow
// creator. Approving does NOT return the flow to production — that remains a
// separate, gated action.
func (s *Service) Approve(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, note string) (*Flow, error) {
	if tenantID == uuid.Nil || flowID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and flow id are required", ErrInvalidInput)
	}
	if actor.ID == nil {
		return nil, fmt.Errorf("%w: an authenticated approver is required", ErrInvalidInput)
	}
	if len(note) > 1000 {
		return nil, fmt.Errorf("%w: approval note too long", ErrInvalidInput)
	}

	var flow *Flow
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		f, err := s.store.GetFlow(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		// The integrity gate MUST have passed before any approval is recorded.
		if !f.IntegrityPassed() || f.IntegrityScanID == nil {
			return ErrIntegrityGateNotPassed
		}
		switch f.Phase {
		case PhaseIntegrityPassed, PhaseAwaitingApproval, PhaseApproved:
			// approvable / re-approvable
		default:
			return fmt.Errorf("%w: approval requires a passed integrity gate (phase=%s)", ErrInvalidTransition, f.Phase)
		}
		if s.forbidSelfApproval && f.CreatedBy != nil && *f.CreatedBy == *actor.ID {
			return ErrSelfApproval
		}
		expected := f.Version
		now := s.now()
		scanID := *f.IntegrityScanID
		f.ApprovedBy = actor.ID
		f.ApprovedByEmail = actor.Email
		f.ApprovedAt = &now
		f.ApprovalNote = note
		f.ApprovedForScanID = &scanID
		f.Phase = PhaseApproved
		if err := s.store.UpdateFlow(ctx, tx, f, expected); err != nil {
			return err
		}
		if err := s.appendEvent(ctx, tx, f, PhaseAwaitingApproval, PhaseApproved, actor, map[string]any{
			"approved_for_scan_id": scanID.String(),
			"note":                 note,
		}); err != nil {
			return err
		}
		flow = f
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncApproval()
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("flow_id", flowID.String()).
		Str("approver", actor.Email).Msg("return-to-production approved")
	return flow, nil
}

// ReturnToProduction is the GATED terminal action: it returns the recovered
// workload to the production network. It is the HARD SERVER-SIDE BLOCKER — it
// re-asserts BOTH halves of the gate inside the transaction:
//
//  1. the flow's latest integrity scan verdict is CLEAN, AND
//  2. an authorized approver has signed off against THAT exact scan.
//
// If either is false the action is refused (ErrIntegrityGateNotPassed /
// ErrApprovalRequired) and the flow is NOT advanced. There is no path to
// PhaseReturnedToProduction that bypasses this check.
func (s *Service) ReturnToProduction(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
	if tenantID == uuid.Nil || flowID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and flow id are required", ErrInvalidInput)
	}

	var flow *Flow
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		f, err := s.store.GetFlow(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		if f.Phase == PhaseReturnedToProduction {
			return fmt.Errorf("%w: flow already returned to production", ErrInvalidTransition)
		}
		// HARD GATE — re-asserted at the moment of action, not trusted from phase.
		if !f.IntegrityPassed() {
			s.metrics.IncBlocked("integrity")
			return ErrIntegrityGateNotPassed
		}
		if !f.ApprovalSatisfied() {
			s.metrics.IncBlocked("approval")
			return ErrApprovalRequired
		}
		expected := f.Version
		now := s.now()
		f.ReturnedBy = actor.ID
		f.ReturnedAt = &now
		f.Phase = PhaseReturnedToProduction
		if err := s.store.UpdateFlow(ctx, tx, f, expected); err != nil {
			return err
		}
		if err := s.appendEvent(ctx, tx, f, PhaseApproved, PhaseReturnedToProduction, actor, map[string]any{
			"integrity_scan_id": f.IntegrityScanID.String(),
			"approved_by_email": f.ApprovedByEmail,
		}); err != nil {
			return err
		}
		flow = f
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncReturned()
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("flow_id", flowID.String()).
		Str("returned_by", actor.Email).Msg("recovered workload returned to production network")
	return flow, nil
}

// Abort terminally abandons a non-terminal flow with a reason.
func (s *Service) Abort(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, reason string) (*Flow, error) {
	if len(reason) > 1000 {
		return nil, fmt.Errorf("%w: abort reason too long", ErrInvalidInput)
	}
	return s.transition(ctx, tenantID, flowID, actor, transitionSpec{
		anyFrom: true,
		to:      PhaseAborted,
		guard: func(f *Flow) error {
			if isTerminal(f.Phase) {
				return fmt.Errorf("%w: flow is already terminal (phase=%s)", ErrInvalidTransition, f.Phase)
			}
			return nil
		},
		mutate: func(f *Flow) { f.AbortReason = reason },
		detail: map[string]any{"reason": reason},
	})
}

// --- transition engine -----------------------------------------------------

// transitionSpec describes a simple guarded phase transition.
type transitionSpec struct {
	// from is the set of phases the action is legal from. Ignored when anyFrom.
	from []Phase
	// anyFrom allows the transition from any non-terminal phase (guard decides).
	anyFrom bool
	// to is the destination phase.
	to Phase
	// via is an optional event recording the in-progress phase the transition
	// passed through (e.g. provisioning) without persisting it as a halt state.
	via Phase
	// guard is an optional extra precondition evaluated against the loaded flow.
	guard func(*Flow) error
	// mutate optionally adjusts flow fields before persisting.
	mutate func(*Flow)
	// detail is merged into the transition event.
	detail map[string]any
}

// transition loads the flow, validates the spec, mutates + persists it under
// optimistic concurrency, and appends the transition event — all in one
// tenant-scoped transaction.
func (s *Service) transition(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, spec transitionSpec) (*Flow, error) {
	if tenantID == uuid.Nil || flowID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and flow id are required", ErrInvalidInput)
	}
	var flow *Flow
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		f, err := s.store.GetFlow(ctx, tx, tenantID, flowID)
		if err != nil {
			return err
		}
		if !spec.anyFrom && !phaseIn(f.Phase, spec.from) {
			return fmt.Errorf("%w: cannot %s from phase %s", ErrInvalidTransition, spec.to, f.Phase)
		}
		if spec.guard != nil {
			if err := spec.guard(f); err != nil {
				return err
			}
		}
		from := f.Phase
		expected := f.Version
		if spec.mutate != nil {
			spec.mutate(f)
		}
		f.Phase = spec.to
		if err := s.store.UpdateFlow(ctx, tx, f, expected); err != nil {
			return err
		}
		detail := spec.detail
		if spec.via != "" {
			if detail == nil {
				detail = map[string]any{}
			}
			detail["via"] = string(spec.via)
		}
		if err := s.appendEvent(ctx, tx, f, from, spec.to, actor, detail); err != nil {
			return err
		}
		flow = f
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncTransition(string(spec.to))
	return flow, nil
}

// appendEvent writes one immutable transition row (append-only audit) and, when a
// unified AuditSink is configured, ALSO records the transition to the
// cross-sub-solution append-only audit log — both in the SAME transaction (tx) so
// the two immutable records commit atomically with the state change. There is
// deliberately no update/delete companion on either path.
func (s *Service) appendEvent(ctx context.Context, tx repository.DBTX, f *Flow, from, to Phase, actor Actor, detail map[string]any) error {
	if err := s.store.AppendEvent(ctx, tx, &FlowEvent{
		TenantID:   f.TenantID,
		FlowID:     f.ID,
		FromPhase:  from,
		ToPhase:    to,
		ActorID:    actor.ID,
		ActorEmail: actor.Email,
		Detail:     detail,
	}); err != nil {
		return err
	}
	if s.audit == nil {
		return nil
	}
	act := auditActionForPhase(to, detail)
	if act.Action == "" {
		return nil // a transition with no audit mapping (e.g. an in-progress via) needs no unified row
	}
	return s.audit.RecordFlowAction(ctx, tx, f.TenantID, f.ID, actor, act)
}

// auditActionForPhase maps a destination phase to a unified audit action verb +
// summary for the cross-sub-solution evidence timeline. The flow id is the
// recovery event the actions are recorded against.
func auditActionForPhase(to Phase, detail map[string]any) AuditAction {
	switch to {
	case PhaseCleanPointSelected:
		return AuditAction{Action: "cyber.clean_point.selected", Summary: "Last-known-good clean point selected for clean-room recovery", Detail: detail}
	case PhaseProvisioned:
		return AuditAction{Action: "cyber.target.provisioned", Summary: "Clean point provisioned to clean/bare-metal target", Detail: detail}
	case PhaseRecovered:
		return AuditAction{Action: "cyber.recovery.run", Summary: "Runbook recovery executed against the provisioned target", Detail: detail}
	case PhaseIntegrityPassed:
		return AuditAction{Action: "cyber.integrity.evaluated", Summary: "Mandatory clean-room integrity gate evaluated: CLEAN", Detail: detail}
	case PhaseIntegrityFailed:
		return AuditAction{Action: "cyber.integrity.evaluated", Summary: "Mandatory clean-room integrity gate evaluated: NOT clean — return-to-production blocked", Detail: detail}
	case PhaseAwaitingApproval:
		return AuditAction{Action: "cyber.approval.requested", Summary: "Authorized approval requested for return-to-production", Detail: detail}
	case PhaseApproved:
		return AuditAction{Action: "cyber.approval.granted", Summary: "Return-to-production approved by an authorized approver", Detail: detail}
	case PhaseReturnedToProduction:
		return AuditAction{Action: "cyber.return_to_production", Summary: "Recovered workload returned to the production network", Detail: detail}
	case PhaseAborted:
		return AuditAction{Action: "cyber.flow.aborted", Summary: "Clean-room recovery flow aborted", Detail: detail}
	default:
		return AuditAction{}
	}
}

// --- helpers ---------------------------------------------------------------

func phaseIn(p Phase, set []Phase) bool {
	for _, s := range set {
		if s == p {
			return true
		}
	}
	return false
}

func isTerminal(p Phase) bool {
	return p == PhaseReturnedToProduction || p == PhaseAborted
}

func projectSignals(in []ransomware.Signal) []RansomwareSignal {
	out := make([]RansomwareSignal, 0, len(in))
	for _, s := range in {
		out = append(out, RansomwareSignal{
			ID:         s.ID,
			StreamID:   s.StreamID,
			Kind:       s.Kind,
			Severity:   s.Severity,
			Ratio:      s.Ratio,
			Threshold:  s.Threshold,
			Detail:     s.Detail,
			ObservedAt: s.ObservedAt,
		})
	}
	return out
}
