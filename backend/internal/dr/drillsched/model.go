package drillsched

import (
	"errors"
	"time"
)

// Package sentinel errors. The router maps these to HTTP statuses; the service
// and store wrap them with %w so callers can errors.Is against them.
var (
	// ErrNotFound is returned when a schedule or result does not exist (within
	// the caller's tenant scope).
	ErrNotFound = errors.New("drillsched: not found")
	// ErrAlreadyExists is returned when a schedule name collides for a tenant.
	ErrAlreadyExists = errors.New("drillsched: already exists")
	// ErrGroupNotFound is returned when the referenced consistency group is
	// absent (or invisible under the tenant's RLS scope).
	ErrGroupNotFound = errors.New("drillsched: consistency group not found")
	// ErrValidation is returned for a malformed create/ingest request (bad cron,
	// empty name, unknown profile, etc.).
	ErrValidation = errors.New("drillsched: validation failed")
	// ErrNoPrevious is returned by the diff path when a result has no predecessor
	// to diff against (it is the first result for its schedule/group).
	ErrNoPrevious = errors.New("drillsched: no previous result to diff against")
)

// Network-mapping profiles a scheduled drill can request. A scheduled drill is
// non-disruptive, so it defaults to isolated (§6.2).
const (
	ProfileProduction = "production"
	ProfileIsolated   = "isolated"
)

// Drill-step statuses, mirroring failover_step.status so an ingested step keeps
// the failover driver's vocabulary.
const (
	StepStatusRunning = "running"
	StepStatusPassed  = "passed"
	StepStatusFailed  = "failed"
)

// durationDriftThreshold is the default proportional change in a step's duration
// that the diff engine reports as drift (25%). It is the package default; the
// diff function also accepts an explicit threshold.
const durationDriftThreshold = 0.25

// Schedule is a recurring, non-disruptive drill cadence for a consistency group.
// next_run is materialised from the cron expression by the package's engine and
// advanced by the leader-singleton scheduler each time a drill is requested.
type Schedule struct {
	ID                  string     `json:"id"`
	TenantID            string     `json:"tenant_id"`
	GroupID             string     `json:"group_id"`
	Name                string     `json:"name"`
	CronExpr            string     `json:"cron_expr"`
	Profile             string     `json:"profile"`
	RTOObjectiveSeconds int        `json:"rto_objective_seconds"`
	Enabled             bool       `json:"enabled"`
	NextRun             time.Time  `json:"next_run"`
	LastFiredAt         *time.Time `json:"last_fired_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// DrillStep is one step of a drill's timeline, captured from the failover_step
// rows the DRILL run produced. Key is the stable step identity (e.g.
// "gate1.validate", "boot:site-x"); the diff engine keys on it so a step that
// only moved is not reported as removed+added.
type DrillStep struct {
	Key        string `json:"key"`
	Title      string `json:"title,omitempty"`
	Status     string `json:"status"`
	DurationMS int64  `json:"duration_ms"`
}

// Passed reports whether the step's recorded status is a success.
func (s DrillStep) Passed() bool { return s.Status == StepStatusPassed }

// AssetFingerprint is a deterministic snapshot of the assets/topology a drill
// ran over, so a diff can surface drift even when no step changed: which member
// sites are in the group, their boot order, and which topology edges exist. The
// scheduler/ingest path fills it; the diff engine compares two fingerprints.
type AssetFingerprint struct {
	// Members maps a member site ID to its boot order at drill time.
	Members map[string]int `json:"members,omitempty"`
	// TopologyEdges is the set of directed edge identities ("from->to") at drill
	// time, sorted for determinism.
	TopologyEdges []string `json:"topology_edges,omitempty"`
}

// DrillResult is the outcome the failover DRILL path produced for one fired
// drill: achieved RTO/RPO, the per-step timeline, pass/fail, the pinned recovery
// point, the validation outcome, and the asset fingerprint. The diff engine
// compares consecutive results for the same schedule/group.
type DrillResult struct {
	ID                  string           `json:"id"`
	TenantID            string           `json:"tenant_id"`
	GroupID             string           `json:"group_id"`
	ScheduleID          *string          `json:"schedule_id,omitempty"`
	RunID               string           `json:"run_id"`
	Passed              bool             `json:"passed"`
	RTOAchievedSeconds  int              `json:"rto_achieved_seconds"`
	RPOAchievedSeconds  int              `json:"rpo_achieved_seconds"`
	RTOObjectiveSeconds int              `json:"rto_objective_seconds"`
	RecoveryPointID     *string          `json:"recovery_point_id,omitempty"`
	ValidationRatio     *float64         `json:"validation_ratio,omitempty"`
	ValidationOutcome   string           `json:"validation_outcome"`
	Steps               []DrillStep      `json:"steps"`
	AssetFingerprint    AssetFingerprint `json:"asset_fingerprint"`
	ObservedAt          time.Time        `json:"observed_at"`
	CreatedAt           time.Time        `json:"created_at"`
}

// --- Diff structures -------------------------------------------------------

// StepDurationDrift records a step whose duration changed beyond the threshold
// between the previous and the current drill.
type StepDurationDrift struct {
	Key            string  `json:"key"`
	PreviousMS     int64   `json:"previous_ms"`
	CurrentMS      int64   `json:"current_ms"`
	DeltaMS        int64   `json:"delta_ms"`
	ChangeFraction float64 `json:"change_fraction"` // signed: + slower, - faster
}

// AssetDrift records the difference between two drills' asset fingerprints.
type AssetDrift struct {
	AddedMembers   []string `json:"added_members,omitempty"`
	RemovedMembers []string `json:"removed_members,omitempty"`
	// ReorderedMembers lists members whose boot order changed.
	ReorderedMembers []MemberReorder `json:"reordered_members,omitempty"`
	AddedEdges       []string        `json:"added_edges,omitempty"`
	RemovedEdges     []string        `json:"removed_edges,omitempty"`
}

// MemberReorder records a member whose boot order changed between drills.
type MemberReorder struct {
	SiteID    string `json:"site_id"`
	FromOrder int    `json:"from_order"`
	ToOrder   int    `json:"to_order"`
}

// HasChanges reports whether the asset drift is non-empty.
func (a AssetDrift) HasChanges() bool {
	return len(a.AddedMembers) > 0 || len(a.RemovedMembers) > 0 ||
		len(a.ReorderedMembers) > 0 || len(a.AddedEdges) > 0 || len(a.RemovedEdges) > 0
}

// DrillDiff is the structured difference between the latest drill result and the
// previous one for the same schedule/group. It is what surfaces drift to
// operators and the SLO board: RTO/RPO regression, steps that newly failed or
// newly passed, per-step duration drift, and asset/topology drift.
type DrillDiff struct {
	GroupID    string  `json:"group_id"`
	ScheduleID *string `json:"schedule_id,omitempty"`
	// CurrentResultID/PreviousResultID identify the two diffed results.
	CurrentResultID  string `json:"current_result_id"`
	PreviousResultID string `json:"previous_result_id"`

	// Outcome transitions.
	PassedChanged  bool `json:"passed_changed"`
	PreviousPassed bool `json:"previous_passed"`
	CurrentPassed  bool `json:"current_passed"`
	NewlyRegressed bool `json:"newly_regressed"` // passed before, fails now
	NewlyRecovered bool `json:"newly_recovered"` // failed before, passes now

	// RTO/RPO deltas (current - previous), seconds. Positive = regressed (worse).
	RTODeltaSeconds int  `json:"rto_delta_seconds"`
	RPODeltaSeconds int  `json:"rpo_delta_seconds"`
	RTORegressed    bool `json:"rto_regressed"`
	RPORegressed    bool `json:"rpo_regressed"`

	// Step-level transitions, keyed by step Key, sorted.
	NewlyFailedSteps []string `json:"newly_failed_steps,omitempty"`
	NewlyPassedSteps []string `json:"newly_passed_steps,omitempty"`
	AddedSteps       []string `json:"added_steps,omitempty"`
	RemovedSteps     []string `json:"removed_steps,omitempty"`

	// Step-duration drift beyond the threshold, sorted by step key.
	DurationDrift []StepDurationDrift `json:"duration_drift,omitempty"`

	// Asset/topology drift.
	AssetDrift AssetDrift `json:"asset_drift"`
}

// HasDrift reports whether the diff surfaced ANY drift worth flagging: an
// outcome change, an RTO/RPO regression, a step transition, duration drift, or
// asset/topology drift. A diff with HasDrift()==false means two consecutive
// drills were equivalent.
func (d DrillDiff) HasDrift() bool {
	return d.PassedChanged ||
		d.RTORegressed || d.RPORegressed ||
		len(d.NewlyFailedSteps) > 0 || len(d.NewlyPassedSteps) > 0 ||
		len(d.AddedSteps) > 0 || len(d.RemovedSteps) > 0 ||
		len(d.DurationDrift) > 0 ||
		d.AssetDrift.HasChanges()
}
