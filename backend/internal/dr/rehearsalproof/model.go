// Package rehearsalproof assembles government-facing proof envelopes for real DR
// rehearsals. It deliberately does not drive failover, mutate provider adapters,
// or seed data; it links existing live execution records into one auditable
// model with explicit provenance so demo evidence cannot masquerade as live.
package rehearsalproof

import "time"

const SchemaVersion = "clario.dr.rehearsal_proof.v1"

const (
	RunTypeGameDay       = "gameday"
	RunTypeRunbookStudio = "runbook_studio"
	RunTypeFailoverDrill = "failover_drill"
	RunTypeRunbookRun    = "runbook_run"
)

const (
	SourceLiveRun    = "live_rehearsal"
	SourceSeededDemo = "seeded_demo"
	SourceImported   = "imported"
	SourceUnknown    = "unknown"
)

const (
	VerdictPassed  = "passed"
	VerdictFailed  = "failed"
	VerdictWarning = "warning"
	VerdictUnknown = "unknown"
)

const (
	TeardownComplete   = "complete"
	TeardownIncomplete = "incomplete"
	TeardownNotStarted = "not_started"
	TeardownUnknown    = "unknown"
)

// ProofRecord is the concrete rehearsal proof envelope. It is intentionally
// JSON-ready so callers can return it from a router, seal it to WORM, or persist
// it as JSONB without lossy translation.
type ProofRecord struct {
	SchemaVersion string `json:"schema_version"`
	ID            string `json:"id"`
	TenantID      string `json:"tenant_id"`

	Run     RunRef      `json:"run"`
	Scope   Scope       `json:"scope"`
	Systems []SystemRef `json:"systems"`
	Runbook RunbookRef  `json:"runbook"`
	Targets Targets     `json:"targets"`

	ApprovalRefs      []ApprovalRef      `json:"approval_refs"`
	StartedAt         time.Time          `json:"started_at"`
	CompletedAt       *time.Time         `json:"completed_at,omitempty"`
	HealthChecks      []HealthCheck      `json:"health_checks"`
	IntegrityVerdicts []IntegrityVerdict `json:"integrity_verdicts"`
	FailbackTeardown  TeardownStatus     `json:"failback_teardown"`
	EvidenceReport    *EvidenceReportRef `json:"evidence_report,omitempty"`

	OverallVerdict string     `json:"overall_verdict"`
	Provenance     Provenance `json:"provenance"`
	EnvelopeHash   string     `json:"envelope_hash"`
	GeneratedAt    time.Time  `json:"generated_at"`
}

type RunRef struct {
	Type       string `json:"type"`
	ID         string `json:"id"`
	GroupID    string `json:"group_id,omitempty"`
	ScenarioID string `json:"scenario_id,omitempty"`
	RunbookID  string `json:"runbook_id,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Status     string `json:"status,omitempty"`
}

type Scope struct {
	Name        string   `json:"name"`
	Environment string   `json:"environment,omitempty"`
	SystemIDs   []string `json:"system_ids,omitempty"`
}

type SystemRef struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Kind     string `json:"kind,omitempty"`
	Critical bool   `json:"critical,omitempty"`
}

type RunbookRef struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	Version     string `json:"version,omitempty"`
	ContentHash string `json:"content_hash,omitempty"`
	Source      string `json:"source,omitempty"`
}

type Targets struct {
	RTOTargetSeconds int   `json:"rto_target_seconds,omitempty"`
	RTOActualSeconds *int  `json:"rto_actual_seconds,omitempty"`
	RPOTargetSeconds int   `json:"rpo_target_seconds,omitempty"`
	RPOActualSeconds *int  `json:"rpo_actual_seconds,omitempty"`
	RTOMet           *bool `json:"rto_met,omitempty"`
	RPOMet           *bool `json:"rpo_met,omitempty"`
}

type ApprovalRef struct {
	ID         string    `json:"id,omitempty"`
	Action     string    `json:"action,omitempty"`
	Approver   string    `json:"approver,omitempty"`
	ApprovedAt time.Time `json:"approved_at,omitempty"`
	Source     string    `json:"source,omitempty"`
}

type HealthCheck struct {
	Name       string     `json:"name"`
	Target     string     `json:"target,omitempty"`
	Status     string     `json:"status"`
	Passed     bool       `json:"passed"`
	CheckedAt  time.Time  `json:"checked_at"`
	Detail     string     `json:"detail,omitempty"`
	EvidenceID string     `json:"evidence_id,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

type IntegrityVerdict struct {
	Source     string    `json:"source"`
	Verdict    string    `json:"verdict"`
	Passed     bool      `json:"passed"`
	CheckedAt  time.Time `json:"checked_at"`
	EvidenceID string    `json:"evidence_id,omitempty"`
	Detail     string    `json:"detail,omitempty"`
}

type TeardownStatus struct {
	Status      string     `json:"status"`
	FailbackID  string     `json:"failback_id,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Detail      string     `json:"detail,omitempty"`
}

type EvidenceReportRef struct {
	ID          string    `json:"id"`
	Hash        string    `json:"hash"`
	Algorithm   string    `json:"algorithm"`
	GeneratedAt time.Time `json:"generated_at,omitempty"`
	Source      string    `json:"source,omitempty"`
}

type Provenance struct {
	Source       string    `json:"source"`
	Live         bool      `json:"live"`
	Seeded       bool      `json:"seeded"`
	Demo         bool      `json:"demo"`
	CapturedFrom string    `json:"captured_from,omitempty"`
	RecordedBy   string    `json:"recorded_by,omitempty"`
	CapturedAt   time.Time `json:"captured_at"`
	Notes        string    `json:"notes,omitempty"`
}
