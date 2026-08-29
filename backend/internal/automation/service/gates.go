package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
)

// GateRepository is the durable surface the gate operations need. It is the run
// + gate subset of the repository so approve/reject/timeout can resolve a parked
// gate and move its run back to RUNNING (or fail it) atomically with an outbox
// event. *repository.Repository satisfies it; tests inject a fake.
type GateRepository interface {
	GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Run, error)
	UpdateRunState(ctx context.Context, db repository.DBTX, run *model.Run) error
	GetApprovalGate(ctx context.Context, db repository.DBTX, tenantID, runID string, stepIndex int) (*model.ApprovalGate, error)
	UpsertApprovalGate(ctx context.Context, db repository.DBTX, g *model.ApprovalGate) error
}

// GateService applies human decisions and timeout policy to parked approval
// gates. A decision NEVER auto-fires from the driver loop — it arrives here from
// the request path (ApproveGate/RejectGate) or from the leader gate-timeout
// sweeper (ApplyTimeout). Each operation resolves the gate and re-arms the run
// for the driver (back to RUNNING) or fails/aborts it, all in one transaction
// with the lifecycle event, so the gate state and the run state never diverge.
type GateService struct {
	repo   GateRepository
	events EventSink
	now    func() time.Time
}

// GateServiceConfig wires a GateService.
type GateServiceConfig struct {
	Repository GateRepository
	Events     EventSink
	Now        func() time.Time
}

// NewGateService constructs the gate-decision service.
func NewGateService(cfg GateServiceConfig) (*GateService, error) {
	if cfg.Repository == nil {
		return nil, errors.New("automation: gate service repository is required")
	}
	if cfg.Events == nil {
		cfg.Events = nopSink{}
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	return &GateService{repo: cfg.Repository, events: cfg.Events, now: cfg.Now}, nil
}

// ApproveGate records an approver's affirmative decision on a parked gate. The
// decision is appended idempotently (a duplicate vote by the same user does not
// double-count). When the quorum is met the gate is resolved APPROVED and the run
// is moved back to RUNNING so the driver advances past the gate on its next tick;
// the orchestrator's resumeAfterGate path then records the gate step and runs the
// next step. Until quorum the run stays parked AWAITING_APPROVAL.
//
// The caller supplies a tenant-scoped transaction (RunWithTenant) so the gate
// row, the run row, and the outbox event commit atomically under RLS.
func (s *GateService) ApproveGate(ctx context.Context, db repository.DBTX, tenantID, runID string, stepIndex int, decision model.Decision) (*model.ApprovalGate, error) {
	return s.decide(ctx, db, tenantID, runID, stepIndex, decision, true)
}

// RejectGate records an approver's rejection. A single rejection resolves the
// gate REJECTED and FAILs the run (a runbook cannot proceed past a rejected
// gate). The caller supplies a tenant-scoped transaction.
func (s *GateService) RejectGate(ctx context.Context, db repository.DBTX, tenantID, runID string, stepIndex int, decision model.Decision) (*model.ApprovalGate, error) {
	decision.Approved = false
	return s.decide(ctx, db, tenantID, runID, stepIndex, decision, false)
}

// decide is the shared approve/reject path.
func (s *GateService) decide(ctx context.Context, db repository.DBTX, tenantID, runID string, stepIndex int, decision model.Decision, approved bool) (*model.ApprovalGate, error) {
	run, err := s.repo.GetRun(ctx, db, tenantID, runID)
	if err != nil {
		return nil, err
	}
	gate, err := s.repo.GetApprovalGate(ctx, db, tenantID, runID, stepIndex)
	if err != nil {
		return nil, err
	}
	if gate.Status != model.GateStatusOpen && gate.Status != model.GateStatusEscalated {
		// Already resolved (approved/rejected/expired): a late decision is a no-op
		// conflict, not a silent overwrite.
		return nil, fmt.Errorf("approval gate (run %s step %d) already %s: %w", runID, stepIndex, gate.Status, model.ErrConflict)
	}
	if run.Status != model.RunStatusAwaitingApproval && run.Status != model.RunStatusEscalated {
		return nil, fmt.Errorf("run %s is %s, not awaiting approval: %w", runID, run.Status, model.ErrConflict)
	}

	decision.Approved = approved
	if decision.DecidedAt.IsZero() {
		decision.DecidedAt = s.now()
	}
	appendDecision(gate, decision)

	if !approved {
		return gate, s.resolveRejected(ctx, db, run, gate, decision)
	}
	if gate.QuorumMet() {
		return gate, s.resolveApproved(ctx, db, run, gate)
	}
	// Quorum not yet met: persist the vote, keep the run parked.
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return nil, fmt.Errorf("recording approval vote (run %s step %d): %w", runID, stepIndex, err)
	}
	return gate, nil
}

// resolveApproved marks the gate APPROVED and re-arms the run (RUNNING) for the
// driver. It does NOT advance the run itself — the driver's orchestrator picks
// up the RUNNING run and its openGate idempotent path resumes past the approved
// gate. This preserves the single-writer (leader) discipline for run advancement.
func (s *GateService) resolveApproved(ctx context.Context, db repository.DBTX, run *model.Run, gate *model.ApprovalGate) error {
	now := s.now()
	gate.Status = model.GateStatusApproved
	gate.ResolvedAt = &now
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("resolving approval gate: %w", err)
	}
	run.Status = model.RunStatusRunning
	run.LastError = ""
	if err := s.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("re-arming run %s after approval: %w", run.ID, err)
	}
	return s.emit(ctx, db, run, eventRunApproved, map[string]any{
		"step_index": gate.StepIndex,
		"approvals":  gate.Approvals(),
		"quorum":     gate.Quorum,
	})
}

// resolveRejected marks the gate REJECTED and FAILs the run.
func (s *GateService) resolveRejected(ctx context.Context, db repository.DBTX, run *model.Run, gate *model.ApprovalGate, decision model.Decision) error {
	now := s.now()
	gate.Status = model.GateStatusRejected
	gate.ResolvedAt = &now
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("resolving rejected gate: %w", err)
	}
	run.Status = model.RunStatusFailed
	run.CompletedAt = &now
	run.LastError = fmt.Sprintf("approval gate %d rejected by %s", gate.StepIndex, decision.UserID)
	if err := s.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("failing run %s after rejection: %w", run.ID, err)
	}
	return s.emit(ctx, db, run, eventRunRejected, map[string]any{
		"step_index":  gate.StepIndex,
		"rejected_by": decision.UserID,
		"comment":     decision.Comment,
	})
}

// ApplyTimeout resolves a timed-out OPEN gate per the runbook step's
// TimeoutAction policy (§4.5):
//
//   - abort        -> gate EXPIRED, run FAILED (the run cannot proceed)
//   - auto_approve -> gate APPROVED, run re-armed RUNNING (proceed as if approved)
//   - escalate     -> gate ESCALATED, run ESCALATED; the run is held for a higher
//     tier. Escalation is NOT auto-advancing: the run sits in ESCALATED (excluded
//     from the driver's claim query) until a human ApproveGate/RejectGate
//     resolves it, exactly mirroring the DR cutback gate.
//
// The sweeper calls this inside a SYSTEM transaction (RunSystemTx) because it
// operates across tenants; the gate carries its TenantID for the event.
func (s *GateService) ApplyTimeout(ctx context.Context, db repository.DBTX, gate *model.ApprovalGate, timeoutAction string) error {
	if gate.Status != model.GateStatusOpen {
		// Resolved between the sweep listing and now (a concurrent human
		// decision): nothing to do.
		return nil
	}
	run, err := s.repo.GetRun(ctx, db, gate.TenantID, gate.RunID)
	if err != nil {
		return err
	}
	if run.Status != model.RunStatusAwaitingApproval {
		// The run moved on (e.g. cancelled) — the gate is stale; just close it.
		return s.expireGate(ctx, db, gate, run)
	}

	switch timeoutAction {
	case model.TimeoutActionAbort:
		return s.timeoutAbort(ctx, db, run, gate)
	case model.TimeoutActionAutoApprove:
		return s.timeoutAutoApprove(ctx, db, run, gate)
	case model.TimeoutActionEscalate:
		return s.timeoutEscalate(ctx, db, run, gate)
	default:
		// Unknown/empty policy defaults to escalate (the safe, non-destructive
		// choice — never silently auto-approve a side-effecting runbook).
		return s.timeoutEscalate(ctx, db, run, gate)
	}
}

func (s *GateService) timeoutAbort(ctx context.Context, db repository.DBTX, run *model.Run, gate *model.ApprovalGate) error {
	now := s.now()
	gate.Status = model.GateStatusExpired
	gate.ResolvedAt = &now
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("expiring gate on abort: %w", err)
	}
	run.Status = model.RunStatusAborted
	run.CompletedAt = &now
	run.LastError = fmt.Sprintf("approval gate %d timed out (abort policy)", gate.StepIndex)
	if err := s.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("aborting run %s on gate timeout: %w", run.ID, err)
	}
	return s.emit(ctx, db, run, eventRunFailed, map[string]any{
		"step_index": gate.StepIndex,
		"reason":     "gate_timeout_abort",
	})
}

func (s *GateService) timeoutAutoApprove(ctx context.Context, db repository.DBTX, run *model.Run, gate *model.ApprovalGate) error {
	now := s.now()
	gate.Status = model.GateStatusApproved
	gate.ResolvedAt = &now
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("auto-approving gate on timeout: %w", err)
	}
	run.Status = model.RunStatusRunning
	run.LastError = ""
	if err := s.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("re-arming run %s after auto-approve: %w", run.ID, err)
	}
	return s.emit(ctx, db, run, eventRunApproved, map[string]any{
		"step_index": gate.StepIndex,
		"reason":     "gate_timeout_auto_approve",
	})
}

func (s *GateService) timeoutEscalate(ctx context.Context, db repository.DBTX, run *model.Run, gate *model.ApprovalGate) error {
	gate.Status = model.GateStatusEscalated
	// Escalation keeps the gate awaiting a (higher-tier) human decision; clearing
	// the deadline stops the sweeper from re-escalating it every tick.
	gate.DeadlineAt = nil
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("escalating gate on timeout: %w", err)
	}
	run.Status = model.RunStatusEscalated
	run.LastError = fmt.Sprintf("approval gate %d timed out (escalated)", gate.StepIndex)
	if err := s.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("escalating run %s on gate timeout: %w", run.ID, err)
	}
	return s.emit(ctx, db, run, eventRunEscalated, map[string]any{
		"step_index": gate.StepIndex,
		"reason":     "gate_timeout_escalate",
	})
}

// expireGate closes a stale gate whose run already moved on, without touching the
// run state.
func (s *GateService) expireGate(ctx context.Context, db repository.DBTX, gate *model.ApprovalGate, run *model.Run) error {
	now := s.now()
	gate.Status = model.GateStatusExpired
	gate.ResolvedAt = &now
	if err := s.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
		return fmt.Errorf("expiring stale gate (run %s step %d): %w", run.ID, gate.StepIndex, err)
	}
	return nil
}

// appendDecision records a vote, replacing a prior vote by the same user so a
// user changing their mind does not double-count toward quorum.
func appendDecision(gate *model.ApprovalGate, decision model.Decision) {
	for i := range gate.Decisions {
		if gate.Decisions[i].UserID == decision.UserID {
			gate.Decisions[i] = decision
			return
		}
	}
	gate.Decisions = append(gate.Decisions, decision)
}

// emit stages a gate lifecycle event in the caller's transaction.
func (s *GateService) emit(ctx context.Context, db repository.DBTX, run *model.Run, eventType string, payload map[string]any) error {
	data := copyMap(payload)
	if data == nil {
		data = map[string]any{}
	}
	data["run_id"] = run.ID
	data["automation_id"] = run.AutomationID
	data["runbook_id"] = run.RunbookID
	data["status"] = run.Status
	return s.events.Emit(ctx, db, run.TenantID, eventType, data)
}
