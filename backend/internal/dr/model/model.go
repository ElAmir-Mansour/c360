// Package model defines the ClarioDR control-plane domain
// (DESIGN_DataStream_DR.md §7): protected sites under DR protection,
// consistency groups + boot order, replication streams (the core's StreamID +
// RPO ledger), immutable recovery points, network mappings, recovery targets,
// the gated failover/drill FSM (runs + steps), NCA-ready attestations, and DR
// agents.
package model

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the handler layer.
var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyExists = errors.New("already exists")
	ErrInvalidState  = errors.New("invalid state")
)

// Protected-site kinds (§7 protected_site.kind CHECK).
const (
	SiteKindVM       = "vm"
	SiteKindDatabase = "database"
	SiteKindFileset  = "fileset"
	SiteKindIaC      = "iac"
)

// Replication-stream statuses (§7 replication_stream.status CHECK).
const (
	StreamStatusPending   = "pending"
	StreamStatusSeeding   = "seeding"
	StreamStatusStreaming = "streaming"
	StreamStatusPaused    = "paused"
	StreamStatusDegraded  = "degraded"
	StreamStatusError     = "error"
)

// Network-mapping profiles (§7 network_mapping.profile CHECK). Drill runs use
// the isolated profile so a rehearsal never touches the production network.
const (
	NetworkProfileProduction = "production"
	NetworkProfileIsolated   = "isolated"
)

// Failover-run modes (§7 failover_run.mode CHECK). A drill is the same code
// path as a real event, differing only in target network profile + teardown.
const (
	ModeReal  = "real"
	ModeDrill = "drill"
)

// Failover approval decisions. Approval rows are append-only; only approve
// decisions count toward the release quorum.
const (
	ApprovalDecisionApprove = "approve"
	ApprovalDecisionReject  = "reject"
)

// Failover-run FSM states (§6.1). The driver claims runs in non-terminal,
// non-await states; AWAITING_APPROVAL parks until /approve transitions it.
const (
	StatusInitiated        = "INITIATED"
	StatusQuiescing        = "QUIESCING"
	StatusSyncConfirmed    = "SYNC_CONFIRMED"    // Gate 1 (Validate) — recovery point pinned here
	StatusAwaitingApproval = "AWAITING_APPROVAL" // Gate 2 human approval parks here
	StatusApproved         = "APPROVED"
	StatusExecuting        = "EXECUTING" // Gate 3 boot order
	StatusValidating       = "VALIDATING"
	StatusAttested         = "ATTESTED"
	StatusCompleted        = "COMPLETED" // Gate 4
	StatusFailed           = "FAILED"
	StatusCancelled        = "CANCELLED"
	StatusRolledBack       = "ROLLED_BACK"
)

// Failover-step statuses (§7 failover_step.status CHECK).
const (
	StepStatusRunning = "running"
	StepStatusPassed  = "passed"
	StepStatusFailed  = "failed"
)

// DR-agent statuses (§7 dr_agent.status CHECK).
const (
	AgentStatusProvisioning = "provisioning"
	AgentStatusActive       = "active"
	AgentStatusSilent       = "silent"
	AgentStatusRotating     = "rotating"
	AgentStatusRevoked      = "revoked"
)

const (
	ObjectiveFitStatusSatisfied      = "satisfied"
	ObjectiveFitStatusInvalid        = "invalid_objectives"
	ObjectiveFitStatusOutsideCatalog = "outside_catalog"
	ObjectiveFitStatusUnknown        = "unknown"
)

// RecoveryTierRecommendation is transient response metadata derived from a
// protected site's RTO/RPO objectives.
type RecoveryTierRecommendation struct {
	Tier                     string   `json:"tier"`
	Strategy                 string   `json:"strategy"`
	RTOObjectiveSeconds      int      `json:"rto_objective_seconds"`
	RPOObjectiveSeconds      int      `json:"rpo_objective_seconds"`
	ValidationCadenceSeconds int      `json:"validation_cadence_seconds"`
	RequiresCyberVault       bool     `json:"requires_cyber_vault"`
	RequiresCleanRoom        bool     `json:"requires_clean_room"`
	Capabilities             []string `json:"capabilities,omitempty"`
	Notes                    []string `json:"notes,omitempty"`
}

// ObjectiveFit describes whether a site's objectives matched the built-in
// recovery-tier catalog. It is response-only and is not persisted.
type ObjectiveFit struct {
	Status              string   `json:"status"`
	RTOObjectiveSeconds int      `json:"rto_objective_seconds"`
	RPOObjectiveSeconds int      `json:"rpo_objective_seconds"`
	Warnings            []string `json:"warnings,omitempty"`
}

// ProtectedSite is a customer system under DR protection (primary site).
type ProtectedSite struct {
	ID                         string                      `json:"id"`
	TenantID                   string                      `json:"tenant_id"`
	Name                       string                      `json:"name"`
	Kind                       string                      `json:"kind"`
	PrimaryEndpoint            string                      `json:"primary_endpoint"`
	RTOObjectiveSeconds        int                         `json:"rto_objective_seconds"`
	RPOObjectiveSeconds        int                         `json:"rpo_objective_seconds"`
	RecoveryTierRecommendation *RecoveryTierRecommendation `json:"recovery_tier_recommendation,omitempty"`
	ObjectiveFit               *ObjectiveFit               `json:"objective_fit,omitempty"`
	CreatedAt                  time.Time                   `json:"created_at"`
	UpdatedAt                  time.Time                   `json:"updated_at"`
}

// ConsistencyGroup is a set of members that fail over together.
type ConsistencyGroup struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// ConsistencyGroupMember binds a protected site into a group with a boot order.
type ConsistencyGroupMember struct {
	GroupID   string `json:"group_id"`
	SiteID    string `json:"site_id"`
	BootOrder int    `json:"boot_order"`
}

// ReplicationStream is the core's StreamID plus the RPO ledger for one site.
type ReplicationStream struct {
	ID         string     `json:"id"`
	TenantID   string     `json:"tenant_id"`
	SiteID     string     `json:"site_id"`
	Status     string     `json:"status"`
	AppliedSeq int64      `json:"applied_seq"`
	SourceLSN  *string    `json:"source_lsn,omitempty"`
	AppliedAt  *time.Time `json:"applied_at,omitempty"`
	// SourceCommittedAt is the source emit/commit wall clock
	// (core.Frame.EmittedAt) of the last contiguously applied frame. It is the
	// input to the true source-to-target RPO (SourceLagRPO): applied_at -
	// source_committed_at. Nil for streams checkpointed before the source-lag
	// column existed or on apply paths that cannot supply a source timestamp.
	SourceCommittedAt *time.Time `json:"source_committed_at,omitempty"`
	LastError         *string    `json:"last_error,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// StreamMonitorSnapshot is the cross-tenant system view consumed by the RPO
// monitor. It joins the stream ledger with the protected site's RPO objective
// so a background loop can decide breach/recovery without request-path access.
type StreamMonitorSnapshot struct {
	ReplicationStream
	SiteName            string `json:"site_name"`
	SiteKind            string `json:"site_kind"`
	RPOObjectiveSeconds int    `json:"rpo_objective_seconds"`
	// GroupName is the consistency group the stream's site belongs to, or the
	// site name when the site is not in a group — used as the dr_rpo_seconds
	// SLO label so every stream contributes to a group aggregation.
	GroupName string `json:"group_name"`
}

// LiveRPO returns the live RPO (now - applied_at): the data-loss window if the
// primary were lost this instant. Ok is false when nothing has been applied
// yet (applied_at NULL), so the caller can render "seeding" rather than zero.
func (s *ReplicationStream) LiveRPO(now time.Time) (rpo time.Duration, ok bool) {
	if s.AppliedAt == nil {
		return 0, false
	}
	d := now.Sub(*s.AppliedAt)
	if d < 0 {
		d = 0
	}
	return d, true
}

// SourceLagRPO returns the TRUE end-to-end data-loss window: the wall time
// between when the last applied change committed at the SOURCE
// (source_committed_at, i.e. core.Frame.EmittedAt) and when it became durable on
// the recovery target (applied_at). This is the figure a skeptical government
// reviewer asks for — "how much committed data would we lose?" — as opposed to
// LiveRPO's apply-side now()-applied_at, which only measures staleness since the
// last apply and ignores in-flight capture/transport latency.
//
// Ok is false when either the apply checkpoint (applied_at) or the source
// timestamp (source_committed_at) is unavailable — e.g. a stream that has never
// applied, or a legacy row checkpointed before the source-lag column existed.
// Callers should fall back to LiveRPO in that case so nothing breaks. Clock skew
// (source_committed_at after applied_at) floors at zero.
func (s *ReplicationStream) SourceLagRPO() (lag time.Duration, ok bool) {
	if s.AppliedAt == nil || s.SourceCommittedAt == nil {
		return 0, false
	}
	d := s.AppliedAt.Sub(*s.SourceCommittedAt)
	if d < 0 {
		d = 0
	}
	return d, true
}

// StreamRPO is the live RPO/lag view of a replication stream returned by
// GET /streams/{id}/rpo (§9). RPOSeconds is now - applied_at; HasData is false
// while the stream is still seeding (nothing applied yet) so the dashboard can
// distinguish "no data window yet" from a true zero.
type StreamRPO struct {
	StreamID   string  `json:"stream_id"`
	SiteID     string  `json:"site_id"`
	Status     string  `json:"status"`
	AppliedSeq int64   `json:"applied_seq"`
	SourceLSN  *string `json:"source_lsn,omitempty"`
	// RPOSeconds is the live data-loss window in whole seconds (now-applied_at).
	RPOSeconds int `json:"rpo_seconds"`
	// LagSeconds is the apply lag (same as RPOSeconds for the live view: the age
	// of the last contiguously-applied commit).
	LagSeconds int        `json:"lag_seconds"`
	HasData    bool       `json:"has_data"`
	AppliedAt  *time.Time `json:"applied_at,omitempty"`
	MeasuredAt time.Time  `json:"measured_at"`
}

// RecoveryPoint is an immutable, consistency-wide marker + sealed WORM chunks.
type RecoveryPoint struct {
	ID              string            `json:"id"`
	TenantID        string            `json:"tenant_id"`
	GroupID         string            `json:"group_id"`
	MarkerLSN       string            `json:"marker_lsn"`
	RPOSeconds      int               `json:"rpo_seconds"`
	ObjectKeys      map[string]string `json:"object_keys"`
	ContentHash     string            `json:"content_hash"`
	ValidationRatio *float64          `json:"validation_ratio,omitempty"`
	IsValidated     bool              `json:"is_validated"`
	// LegalHold marks the ransomware-safe floor (§5): the newest validated
	// points carry it so they cannot be reclaimed even by a break-glass
	// governance-bypass holder until a newer validated point supersedes them.
	LegalHold      bool      `json:"legal_hold"`
	SealedAt       time.Time `json:"sealed_at"`
	RetentionUntil time.Time `json:"retention_until"`
}

// NetworkMapping remaps primary->recovery addressing for the recovery executor.
type NetworkMapping struct {
	ID           string `json:"id"`
	TenantID     string `json:"tenant_id"`
	GroupID      string `json:"group_id"`
	Profile      string `json:"profile"`
	PrimaryCIDR  string `json:"primary_cidr"`
	RecoveryCIDR string `json:"recovery_cidr"`
}

// HealthProbe is the distinct workload-up probe (§15.2) — separate from the
// data-fidelity Validator. The recovery executor blocks VALIDATING->ATTESTED
// until every member's probe is green or a deadline trips.
type HealthProbe struct {
	Type     string `json:"type,omitempty"` // http | tcp | sql | k8s_ready
	Target   string `json:"target,omitempty"`
	Expected string `json:"expected,omitempty"`
	Timeout  string `json:"timeout,omitempty"`
	Retries  int    `json:"retries,omitempty"`
}

// RecoveryTarget is where a protected site boots at the recovery site, in
// declared boot order, with its workload-up health probe.
type RecoveryTarget struct {
	ID               string      `json:"id"`
	TenantID         string      `json:"tenant_id"`
	GroupID          string      `json:"group_id"`
	SiteID           string      `json:"site_id"`
	BootOrder        int         `json:"boot_order"`
	RecoveryEndpoint *string     `json:"recovery_endpoint,omitempty"`
	HealthProbe      HealthProbe `json:"health_probe"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

// FailoverRun is one row-backed instance of the gated failover/drill FSM (§6).
type FailoverRun struct {
	ID                  string     `json:"id"`
	TenantID            string     `json:"tenant_id"`
	GroupID             string     `json:"group_id"`
	Mode                string     `json:"mode"`
	Status              string     `json:"status"`
	RecoveryPointID     *string    `json:"recovery_point_id,omitempty"`
	RTOObjectiveSeconds int        `json:"rto_objective_seconds"`
	InitiatedBy         string     `json:"initiated_by"`
	ApprovedBy          *string    `json:"approved_by,omitempty"`
	InitiatedAt         time.Time  `json:"initiated_at"`
	CompletedAt         *time.Time `json:"completed_at,omitempty"`
	RTOActualSeconds    *int       `json:"rto_actual_seconds,omitempty"`
	LastError           *string    `json:"last_error,omitempty"`
	ClaimedAt           *time.Time `json:"claimed_at,omitempty"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// ApprovalPolicy controls the human approval gate for failover runs.
type ApprovalPolicy struct {
	ID                       string    `json:"id"`
	TenantID                 string    `json:"tenant_id"`
	Operation                string    `json:"operation"`
	Mode                     string    `json:"mode"`
	Quorum                   int       `json:"quorum"`
	RequireReason            bool      `json:"require_reason"`
	PreventInitiatorApproval bool      `json:"prevent_initiator_approval"`
	RequireStepUp            bool      `json:"require_step_up"`
	StepUpMaxAgeSeconds      int       `json:"step_up_max_age_seconds"`
	AllowBreakGlass          bool      `json:"allow_break_glass"`
	BreakGlassRequiresReason bool      `json:"break_glass_requires_reason"`
	BreakGlassRequiresStepUp bool      `json:"break_glass_requires_step_up"`
	BreakGlassMinApprovers   int       `json:"break_glass_min_approvers"`
	CreatedAt                time.Time `json:"created_at"`
	UpdatedAt                time.Time `json:"updated_at"`
}

// FailoverApproval is one immutable approval submission for a failover run.
type FailoverApproval struct {
	ID               string     `json:"id"`
	TenantID         string     `json:"tenant_id"`
	RunID            string     `json:"run_id"`
	ApproverID       string     `json:"approver_id"`
	Decision         string     `json:"decision"`
	Reason           string     `json:"reason,omitempty"`
	BreakGlass       bool       `json:"break_glass"`
	StepUpVerifiedAt *time.Time `json:"step_up_verified_at,omitempty"`
	DecidedAt        time.Time  `json:"decided_at"`
}

// BreakGlassEvent is the append-only ledger row created when an approval uses the
// emergency override path. The reason text itself remains on the approval row; the
// ledger stores a hash for audit correlation without duplicating sensitive detail.
type BreakGlassEvent struct {
	ID         string    `json:"id"`
	TenantID   string    `json:"tenant_id"`
	RunID      string    `json:"run_id"`
	ApprovalID string    `json:"approval_id"`
	ActorID    string    `json:"actor_id"`
	ReasonHash string    `json:"reason_hash"`
	RecordedAt time.Time `json:"recorded_at"`
}

// RTOActual returns the achieved RTO (completed_at - initiated_at). Ok is false
// until the run has completed, so an in-flight run reports no actual yet.
func (r *FailoverRun) RTOActual() (rto time.Duration, ok bool) {
	if r.CompletedAt == nil {
		return 0, false
	}
	d := r.CompletedAt.Sub(r.InitiatedAt)
	if d < 0 {
		d = 0
	}
	return d, true
}

// IsTerminal reports whether the run has reached a final state and the driver
// must not claim it again.
func (r *FailoverRun) IsTerminal() bool {
	switch r.Status {
	case StatusCompleted, StatusFailed, StatusCancelled, StatusRolledBack:
		return true
	default:
		return false
	}
}

// FailoverStep is a durable per-step audit + idempotency record (one per step).
type FailoverStep struct {
	ID         string         `json:"id"`
	RunID      string         `json:"run_id"`
	Step       string         `json:"step"`
	Status     string         `json:"status"`
	Detail     map[string]any `json:"detail,omitempty"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at,omitempty"`
}

// Attestation is the immutable, signed Gate-4 record (sealed to WORM; the row
// is the index). RTO objective-vs-actual is the Cutover bar (§6.4).
type Attestation struct {
	ID                  string    `json:"id"`
	TenantID            string    `json:"tenant_id"`
	RunID               string    `json:"run_id"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds"`
	RTOActualSeconds    int       `json:"rto_actual_seconds"`
	RPOSeconds          int       `json:"rpo_seconds"`
	ValidationRatio     float64   `json:"validation_ratio"`
	ReportObjectKey     string    `json:"report_object_key"`
	ContentHash         string    `json:"content_hash"`
	CreatedAt           time.Time `json:"created_at"`
}

// DRAgent is an enrolled capture agent on customer infra.
type DRAgent struct {
	ID                string     `json:"id"`
	TenantID          string     `json:"tenant_id"`
	SiteID            *string    `json:"site_id,omitempty"`
	Status            string     `json:"status"`
	MTLSThumbprint    *string    `json:"mtls_thumbprint,omitempty"`
	CertSerial        *string    `json:"cert_serial,omitempty"`
	CertIssuedAt      *time.Time `json:"cert_issued_at,omitempty"`
	CertExpiresAt     *time.Time `json:"cert_expires_at,omitempty"`
	CertRevokedAt     *time.Time `json:"cert_revoked_at,omitempty"`
	CertRevokedReason *string    `json:"cert_revoked_reason,omitempty"`
	LastSeenAt        *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// AgentCertRevocation is the durable mTLS denylist entry for a retired or
// explicitly revoked DR agent certificate. It revokes one thumbprint without
// necessarily disabling the agent identity.
type AgentCertRevocation struct {
	Thumbprint string    `json:"thumbprint"`
	AgentID    string    `json:"agent_id"`
	TenantID   string    `json:"tenant_id"`
	CertSerial string    `json:"cert_serial"`
	RevokedAt  time.Time `json:"revoked_at"`
	Reason     string    `json:"reason"`
}
