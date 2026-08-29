package failback

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// reverseEventTopic is the DR lifecycle topic the failback FSM emits onto. It is
// the existing datastream.dr.events topic (events.Topics.DREvents); a literal is
// used here so the package does not edit the shared topics file (disjoint
// ownership). The integrate phase confirms this matches events.Topics.DREvents.
const reverseEventTopic = "datastream.dr.events"

// RunStore is the durable state surface the failback driver needs. *Store
// satisfies it directly.
type RunStore interface {
	UpdateRunStatus(ctx context.Context, db repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error
	SetReverseStream(ctx context.Context, db repository.DBTX, tenantID, id, reverseStreamID string, sourceLSN *string) error
	UpdateDelta(ctx context.Context, db repository.DBTX, tenantID, id string, d DeltaUpdate) error
	MarkConverged(ctx context.Context, db repository.DBTX, tenantID, id string) error
	CompleteRun(ctx context.Context, db repository.DBTX, tenantID, id, expectedStatus, newDirection string) error
	FailRun(ctx context.Context, db repository.DBTX, tenantID, id, expectedStatus string, reason *string) error
	UpsertStep(ctx context.Context, db repository.DBTX, step *FailbackStep) error
}

// ReverseStreamConfig describes the reverse replication stream the failback
// establishes (DR site -> original primary). It is built from the run's sites and
// passed to the ReverseStreamStarter.
type ReverseStreamConfig struct {
	RunID      string
	TenantID   string
	GroupID    string
	FromSite   string // DR site (reverse stream source)
	ToSite     string // original/restored primary (reverse stream target)
	ResumeFrom uint64 // last durably-applied Seq if resuming an existing reverse stream
}

// ReverseStreamHandle is the durable result of starting a reverse stream. The
// driver persists StreamID so a restart reuses the same stream rather than
// starting a duplicate.
type ReverseStreamHandle struct {
	StreamID  string
	SourceLSN string // starting source LSN at the DR head
}

// ReverseStreamStarter establishes the reverse replication stream during
// REVERSE_SYNCING. Implementations MUST be idempotent for a run id: re-starting
// after a driver restart returns the existing stream handle, never a duplicate.
type ReverseStreamStarter interface {
	StartReverseStream(ctx context.Context, cfg ReverseStreamConfig) (ReverseStreamHandle, error)
}

// CutbackExecutor performs the gated, side-effecting cutback: quiesce the DR
// site, flip authority to the restored primary, and direct forward replication
// primary -> DR. It runs only in CUTTING_BACK, which is only reachable after an
// explicit approval. Implementations must be idempotent for a run id.
type CutbackExecutor interface {
	ExecuteCutback(ctx context.Context, run *FailbackRun) (map[string]any, error)
}

// EventSink records lifecycle/audit events transactionally with state changes.
type EventSink interface {
	Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload any) error
}

// OutboxSink stages failback events in event_outbox (datastream.dr.events),
// mirroring failover.OutboxSink so the event commits in the same transaction as
// the state change.
type OutboxSink struct{}

// Emit stages a DR failback lifecycle event in the caller's transaction.
func (OutboxSink) Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload any) error {
	event, err := events.NewEvent(eventType, "clario-dr-service", tenantID, payload)
	if err != nil {
		return err
	}
	return outbox.Write(ctx, db, reverseEventTopic, event)
}

type nopSink struct{}

func (nopSink) Emit(context.Context, repository.DBTX, string, string, any) error { return nil }

// RecordedFailureError means a step collaborator failed and the driver has
// already durably recorded the failed step, terminal FAILED status, and outbox
// event in the caller's transaction. The loop may commit this transaction. Plain
// errors from Advance are persistence/programming failures and must roll back.
// This mirrors failover.RecordedFailureError exactly.
type RecordedFailureError struct {
	RunID string
	Cause error
}

func (e *RecordedFailureError) Error() string {
	if e == nil || e.Cause == nil {
		return "failback: recorded run failure"
	}
	return e.Cause.Error()
}

func (e *RecordedFailureError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// IsRecordedFailure reports whether err is a step failure whose terminal state
// has already been written transactionally.
func IsRecordedFailure(err error) bool {
	var recorded *RecordedFailureError
	return errors.As(err, &recorded)
}

// Driver advances failback runs one durable state at a time. It is safe to re-run
// after a crash because every transition is guarded by the expected state and
// every step row is keyed by (run_id, step). It mirrors failover.Driver's gate
// discipline in the reverse direction.
type Driver struct {
	store   RunStore
	starter ReverseStreamStarter
	tracker *DeltaTracker
	cutback CutbackExecutor
	events  EventSink
	now     func() time.Time
}

// Config wires a failback Driver.
type Config struct {
	Store   RunStore
	Starter ReverseStreamStarter
	Tracker *DeltaTracker
	Cutback CutbackExecutor
	Events  EventSink
	Now     func() time.Time
}

// New constructs a failback driver.
func New(cfg Config) (*Driver, error) {
	if cfg.Store == nil {
		return nil, errors.New("failback: store is required")
	}
	if cfg.Starter == nil {
		return nil, errors.New("failback: reverse-stream starter is required")
	}
	if cfg.Tracker == nil {
		return nil, errors.New("failback: delta tracker is required")
	}
	if cfg.Cutback == nil {
		return nil, errors.New("failback: cutback executor is required")
	}
	if cfg.Events == nil {
		cfg.Events = nopSink{}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Driver{
		store:   cfg.Store,
		starter: cfg.Starter,
		tracker: cfg.Tracker,
		cutback: cfg.Cutback,
		events:  cfg.Events,
		now:     cfg.Now,
	}, nil
}

// Advance advances one claimed run by exactly one state. The caller owns the
// transaction boundary and passes the same tx so step, status and outbox writes
// are atomic. Mirrors failover.Driver.Advance.
func (d *Driver) Advance(ctx context.Context, db repository.DBTX, run *FailbackRun) error {
	if run == nil {
		return errors.New("failback: run is required")
	}
	switch run.Status {
	case StatusPlanning:
		return d.planReverse(ctx, db, run)
	case StatusReverseSyncing:
		return d.reverseSync(ctx, db, run)
	case StatusDeltaConverged:
		return d.awaitCutbackApproval(ctx, db, run)
	case StatusAwaitingCutbackApproval:
		// The human cutback gate. The driver never auto-advances it: the loop
		// excludes this state from claims, and a direct Advance here is a no-op
		// (the run only leaves via /approve-cutback). Advancing past it WITHOUT an
		// approval is therefore impossible through the driver — and explicitly
		// rejected to surface a programming error if ever invoked directly.
		if !run.IsApproved() {
			return fmt.Errorf("failback: cutback gate not approved for run %s: %w", run.ID, ErrNotApproved)
		}
		return nil
	case StatusCuttingBack:
		return d.executeCutback(ctx, db, run)
	default:
		if run.IsTerminal() {
			return nil
		}
		return fmt.Errorf("failback: unsupported run state %q: %w", run.Status, ErrInvalidState)
	}
}

// planReverse: PLANNING -> REVERSE_SYNCING. Establishes the reverse stream
// (idempotently) and records its id + starting LSN durably so a restart reuses it.
func (d *Driver) planReverse(ctx context.Context, db repository.DBTX, run *FailbackRun) error {
	step, err := d.startStep(ctx, db, run, StepPlanReverse, map[string]any{
		"from_site": run.FromSite,
		"to_site":   run.ToSite,
		"direction": DirectionDRToPrimary,
	})
	if err != nil {
		return err
	}

	var resumeFrom uint64
	handle, err := d.starter.StartReverseStream(ctx, ReverseStreamConfig{
		RunID:      run.ID,
		TenantID:   run.TenantID,
		GroupID:    run.GroupID,
		FromSite:   run.FromSite,
		ToSite:     run.ToSite,
		ResumeFrom: resumeFrom,
	})
	if err != nil {
		return d.failRun(ctx, db, run, step, fmt.Errorf("starting reverse stream: %w", err))
	}
	if handle.StreamID == "" {
		return d.failRun(ctx, db, run, step, errors.New("reverse-stream starter returned empty stream id"))
	}

	var sourceLSN *string
	if handle.SourceLSN != "" {
		s := handle.SourceLSN
		sourceLSN = &s
	}
	if err := d.store.SetReverseStream(ctx, db, run.TenantID, run.ID, handle.StreamID, sourceLSN); err != nil {
		return err
	}
	run.ReverseStreamID = strPtr(handle.StreamID)
	run.SourceLSN = sourceLSN

	detail := map[string]any{
		"reverse_stream_id": handle.StreamID,
		"source_lsn":        handle.SourceLSN,
		"direction":         DirectionDRToPrimary,
	}
	if err := d.finishStep(ctx, db, step, StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, StatusReverseSyncing, StatusPlanning); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failback.reverse_syncing", detail)
}

// reverseSync: REVERSE_SYNCING -> DELTA_CONVERGED, but ONLY when the DeltaTracker
// declares convergence (remaining <= threshold AND cutover window open). When not
// yet converged, it persists the latest delta and stays in REVERSE_SYNCING so the
// next tick re-measures — it does NOT advance.
func (d *Driver) reverseSync(ctx context.Context, db repository.DBTX, run *FailbackRun) error {
	if run.ReverseStreamID == nil || *run.ReverseStreamID == "" {
		return fmt.Errorf("failback: run %s in REVERSE_SYNCING without a reverse stream: %w", run.ID, ErrInvalidState)
	}
	measurement, err := d.tracker.Measure(ctx, run, *run.ReverseStreamID)
	if err != nil {
		step, sErr := d.startStep(ctx, db, run, StepReverseSyncing, nil)
		if sErr != nil {
			return sErr
		}
		return d.failRun(ctx, db, run, step, fmt.Errorf("measuring reverse delta: %w", err))
	}

	update := DeltaUpdate{
		BytesRemaining:    measurement.BytesRemaining,
		SeqRemaining:      measurement.SeqRemaining,
		CutoverWindowOpen: measurement.CutoverWindowOpen,
	}
	if measurement.SourceLSN != "" {
		update.SourceLSN = strPtr(measurement.SourceLSN)
	}
	if measurement.AppliedLSN != "" {
		update.AppliedLSN = strPtr(measurement.AppliedLSN)
	}
	if err := d.store.UpdateDelta(ctx, db, run.TenantID, run.ID, update); err != nil {
		return err
	}
	run.DeltaBytesRemaining = measurement.BytesRemaining
	run.DeltaSeqRemaining = measurement.SeqRemaining
	run.CutoverWindowOpen = measurement.CutoverWindowOpen
	run.SourceLSN = update.SourceLSN
	run.AppliedLSN = update.AppliedLSN

	if !measurement.Converged {
		// Not converged yet: emit a progress event and stay in REVERSE_SYNCING.
		// The status does NOT change, so the next claim re-measures.
		return d.emit(ctx, db, run, "datastream.dr.failback.reverse_progress", map[string]any{
			"delta_bytes_remaining":    measurement.BytesRemaining,
			"delta_seq_remaining":      measurement.SeqRemaining,
			"converge_threshold_bytes": run.ConvergeThresholdBytes,
			"cutover_window_open":      measurement.CutoverWindowOpen,
		})
	}

	step, err := d.startStep(ctx, db, run, StepDeltaConverged, nil)
	if err != nil {
		return err
	}
	detail := map[string]any{
		"delta_bytes_remaining":    measurement.BytesRemaining,
		"delta_seq_remaining":      measurement.SeqRemaining,
		"converge_threshold_bytes": run.ConvergeThresholdBytes,
		"source_lsn":               measurement.SourceLSN,
		"applied_lsn":              measurement.AppliedLSN,
	}
	if err := d.store.MarkConverged(ctx, db, run.TenantID, run.ID); err != nil {
		return err
	}
	if err := d.finishStep(ctx, db, step, StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, StatusDeltaConverged, StatusReverseSyncing); err != nil {
		return err
	}
	now := d.now().UTC()
	run.LastConvergedAt = &now
	return d.emit(ctx, db, run, "datastream.dr.failback.delta_converged", detail)
}

// awaitCutbackApproval: DELTA_CONVERGED -> AWAITING_CUTBACK_APPROVAL. Parks the
// run at the human cutback gate; the driver will not claim it again until an
// approval transitions it to CUTTING_BACK.
func (d *Driver) awaitCutbackApproval(ctx context.Context, db repository.DBTX, run *FailbackRun) error {
	step, err := d.startStep(ctx, db, run, StepAwaitApproval, map[string]any{"approval_required": true})
	if err != nil {
		return err
	}
	if err := d.finishStep(ctx, db, step, StepStatusPassed, map[string]any{"approval_required": true}); err != nil {
		return err
	}
	if err := d.transition(ctx, db, run, StatusAwaitingCutbackApproval, StatusDeltaConverged); err != nil {
		return err
	}
	return d.emit(ctx, db, run, "datastream.dr.failback.cutback_approval.required", nil)
}

// executeCutback: CUTTING_BACK -> COMPLETED. Runs only after an explicit approval
// (CUTTING_BACK is unreachable without one). Performs the gated cutback and
// records the new forward replication direction.
func (d *Driver) executeCutback(ctx context.Context, db repository.DBTX, run *FailbackRun) error {
	if !run.IsApproved() {
		// Defence in depth: CUTTING_BACK is only reachable via ApproveCutback,
		// which sets approved_by atomically. If we ever see it unset, refuse.
		step, sErr := d.startStep(ctx, db, run, StepCutback, nil)
		if sErr != nil {
			return sErr
		}
		return d.failRun(ctx, db, run, step, fmt.Errorf("cutback reached without approval: %w", ErrNotApproved))
	}
	step, err := d.startStep(ctx, db, run, StepCutback, map[string]any{"approved_by": run.ApprovedBy})
	if err != nil {
		return err
	}
	detail, err := d.cutback.ExecuteCutback(ctx, run)
	if err != nil {
		return d.failRun(ctx, db, run, step, fmt.Errorf("executing cutback: %w", err))
	}
	if detail == nil {
		detail = map[string]any{}
	}
	detail["new_direction"] = DirectionPrimaryToDR
	detail["to_site"] = run.ToSite
	if err := d.finishStep(ctx, db, step, StepStatusPassed, detail); err != nil {
		return err
	}
	if err := d.store.CompleteRun(ctx, db, run.TenantID, run.ID, StatusCuttingBack, DirectionPrimaryToDR); err != nil {
		return err
	}
	now := d.now().UTC()
	run.Status = StatusCompleted
	run.NewDirection = strPtr(DirectionPrimaryToDR)
	run.CompletedAt = &now
	run.LastError = nil
	return d.emit(ctx, db, run, "datastream.dr.failback.completed", detail)
}

func (d *Driver) startStep(ctx context.Context, db repository.DBTX, run *FailbackRun, name string, detail map[string]any) (*FailbackStep, error) {
	step := &FailbackStep{
		RunID:     run.ID,
		Step:      name,
		Status:    StepStatusRunning,
		Detail:    detail,
		StartedAt: d.now().UTC(),
	}
	if err := d.store.UpsertStep(ctx, db, step); err != nil {
		return nil, err
	}
	return step, nil
}

func (d *Driver) finishStep(ctx context.Context, db repository.DBTX, step *FailbackStep, status string, detail map[string]any) error {
	now := d.now().UTC()
	step.Status = status
	step.Detail = detail
	step.FinishedAt = &now
	return d.store.UpsertStep(ctx, db, step)
}

func (d *Driver) transition(ctx context.Context, db repository.DBTX, run *FailbackRun, next, expected string) error {
	if err := d.store.UpdateRunStatus(ctx, db, run.TenantID, run.ID, next, expected, nil); err != nil {
		return err
	}
	run.Status = next
	run.LastError = nil
	run.UpdatedAt = d.now().UTC()
	return nil
}

// failRun records a step's failure, the terminal FAILED status, and a failure
// event in the caller's tx, then returns a RecordedFailureError so the loop
// commits the durable failure. A persistence error while recording is returned as
// a plain error so the loop rolls back and retries. Mirrors failover.failRun.
func (d *Driver) failRun(ctx context.Context, db repository.DBTX, run *FailbackRun, step *FailbackStep, cause error) error {
	if cause == nil {
		cause = errors.New("failback step failed")
	}
	previousStatus := run.Status
	var recordErrs []error
	if step != nil {
		if err := d.finishStep(ctx, db, step, StepStatusFailed, map[string]any{"error": cause.Error()}); err != nil {
			recordErrs = append(recordErrs, fmt.Errorf("failed step write: %w", err))
		}
	}
	reason := cause.Error()
	if err := d.store.FailRun(ctx, db, run.TenantID, run.ID, previousStatus, &reason); err != nil {
		recordErrs = append(recordErrs, fmt.Errorf("terminal status write: %w", err))
	} else {
		now := d.now().UTC()
		run.Status = StatusFailed
		run.LastError = &reason
		run.CompletedAt = &now
		run.UpdatedAt = now
	}
	if err := d.emit(ctx, db, run, "datastream.dr.failback.failed", map[string]any{
		"previous_status": previousStatus,
		"error":           cause.Error(),
	}); err != nil {
		recordErrs = append(recordErrs, fmt.Errorf("failure event write: %w", err))
	}
	if len(recordErrs) > 0 {
		return fmt.Errorf("failback: failed to durably record failure for run %s: %w; original cause: %v", run.ID, errors.Join(recordErrs...), cause)
	}
	return &RecordedFailureError{RunID: run.ID, Cause: cause}
}

func (d *Driver) emit(ctx context.Context, db repository.DBTX, run *FailbackRun, eventType string, payload any) error {
	var data map[string]any
	if m, ok := payload.(map[string]any); ok {
		data = copyMap(m)
	} else {
		data = map[string]any{}
		if payload != nil {
			data["detail"] = payload
		}
	}
	data["run_id"] = run.ID
	data["group_id"] = run.GroupID
	data["from_site"] = run.FromSite
	data["to_site"] = run.ToSite
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

func strPtr(s string) *string { return &s }
