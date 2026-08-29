// Package failback drives ClarioDR capability #9: after a failover where the
// workload now runs at the DR site, FAIL BACK to the original (restored) primary
// with minimal data loss. It establishes REVERSE replication (DR site ->
// original primary) to ship the delta written while running at DR, tracks
// convergence, then performs a gated cutback to the restored primary.
//
// The failback FSM mirrors the failover gate discipline exactly
// (DESIGN_DataStream_DR.md §6): a persisted, restart-safe state machine driven by
// a leader-singleton — NOT the workflow engine. Every transition is a durable row
// update guarded by the expected state, with an outbox event in the same
// transaction; a restart re-loads the run and resumes from its persisted status.
//
// States:
//
//	PLANNING -> REVERSE_SYNCING -> DELTA_CONVERGED -> AWAITING_CUTBACK_APPROVAL
//	         -> CUTTING_BACK -> COMPLETED   (+ FAILED on any error)
//
// The cutback is gated on an EXPLICIT human approval: the driver never claims a
// run in AWAITING_CUTBACK_APPROVAL (the §7 partial index excludes it), so the
// cutback can never auto-fire. Advancing past AWAITING_CUTBACK_APPROVAL without an
// approval is rejected as an invalid state.
package failback

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	ErrNotFound        = errors.New("failback: not found")
	ErrInvalidState    = errors.New("failback: invalid state")
	ErrNotApproved     = errors.New("failback: cutback not approved")
	ErrValidation      = errors.New("failback: validation failed")
	ErrAlreadyApproved = errors.New("failback: cutback already approved")
)

// Failback FSM states. The driver claims runs in non-terminal, non-await states;
// AWAITING_CUTBACK_APPROVAL parks until /approve-cutback transitions it.
const (
	// StatusPlanning: the run is created; the reverse stream has not been started.
	StatusPlanning = "PLANNING"
	// StatusReverseSyncing: a reverse replication stream (DR -> original primary)
	// is established and shipping the delta written while running at DR.
	StatusReverseSyncing = "REVERSE_SYNCING"
	// StatusDeltaConverged: the reverse stream's remaining delta is at/under the
	// configured threshold AND a quiesce/cutover window is open.
	StatusDeltaConverged = "DELTA_CONVERGED"
	// StatusAwaitingCutbackApproval: the human cutback gate. The driver never
	// claims this state; only /approve-cutback transitions it onward.
	StatusAwaitingCutbackApproval = "AWAITING_CUTBACK_APPROVAL"
	// StatusCuttingBack: the gated cutback is executing (quiesced DR, redirect to
	// the restored primary, flip authority).
	StatusCuttingBack = "CUTTING_BACK"
	// StatusCompleted: cutback done; the new replication direction is recorded.
	StatusCompleted = "COMPLETED"
	// StatusFailed: any error before COMPLETED.
	StatusFailed = "FAILED"
)

// Failback step statuses (dr_failback_step.status CHECK).
const (
	StepStatusRunning = "running"
	StepStatusPassed  = "passed"
	StepStatusFailed  = "failed"
)

// Step names — one durable per-step audit/idempotency row per gate (§6.2).
const (
	StepPlanReverse    = "plan.reverse_stream"
	StepReverseSyncing = "reverse.syncing"
	StepDeltaConverged = "delta.converged"
	StepAwaitApproval  = "gate.await_cutback_approval"
	StepCutback        = "cutback.execute"
	StepCompleted      = "cutback.completed"
)

// DirectionDRToPrimary is the reverse replication direction established during
// failback: the DR site ships the delta to the restored primary.
const DirectionDRToPrimary = "dr->primary"

// DirectionPrimaryToDR is the post-cutback forward direction recorded on
// COMPLETED: the restored primary is authoritative again and forward replication
// resumes primary -> DR.
const DirectionPrimaryToDR = "primary->dr"

// FailbackRun is one row-backed instance of the gated failback FSM. FromSite is
// the DR site currently authoritative (the reverse stream's source); ToSite is
// the original (restored) primary the reverse stream ships to.
type FailbackRun struct {
	ID            string  `json:"id"`
	TenantID      string  `json:"tenant_id"`
	GroupID       string  `json:"group_id"`
	FailoverRunID *string `json:"failover_run_id,omitempty"`
	FromSite      string  `json:"from_site"`
	ToSite        string  `json:"to_site"`
	// ReverseStreamID is the core StreamID of the DR->primary reverse stream. Nil
	// until REVERSE_SYNCING starts it; set durably so a restart reuses it.
	ReverseStreamID *string `json:"reverse_stream_id,omitempty"`
	Status          string  `json:"status"`
	// DeltaBytesRemaining is the unreplicated byte backlog on the reverse stream
	// (DR -> primary). DeltaSeqRemaining is the same backlog in frame-count terms.
	DeltaBytesRemaining int64 `json:"delta_bytes_remaining"`
	DeltaSeqRemaining   int64 `json:"delta_seq_remaining"`
	// ConvergeThresholdBytes is the configurable convergence threshold: the run
	// declares DELTA_CONVERGED only when DeltaBytesRemaining <= this AND the
	// cutover window is open.
	ConvergeThresholdBytes int64      `json:"converge_threshold_bytes"`
	SourceLSN              *string    `json:"source_lsn,omitempty"`
	AppliedLSN             *string    `json:"applied_lsn,omitempty"`
	LastConvergedAt        *time.Time `json:"last_converged_at,omitempty"`
	CutoverWindowOpen      bool       `json:"cutover_window_open"`
	InitiatedBy            string     `json:"initiated_by"`
	ApprovedBy             *string    `json:"approved_by,omitempty"`
	ApprovedAt             *time.Time `json:"approved_at,omitempty"`
	NewDirection           *string    `json:"new_direction,omitempty"`
	LastError              *string    `json:"last_error,omitempty"`
	ClaimedAt              *time.Time `json:"claimed_at,omitempty"`
	InitiatedAt            time.Time  `json:"initiated_at"`
	CompletedAt            *time.Time `json:"completed_at,omitempty"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// FailbackStep is a durable per-step audit + idempotency record (one per step).
type FailbackStep struct {
	ID         string         `json:"id"`
	RunID      string         `json:"run_id"`
	Step       string         `json:"step"`
	Status     string         `json:"status"`
	Detail     map[string]any `json:"detail,omitempty"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at,omitempty"`
}

// IsTerminal reports whether the run has reached a final state and the driver
// must not claim it again.
func (r *FailbackRun) IsTerminal() bool {
	switch r.Status {
	case StatusCompleted, StatusFailed:
		return true
	default:
		return false
	}
}

// IsApproved reports whether the cutback has been explicitly approved.
func (r *FailbackRun) IsApproved() bool {
	return r.ApprovedBy != nil && *r.ApprovedBy != ""
}

// DeltaConverged reports whether the reverse stream's remaining delta is at/under
// the configured threshold AND the cutover window is open — the two conditions
// that together permit declaring DELTA_CONVERGED. A zero threshold means "fully
// drained" (no remaining backlog), the strictest convergence.
func (r *FailbackRun) DeltaConverged() bool {
	if !r.CutoverWindowOpen {
		return false
	}
	return r.DeltaBytesRemaining <= r.ConvergeThresholdBytes
}

// nextStatus returns the FSM successor of a non-terminal, advanceable status, or
// ok=false for terminal states and the human-gated wait state (which only
// /approve-cutback may advance). This is the single source of truth for legal
// forward transitions, so the driver and store guards stay consistent.
func nextStatus(status string) (next string, ok bool) {
	switch status {
	case StatusPlanning:
		return StatusReverseSyncing, true
	case StatusReverseSyncing:
		return StatusDeltaConverged, true
	case StatusDeltaConverged:
		return StatusAwaitingCutbackApproval, true
	case StatusCuttingBack:
		return StatusCompleted, true
	default:
		// AWAITING_CUTBACK_APPROVAL advances to CUTTING_BACK only via the approval
		// path (the driver never claims it). Terminal states do not advance.
		return "", false
	}
}

// NextStatus exposes the legal forward transition for a status (test/diagnostic
// helper). ok is false for terminal or human-gated states.
func NextStatus(status string) (string, bool) {
	return nextStatus(status)
}
