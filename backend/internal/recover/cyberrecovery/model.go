// Package cyberrecovery is the Clario Recover CYBER RECOVERY sub-solution
// orchestration layer. It COMPOSES the existing dr/* services — clean room
// (internal/dr/cleanroom), ransomware detection (internal/dr/ransomware), and
// the shared recovery-point store — and adds the distinguishing clean-room
// RECOVERY FLOW those services do not themselves own:
//
//	select last-known-good clean point
//	  -> provision to a clean / bare-metal target
//	  -> run runbook recovery
//	  -> MANDATORY integrity-check gate (clean-room scan must pass)
//	  -> explicit approval before "return to production network".
//
// The integrity gate is a HARD, SERVER-SIDE blocker: a flow can only reach
// PhaseReturnedToProduction once (a) its latest clean-room scan verdict is CLEAN
// and (b) an authorized approver has signed off (provenance recorded). This
// package owns ONLY the flow state machine and its append-only transition log;
// it never reimplements clean-room scanning, ransomware detection, or
// recovery-point management — it calls their public APIs.
package cyberrecovery

import (
	"time"

	"github.com/google/uuid"
)

// Phase is the state-machine position of a clean-room recovery flow. The set
// mirrors the recover_cyber_recovery_flow.phase CHECK constraint.
type Phase string

const (
	// PhaseCleanPointSelected — a last-known-good clean point has been chosen and
	// the flow created. Nothing has been provisioned yet.
	PhaseCleanPointSelected Phase = "clean_point_selected"
	// PhaseProvisioning — provisioning the clean point to the clean/bare-metal
	// target is in progress.
	PhaseProvisioning Phase = "provisioning"
	// PhaseProvisioned — the target has been provisioned from the clean point.
	PhaseProvisioned Phase = "provisioned"
	// PhaseRecovering — runbook recovery is executing against the provisioned
	// target.
	PhaseRecovering Phase = "recovering"
	// PhaseRecovered — runbook recovery completed; the workload is up in
	// isolation, ready for the integrity gate.
	PhaseRecovered Phase = "recovered"
	// PhaseIntegrityChecking — the mandatory clean-room integrity scan is running.
	PhaseIntegrityChecking Phase = "integrity_checking"
	// PhaseIntegrityPassed — the clean-room scan returned a CLEAN verdict; the
	// flow may now seek approval.
	PhaseIntegrityPassed Phase = "integrity_passed"
	// PhaseIntegrityFailed — the clean-room scan did NOT return clean
	// (malware/integrity/error). Return-to-production is blocked; the gate may be
	// re-run after remediation.
	PhaseIntegrityFailed Phase = "integrity_failed"
	// PhaseAwaitingApproval — integrity passed; an authorized approver must sign
	// off before return-to-production.
	PhaseAwaitingApproval Phase = "awaiting_approval"
	// PhaseApproved — an authorized approver has signed off against the passing
	// integrity scan. Return-to-production is now permitted.
	PhaseApproved Phase = "approved"
	// PhaseReturnedToProduction — terminal success: the recovered workload has
	// been returned to the production network.
	PhaseReturnedToProduction Phase = "returned_to_production"
	// PhaseAborted — terminal: the flow was abandoned.
	PhaseAborted Phase = "aborted"
)

// TargetKind classifies the recovery target a clean point is provisioned to.
type TargetKind string

const (
	TargetCleanRoom   TargetKind = "clean_room"
	TargetBareMetal   TargetKind = "bare_metal"
	TargetIsolatedVPC TargetKind = "isolated_vpc"
)

// validTargetKind reports whether k is one of the defined target kinds.
func validTargetKind(k TargetKind) bool {
	switch k {
	case TargetCleanRoom, TargetBareMetal, TargetIsolatedVPC:
		return true
	default:
		return false
	}
}

// Flow is one clean-room recovery flow (a recover_cyber_recovery_flow row): the
// selected clean point, the provisioning target, the state-machine phase, the
// integrity-gate result, and the approval provenance for return-to-production.
type Flow struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	CleanPoint  uuid.UUID  `json:"clean_point_id"`
	GroupID     uuid.UUID  `json:"group_id"`
	TargetLabel string     `json:"target_label"`
	TargetKind  TargetKind `json:"target_kind"`
	Phase       Phase      `json:"phase"`

	RunbookRunID string `json:"runbook_run_id,omitempty"`

	// Integrity gate.
	IntegrityScanID    *uuid.UUID `json:"integrity_scan_id,omitempty"`
	IntegrityVerdict   string     `json:"integrity_verdict,omitempty"`
	IntegrityCheckedAt *time.Time `json:"integrity_checked_at,omitempty"`
	IntegrityDetail    string     `json:"integrity_detail,omitempty"`

	// Approval provenance.
	ApprovedBy        *uuid.UUID `json:"approved_by,omitempty"`
	ApprovedByEmail   string     `json:"approved_by_email,omitempty"`
	ApprovedAt        *time.Time `json:"approved_at,omitempty"`
	ApprovalNote      string     `json:"approval_note,omitempty"`
	ApprovedForScanID *uuid.UUID `json:"approved_for_scan_id,omitempty"`

	ReturnedBy *uuid.UUID `json:"returned_by,omitempty"`
	ReturnedAt *time.Time `json:"returned_at,omitempty"`

	AbortReason string `json:"abort_reason,omitempty"`

	Version   int64      `json:"version"`
	CreatedBy *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

// IntegrityPassed reports whether the flow's recorded integrity verdict is the
// CLEAN verdict — the necessary (not sufficient) condition for the gate.
func (f *Flow) IntegrityPassed() bool {
	return f != nil && f.IntegrityVerdict == VerdictClean
}

// ApprovalSatisfied reports whether an authorized approver has signed off
// against the flow's current passing integrity scan. An approval pinned to a
// stale scan id (a re-run produced a newer scan) does not satisfy the gate.
func (f *Flow) ApprovalSatisfied() bool {
	if f == nil || f.ApprovedBy == nil || f.IntegrityScanID == nil || f.ApprovedForScanID == nil {
		return false
	}
	return *f.ApprovedForScanID == *f.IntegrityScanID
}

// CanReturnToProduction is the authoritative gate predicate: a flow may return
// to the production network only when its latest integrity scan is CLEAN AND an
// authorized approver has signed off against that exact scan. This is the
// single source of truth the service enforces server-side.
func (f *Flow) CanReturnToProduction() bool {
	return f.IntegrityPassed() && f.ApprovalSatisfied()
}

// VerdictClean is the clean-room verdict that permits promotion. It is a local
// copy of cleanroom.VerdictClean kept as the persisted string value so the flow
// row is self-describing; the service asserts the two agree.
const VerdictClean = "clean"

// FlowEvent is one append-only phase-transition record (a
// recover_cyber_recovery_event row): who moved the flow between which phases,
// when, and a structured detail blob. The log has no update/delete path.
type FlowEvent struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	FlowID     uuid.UUID      `json:"flow_id"`
	FromPhase  Phase          `json:"from_phase"`
	ToPhase    Phase          `json:"to_phase"`
	ActorID    *uuid.UUID     `json:"actor_id,omitempty"`
	ActorEmail string         `json:"actor_email,omitempty"`
	Detail     map[string]any `json:"detail,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
}

// CleanPoint is a tenant's last-known-good restore candidate: a validated
// recovery_point projection plus its clean-room freshness. It is read from the
// shared recovery_point + dr_cleanroom_scan tables (owned by dr/*); this package
// only reads it for selection and freshness surfacing.
type CleanPoint struct {
	ID          uuid.UUID `json:"id"`
	GroupID     uuid.UUID `json:"group_id"`
	MarkerLSN   string    `json:"marker_lsn"`
	SealedAt    time.Time `json:"sealed_at"`
	IsValidated bool      `json:"is_validated"`
	LegalHold   bool      `json:"legal_hold"`
	// LatestScanVerdict is the most recent clean-room verdict for this point
	// ("" when never scanned). A point is only "clean" when this is VerdictClean.
	LatestScanVerdict string     `json:"latest_scan_verdict,omitempty"`
	LatestScanAt      *time.Time `json:"latest_scan_at,omitempty"`
}

// IsClean reports whether the point's latest clean-room scan passed.
func (c CleanPoint) IsClean() bool { return c.LatestScanVerdict == VerdictClean }

// Overview is the GET /api/recover/cyber-recovery/overview payload: the live
// dashboard for the Cyber Recovery workspace. Every field is derived from real
// persisted state (recovery points, clean-room scans, ransomware signals, and
// the flow table) — never canned.
type Overview struct {
	// CleanPoints is the freshest set of last-known-good restore candidates
	// (newest first), each carrying its clean-room verdict + freshness.
	CleanPoints []CleanPoint `json:"clean_points"`
	// LatestCleanPoint is the newest VALIDATED, clean-room-CLEAN point, or nil
	// when none qualifies (the recommended return target).
	LatestCleanPoint *CleanPoint `json:"latest_clean_point,omitempty"`
	// CleanPointFreshnessSeconds is the age of LatestCleanPoint at read time, or
	// nil when there is no clean point. Surfaced so operators see staleness.
	CleanPointFreshnessSeconds *int64 `json:"clean_point_freshness_seconds,omitempty"`

	// RansomwareSignals is the tenant's most recent ransomware early-warning
	// signals (newest first), read from the detector's persisted store.
	RansomwareSignals []RansomwareSignal `json:"ransomware_signals"`
	// ConfirmedRansomwareSignals counts the confirmed-severity signals in the
	// window — the headline "are we under attack" indicator.
	ConfirmedRansomwareSignals int `json:"confirmed_ransomware_signals"`

	// Flows is the tenant's recent clean-room recovery flows (newest first).
	Flows []Flow `json:"flows"`
	// ActiveFlows counts flows that are in-flight (not terminal).
	ActiveFlows int `json:"active_flows"`
	// FlowsAwaitingApproval counts flows blocked at the integrity gate awaiting an
	// approver — the operator's action queue.
	FlowsAwaitingApproval int `json:"flows_awaiting_approval"`

	GeneratedAt time.Time `json:"generated_at"`
}

// RansomwareSignal is the workspace projection of a persisted ransomware signal
// (a dr_ransomware_signals row, read via internal/dr/ransomware). It carries
// only the fields the dashboard surfaces.
type RansomwareSignal struct {
	ID         string    `json:"id"`
	StreamID   string    `json:"stream_id"`
	Kind       string    `json:"kind"`
	Severity   string    `json:"severity"`
	Ratio      float64   `json:"ratio"`
	Threshold  float64   `json:"threshold"`
	Detail     string    `json:"detail,omitempty"`
	ObservedAt time.Time `json:"observed_at"`
}
