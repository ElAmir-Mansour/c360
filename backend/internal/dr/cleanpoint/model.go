// Package cleanpoint scores whether a recovery point has enough clean-room,
// ransomware, application, attestation, immutability, and RPO evidence to be
// safely promoted.
package cleanpoint

import "time"

// CleanRoomVerdict is the normalized terminal outcome from isolated recovery
// validation.
type CleanRoomVerdict string

const (
	// CleanRoomVerdictClean means the restored point passed clean-room scanning.
	CleanRoomVerdictClean CleanRoomVerdict = "clean"
	// CleanRoomVerdictMalware means malware was detected in the clean room.
	CleanRoomVerdictMalware CleanRoomVerdict = "malware"
	// CleanRoomVerdictIntegrityFailed means restored bytes did not match the
	// sealed recovery-point hash.
	CleanRoomVerdictIntegrityFailed CleanRoomVerdict = "integrity_failed"
	// CleanRoomVerdictError means the scan could not complete and the point is
	// unverified.
	CleanRoomVerdictError CleanRoomVerdict = "error"
)

// AppVerificationVerdict is the recovered application's smoke-test outcome.
type AppVerificationVerdict string

const (
	// AppVerificationPassed means required application checks passed.
	AppVerificationPassed AppVerificationVerdict = "passed"
	// AppVerificationFailed means required application checks failed.
	AppVerificationFailed AppVerificationVerdict = "failed"
	// AppVerificationError means checks could not complete.
	AppVerificationError AppVerificationVerdict = "error"
	// AppVerificationSkipped means application checks were intentionally skipped.
	AppVerificationSkipped AppVerificationVerdict = "skipped"
)

// SignalKind classifies extra evidence that can strengthen or weaken the
// recovery-point decision.
type SignalKind string

const (
	SignalCleanRoomVerdict     SignalKind = "clean_room_verdict"
	SignalMalwareFinding       SignalKind = "malware_finding"
	SignalIntegrityMismatch    SignalKind = "integrity_mismatch"
	SignalRansomwareSuspicion  SignalKind = "ransomware_suspicion"
	SignalEntropyAnomaly       SignalKind = "entropy_anomaly"
	SignalDeleteRateAnomaly    SignalKind = "delete_rate_anomaly"
	SignalAppVerification      SignalKind = "app_verification"
	SignalAttestationFreshness SignalKind = "attestation_freshness"
	SignalImmutabilitySeal     SignalKind = "immutability_seal"
	SignalRPOAge               SignalKind = "rpo_age"
)

// SignalSeverity is the promotion impact of a signal.
type SignalSeverity string

const (
	// SeverityInfo records supporting context without affecting the decision.
	SeverityInfo SignalSeverity = "info"
	// SeverityWarning permits promotion, but only with warnings.
	SeverityWarning SignalSeverity = "warning"
	// SeverityHigh requires retesting before promotion.
	SeverityHigh SignalSeverity = "high"
	// SeverityCritical quarantines the recovery point.
	SeverityCritical SignalSeverity = "critical"
)

// Signal is one caller-supplied observation about the recovery point. Signals
// are sorted before scoring, so caller input order does not affect the decision.
type Signal struct {
	Kind        SignalKind     `json:"kind"`
	Severity    SignalSeverity `json:"severity"`
	Code        string         `json:"code,omitempty"`
	Message     string         `json:"message"`
	Source      string         `json:"source,omitempty"`
	EvidenceRef string         `json:"evidence_ref,omitempty"`
	ObservedAt  time.Time      `json:"observed_at,omitempty"`
}

// RecoveryPointEvidence is the full evidence bundle for one candidate recovery
// point. Zero values are treated conservatively: missing required proof becomes
// a warning or retest finding, never a clean pass.
type RecoveryPointEvidence struct {
	RecoveryPointID string `json:"recovery_point_id,omitempty"`
	GroupID         string `json:"group_id,omitempty"`

	CreatedAt           time.Time `json:"created_at,omitempty"`
	RPOObjectiveSeconds int       `json:"rpo_objective_seconds,omitempty"`

	CleanRoomVerdict    CleanRoomVerdict `json:"clean_room_verdict,omitempty"`
	CleanRoomFinishedAt time.Time        `json:"clean_room_finished_at,omitempty"`
	MalwareFindings     []string         `json:"malware_findings,omitempty"`
	IntegrityMismatch   bool             `json:"integrity_mismatch"`
	RansomwareSuspected bool             `json:"ransomware_suspected"`
	EntropyAnomaly      bool             `json:"entropy_anomaly"`
	DeleteRateAnomaly   bool             `json:"delete_rate_anomaly"`

	AppVerificationVerdict    AppVerificationVerdict `json:"app_verification_verdict,omitempty"`
	AppVerificationFinishedAt time.Time              `json:"app_verification_finished_at,omitempty"`

	AttestationVerified      bool      `json:"attestation_verified"`
	AttestedAt               time.Time `json:"attested_at,omitempty"`
	MaxAttestationAgeSeconds int       `json:"max_attestation_age_seconds,omitempty"`

	Immutable      bool      `json:"immutable"`
	Sealed         bool      `json:"sealed"`
	SealVerified   bool      `json:"seal_verified"`
	RetentionUntil time.Time `json:"retention_until,omitempty"`

	Signals []Signal `json:"signals,omitempty"`
}

// DecisionKind is the action the promotion gate should take.
type DecisionKind string

const (
	// DecisionPromote means the point can be promoted without unresolved gaps.
	DecisionPromote DecisionKind = "promote"
	// DecisionPromoteWithWarnings means promotion is allowed, but the caller
	// should surface non-blocking warnings.
	DecisionPromoteWithWarnings DecisionKind = "promote_with_warnings"
	// DecisionRetest means the point is not proven dirty, but evidence is missing,
	// stale, or failed and must be collected again.
	DecisionRetest DecisionKind = "retest"
	// DecisionQuarantine means dirty or malicious evidence blocks promotion.
	DecisionQuarantine DecisionKind = "quarantine"
)

// Finding is one scored issue. Findings are returned in deterministic control
// order, then by kind/severity/message.
type Finding struct {
	Code        string         `json:"code"`
	Kind        SignalKind     `json:"kind"`
	Severity    SignalSeverity `json:"severity"`
	Message     string         `json:"message"`
	EvidenceRef string         `json:"evidence_ref,omitempty"`
	ObservedAt  time.Time      `json:"observed_at,omitempty"`
}

// Reason is the compact ordered explanation list derived from findings.
type Reason struct {
	Code     string         `json:"code"`
	Kind     SignalKind     `json:"kind"`
	Severity SignalSeverity `json:"severity"`
	Message  string         `json:"message"`
}

// Decision is the scored promotion result. Score is a bounded percentage
// (0..100) over the fixed clean-point controls.
type Decision struct {
	RecoveryPointID string       `json:"recovery_point_id,omitempty"`
	Kind            DecisionKind `json:"kind"`
	Score           float64      `json:"score"`
	Findings        []Finding    `json:"findings,omitempty"`
	Reasons         []Reason     `json:"reasons,omitempty"`
	EvaluatedAt     time.Time    `json:"evaluated_at"`
}
