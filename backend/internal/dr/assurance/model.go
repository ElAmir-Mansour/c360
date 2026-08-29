// Package assurance evaluates continuous recovery assurance posture for a
// protected workload or consistency group. It is intentionally self-contained:
// callers provide normalised evidence, and the package returns a deterministic
// scored assessment with ordered findings and machine-readable next actions.
package assurance

import "time"

// VerificationKind identifies the recovery verification evidence class.
type VerificationKind string

const (
	// VerificationApp proves the recovered workload is usable at the application
	// layer, not merely booted.
	VerificationApp VerificationKind = "app"
	// VerificationCleanRoom proves the workload was restored and verified in an
	// isolated clean-room environment.
	VerificationCleanRoom VerificationKind = "clean_room"
	// VerificationRunbookReview records review or approval of the recovery
	// runbook used by the group.
	VerificationRunbookReview VerificationKind = "runbook_review"
	// VerificationDependencyBootGraph proves the dependency graph or bootgraph is
	// valid and executable.
	VerificationDependencyBootGraph VerificationKind = "dependency_bootgraph"
	// VerificationFailback proves failback has been tested recently.
	VerificationFailback VerificationKind = "failback"
)

// Verdict is the aggregate or per-check evaluation outcome.
type Verdict string

const (
	// VerdictSatisfied means the check is fully met.
	VerdictSatisfied Verdict = "satisfied"
	// VerdictPartial means the check is met with a warning-grade gap.
	VerdictPartial Verdict = "partial"
	// VerdictFailed means the check is unmet or required evidence is absent.
	VerdictFailed Verdict = "failed"
)

// Severity is the remediation priority for a finding.
type Severity string

const (
	// SeverityWarning is used for gaps that should be corrected before posture
	// degrades into a breach.
	SeverityWarning Severity = "warning"
	// SeverityHigh is used for gaps that invalidate a core assurance claim.
	SeverityHigh Severity = "high"
	// SeverityCritical is used for active breaches, critical drift, or missing
	// recovery evidence.
	SeverityCritical Severity = "critical"
)

// Recommendation labels are stable machine-readable next actions.
const (
	RecommendationScheduleDrill        = "schedule_drill"
	RecommendationRefreshRunbook       = "refresh_runbook"
	RecommendationResolveDrift         = "resolve_drift"
	RecommendationRerunAppVerification = "rerun_app_verification"
	RecommendationRunCleanRoom         = "run_clean_room_verification"
	RecommendationInvestigateRPO       = "investigate_rpo_breach"
	RecommendationValidateBootGraph    = "validate_bootgraph"
	RecommendationTestFailback         = "test_failback"
	RecommendationRefreshEvidence      = "refresh_evidence"
)

// Default policy windows used when an AssuranceProfile leaves an override unset.
const (
	DefaultDrillCadenceDays         = 90
	DefaultEvidenceRecencyDays      = 30
	DefaultRunbookFreshnessDays     = 180
	DefaultDependencyValidationDays = 90
	DefaultFailbackTestDays         = 180
	DefaultRPOObjectiveSeconds      = 300
)

// AssuranceProfile defines the recovery objectives and freshness windows used
// to score a workload or protected group.
type AssuranceProfile struct {
	ID             string `json:"id,omitempty"`
	TenantID       string `json:"tenant_id,omitempty"`
	GroupID        string `json:"group_id,omitempty"`
	WorkloadID     string `json:"workload_id,omitempty"`
	WorkloadName   string `json:"workload_name,omitempty"`
	WorkloadKind   string `json:"workload_kind,omitempty"`
	Criticality    string `json:"criticality,omitempty"`
	Environment    string `json:"environment,omitempty"`
	RunbookID      string `json:"runbook_id,omitempty"`
	BootGraphID    string `json:"bootgraph_id,omitempty"`
	RecoveryTierID string `json:"recovery_tier_id,omitempty"`

	// DrillCadenceDays is the maximum age for a successful drill.
	DrillCadenceDays int `json:"drill_cadence_days,omitempty"`
	// EvidenceRecencyDays is the maximum age for continuous operational
	// evidence such as RPO, drift, drill, and verification observations.
	EvidenceRecencyDays int `json:"evidence_recency_days,omitempty"`
	// RunbookFreshnessDays is the maximum age for runbook review evidence.
	RunbookFreshnessDays int `json:"runbook_freshness_days,omitempty"`
	// DependencyValidationDays is the maximum age for bootgraph validation.
	DependencyValidationDays int `json:"dependency_validation_days,omitempty"`
	// FailbackTestDays is the maximum age for successful failback test evidence.
	FailbackTestDays int `json:"failback_test_days,omitempty"`
	// RPOObjectiveSeconds is used when the RPO evidence does not carry its own
	// objective.
	RPOObjectiveSeconds int `json:"rpo_objective_seconds,omitempty"`
	// MinAppVerificationPassRatio is the minimum passed/total check ratio for
	// application verification. Values outside 0..1 are normalised to 1.0.
	MinAppVerificationPassRatio float64 `json:"min_app_verification_pass_ratio,omitempty"`
	// RequireCleanRoomVerification is normalised to true for zero-value profiles;
	// continuous assurance treats clean-room verification as mandatory.
	RequireCleanRoomVerification bool `json:"require_clean_room_verification"`
	// RequireNondisruptiveDrills is normalised to true for zero-value profiles;
	// successful drill evidence must be non-disruptive.
	RequireNondisruptiveDrills bool `json:"require_nondisruptive_drills"`
}

// DrillEvidence records a recovery drill outcome.
type DrillEvidence struct {
	ID                  string    `json:"id"`
	RunID               string    `json:"run_id,omitempty"`
	ScheduleID          string    `json:"schedule_id,omitempty"`
	Scenario            string    `json:"scenario,omitempty"`
	ExecutedAt          time.Time `json:"executed_at"`
	CompletedAt         time.Time `json:"completed_at,omitempty"`
	NonDisruptive       bool      `json:"non_disruptive"`
	Passed              bool      `json:"passed"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds,omitempty"`
	RTOAchievedSeconds  int       `json:"rto_achieved_seconds,omitempty"`
	RPOObjectiveSeconds int       `json:"rpo_objective_seconds,omitempty"`
	RPOAchievedSeconds  int       `json:"rpo_achieved_seconds,omitempty"`
	Warnings            int       `json:"warnings,omitempty"`
	FailedSteps         []string  `json:"failed_steps,omitempty"`
}

// ObservedAt returns the timestamp used to order and age drill evidence.
func (d DrillEvidence) ObservedAt() time.Time {
	if !d.CompletedAt.IsZero() {
		return d.CompletedAt
	}
	return d.ExecutedAt
}

// VerificationEvidence records one recovery verification result.
type VerificationEvidence struct {
	ID           string           `json:"id"`
	RunID        string           `json:"run_id,omitempty"`
	Kind         VerificationKind `json:"kind"`
	VerifiedAt   time.Time        `json:"verified_at"`
	Passed       bool             `json:"passed"`
	ChecksPassed int              `json:"checks_passed,omitempty"`
	ChecksTotal  int              `json:"checks_total,omitempty"`
	Warnings     int              `json:"warnings,omitempty"`
	Artifacts    []string         `json:"artifacts,omitempty"`
	Message      string           `json:"message,omitempty"`
}

// DriftEvidence records the latest infrastructure, topology, or plan drift
// snapshot for the protected group.
type DriftEvidence struct {
	ID            string    `json:"id"`
	ObservedAt    time.Time `json:"observed_at"`
	DriftDetected bool      `json:"drift_detected"`
	OpenItems     int       `json:"open_items,omitempty"`
	CriticalItems int       `json:"critical_items,omitempty"`
	AddedItems    int       `json:"added_items,omitempty"`
	RemovedItems  int       `json:"removed_items,omitempty"`
	ChangedItems  int       `json:"changed_items,omitempty"`
	Message       string    `json:"message,omitempty"`
}

// RPOEvidence records observed replication lag against an RPO objective.
type RPOEvidence struct {
	ID                  string    `json:"id"`
	MeasuredAt          time.Time `json:"measured_at"`
	ObjectiveSeconds    int       `json:"objective_seconds,omitempty"`
	ActualLagSeconds    int       `json:"actual_lag_seconds"`
	Breached            bool      `json:"breached"`
	BreachOpen          bool      `json:"breach_open,omitempty"`
	RecoveryPointID     string    `json:"recovery_point_id,omitempty"`
	ReplicationStreamID string    `json:"replication_stream_id,omitempty"`
}

// AssuranceEvidence is the normalised evidence bundle evaluated by this
// package.
type AssuranceEvidence struct {
	Drills        []DrillEvidence        `json:"drills,omitempty"`
	Verifications []VerificationEvidence `json:"verifications,omitempty"`
	Drift         []DriftEvidence        `json:"drift,omitempty"`
	RPO           []RPOEvidence          `json:"rpo,omitempty"`
}

// CheckResult is the outcome for one assurance check.
type CheckResult struct {
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	Verdict        Verdict  `json:"verdict"`
	Severity       Severity `json:"severity,omitempty"`
	Weight         int      `json:"weight"`
	Message        string   `json:"message,omitempty"`
	Recommendation string   `json:"recommendation,omitempty"`
	EvidenceRefs   []string `json:"evidence_refs,omitempty"`
}

// Finding is one unmet or warning-grade assurance check surfaced for action.
// Findings are returned in deterministic control order.
type Finding struct {
	Code           string   `json:"code"`
	Title          string   `json:"title"`
	Verdict        Verdict  `json:"verdict"`
	Severity       Severity `json:"severity"`
	Weight         int      `json:"weight"`
	Message        string   `json:"message"`
	Recommendation string   `json:"recommendation"`
	EvidenceRefs   []string `json:"evidence_refs,omitempty"`
}

// AssuranceAssessment is the scored result of evaluating an AssuranceProfile
// against evidence. Score is a bounded weighted percentage in the range 0..100.
type AssuranceAssessment struct {
	ProfileID       string        `json:"profile_id,omitempty"`
	TenantID        string        `json:"tenant_id,omitempty"`
	GroupID         string        `json:"group_id,omitempty"`
	WorkloadID      string        `json:"workload_id,omitempty"`
	Score           float64       `json:"score"`
	Verdict         Verdict       `json:"verdict"`
	TotalChecks     int           `json:"total_checks"`
	Satisfied       int           `json:"satisfied"`
	Partial         int           `json:"partial"`
	Failed          int           `json:"failed"`
	Results         []CheckResult `json:"results"`
	Findings        []Finding     `json:"findings"`
	Recommendations []string      `json:"recommendations,omitempty"`
	EvaluatedAt     time.Time     `json:"evaluated_at"`
}
