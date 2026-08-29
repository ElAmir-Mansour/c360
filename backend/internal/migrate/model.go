// Package migrate owns the Clario Migrate cloud-migration orchestration domain.
//
// It persists migration programs, workloads, dependency move groups, waves,
// cutover windows, readiness/validation gates, rollback plans, connector
// configuration, and append-only evidence. The package composes existing Clario
// foundations by stable contract: Recover Metastore supplies application
// inventory metadata, and DR Runbook Studio/topology identifiers are linked
// rather than reimplemented here.
package migrate

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

const EntitlementCloudMigration = "migrate.cloud_migration"

const (
	PermMigrateRead           = "migrate:read"
	PermMigratePlan           = "migrate:plan"
	PermMigrateApprove        = "migrate:approve"
	PermMigrateCutover        = "migrate:cutover"
	PermMigrateRollback       = "migrate:rollback"
	PermMigrateIntegrations   = "migrate:integrations"
	PermMigrateEvidenceExport = "migrate:evidence:export"
	PermMigrateAdmin          = "migrate:admin"
)

var (
	ErrNotFound               = errors.New("migrate object not found")
	ErrValidation             = errors.New("migrate validation failed")
	ErrUnauthorized           = errors.New("migrate action is not authorized")
	ErrInvalidStatus          = errors.New("migrate invalid status")
	ErrInvalidTransition      = errors.New("migrate status transition is not allowed")
	ErrVersionConflict        = errors.New("migrate version conflict")
	ErrCompletenessBlocked    = errors.New("migrate move group is incomplete")
	ErrApprovalRequired       = errors.New("migrate approval is required")
	ErrGoNoGoRequired         = errors.New("migrate go decision is required")
	ErrReadinessBlocked       = errors.New("migrate readiness checks block cutover start")
	ErrValidationBlocked      = errors.New("migrate validation checks block cutover completion")
	ErrRollbackPlanRequired   = errors.New("migrate approved rollback plan is required")
	ErrConnectorNotConfigured = errors.New("migrate connector is not configured")
	ErrConnectorRequestFailed = errors.New("migrate connector request failed")
	ErrEntitlementUnavailable = errors.New("migrate entitlement service unavailable")
	ErrWindowConflict         = errors.New("migrate cutover window conflict")
	ErrAuditAppendOnly        = errors.New("migrate audit log is append-only")
)

type MigrationStrategy string

const (
	StrategyRehost     MigrationStrategy = "rehost"
	StrategyReplatform MigrationStrategy = "replatform"
	StrategyRepurchase MigrationStrategy = "repurchase"
	StrategyRefactor   MigrationStrategy = "refactor"
	StrategyRetire     MigrationStrategy = "retire"
	StrategyRetain     MigrationStrategy = "retain"
)

var Strategies = []MigrationStrategy{
	StrategyRehost,
	StrategyReplatform,
	StrategyRepurchase,
	StrategyRefactor,
	StrategyRetire,
	StrategyRetain,
}

func (s MigrationStrategy) Valid() bool { return slices.Contains(Strategies, s) }

type ProgramStatus string

const (
	ProgramDraft     ProgramStatus = "draft"
	ProgramActive    ProgramStatus = "active"
	ProgramCompleted ProgramStatus = "completed"
	ProgramSuspended ProgramStatus = "suspended"
)

var ProgramStatuses = []ProgramStatus{ProgramDraft, ProgramActive, ProgramCompleted, ProgramSuspended}

func (s ProgramStatus) Valid() bool { return slices.Contains(ProgramStatuses, s) }

type WorkloadStatus string

const (
	WorkloadDiscovered     WorkloadStatus = "discovered"
	WorkloadAssessed       WorkloadStatus = "assessed"
	WorkloadPlanned        WorkloadStatus = "planned"
	WorkloadInMigration    WorkloadStatus = "in_migration"
	WorkloadCutover        WorkloadStatus = "cutover"
	WorkloadValidated      WorkloadStatus = "validated"
	WorkloadLive           WorkloadStatus = "live"
	WorkloadDecommissioned WorkloadStatus = "decommissioned"
	WorkloadRolledBack     WorkloadStatus = "rolled_back"
)

var WorkloadStatuses = []WorkloadStatus{
	WorkloadDiscovered,
	WorkloadAssessed,
	WorkloadPlanned,
	WorkloadInMigration,
	WorkloadCutover,
	WorkloadValidated,
	WorkloadLive,
	WorkloadDecommissioned,
	WorkloadRolledBack,
}

var WorkloadTransitionTable = map[WorkloadStatus][]WorkloadStatus{
	WorkloadDiscovered:     {WorkloadAssessed},
	WorkloadAssessed:       {WorkloadPlanned},
	WorkloadPlanned:        {WorkloadInMigration, WorkloadRolledBack},
	WorkloadInMigration:    {WorkloadCutover, WorkloadRolledBack},
	WorkloadCutover:        {WorkloadValidated, WorkloadRolledBack},
	WorkloadValidated:      {WorkloadLive, WorkloadRolledBack},
	WorkloadLive:           {WorkloadDecommissioned, WorkloadRolledBack},
	WorkloadDecommissioned: {},
	WorkloadRolledBack:     {WorkloadPlanned},
}

func (s WorkloadStatus) Valid() bool { return slices.Contains(WorkloadStatuses, s) }

func ValidateWorkloadTransition(from, to WorkloadStatus) error {
	if !from.Valid() || !to.Valid() {
		return ErrInvalidStatus
	}
	if !slices.Contains(WorkloadTransitionTable[from], to) {
		return fmt.Errorf("%s -> %s: %w", from, to, ErrInvalidTransition)
	}
	return nil
}

type MoveGroupStatus string

const (
	MoveGroupDraft             MoveGroupStatus = "draft"
	MoveGroupCompletenessIssue MoveGroupStatus = "completeness_issue"
	MoveGroupReady             MoveGroupStatus = "ready"
	MoveGroupApprovalPending   MoveGroupStatus = "approval_pending"
	MoveGroupApproved          MoveGroupStatus = "approved"
	MoveGroupRejected          MoveGroupStatus = "rejected"
)

var MoveGroupStatuses = []MoveGroupStatus{
	MoveGroupDraft,
	MoveGroupCompletenessIssue,
	MoveGroupReady,
	MoveGroupApprovalPending,
	MoveGroupApproved,
	MoveGroupRejected,
}

func (s MoveGroupStatus) Valid() bool { return slices.Contains(MoveGroupStatuses, s) }

type WaveStatus string

const (
	WavePlanned    WaveStatus = "planned"
	WaveReady      WaveStatus = "ready"
	WaveInProgress WaveStatus = "in_progress"
	WaveCutover    WaveStatus = "cutover"
	WaveCompleted  WaveStatus = "completed"
	WavePaused     WaveStatus = "paused"
	WaveRolledBack WaveStatus = "rolled_back"
)

var WaveStatuses = []WaveStatus{WavePlanned, WaveReady, WaveInProgress, WaveCutover, WaveCompleted, WavePaused, WaveRolledBack}

var WaveTransitionTable = map[WaveStatus][]WaveStatus{
	WavePlanned:    {WaveReady, WavePaused},
	WaveReady:      {WaveInProgress, WavePaused},
	WaveInProgress: {WaveCutover, WavePaused, WaveRolledBack},
	WaveCutover:    {WaveCompleted, WaveRolledBack},
	WaveCompleted:  {},
	WavePaused:     {WavePlanned, WaveReady, WaveInProgress, WaveRolledBack},
	WaveRolledBack: {WavePlanned},
}

func (s WaveStatus) Valid() bool { return slices.Contains(WaveStatuses, s) }

func ValidateWaveTransition(from, to WaveStatus) error {
	if !from.Valid() || !to.Valid() {
		return ErrInvalidStatus
	}
	if !slices.Contains(WaveTransitionTable[from], to) {
		return fmt.Errorf("%s -> %s: %w", from, to, ErrInvalidTransition)
	}
	return nil
}

type WindowType string

const (
	WindowMaintenance WindowType = "maintenance"
	WindowOffPeak     WindowType = "off_peak"
	WindowDowntime    WindowType = "planned_downtime"
)

func (t WindowType) Valid() bool {
	return t == WindowMaintenance || t == WindowOffPeak || t == WindowDowntime
}

type Decision string

const (
	DecisionPending  Decision = "pending"
	DecisionApproved Decision = "approved"
	DecisionRejected Decision = "rejected"
	DecisionGo       Decision = "go"
	DecisionNoGo     Decision = "no_go"
)

func (d Decision) Valid() bool {
	switch d {
	case DecisionPending, DecisionApproved, DecisionRejected, DecisionGo, DecisionNoGo:
		return true
	default:
		return false
	}
}

type CheckStatus string

const (
	CheckPending    CheckStatus = "pending"
	CheckRunning    CheckStatus = "running"
	CheckPassed     CheckStatus = "passed"
	CheckFailed     CheckStatus = "failed"
	CheckOverridden CheckStatus = "overridden"
)

func (s CheckStatus) Valid() bool {
	switch s {
	case CheckPending, CheckRunning, CheckPassed, CheckFailed, CheckOverridden:
		return true
	default:
		return false
	}
}

type CheckKind string

const (
	CheckReadiness       CheckKind = "readiness"
	CheckValidation      CheckKind = "validation"
	CheckRollbackSuccess CheckKind = "rollback_success"
)

func (k CheckKind) Valid() bool {
	return k == CheckReadiness || k == CheckValidation || k == CheckRollbackSuccess
}

type Actor struct {
	UserID     uuid.UUID `json:"user_id"`
	Permission []string  `json:"permissions,omitempty"`
}

func (a Actor) Can(permission string) bool {
	if a.UserID == uuid.Nil {
		return false
	}
	for _, p := range a.Permission {
		if p == permission || p == PermMigrateAdmin {
			return true
		}
		prefix := strings.TrimSuffix(p, "*")
		if strings.HasSuffix(p, "*") && strings.HasPrefix(permission, prefix) {
			return true
		}
	}
	return false
}

type Program struct {
	ID          uuid.UUID     `json:"id"`
	TenantID    uuid.UUID     `json:"tenant_id"`
	Reference   string        `json:"reference"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	Owner       string        `json:"owner"`
	Status      ProgramStatus `json:"status"`
	RowVersion  int           `json:"row_version"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

func (p *Program) ValidateForCreate() error {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
	p.Owner = strings.TrimSpace(p.Owner)
	if p.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required: %w", ErrValidation)
	}
	if p.Name == "" {
		return fmt.Errorf("program name is required: %w", ErrValidation)
	}
	if p.Status == "" {
		p.Status = ProgramDraft
	}
	if !p.Status.Valid() {
		return ErrInvalidStatus
	}
	return nil
}

type WorkloadDependency struct {
	AppKey      string `json:"app_key"`
	Criticality string `json:"criticality"`
}

type Workload struct {
	ID                   uuid.UUID            `json:"id"`
	TenantID             uuid.UUID            `json:"tenant_id"`
	ProgramID            uuid.UUID            `json:"program_id"`
	AppKey               string               `json:"app_key"`
	Name                 string               `json:"name"`
	SourceEnv            string               `json:"source_environment"`
	TargetCloud          string               `json:"target_cloud"`
	TargetAccount        string               `json:"target_account"`
	Strategy             MigrationStrategy    `json:"strategy"`
	OwnerName            string               `json:"owner_name"`
	OwnerContact         string               `json:"owner_contact"`
	Tier                 string               `json:"tier"`
	Status               WorkloadStatus       `json:"status"`
	ReadinessScore       int                  `json:"readiness_score"`
	EstimatedEffortHours float64              `json:"estimated_effort_hours"`
	Dependencies         []WorkloadDependency `json:"dependencies"`
	MoveGroupID          *uuid.UUID           `json:"move_group_id,omitempty"`
	RowVersion           int                  `json:"row_version"`
	CreatedAt            time.Time            `json:"created_at"`
	UpdatedAt            time.Time            `json:"updated_at"`
}

func (w *Workload) ValidateForCreate() error {
	w.AppKey = strings.TrimSpace(w.AppKey)
	w.Name = strings.TrimSpace(w.Name)
	w.SourceEnv = strings.TrimSpace(w.SourceEnv)
	w.TargetCloud = strings.TrimSpace(w.TargetCloud)
	w.TargetAccount = strings.TrimSpace(w.TargetAccount)
	w.OwnerName = strings.TrimSpace(w.OwnerName)
	w.OwnerContact = strings.TrimSpace(w.OwnerContact)
	w.Tier = strings.TrimSpace(w.Tier)
	if w.TenantID == uuid.Nil || w.ProgramID == uuid.Nil {
		return fmt.Errorf("tenant_id and program_id are required: %w", ErrValidation)
	}
	if w.AppKey == "" || w.Name == "" {
		return fmt.Errorf("app_key and name are required: %w", ErrValidation)
	}
	if w.Strategy == "" {
		w.Strategy = StrategyRehost
	}
	if !w.Strategy.Valid() {
		return fmt.Errorf("strategy %q: %w", w.Strategy, ErrValidation)
	}
	if w.Status == "" {
		w.Status = WorkloadDiscovered
	}
	if !w.Status.Valid() {
		return ErrInvalidStatus
	}
	if w.ReadinessScore < 0 || w.ReadinessScore > 100 {
		return fmt.Errorf("readiness_score must be 0..100: %w", ErrValidation)
	}
	if w.EstimatedEffortHours < 0 || w.EstimatedEffortHours > 100000 {
		return fmt.Errorf("estimated_effort_hours must be 0..100000: %w", ErrValidation)
	}
	return nil
}

type MoveGroup struct {
	ID                   uuid.UUID       `json:"id"`
	TenantID             uuid.UUID       `json:"tenant_id"`
	ProgramID            uuid.UUID       `json:"program_id"`
	Reference            string          `json:"reference"`
	Name                 string          `json:"name"`
	Description          string          `json:"description"`
	Constraints          string          `json:"constraints"`
	Status               MoveGroupStatus `json:"status"`
	CompletenessStatus   string          `json:"completeness_status"`
	CompletenessFindings []string        `json:"completeness_findings"`
	SubmittedBy          *uuid.UUID      `json:"submitted_by,omitempty"`
	SubmittedAt          *time.Time      `json:"submitted_at,omitempty"`
	ApprovedBy           *uuid.UUID      `json:"approved_by,omitempty"`
	ApprovedAt           *time.Time      `json:"approved_at,omitempty"`
	DecisionRationale    string          `json:"decision_rationale,omitempty"`
	RowVersion           int             `json:"row_version"`
	CreatedAt            time.Time       `json:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
	Workloads            []Workload      `json:"workloads,omitempty"`
	// WaveSequence and WavePlannedSeconds are populated only when a move group
	// is loaded in the context of a wave (from migrate_wave_move_group). They
	// carry the operator-defined ordering and planned duration of this group
	// inside that wave and feed the wave critical-path computation.
	WaveSequence       int `json:"wave_sequence,omitempty"`
	WavePlannedSeconds int `json:"wave_planned_seconds,omitempty"`
	// DRTopologyGroupID optionally binds the move group to a DR consistency/topology
	// group so its dependency/failover view can be proxied through the Topology API.
	DRTopologyGroupID *uuid.UUID `json:"dr_topology_group_id,omitempty"`
}

type Wave struct {
	ID                     uuid.UUID  `json:"id"`
	TenantID               uuid.UUID  `json:"tenant_id"`
	ProgramID              uuid.UUID  `json:"program_id"`
	Reference              string     `json:"reference"`
	Name                   string     `json:"name"`
	Description            string     `json:"description"`
	Sequence               int        `json:"sequence"`
	Status                 WaveStatus `json:"status"`
	ParentRunbookID        *uuid.UUID `json:"parent_runbook_id,omitempty"`
	PlannedDurationSeconds int        `json:"planned_duration_seconds"`
	ActualDurationSeconds  *int       `json:"actual_duration_seconds,omitempty"`
	StartedAt              *time.Time `json:"started_at,omitempty"`
	CompletedAt            *time.Time `json:"completed_at,omitempty"`
	// DRRunbookID links the wave to the REAL parent runbook GENERATED in the DR
	// Runbook Studio engine (Wave 2). It replaces the inert ParentRunbookID usage:
	// ParentRunbookID remains for any externally-authored runbook pointer, while
	// DRRunbookID is the engine-generated, engine-owned runbook this wave executes.
	DRRunbookID *uuid.UUID `json:"dr_runbook_id,omitempty"`
	// DRTopologyGroupID optionally binds the wave to a DR consistency/topology group.
	DRTopologyGroupID  *uuid.UUID  `json:"dr_topology_group_id,omitempty"`
	RunbookGeneratedAt *time.Time  `json:"runbook_generated_at,omitempty"`
	RowVersion         int         `json:"row_version"`
	CreatedAt          time.Time   `json:"created_at"`
	UpdatedAt          time.Time   `json:"updated_at"`
	MoveGroups         []MoveGroup `json:"move_groups,omitempty"`
}

type CutoverWindow struct {
	ID           uuid.UUID  `json:"id"`
	TenantID     uuid.UUID  `json:"tenant_id"`
	ProgramID    uuid.UUID  `json:"program_id"`
	WaveID       uuid.UUID  `json:"wave_id"`
	Reference    string     `json:"reference"`
	Name         string     `json:"name"`
	WindowType   WindowType `json:"window_type"`
	StartsAt     time.Time  `json:"starts_at"`
	EndsAt       time.Time  `json:"ends_at"`
	Constraints  string     `json:"constraints"`
	Decision     Decision   `json:"decision"`
	DecidedBy    *uuid.UUID `json:"decided_by,omitempty"`
	DecidedAt    *time.Time `json:"decided_at,omitempty"`
	Rationale    string     `json:"rationale,omitempty"`
	RunbookRunID *uuid.UUID `json:"runbook_run_id,omitempty"`
	// DRRunbookID / DRRunID link the cutover window to the REAL DR Runbook Studio
	// runbook and its live run (Wave 2). DRRunID is the engine run id used to poll
	// frontier/ETA and proxy task actions; it replaces the inert RunbookRunID usage.
	DRRunbookID *uuid.UUID `json:"dr_runbook_id,omitempty"`
	DRRunID     *uuid.UUID `json:"dr_run_id,omitempty"`
	// RunStartedAt / RunStartedBy record the auditable start event of the live DR
	// cutover run (Wave 3, migration 000004).
	RunStartedAt *time.Time `json:"run_started_at,omitempty"`
	RunStartedBy *uuid.UUID `json:"run_started_by,omitempty"`
	RowVersion   int        `json:"row_version"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// RunbookBindingRole distinguishes a wave's parent runbook from a per-move-group
// child runbook (and an isolated rollback runbook) in the binding audit trail.
type RunbookBindingRole string

const (
	BindingRoleParent   RunbookBindingRole = "parent"
	BindingRoleChild    RunbookBindingRole = "child"
	BindingRoleRollback RunbookBindingRole = "rollback"
)

// RunbookBindingSource records how a binding's runbook was produced.
type RunbookBindingSource string

const (
	BindingSourceGenerated RunbookBindingSource = "generated"
	BindingSourceAuthored  RunbookBindingSource = "authored"
	BindingSourceImported  RunbookBindingSource = "imported"
)

// RunbookBindingStatus tracks the live lifecycle of a binding's runbook/run.
type RunbookBindingStatus string

const (
	BindingStatusGenerated  RunbookBindingStatus = "generated"
	BindingStatusRunning    RunbookBindingStatus = "running"
	BindingStatusCompleted  RunbookBindingStatus = "completed"
	BindingStatusFailed     RunbookBindingStatus = "failed"
	BindingStatusSuperseded RunbookBindingStatus = "superseded"
)

// RunbookBinding is the audit-trail row linking a Migrate entity (wave / window /
// move group) to a DR Runbook Studio runbook and (once started) its run. It makes
// the previously-inert linking UUIDs real and queryable, and lets a wave
// regenerate its runbook (a new row) without losing the prior binding.
type RunbookBinding struct {
	ID              uuid.UUID            `json:"id"`
	TenantID        uuid.UUID            `json:"tenant_id"`
	ProgramID       uuid.UUID            `json:"program_id"`
	WaveID          *uuid.UUID           `json:"wave_id,omitempty"`
	WindowID        *uuid.UUID           `json:"window_id,omitempty"`
	MoveGroupID     *uuid.UUID           `json:"move_group_id,omitempty"`
	DRRunbookID     uuid.UUID            `json:"dr_runbook_id"`
	DRRunID         *uuid.UUID           `json:"dr_run_id,omitempty"`
	Role            RunbookBindingRole   `json:"role"`
	ParentBindingID *uuid.UUID           `json:"parent_binding_id,omitempty"`
	Source          RunbookBindingSource `json:"source"`
	Status          RunbookBindingStatus `json:"status"`
	Ordinal         int                  `json:"ordinal"`
	Detail          map[string]any       `json:"detail,omitempty"`
	CreatedBy       *uuid.UUID           `json:"created_by,omitempty"`
	CreatedAt       time.Time            `json:"created_at"`
	UpdatedAt       time.Time            `json:"updated_at"`
}

// WaveRunbook is the response of the wave runbook generation/fetch endpoints: the
// parent runbook binding plus the per-move-group child bindings, and (when a run
// has been started) the live state fetched from the DR engine.
type WaveRunbook struct {
	WaveID    uuid.UUID        `json:"wave_id"`
	Parent    RunbookBinding   `json:"parent"`
	Children  []RunbookBinding `json:"children"`
	Runbook   *DRRunbook       `json:"runbook,omitempty"`
	LiveState *DRRunLiveState  `json:"live_state,omitempty"`
}

// RollbackRunStatus tracks the lifecycle of an executed rollback DR run as
// observed from the DR engine.
type RollbackRunStatus string

const (
	RollbackRunRunning   RollbackRunStatus = "running"
	RollbackRunCompleted RollbackRunStatus = "completed"
	RollbackRunFailed    RollbackRunStatus = "failed"
	RollbackRunAborted   RollbackRunStatus = "aborted"
)

// RollbackRun is the trigger-decision provenance row for one executed rollback:
// who triggered it, why, against which window/wave, and the isolated DR rollback
// runbook + run it drove. It makes the rollback an auditable, gated, real
// execution rather than a status flip.
type RollbackRun struct {
	ID             uuid.UUID         `json:"id"`
	TenantID       uuid.UUID         `json:"tenant_id"`
	ProgramID      uuid.UUID         `json:"program_id"`
	WindowID       uuid.UUID         `json:"window_id"`
	WaveID         uuid.UUID         `json:"wave_id"`
	RollbackPlanID *uuid.UUID        `json:"rollback_plan_id,omitempty"`
	BindingID      *uuid.UUID        `json:"binding_id,omitempty"`
	DRRunbookID    uuid.UUID         `json:"dr_runbook_id"`
	DRRunID        uuid.UUID         `json:"dr_run_id"`
	TriggeredBy    uuid.UUID         `json:"triggered_by"`
	Reason         string            `json:"reason"`
	Status         RollbackRunStatus `json:"status"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

// WindowRun is the response of the cutover execution endpoints: the window's
// runbook binding, the persisted rollback-run provenance (when one exists), and
// the live DR run state hydrated from the engine.
type WindowRun struct {
	WindowID    uuid.UUID       `json:"window_id"`
	WaveID      uuid.UUID       `json:"wave_id"`
	Binding     *RunbookBinding `json:"binding,omitempty"`
	RollbackRun *RollbackRun    `json:"rollback_run,omitempty"`
	LiveState   *DRRunLiveState `json:"live_state,omitempty"`
}

type RollbackPlan struct {
	ID              uuid.UUID  `json:"id"`
	TenantID        uuid.UUID  `json:"tenant_id"`
	ProgramID       uuid.UUID  `json:"program_id"`
	WindowID        uuid.UUID  `json:"window_id"`
	Strategy        string     `json:"strategy"`
	Procedures      string     `json:"procedures"`
	SuccessCriteria string     `json:"success_criteria"`
	RunbookID       *uuid.UUID `json:"runbook_id,omitempty"`
	Decision        Decision   `json:"decision"`
	DecidedBy       *uuid.UUID `json:"decided_by,omitempty"`
	DecidedAt       *time.Time `json:"decided_at,omitempty"`
	Rationale       string     `json:"rationale,omitempty"`
	RowVersion      int        `json:"row_version"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type GateCheck struct {
	ID         uuid.UUID   `json:"id"`
	TenantID   uuid.UUID   `json:"tenant_id"`
	ProgramID  uuid.UUID   `json:"program_id"`
	WindowID   uuid.UUID   `json:"window_id"`
	Kind       CheckKind   `json:"kind"`
	Name       string      `json:"name"`
	CheckType  string      `json:"check_type"`
	Status     CheckStatus `json:"status"`
	Evidence   string      `json:"evidence"`
	Result     string      `json:"result"`
	Required   bool        `json:"required"`
	RecordedBy *uuid.UUID  `json:"recorded_by,omitempty"`
	RecordedAt *time.Time  `json:"recorded_at,omitempty"`
	CreatedAt  time.Time   `json:"created_at"`
	UpdatedAt  time.Time   `json:"updated_at"`
}

type ConnectorConfig struct {
	ID          uuid.UUID `json:"id"`
	TenantID    uuid.UUID `json:"tenant_id"`
	Name        string    `json:"name"`
	Provider    string    `json:"provider"`
	EndpointURL string    `json:"endpoint_url"`
	AuthType    string    `json:"auth_type"`
	SecretRef   string    `json:"secret_ref,omitempty"`
	Enabled     bool      `json:"enabled"`
	CreatedBy   uuid.UUID `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// ConnectorInvocationSource records what drove a connector invocation: the
// manual Wave-1 endpoint, or an AUTOMATED task inside a live cutover / rollback
// DR run (Wave 6, P10a). A run-driven invocation additionally carries the DR run
// + task that produced it, so the evidence report can attribute the connector
// call to the exact run task.
type ConnectorInvocationSource string

const (
	ConnectorSourceManual      ConnectorInvocationSource = "manual"
	ConnectorSourceCutoverRun  ConnectorInvocationSource = "cutover_run"
	ConnectorSourceRollbackRun ConnectorInvocationSource = "rollback_run"
)

type ConnectorInvocation struct {
	ID             uuid.UUID                 `json:"id"`
	TenantID       uuid.UUID                 `json:"tenant_id"`
	ConnectorID    uuid.UUID                 `json:"connector_id"`
	WindowID       uuid.UUID                 `json:"window_id"`
	IdempotencyKey string                    `json:"idempotency_key"`
	Action         string                    `json:"action"`
	RequestBody    map[string]any            `json:"request_body,omitempty"`
	Status         string                    `json:"status"`
	HTTPStatus     int                       `json:"http_status,omitempty"`
	ResponseBody   string                    `json:"response_body,omitempty"`
	ErrorMessage   string                    `json:"error_message,omitempty"`
	Source         ConnectorInvocationSource `json:"source"`
	DRRunID        *uuid.UUID                `json:"dr_run_id,omitempty"`
	DRTaskID       *uuid.UUID                `json:"dr_task_id,omitempty"`
	TaskKey        string                    `json:"task_key,omitempty"`
	CreatedAt      time.Time                 `json:"created_at"`
	UpdatedAt      time.Time                 `json:"updated_at"`
}

type AuditEvent struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	ProgramID   uuid.UUID      `json:"program_id"`
	ActorID     *uuid.UUID     `json:"actor_id,omitempty"`
	Action      string         `json:"action"`
	SubjectID   *uuid.UUID     `json:"subject_id,omitempty"`
	SubjectType string         `json:"subject_type,omitempty"`
	Summary     string         `json:"summary"`
	Detail      map[string]any `json:"detail,omitempty"`
	OccurredAt  time.Time      `json:"occurred_at"`
	RecordedAt  time.Time      `json:"recorded_at"`
}

type ProductCapability struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	Description    string `json:"description,omitempty"`
	EntitlementKey string `json:"entitlement_key"`
	Enabled        bool   `json:"enabled"`
}

type ProductResponse struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	EntitlementKey    string              `json:"entitlement_key"`
	EntitlementState  string              `json:"entitlement_state"`
	EntitlementReason string              `json:"entitlement_reason,omitempty"`
	Licensed          bool                `json:"licensed"`
	Capabilities      []ProductCapability `json:"capabilities"`
}

type PortfolioSummary struct {
	TotalWorkloads   int            `json:"total_workloads"`
	ByStrategy       map[string]int `json:"by_strategy"`
	ByStatus         map[string]int `json:"by_status"`
	ByTier           map[string]int `json:"by_tier"`
	ReadinessAverage int            `json:"readiness_average"`
}

type CriticalPath struct {
	// TotalSeconds is the longest-path length through the wave's workload /
	// move-group dependency DAG, weighted by each workload's real estimated
	// duration. It is never a global constant.
	TotalSeconds int `json:"total_seconds"`
	// Path is the ordered list of node labels (move-group references plus the
	// critical workload app keys) that form the longest path.
	Path []string `json:"path"`
	// Nodes is the per-node breakdown of the critical path: which workload,
	// in which move group, with what computed duration and how it was derived.
	Nodes      []CriticalPathNode `json:"nodes"`
	Milestones []Milestone        `json:"milestones"`
	// Method documents how durations were derived so the figure is honest:
	// "estimated_effort" when operator effort estimates drove it, "derived"
	// when strategy/tier/readiness fallbacks were used, or "mixed".
	Method string `json:"method"`
}

type CriticalPathNode struct {
	MoveGroupRef    string `json:"move_group_ref"`
	AppKey          string `json:"app_key"`
	WorkloadName    string `json:"workload_name,omitempty"`
	DurationSeconds int    `json:"duration_seconds"`
	OffsetSeconds   int    `json:"offset_seconds"`
	DurationSource  string `json:"duration_source"`
}

type Milestone struct {
	Label             string `json:"label"`
	OffsetSeconds     int    `json:"offset_seconds"`
	CompletionPercent int    `json:"completion_percent"`
}

type CommandCenter struct {
	Program           Program          `json:"program"`
	Summary           PortfolioSummary `json:"summary"`
	MoveGroups        []MoveGroup      `json:"move_groups"`
	Waves             []Wave           `json:"waves"`
	UpcomingWindows   []CutoverWindow  `json:"upcoming_windows"`
	CriticalPath      CriticalPath     `json:"critical_path"`
	ReadinessBlockers []GateCheck      `json:"readiness_blockers"`
	RecentAudit       []AuditEvent     `json:"recent_audit"`
	VarianceSeconds   int              `json:"variance_seconds"`
	// WaveStatuses is the per-wave rollup the UI renders alongside the waves list:
	// %complete, the operator-set planned vs measured actual duration, the wave's
	// variance, and — when a live cutover run exists for the wave — its run status.
	WaveStatuses []WaveStatusView `json:"wave_statuses"`
}

// WaveStatusView is a per-wave progress rollup for the command center / exec
// summary. CompletionPercent is derived from the wave's real lifecycle status;
// VarianceSeconds is actual-minus-planned once the wave has an actual duration;
// RunStatus is the live DR cutover-run status (from the window binding) when a run
// has been started for the wave, otherwise empty.
type WaveStatusView struct {
	WaveID                 uuid.UUID  `json:"wave_id"`
	Reference              string     `json:"reference"`
	Name                   string     `json:"name"`
	Sequence               int        `json:"sequence"`
	Status                 WaveStatus `json:"status"`
	CompletionPercent      int        `json:"completion_percent"`
	PlannedDurationSeconds int        `json:"planned_duration_seconds"`
	ActualDurationSeconds  *int       `json:"actual_duration_seconds,omitempty"`
	VarianceSeconds        int        `json:"variance_seconds"`
	RunStatus              string     `json:"run_status,omitempty"`
	RunStartedAt           *time.Time `json:"run_started_at,omitempty"`
}

// waveCompletionPercent maps a wave's lifecycle status to a coarse %complete the
// UI renders as a progress bar. It is derived from the real state machine, not a
// stored field, so it can never drift from the wave's actual status.
func waveCompletionPercent(status WaveStatus) int {
	switch status {
	case WavePlanned:
		return 0
	case WaveReady:
		return 20
	case WaveInProgress:
		return 50
	case WaveCutover:
		return 80
	case WaveCompleted:
		return 100
	case WavePaused:
		return 10
	case WaveRolledBack:
		return 0
	default:
		return 0
	}
}

// ProgramStatusSummary is the concise, read-only executive/stakeholder view of a
// migration program: overall %complete, wave rollups, open blockers, the current
// live run (if any), and the program-level variance. It is a projection over the
// same aggregate the command center loads (no separate data path), gated on
// migrate:read.
type ProgramStatusSummary struct {
	Program          Program          `json:"program"`
	TotalWorkloads   int              `json:"total_workloads"`
	ReadinessAverage int              `json:"readiness_average"`
	WaveCount        int              `json:"wave_count"`
	CompletedWaves   int              `json:"completed_waves"`
	OverallPercent   int              `json:"overall_percent"`
	VarianceSeconds  int              `json:"variance_seconds"`
	BlockerCount     int              `json:"blocker_count"`
	Waves            []WaveStatusView `json:"waves"`
	Blockers         []GateCheck      `json:"blockers"`
	// CurrentRun is the wave that currently has a live (running) cutover run, if any,
	// so the exec view can point at the in-flight cutover.
	CurrentRun *WaveStatusView `json:"current_run,omitempty"`
}

func normalizeStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

// --- Wave critical-path computation -----------------------------------------
//
// The critical path is the longest weighted path through the wave's workload
// dependency DAG. Node weight is each workload's estimated execution duration,
// derived from real per-workload model attributes (operator effort estimate
// when present, otherwise strategy/tier/readiness). Edges come from two real
// sources: (1) intra-group workload dependencies (a workload runs after the
// workloads it declares as dependencies), and (2) move-group sequencing inside
// the wave (a group at sequence k+1 starts only after the group at sequence k
// completes). No global constant total is used.

// strategyEffortHours is the baseline execution effort, in hours, for moving a
// single workload under each migration strategy. These are relative weights
// grounded in well-known migration-cost ordering (the 6 R's): rehosting a VM is
// cheaper than replatforming, which is far cheaper than a refactor; retiring or
// retaining needs only decommission/verification effort. They are per-strategy
// model attributes, not a single global constant applied to every workload.
var strategyEffortHours = map[MigrationStrategy]float64{
	StrategyRetire:     1.0,
	StrategyRetain:     1.0,
	StrategyRehost:     4.0,
	StrategyRepurchase: 6.0,
	StrategyReplatform: 12.0,
	StrategyRefactor:   24.0,
}

// tierMultiplier scales effort by the workload's operational tier. Higher-tier
// (more critical / larger) systems carry more cutover, validation and
// stakeholder coordination effort.
func tierMultiplier(tier string) float64 {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "0", "tier-0", "tier0", "platinum", "mission-critical", "critical":
		return 2.0
	case "1", "tier-1", "tier1", "gold":
		return 1.6
	case "2", "tier-2", "tier2", "silver":
		return 1.3
	case "3", "tier-3", "tier3", "bronze":
		return 1.1
	default:
		return 1.0
	}
}

// workloadDurationSeconds returns the estimated execution duration of a single
// workload and a tag describing how it was derived. When the operator supplied
// an explicit effort estimate it is authoritative; otherwise the duration is
// derived from the workload's strategy, tier and readiness-remediation gap.
func workloadDurationSeconds(w Workload) (int, string) {
	if w.EstimatedEffortHours > 0 {
		return int(w.EstimatedEffortHours * 3600), "estimated_effort"
	}
	base, ok := strategyEffortHours[w.Strategy]
	if !ok {
		base = strategyEffortHours[StrategyRehost]
	}
	// Readiness remediation: a workload that is only partially ready needs
	// extra preparation. A fully ready workload (score 100) adds nothing; a
	// score of 0 adds a full strategy-base of remediation effort.
	readinessGap := 100 - w.ReadinessScore
	if readinessGap < 0 {
		readinessGap = 0
	}
	if readinessGap > 100 {
		readinessGap = 100
	}
	remediation := base * (float64(readinessGap) / 100.0)
	hours := (base + remediation) * tierMultiplier(w.Tier)
	seconds := int(hours * 3600)
	if seconds < 60 {
		seconds = 60 // a real move always takes at least a minute of cutover work
	}
	return seconds, "derived"
}

// cpNode is a workload node in the wave dependency DAG.
type cpNode struct {
	appKey       string
	moveGroupRef string
	name         string
	duration     int
	source       string
	deps         []string // app keys this node waits on
}

// computeWaveCriticalPath builds the wave's workload dependency DAG and returns
// the longest weighted path through it. It is the single source of truth for
// both CriticalPathForWave and the command-center summary.
func computeWaveCriticalPath(w Wave) CriticalPath {
	nodes := map[string]*cpNode{}
	var order []string // deterministic node visitation order

	// Sort move groups by their in-wave sequence so group-to-group edges are
	// built in the operator-defined order. Fall back to reference ordering when
	// sequences are absent (e.g. legacy data) so the result stays deterministic.
	groups := append([]MoveGroup(nil), w.MoveGroups...)
	slices.SortStableFunc(groups, func(a, b MoveGroup) int {
		if a.WaveSequence != b.WaveSequence {
			return a.WaveSequence - b.WaveSequence
		}
		return strings.Compare(a.Reference, b.Reference)
	})

	var prevGroupKeys []string
	hasEstimate, hasDerived := false, false
	for _, group := range groups {
		var groupKeys []string
		for _, wl := range group.Workloads {
			key := wl.AppKey
			if key == "" {
				continue
			}
			dur, src := workloadDurationSeconds(wl)
			switch src {
			case "estimated_effort":
				hasEstimate = true
			default:
				hasDerived = true
			}
			deps := make([]string, 0, len(wl.Dependencies)+len(prevGroupKeys))
			for _, d := range wl.Dependencies {
				if d.AppKey != "" {
					deps = append(deps, d.AppKey)
				}
			}
			// Move-group sequencing: this group cannot start until every
			// workload in the immediately preceding group has completed.
			deps = append(deps, prevGroupKeys...)
			if existing, ok := nodes[key]; ok {
				// Same app key appearing twice: keep the longer-duration node
				// and merge dependencies so the DAG stays sound.
				if dur > existing.duration {
					existing.duration = dur
					existing.source = src
				}
				existing.deps = append(existing.deps, deps...)
			} else {
				nodes[key] = &cpNode{
					appKey:       key,
					moveGroupRef: group.Reference,
					name:         wl.Name,
					duration:     dur,
					source:       src,
					deps:         deps,
				}
				order = append(order, key)
			}
			groupKeys = append(groupKeys, key)
		}
		if len(groupKeys) > 0 {
			prevGroupKeys = groupKeys
		}
	}

	method := "derived"
	switch {
	case hasEstimate && hasDerived:
		method = "mixed"
	case hasEstimate:
		method = "estimated_effort"
	}

	// Longest path via memoized DFS over real durations. Cycle-safe: a node
	// currently on the recursion stack contributes only its own duration,
	// breaking any accidental dependency cycle without inflating the path.
	type memo struct {
		total int
		next  string // successor on the longest path from this node
	}
	results := map[string]memo{}
	onStack := map[string]bool{}
	var longest func(key string) memo
	longest = func(key string) memo {
		if r, ok := results[key]; ok {
			return r
		}
		node := nodes[key]
		if node == nil {
			return memo{}
		}
		if onStack[key] {
			// This node is already on the current recursion stack: a dependency
			// cycle. Its duration is counted by the ancestor that put it on the
			// stack, so contribute 0 here to break the cycle without inflating
			// the path. (Cyclic dependencies are illegal input; this only keeps
			// the computation finite and sane if one slips through.)
			return memo{total: 0}
		}
		onStack[key] = true
		best := memo{total: node.duration}
		// Deduplicate dependency keys deterministically.
		seen := map[string]struct{}{}
		deps := make([]string, 0, len(node.deps))
		for _, d := range node.deps {
			if _, ok := nodes[d]; !ok {
				continue
			}
			if _, dup := seen[d]; dup {
				continue
			}
			seen[d] = struct{}{}
			deps = append(deps, d)
		}
		slices.Sort(deps)
		for _, dep := range deps {
			sub := longest(dep)
			cand := node.duration + sub.total
			if cand > best.total || (cand == best.total && dep < best.next && best.next != "") {
				best.total = cand
				best.next = dep
			}
		}
		onStack[key] = false
		results[key] = best
		return best
	}

	// The longest path can end at any node; find the global maximum, breaking
	// ties deterministically by app key.
	bestKey := ""
	bestTotal := 0
	keys := append([]string(nil), order...)
	slices.Sort(keys)
	for _, key := range keys {
		r := longest(key)
		if r.total > bestTotal || (r.total == bestTotal && (bestKey == "" || key < bestKey)) {
			bestTotal = r.total
			bestKey = key
		}
	}

	// Walk the longest path backwards (dependencies precede the node) and emit
	// it in execution order with cumulative offsets. Guard against cycles in the
	// successor links so a malformed (cyclic) dependency graph cannot loop here.
	chain := []string{}
	walked := map[string]bool{}
	for k := bestKey; k != "" && !walked[k]; {
		walked[k] = true
		chain = append(chain, k)
		k = results[k].next
	}
	// chain is node -> its critical predecessor; execution order is reversed.
	slices.Reverse(chain)

	cp := CriticalPath{Method: method}
	path := make([]string, 0, len(chain))
	cpNodes := make([]CriticalPathNode, 0, len(chain))
	offset := 0
	seenGroups := map[string]struct{}{}
	for _, key := range chain {
		n := nodes[key]
		if n == nil {
			continue
		}
		if n.moveGroupRef != "" {
			if _, ok := seenGroups[n.moveGroupRef]; !ok {
				path = append(path, n.moveGroupRef)
				seenGroups[n.moveGroupRef] = struct{}{}
			}
		}
		path = append(path, key)
		cpNodes = append(cpNodes, CriticalPathNode{
			MoveGroupRef:    n.moveGroupRef,
			AppKey:          key,
			WorkloadName:    n.name,
			DurationSeconds: n.duration,
			OffsetSeconds:   offset,
			DurationSource:  n.source,
		})
		offset += n.duration
	}

	total := bestTotal
	// The wave's own planned duration is a real, operator-set lower bound on
	// elapsed time (it can include scheduling/coordination gaps the DAG does
	// not model), so honor it when larger. This is wave-specific data, not a
	// constant.
	if w.PlannedDurationSeconds > total {
		total = w.PlannedDurationSeconds
	}
	cp.TotalSeconds = total
	cp.Path = path
	cp.Nodes = cpNodes
	cp.Milestones = criticalPathMilestones(total)
	return cp
}

// criticalPathMilestones derives quartile milestones from the computed total.
func criticalPathMilestones(total int) []Milestone {
	if total <= 0 {
		return []Milestone{}
	}
	return []Milestone{
		{Label: "25%", OffsetSeconds: total / 4, CompletionPercent: 25},
		{Label: "50%", OffsetSeconds: total / 2, CompletionPercent: 50},
		{Label: "75%", OffsetSeconds: (total * 3) / 4, CompletionPercent: 75},
		{Label: "100%", OffsetSeconds: total, CompletionPercent: 100},
	}
}
