// Package failover drives the non-skippable ClarioDR gate sequence:
// Validate -> Approve -> Execute -> Attest.
package failover

import (
	"context"
	"errors"
	"fmt"
	"time"

	drmetrics "github.com/clario360/platform/internal/dr/metrics"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	stepQuiesceFinalSync = "quiesce.final_sync"
	stepGateValidate     = "gate1.validate"
	stepGateApprovalWait = "gate2.await_approval"
	stepGateApproved     = "gate2.approved"
	stepGateExecute      = "gate3.execute"
	stepGateHealth       = "gate3.health"
	stepGateAttest       = "gate4.attest"
)

// Repository is the durable state surface the driver needs. repository.Repository
// satisfies this interface directly.
type Repository interface {
	UpdateFailoverRunStatus(ctx context.Context, db repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error
	CompleteFailoverRunFromStatus(ctx context.Context, db repository.DBTX, tenantID, id, finalStatus, expectedStatus string, lastError *string) error
	PinRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID, id, recoveryPointID string) error
	UpsertFailoverStep(ctx context.Context, db repository.DBTX, step *model.FailoverStep) error
	ListFailoverSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.FailoverStep, error)
	CompleteFailoverRun(ctx context.Context, db repository.DBTX, tenantID, id, finalStatus string) error
	CreateAttestation(ctx context.Context, db repository.DBTX, a *model.Attestation) error
}

// RecoveryPointDecision is the Gate-1 validation result. RecoveryPointID must
// identify an immutable, already sealed recovery point.
type RecoveryPointDecision struct {
	RecoveryPointID string
	RPOSeconds      int
	ValidationRatio float64
	Details         map[string]any
}

// Passed reports whether the decision can advance Gate 1.
func (d RecoveryPointDecision) Passed() bool {
	return d.RecoveryPointID != "" && d.ValidationRatio >= 0.999
}

// GateValidator validates and selects the recovery point to pin for a run.
type GateValidator interface {
	ValidateRecoveryPoint(ctx context.Context, run *model.FailoverRun) (RecoveryPointDecision, error)
}

// FinalSyncResult is the durable output of the quiesce/final-sync step.
// RecoveryPointID identifies the freshly sealed point that Gate 1 must validate
// and pin before the run can ask for approval.
type FinalSyncResult struct {
	RecoveryPointID string
	RPOSeconds      int
	ValidationRatio float64
	Details         map[string]any
}

// FinalSyncer performs the side-effecting "quiesce + final sync" work while a
// run is in QUIESCING. Implementations must be idempotent for a run ID:
// re-running after a driver restart should return the same final-sync outcome.
type FinalSyncer interface {
	QuiesceAndSync(ctx context.Context, run *model.FailoverRun) (FinalSyncResult, error)
}

// Executor performs the side-effecting recovery boot/cutover step. For drill
// runs, implementations must use isolated mappings and leave production intact.
type Executor interface {
	Execute(ctx context.Context, run *model.FailoverRun) error
}

// DetailedExecutor is an optional extension for executors that can return a
// durable audit detail for the Gate-3 step.
type DetailedExecutor interface {
	ExecuteWithDetail(ctx context.Context, run *model.FailoverRun) (map[string]any, error)
}

// HealthValidator proves recovered workloads are usable before attestation.
type HealthValidator interface {
	ValidateRecoveredWorkloads(ctx context.Context, run *model.FailoverRun) (map[string]any, error)
}

// AttestationBuilder builds the immutable Gate-4 attestation payload after the
// recovered workloads have passed validation.
type AttestationBuilder interface {
	BuildAttestation(ctx context.Context, run *model.FailoverRun) (*model.Attestation, error)
}

// EventSink records lifecycle/audit events transactionally with state changes.
type EventSink interface {
	Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload any) error
}

// OutboxSink stages DR events in event_outbox.
type OutboxSink struct{}

// Emit stages a DR lifecycle event in the same transaction as the state change.
func (OutboxSink) Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload any) error {
	event, err := events.NewEvent(eventType, "clario-dr-service", tenantID, payload)
	if err != nil {
		return err
	}
	return outbox.Write(ctx, db, events.Topics.DREvents, event)
}

type nopSink struct{}

func (nopSink) Emit(context.Context, repository.DBTX, string, string, any) error { return nil }

// RecordedFailureError means a gate collaborator failed and the driver has
// already durably recorded the failed step, terminal run status, and outbox event
// in the caller's transaction. The loop may commit this transaction. Plain
// errors from Advance are persistence or programming failures and must roll back.
type RecordedFailureError struct {
	RunID       string
	Cause       error
	FinalStatus string
}

func (e *RecordedFailureError) Error() string {
	if e == nil || e.Cause == nil {
		return "failover: recorded run failure"
	}
	return e.Cause.Error()
}

func (e *RecordedFailureError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// IsRecordedFailure reports whether err is a gate failure whose terminal state
// has already been written transactionally.
func IsRecordedFailure(err error) bool {
	var recorded *RecordedFailureError
	return errors.As(err, &recorded)
}

// Driver advances failover/drill runs one durable state at a time. It is safe to
// re-run after a crash because every transition is guarded by the expected state
// and every step row is keyed by (run_id, step).
type Driver struct {
	repo     Repository
	final    FinalSyncer
	validate GateValidator
	exec     Executor
	health   HealthValidator
	attest   AttestationBuilder
	events   EventSink
	now      func() time.Time
	metrics  *drmetrics.Metrics
}

// Config wires a Driver.
type Config struct {
	Repository Repository
	// FinalSyncer runs the QUIESCING quiesce/final-sync side effect.
	FinalSyncer FinalSyncer
	Validator   GateValidator
	Executor    Executor
	Health      HealthValidator
	Attester    AttestationBuilder
	Events      EventSink
	Now         func() time.Time
	// Metrics, when set, records dr_failover_rto_seconds when a run completes.
	// Nil disables emission (e.g. unit tests).
	Metrics *drmetrics.Metrics
}

// New constructs a failover driver.
func New(cfg Config) (*Driver, error) {
	if cfg.Repository == nil {
		return nil, errors.New("failover: repository is required")
	}
	if cfg.FinalSyncer == nil {
		return nil, errors.New("failover: final syncer is required")
	}
	if cfg.Validator == nil {
		return nil, errors.New("failover: validator is required")
	}
	if cfg.Executor == nil {
		return nil, errors.New("failover: executor is required")
	}
	if cfg.Health == nil {
		return nil, errors.New("failover: health validator is required")
	}
	if cfg.Attester == nil {
		return nil, errors.New("failover: attester is required")
	}
	if cfg.Events == nil {
		cfg.Events = nopSink{}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Driver{
		repo:     cfg.Repository,
		final:    cfg.FinalSyncer,
		validate: cfg.Validator,
		exec:     cfg.Executor,
		health:   cfg.Health,
		attest:   cfg.Attester,
		events:   cfg.Events,
		now:      cfg.Now,
		metrics:  cfg.Metrics,
	}, nil
}

// Advance advances one claimed run by exactly one state. The caller owns the
// transaction boundary and should pass the same tx to make step, status and
// outbox writes atomic.
func (d *Driver) Advance(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	if run == nil {
		return errors.New("failover: run is required")
	}
	switch run.Status {
	case model.StatusInitiated:
		return d.beginQuiescing(ctx, db, run)
	case model.StatusQuiescing:
		return d.quiesceFinalSync(ctx, db, run)
	case model.StatusSyncConfirmed:
		return d.awaitApproval(ctx, db, run)
	case model.StatusAwaitingApproval:
		return nil
	case model.StatusApproved:
		return d.startExecution(ctx, db, run)
	case model.StatusExecuting:
		return d.execute(ctx, db, run)
	case model.StatusValidating:
		return d.validateRecovered(ctx, db, run)
	case model.StatusAttested:
		return d.attestAndComplete(ctx, db, run)
	default:
		if run.IsTerminal() {
			return nil
		}
		return fmt.Errorf("failover: unsupported run state %q: %w", run.Status, model.ErrInvalidState)
	}
}

func (d *Driver) beginQuiescing(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	detail := map[string]any{
		"mode":                 run.Mode,
		"final_sync":           true,
		"recovery_point_stage": "gate1.validate",
	}
	if _, err := d.startStep(ctx, db, run, stepQuiesceFinalSync, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusQuiescing, model.StatusInitiated, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.quiescing", detail)
}

func (d *Driver) quiesceFinalSync(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, prior, alreadySynced, err := d.quiesceStepState(ctx, db, run)
	if err != nil {
		return err
	}
	if alreadySynced {
		if prior.RecoveryPointID != "" {
			run.RecoveryPointID = stringPtr(prior.RecoveryPointID)
		}
		return d.validateGate(ctx, db, run)
	}
	if step == nil {
		step, err = d.startStep(ctx, db, run, stepQuiesceFinalSync, map[string]any{
			"mode":                 run.Mode,
			"final_sync":           true,
			"recovery_point_stage": "gate1.validate",
		})
		if err != nil {
			return err
		}
	}

	result, err := d.final.QuiesceAndSync(ctx, run)
	if err != nil {
		return d.failRun(ctx, db, run, step, fmt.Errorf("quiesce/final sync failed: %w", err))
	}
	if run.Mode == model.ModeReal && result.RecoveryPointID == "" {
		return d.failRun(ctx, db, run, step, errors.New("quiesce/final sync returned empty recovery point"))
	}
	detail := finalSyncDetail(run, result)
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if result.RecoveryPointID != "" {
		run.RecoveryPointID = stringPtr(result.RecoveryPointID)
	}
	if err := d.emit(ctx, db, run, "datastream.dr.failover.quiesced", detail); err != nil {
		return err
	}
	return d.validateGate(ctx, db, run)
}

func (d *Driver) validateGate(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, err := d.startStep(ctx, db, run, stepGateValidate, nil)
	if err != nil {
		return err
	}
	decision, err := d.validate.ValidateRecoveryPoint(ctx, run)
	if err != nil {
		return d.failRun(ctx, db, run, step, err)
	}
	if !decision.Passed() {
		if reason, ok := detailString(decision.Details, "promotion_blocked_reason"); ok && reason != "" {
			return d.failRun(ctx, db, run, step, fmt.Errorf("recovery point promotion blocked: %s: %w", reason, model.ErrInvalidState))
		}
		return d.failRun(ctx, db, run, step, fmt.Errorf("recovery point validation %.4f below 0.999: %w", decision.ValidationRatio, model.ErrInvalidState))
	}
	if err := d.repo.PinRecoveryPoint(ctx, db, run.TenantID, run.ID, decision.RecoveryPointID); err != nil {
		return err
	}
	run.RecoveryPointID = stringPtr(decision.RecoveryPointID)
	detail := map[string]any{
		"recovery_point_id": decision.RecoveryPointID,
		"rpo_seconds":       decision.RPOSeconds,
		"validation_ratio":  decision.ValidationRatio,
	}
	for k, v := range decision.Details {
		detail[k] = v
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusSyncConfirmed, model.StatusQuiescing, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.gate1.passed", detail)
}

func (d *Driver) awaitApproval(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, err := d.startStep(ctx, db, run, stepGateApprovalWait, map[string]any{"approval_required": true})
	if err != nil {
		return err
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, map[string]any{"approval_required": true}); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusAwaitingApproval, model.StatusSyncConfirmed, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.approval.required", nil)
}

func (d *Driver) startExecution(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	detail := map[string]any{"approved_by": run.ApprovedBy}
	step, err := d.startStep(ctx, db, run, stepGateApproved, detail)
	if err != nil {
		return err
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusExecuting, model.StatusApproved, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.gate2.approved", detail)
}

func (d *Driver) execute(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, err := d.startStep(ctx, db, run, stepGateExecute, map[string]any{"mode": run.Mode})
	if err != nil {
		return err
	}
	detail := map[string]any{"mode": run.Mode}
	if detailed, ok := d.exec.(DetailedExecutor); ok {
		detail, err = detailed.ExecuteWithDetail(ctx, run)
		if detail == nil {
			detail = map[string]any{"mode": run.Mode}
		}
	} else {
		err = d.exec.Execute(ctx, run)
	}
	if err != nil {
		return d.failRun(ctx, db, run, step, err)
	}
	if _, ok := detail["mode"]; !ok {
		detail["mode"] = run.Mode
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusValidating, model.StatusExecuting, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.gate3.executed", detail)
}

func (d *Driver) validateRecovered(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, err := d.startStep(ctx, db, run, stepGateHealth, nil)
	if err != nil {
		return err
	}
	detail, err := d.health.ValidateRecoveredWorkloads(ctx, run)
	if err != nil {
		return d.failRun(ctx, db, run, step, err)
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, model.StatusAttested, model.StatusValidating, nil); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failover.recovery.validated", detail)
}

func (d *Driver) attestAndComplete(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error {
	step, err := d.startStep(ctx, db, run, stepGateAttest, nil)
	if err != nil {
		return err
	}
	att, err := d.attest.BuildAttestation(ctx, run)
	if err != nil {
		return d.failRun(ctx, db, run, step, err)
	}
	if att == nil {
		return d.failRun(ctx, db, run, step, errors.New("attestation builder returned nil"))
	}
	att.TenantID = run.TenantID
	att.RunID = run.ID
	if err := d.repo.CreateAttestation(ctx, db, att); err != nil {
		return err
	}
	detail := map[string]any{
		"attestation_id":    att.ID,
		"report_object_key": att.ReportObjectKey,
		"content_hash":      att.ContentHash,
	}
	if err := d.finishStep(ctx, db, step, model.StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.repo.CompleteFailoverRun(ctx, db, run.TenantID, run.ID, model.StatusCompleted); err != nil {
		return err
	}
	now := d.now().UTC()
	run.Status = model.StatusCompleted
	run.CompletedAt = &now
	// SLO board (DESIGN §11): record the achieved recovery time by mode.
	d.metrics.ObserveRTO(run.Mode, float64(att.RTOActualSeconds))
	return d.emit(ctx, db, run, "datastream.dr.attestation.issued", detail)
}

func (d *Driver) startStep(ctx context.Context, db repository.DBTX, run *model.FailoverRun, name string, detail map[string]any) (*model.FailoverStep, error) {
	now := d.now().UTC()
	step := &model.FailoverStep{
		RunID:     run.ID,
		Step:      name,
		Status:    model.StepStatusRunning,
		Detail:    detail,
		StartedAt: now,
	}
	if err := d.repo.UpsertFailoverStep(ctx, db, step); err != nil {
		return nil, err
	}
	return step, nil
}

func (d *Driver) finishStep(ctx context.Context, db repository.DBTX, step *model.FailoverStep, status string, detail map[string]any) error {
	now := d.now().UTC()
	step.Status = status
	step.Detail = detail
	step.FinishedAt = &now
	return d.repo.UpsertFailoverStep(ctx, db, step)
}

func (d *Driver) transition(ctx context.Context, db repository.DBTX, run *model.FailoverRun, next, expected string, cause error) error {
	var msg *string
	if cause != nil {
		s := cause.Error()
		msg = &s
	}
	if err := d.repo.UpdateFailoverRunStatus(ctx, db, run.TenantID, run.ID, next, expected, msg); err != nil {
		return err
	}
	run.Status = next
	run.LastError = msg
	run.UpdatedAt = d.now().UTC()
	return nil
}

func (d *Driver) failRun(ctx context.Context, db repository.DBTX, run *model.FailoverRun, step *model.FailoverStep, cause error) error {
	if cause == nil {
		cause = errors.New("failover gate failed")
	}
	previousStatus := run.Status
	finalStatus := failureStatus(previousStatus)
	var recordErrs []error
	if step != nil {
		if err := d.finishStep(ctx, db, step, model.StepStatusFailed, map[string]any{"error": cause.Error()}); err != nil {
			recordErrs = append(recordErrs, fmt.Errorf("failed step write: %w", err))
		}
	}
	if err := d.completeTerminal(ctx, db, run, finalStatus, previousStatus, cause); err != nil {
		recordErrs = append(recordErrs, fmt.Errorf("terminal status write: %w", err))
	}
	if err := d.emit(ctx, db, run, "datastream.dr.failover.failed", map[string]any{
		"previous_status": previousStatus,
		"final_status":    finalStatus,
		"error":           cause.Error(),
	}); err != nil {
		recordErrs = append(recordErrs, fmt.Errorf("failure event write: %w", err))
	}
	if len(recordErrs) > 0 {
		return fmt.Errorf("failover: failed to durably record failure for run %s: %w; original cause: %v", run.ID, errors.Join(recordErrs...), cause)
	}
	return &RecordedFailureError{RunID: run.ID, Cause: cause, FinalStatus: finalStatus}
}

func (d *Driver) completeTerminal(ctx context.Context, db repository.DBTX, run *model.FailoverRun, finalStatus, expected string, cause error) error {
	var msg *string
	if cause != nil {
		s := cause.Error()
		msg = &s
	}
	if err := d.repo.CompleteFailoverRunFromStatus(ctx, db, run.TenantID, run.ID, finalStatus, expected, msg); err != nil {
		return err
	}
	now := d.now().UTC()
	run.Status = finalStatus
	run.LastError = msg
	run.CompletedAt = &now
	run.UpdatedAt = now
	return nil
}

func failureStatus(status string) string {
	switch status {
	case model.StatusExecuting, model.StatusValidating:
		return model.StatusRolledBack
	default:
		return model.StatusFailed
	}
}

func (d *Driver) quiesceStepState(ctx context.Context, db repository.DBTX, run *model.FailoverRun) (*model.FailoverStep, FinalSyncResult, bool, error) {
	steps, err := d.repo.ListFailoverSteps(ctx, db, run.ID)
	if err != nil {
		return nil, FinalSyncResult{}, false, err
	}
	for _, step := range steps {
		if step.Step != stepQuiesceFinalSync {
			continue
		}
		if step.Status != model.StepStatusPassed {
			return step, FinalSyncResult{}, false, nil
		}
		result, ok := finalSyncResultFromDetail(step.Detail)
		if !ok {
			if run.Mode != model.ModeReal {
				return step, FinalSyncResult{Details: copyMap(step.Detail)}, true, nil
			}
			return step, FinalSyncResult{}, false, fmt.Errorf("failover: quiesce step for run %s passed without recovery_point_id: %w", run.ID, model.ErrInvalidState)
		}
		return step, result, true, nil
	}
	return nil, FinalSyncResult{}, false, nil
}

func finalSyncDetail(run *model.FailoverRun, result FinalSyncResult) map[string]any {
	detail := map[string]any{
		"mode":       run.Mode,
		"final_sync": true,
	}
	if result.RecoveryPointID != "" {
		detail["recovery_point_id"] = result.RecoveryPointID
		detail["rpo_seconds"] = result.RPOSeconds
		detail["validation_ratio"] = result.ValidationRatio
	}
	for k, v := range result.Details {
		if _, exists := detail[k]; !exists {
			detail[k] = v
		}
	}
	return detail
}

func finalSyncResultFromDetail(detail map[string]any) (FinalSyncResult, bool) {
	rp, ok := detailString(detail, "recovery_point_id")
	if !ok || rp == "" {
		return FinalSyncResult{}, false
	}
	result := FinalSyncResult{
		RecoveryPointID: rp,
		Details:         copyMap(detail),
	}
	if rpo, ok := detailInt(detail, "rpo_seconds"); ok {
		result.RPOSeconds = rpo
	}
	if ratio, ok := detailFloat(detail, "validation_ratio"); ok {
		result.ValidationRatio = ratio
	}
	return result, true
}

func detailString(detail map[string]any, key string) (string, bool) {
	if detail == nil {
		return "", false
	}
	v, ok := detail[key]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func detailInt(detail map[string]any, key string) (int, bool) {
	if detail == nil {
		return 0, false
	}
	v, ok := detail[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	default:
		return 0, false
	}
}

func detailFloat(detail map[string]any, key string) (float64, bool) {
	if detail == nil {
		return 0, false
	}
	v, ok := detail[key]
	if !ok {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func stringPtr(s string) *string {
	return &s
}

func (d *Driver) emit(ctx context.Context, db repository.DBTX, run *model.FailoverRun, eventType string, payload any) error {
	if payload == nil {
		payload = map[string]any{}
	}
	data, ok := payload.(map[string]any)
	if !ok {
		data = map[string]any{"detail": payload}
	} else {
		data = copyMap(data)
	}
	data["run_id"] = run.ID
	data["group_id"] = run.GroupID
	data["mode"] = run.Mode
	data["status"] = run.Status
	return d.events.Emit(ctx, db, run.TenantID, eventType, data)
}

func copyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
