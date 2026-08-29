package model

import (
	"time"

	"github.com/google/uuid"
)

type DocumentEditorMode string

const (
	DocumentEditorModeEdit    DocumentEditorMode = "edit"
	DocumentEditorModeComment DocumentEditorMode = "comment"
	DocumentEditorModeView    DocumentEditorMode = "view"
)

func (m DocumentEditorMode) Valid() bool {
	switch m {
	case DocumentEditorModeEdit, DocumentEditorModeComment, DocumentEditorModeView:
		return true
	default:
		return false
	}
}

type DocumentEditorSessionStatus string

const (
	DocumentEditorSessionActive  DocumentEditorSessionStatus = "active"
	DocumentEditorSessionClosed  DocumentEditorSessionStatus = "closed"
	DocumentEditorSessionExpired DocumentEditorSessionStatus = "expired"
)

type DocumentEditorLockStatus string

const (
	DocumentEditorLockActive   DocumentEditorLockStatus = "active"
	DocumentEditorLockReleased DocumentEditorLockStatus = "released"
	DocumentEditorLockExpired  DocumentEditorLockStatus = "expired"
)

type DocumentEditorSession struct {
	ID                  uuid.UUID                   `json:"id"`
	TenantID            uuid.UUID                   `json:"tenant_id"`
	DocumentID          uuid.UUID                   `json:"document_id"`
	Provider            string                      `json:"provider"`
	RequestedMode       DocumentEditorMode          `json:"requested_mode"`
	PermissionMode      DocumentEditorMode          `json:"permission_mode"`
	Status              DocumentEditorSessionStatus `json:"status"`
	ProviderDocumentKey string                      `json:"provider_document_key"`
	DocumentVersion     int                         `json:"document_version"`
	CallbackURL         *string                     `json:"callback_url,omitempty"`
	CallbackTokenHash   *string                     `json:"-"`
	AutosaveMetadata    map[string]any              `json:"autosave_metadata"`
	LastCallback        map[string]any              `json:"last_callback"`
	PreflightResult     map[string]any              `json:"preflight_result"`
	SnapshotMetadata    map[string]any              `json:"snapshot_metadata"`
	CreatedBy           uuid.UUID                   `json:"created_by"`
	CreatedAt           time.Time                   `json:"created_at"`
	UpdatedAt           time.Time                   `json:"updated_at"`
	ExpiresAt           *time.Time                  `json:"expires_at,omitempty"`
	ClosedAt            *time.Time                  `json:"closed_at,omitempty"`
}

type DocumentEditorLock struct {
	ID         uuid.UUID                `json:"id"`
	TenantID   uuid.UUID                `json:"tenant_id"`
	DocumentID uuid.UUID                `json:"document_id"`
	SessionID  *uuid.UUID               `json:"session_id,omitempty"`
	LockType   string                   `json:"lock_type"`
	Status     DocumentEditorLockStatus `json:"status"`
	Reason     string                   `json:"reason"`
	LockedBy   uuid.UUID                `json:"locked_by"`
	LockedAt   time.Time                `json:"locked_at"`
	ExpiresAt  *time.Time               `json:"expires_at,omitempty"`
	ReleasedBy *uuid.UUID               `json:"released_by,omitempty"`
	ReleasedAt *time.Time               `json:"released_at,omitempty"`
	Metadata   map[string]any           `json:"metadata"`
}

type DocumentEditorAuditEntry struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	DocumentID  uuid.UUID      `json:"document_id"`
	SessionID   *uuid.UUID     `json:"session_id,omitempty"`
	LockID      *uuid.UUID     `json:"lock_id,omitempty"`
	Action      string         `json:"action"`
	Provider    *string        `json:"provider,omitempty"`
	ActorUserID *uuid.UUID     `json:"actor_user_id,omitempty"`
	Detail      map[string]any `json:"detail"`
	CreatedAt   time.Time      `json:"created_at"`
}

type DocumentEditorDocument struct {
	ID             uuid.UUID  `json:"id"`
	Title          string     `json:"title"`
	FileID         *uuid.UUID `json:"file_id,omitempty"`
	FileName       *string    `json:"file_name,omitempty"`
	FileType       string     `json:"file_type,omitempty"`
	CurrentVersion int        `json:"current_version"`
}

type DocumentEditorPermissions struct {
	Mode     DocumentEditorMode `json:"mode"`
	Edit     bool               `json:"edit"`
	Comment  bool               `json:"comment"`
	Review   bool               `json:"review"`
	Download bool               `json:"download"`
	Print    bool               `json:"print"`
	Copy     bool               `json:"copy"`
}

type DocumentEditorConfig struct {
	Provider       string                    `json:"provider"`
	DocumentType   string                    `json:"document_type"`
	Document       map[string]any            `json:"document"`
	EditorConfig   map[string]any            `json:"editor_config"`
	Permissions    DocumentEditorPermissions `json:"permissions"`
	ProviderConfig map[string]any            `json:"provider_config,omitempty"`
	Metadata       map[string]any            `json:"metadata,omitempty"`
}

type DocumentEditorOpenResult struct {
	Session  *DocumentEditorSession `json:"session"`
	Document DocumentEditorDocument `json:"document"`
	Lock     *DocumentEditorLock    `json:"lock,omitempty"`
	Config   DocumentEditorConfig   `json:"config"`
}

type DocumentEditorPreflightResult struct {
	Session   *DocumentEditorSession `json:"session,omitempty"`
	Accepted  bool                   `json:"accepted"`
	Preflight map[string]any         `json:"preflight"`
}

type DocumentEditorVersionSnapshot struct {
	ID            uuid.UUID      `json:"id"`
	TenantID      uuid.UUID      `json:"tenant_id"`
	DocumentID    uuid.UUID      `json:"document_id"`
	SessionID     *uuid.UUID     `json:"session_id,omitempty"`
	Version       int            `json:"version"`
	ChangeSummary *string        `json:"change_summary,omitempty"`
	CreatedBy     uuid.UUID      `json:"created_by"`
	CreatedAt     time.Time      `json:"created_at"`
	Metadata      map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorCallbackResult struct {
	Session                  *DocumentEditorSession `json:"session,omitempty"`
	VersionSnapshotRequested bool                   `json:"version_snapshot_requested"`
}

type DocumentEditorWorkspaceItem struct {
	Key              string         `json:"key,omitempty"`
	Title            string         `json:"title"`
	Status           string         `json:"status,omitempty"`
	Severity         string         `json:"severity,omitempty"`
	SectionReference string         `json:"section_reference,omitempty"`
	Owner            string         `json:"owner,omitempty"`
	Source           string         `json:"source,omitempty"`
	DueAt            *time.Time     `json:"due_at,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorParticipant struct {
	UserID       *uuid.UUID     `json:"user_id,omitempty"`
	Name         string         `json:"name,omitempty"`
	Email        string         `json:"email,omitempty"`
	Role         string         `json:"role,omitempty"`
	Organization string         `json:"organization,omitempty"`
	Status       string         `json:"status,omitempty"`
	External     bool           `json:"external"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorTimelineEvent struct {
	Action      string         `json:"action"`
	ActorUserID *uuid.UUID     `json:"actor_user_id,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	Detail      map[string]any `json:"detail,omitempty"`
}

type DocumentEditorNegotiationRoomSummary struct {
	Document       DocumentEditorDocument        `json:"document"`
	Status         string                        `json:"status"`
	Phase          string                        `json:"phase,omitempty"`
	Summary        string                        `json:"summary,omitempty"`
	NextStep       string                        `json:"next_step,omitempty"`
	Participants   []DocumentEditorParticipant   `json:"participants"`
	PendingItems   []DocumentEditorWorkspaceItem `json:"pending_items"`
	ActiveLock     *DocumentEditorLock           `json:"active_lock,omitempty"`
	ActiveSessions int                           `json:"active_sessions"`
	RecentActivity []DocumentEditorTimelineEvent `json:"recent_activity"`
	Metadata       map[string]any                `json:"metadata,omitempty"`
	GeneratedAt    time.Time                     `json:"generated_at"`
}

type DocumentEditorPlaybookEnforcementSummary struct {
	Document            DocumentEditorDocument        `json:"document"`
	ContractID          *uuid.UUID                    `json:"contract_id,omitempty"`
	Status              string                        `json:"status"`
	PlaybookID          string                        `json:"playbook_id,omitempty"`
	PlaybookName        string                        `json:"playbook_name,omitempty"`
	ClauseCount         int                           `json:"clause_count"`
	HighRiskClauseCount int                           `json:"high_risk_clause_count"`
	RequiredClauses     []DocumentEditorWorkspaceItem `json:"required_clauses"`
	MatchedClauses      []DocumentEditorWorkspaceItem `json:"matched_clauses"`
	MissingClauses      []DocumentEditorWorkspaceItem `json:"missing_clauses"`
	Deviations          []DocumentEditorWorkspaceItem `json:"deviations"`
	Metadata            map[string]any                `json:"metadata,omitempty"`
	GeneratedAt         time.Time                     `json:"generated_at"`
}

type DocumentEditorDefinedTerm struct {
	Term             string         `json:"term"`
	Definition       string         `json:"definition,omitempty"`
	SectionReference string         `json:"section_reference,omitempty"`
	Occurrences      int            `json:"occurrences"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorCrossReference struct {
	Reference        string         `json:"reference"`
	Target           string         `json:"target,omitempty"`
	Status           string         `json:"status,omitempty"`
	SectionReference string         `json:"section_reference,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorNavigatorSummary struct {
	Document             DocumentEditorDocument         `json:"document"`
	DefinedTerms         []DocumentEditorDefinedTerm    `json:"defined_terms"`
	CrossReferences      []DocumentEditorCrossReference `json:"cross_references"`
	BrokenReferenceCount int                            `json:"broken_reference_count"`
	Metadata             map[string]any                 `json:"metadata,omitempty"`
	GeneratedAt          time.Time                      `json:"generated_at"`
}

type DocumentEditorSectionAssignment struct {
	ID               string         `json:"id,omitempty"`
	SectionID        string         `json:"section_id,omitempty"`
	Title            string         `json:"title"`
	SectionReference string         `json:"section_reference,omitempty"`
	AssigneeID       *uuid.UUID     `json:"assignee_id,omitempty"`
	AssigneeName     string         `json:"assignee_name,omitempty"`
	Role             string         `json:"role,omitempty"`
	Status           string         `json:"status"`
	DueAt            *time.Time     `json:"due_at,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorSectionAssignmentsSummary struct {
	Document       DocumentEditorDocument            `json:"document"`
	Assignments    []DocumentEditorSectionAssignment `json:"assignments"`
	OpenCount      int                               `json:"open_count"`
	CompletedCount int                               `json:"completed_count"`
	OverdueCount   int                               `json:"overdue_count"`
	Metadata       map[string]any                    `json:"metadata,omitempty"`
	GeneratedAt    time.Time                         `json:"generated_at"`
}

type DocumentEditorGuestReviewLinkRequestResult struct {
	RequestID   uuid.UUID                 `json:"request_id"`
	DocumentID  uuid.UUID                 `json:"document_id"`
	SessionID   *uuid.UUID                `json:"session_id,omitempty"`
	Reviewer    DocumentEditorParticipant `json:"reviewer"`
	AccessMode  DocumentEditorMode        `json:"access_mode"`
	Sections    []string                  `json:"sections,omitempty"`
	ExpiresAt   *time.Time                `json:"expires_at,omitempty"`
	Status      string                    `json:"status"`
	AuditAction string                    `json:"audit_action"`
	Metadata    map[string]any            `json:"metadata,omitempty"`
	CreatedAt   time.Time                 `json:"created_at"`
}

type DocumentEditorLegalIssue struct {
	ID               string         `json:"id,omitempty"`
	Title            string         `json:"title"`
	Description      string         `json:"description,omitempty"`
	Severity         string         `json:"severity"`
	Status           string         `json:"status"`
	SectionReference string         `json:"section_reference,omitempty"`
	Owner            string         `json:"owner,omitempty"`
	Source           string         `json:"source,omitempty"`
	ClauseID         *uuid.UUID     `json:"clause_id,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorLegalIssuesSummary struct {
	Document          DocumentEditorDocument     `json:"document"`
	Issues            []DocumentEditorLegalIssue `json:"issues"`
	OpenCount         int                        `json:"open_count"`
	HighSeverityCount int                        `json:"high_severity_count"`
	Metadata          map[string]any             `json:"metadata,omitempty"`
	GeneratedAt       time.Time                  `json:"generated_at"`
}

type DocumentEditorSignatureSigner struct {
	UserID   *uuid.UUID `json:"user_id,omitempty"`
	Name     string     `json:"name,omitempty"`
	Email    string     `json:"email,omitempty"`
	Role     string     `json:"role,omitempty"`
	Status   string     `json:"status,omitempty"`
	SignedAt *time.Time `json:"signed_at,omitempty"`
}

type DocumentEditorSignatureReadinessSummary struct {
	Document       DocumentEditorDocument          `json:"document"`
	Ready          bool                            `json:"ready"`
	Status         string                          `json:"status"`
	EnvelopeID     *uuid.UUID                      `json:"envelope_id,omitempty"`
	EnvelopeStatus string                          `json:"envelope_status,omitempty"`
	Provider       string                          `json:"provider,omitempty"`
	Method         string                          `json:"method,omitempty"`
	SignerCount    int                             `json:"signer_count"`
	SignedCount    int                             `json:"signed_count"`
	Signers        []DocumentEditorSignatureSigner `json:"signers"`
	Blockers       []DocumentEditorWorkspaceItem   `json:"blockers"`
	Metadata       map[string]any                  `json:"metadata,omitempty"`
	GeneratedAt    time.Time                       `json:"generated_at"`
}

type DocumentEditorClauseAIActionRequestResult struct {
	RequestID        uuid.UUID      `json:"request_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	Action           string         `json:"action"`
	ClauseID         *uuid.UUID     `json:"clause_id,omitempty"`
	ClauseType       string         `json:"clause_type,omitempty"`
	SectionReference string         `json:"section_reference,omitempty"`
	Status           string         `json:"status"`
	AuditAction      string         `json:"audit_action"`
	Metadata         map[string]any `json:"metadata,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
}

type DocumentEditorHealthCheck struct {
	Key         string         `json:"key"`
	Status      string         `json:"status"`
	Severity    string         `json:"severity,omitempty"`
	Message     string         `json:"message,omitempty"`
	ScoreImpact float64        `json:"score_impact,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type DocumentEditorHealthScore struct {
	Document    DocumentEditorDocument        `json:"document"`
	Score       float64                       `json:"score"`
	Status      string                        `json:"status"`
	Checks      []DocumentEditorHealthCheck   `json:"checks"`
	Signals     []DocumentEditorWorkspaceItem `json:"signals"`
	Metadata    map[string]any                `json:"metadata,omitempty"`
	GeneratedAt time.Time                     `json:"generated_at"`
}

type DocumentEditorPrivilegedControl struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Enabled bool   `json:"enabled"`
	Locked  bool   `json:"locked"`
	Reason  string `json:"reason,omitempty"`
}

type DocumentEditorPrivilegedControlsSummary struct {
	Document               DocumentEditorDocument            `json:"document"`
	Confidentiality        DocumentConfidentiality           `json:"confidentiality"`
	Privileged             bool                              `json:"privileged"`
	ExternalSharingAllowed bool                              `json:"external_sharing_allowed"`
	DownloadAllowed        bool                              `json:"download_allowed"`
	PrintAllowed           bool                              `json:"print_allowed"`
	CopyAllowed            bool                              `json:"copy_allowed"`
	WatermarkRequired      bool                              `json:"watermark_required"`
	ApprovalRequired       bool                              `json:"approval_required"`
	Controls               []DocumentEditorPrivilegedControl `json:"controls"`
	Holds                  []DocumentEditorWorkspaceItem     `json:"holds"`
	Metadata               map[string]any                    `json:"metadata,omitempty"`
	GeneratedAt            time.Time                         `json:"generated_at"`
}

type DocumentEditorPrivilegedControlRequestResult struct {
	RequestID      uuid.UUID      `json:"request_id"`
	DocumentID     uuid.UUID      `json:"document_id"`
	SessionID      *uuid.UUID     `json:"session_id,omitempty"`
	Control        string         `json:"control"`
	RequestedState *bool          `json:"requested_state,omitempty"`
	Reason         string         `json:"reason"`
	Status         string         `json:"status"`
	AuditAction    string         `json:"audit_action"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}
