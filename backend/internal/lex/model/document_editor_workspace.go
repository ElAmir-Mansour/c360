package model

import (
	"time"

	"github.com/google/uuid"
)

type DocumentEditorClauseAnchor struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	DocumentVersion  int            `json:"document_version"`
	AnchorKey        string         `json:"anchor_key"`
	ClauseID         *uuid.UUID     `json:"clause_id,omitempty"`
	SectionID        string         `json:"section_id"`
	SectionReference string         `json:"section_reference"`
	Title            string         `json:"title"`
	ClauseType       string         `json:"clause_type"`
	StartOffset      *int           `json:"start_offset,omitempty"`
	EndOffset        *int           `json:"end_offset,omitempty"`
	PageNumber       *int           `json:"page_number,omitempty"`
	DocXPath         string         `json:"docx_path"`
	Checksum         string         `json:"checksum"`
	ExtractedText    string         `json:"extracted_text"`
	Confidence       float64        `json:"confidence"`
	Status           string         `json:"status"`
	Metadata         map[string]any `json:"metadata"`
	CreatedBy        uuid.UUID      `json:"created_by"`
	UpdatedBy        *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorGuestReviewLink struct {
	ID             uuid.UUID          `json:"id"`
	TenantID       uuid.UUID          `json:"tenant_id"`
	DocumentID     uuid.UUID          `json:"document_id"`
	SessionID      *uuid.UUID         `json:"session_id,omitempty"`
	TokenHash      string             `json:"-"`
	ReviewerName   string             `json:"reviewer_name"`
	ReviewerEmail  string             `json:"reviewer_email"`
	Organization   string             `json:"organization"`
	AccessMode     DocumentEditorMode `json:"access_mode"`
	Sections       []string           `json:"sections"`
	Status         string             `json:"status"`
	Message        string             `json:"message"`
	ExpiresAt      *time.Time         `json:"expires_at,omitempty"`
	CreatedBy      uuid.UUID          `json:"created_by"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
	RevokedBy      *uuid.UUID         `json:"revoked_by,omitempty"`
	RevokedAt      *time.Time         `json:"revoked_at,omitempty"`
	LastAccessedAt *time.Time         `json:"last_accessed_at,omitempty"`
	Metadata       map[string]any     `json:"metadata"`
}

type DocumentEditorLegalIssueRecord struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	AnchorID         *uuid.UUID     `json:"anchor_id,omitempty"`
	ExternalID       *string        `json:"external_id,omitempty"`
	Title            string         `json:"title"`
	Description      string         `json:"description"`
	Severity         string         `json:"severity"`
	Status           string         `json:"status"`
	Source           string         `json:"source"`
	SectionReference string         `json:"section_reference"`
	OwnerUserID      *uuid.UUID     `json:"owner_user_id,omitempty"`
	OwnerName        string         `json:"owner_name"`
	DueAt            *time.Time     `json:"due_at,omitempty"`
	ResolvedBy       *uuid.UUID     `json:"resolved_by,omitempty"`
	ResolvedAt       *time.Time     `json:"resolved_at,omitempty"`
	ResolutionNotes  string         `json:"resolution_notes"`
	Metadata         map[string]any `json:"metadata"`
	CreatedBy        uuid.UUID      `json:"created_by"`
	UpdatedBy        *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorNegotiationMessage struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	IssueID          *uuid.UUID     `json:"issue_id,omitempty"`
	ParentMessageID  *uuid.UUID     `json:"parent_message_id,omitempty"`
	ActorUserID      *uuid.UUID     `json:"actor_user_id,omitempty"`
	ParticipantName  string         `json:"participant_name"`
	ParticipantEmail string         `json:"participant_email"`
	ParticipantRole  string         `json:"participant_role"`
	MessageType      string         `json:"message_type"`
	Visibility       string         `json:"visibility"`
	Status           string         `json:"status"`
	Body             string         `json:"body"`
	SectionReference string         `json:"section_reference"`
	Metadata         map[string]any `json:"metadata"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorSectionAssignmentRecord struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	SessionID        *uuid.UUID     `json:"session_id,omitempty"`
	AnchorID         *uuid.UUID     `json:"anchor_id,omitempty"`
	SectionID        string         `json:"section_id"`
	Title            string         `json:"title"`
	SectionReference string         `json:"section_reference"`
	AssigneeID       *uuid.UUID     `json:"assignee_id,omitempty"`
	AssigneeName     string         `json:"assignee_name"`
	Role             string         `json:"role"`
	Status           string         `json:"status"`
	DueAt            *time.Time     `json:"due_at,omitempty"`
	CompletedAt      *time.Time     `json:"completed_at,omitempty"`
	Metadata         map[string]any `json:"metadata"`
	CreatedBy        uuid.UUID      `json:"created_by"`
	UpdatedBy        *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorPrivilegedControlRecord struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	DocumentID uuid.UUID      `json:"document_id"`
	ControlKey string         `json:"control_key"`
	Enabled    bool           `json:"enabled"`
	Locked     bool           `json:"locked"`
	Reason     string         `json:"reason"`
	Status     string         `json:"status"`
	Metadata   map[string]any `json:"metadata"`
	UpdatedBy  *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

type DocumentEditorPrivilegedControlRequest struct {
	ID             uuid.UUID      `json:"id"`
	TenantID       uuid.UUID      `json:"tenant_id"`
	DocumentID     uuid.UUID      `json:"document_id"`
	SessionID      *uuid.UUID     `json:"session_id,omitempty"`
	ControlKey     string         `json:"control_key"`
	RequestedState *bool          `json:"requested_state,omitempty"`
	Status         string         `json:"status"`
	Reason         string         `json:"reason"`
	DecisionNotes  string         `json:"decision_notes"`
	RequestedBy    uuid.UUID      `json:"requested_by"`
	DecidedBy      *uuid.UUID     `json:"decided_by,omitempty"`
	RequestedAt    time.Time      `json:"requested_at"`
	DecidedAt      *time.Time     `json:"decided_at,omitempty"`
	AppliedAt      *time.Time     `json:"applied_at,omitempty"`
	Metadata       map[string]any `json:"metadata"`
}

type DocumentEditorApprovalRequest struct {
	ID            uuid.UUID      `json:"id"`
	TenantID      uuid.UUID      `json:"tenant_id"`
	DocumentID    uuid.UUID      `json:"document_id"`
	SessionID     *uuid.UUID     `json:"session_id,omitempty"`
	TargetType    string         `json:"target_type"`
	TargetID      *uuid.UUID     `json:"target_id,omitempty"`
	Status        string         `json:"status"`
	Priority      string         `json:"priority"`
	Reason        string         `json:"reason"`
	RequestedBy   uuid.UUID      `json:"requested_by"`
	AssignedTo    *uuid.UUID     `json:"assigned_to,omitempty"`
	DueAt         *time.Time     `json:"due_at,omitempty"`
	DecidedBy     *uuid.UUID     `json:"decided_by,omitempty"`
	DecidedAt     *time.Time     `json:"decided_at,omitempty"`
	DecisionNotes string         `json:"decision_notes"`
	Metadata      map[string]any `json:"metadata"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type DocumentEditorCitationBinding struct {
	ID               uuid.UUID      `json:"id"`
	TenantID         uuid.UUID      `json:"tenant_id"`
	DocumentID       uuid.UUID      `json:"document_id"`
	AnchorID         *uuid.UUID     `json:"anchor_id,omitempty"`
	SourceType       string         `json:"source_type"`
	SourceDocumentID *uuid.UUID     `json:"source_document_id,omitempty"`
	SourceID         *uuid.UUID     `json:"source_id,omitempty"`
	SourceLabel      string         `json:"source_label"`
	SourceURL        string         `json:"source_url"`
	CitationText     string         `json:"citation_text"`
	PageNumber       *int           `json:"page_number,omitempty"`
	Confidence       float64        `json:"confidence"`
	Status           string         `json:"status"`
	Metadata         map[string]any `json:"metadata"`
	CreatedBy        uuid.UUID      `json:"created_by"`
	UpdatedBy        *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorTask struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	DocumentID   uuid.UUID      `json:"document_id"`
	SourceType   string         `json:"source_type"`
	SourceID     *uuid.UUID     `json:"source_id,omitempty"`
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	Status       string         `json:"status"`
	Priority     string         `json:"priority"`
	AssigneeID   *uuid.UUID     `json:"assignee_id,omitempty"`
	DueAt        *time.Time     `json:"due_at,omitempty"`
	SLADueAt     *time.Time     `json:"sla_due_at,omitempty"`
	EscalationAt *time.Time     `json:"escalation_at,omitempty"`
	CompletedBy  *uuid.UUID     `json:"completed_by,omitempty"`
	CompletedAt  *time.Time     `json:"completed_at,omitempty"`
	Metadata     map[string]any `json:"metadata"`
	CreatedBy    uuid.UUID      `json:"created_by"`
	UpdatedBy    *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
}

type DocumentEditorOfflineRecoverySnapshot struct {
	ID                uuid.UUID      `json:"id"`
	TenantID          uuid.UUID      `json:"tenant_id"`
	DocumentID        uuid.UUID      `json:"document_id"`
	SessionID         *uuid.UUID     `json:"session_id,omitempty"`
	UserID            uuid.UUID      `json:"user_id"`
	Provider          string         `json:"provider"`
	ClientInstanceID  string         `json:"client_instance_id"`
	SnapshotVersion   int            `json:"snapshot_version"`
	PayloadCiphertext string         `json:"-"`
	PayloadMetadata   map[string]any `json:"payload_metadata"`
	Status            string         `json:"status"`
	CapturedAt        time.Time      `json:"captured_at"`
	RecoveredAt       *time.Time     `json:"recovered_at,omitempty"`
	DiscardedAt       *time.Time     `json:"discarded_at,omitempty"`
	ExpiresAt         *time.Time     `json:"expires_at,omitempty"`
	CreatedAt         time.Time      `json:"created_at"`
	UpdatedAt         time.Time      `json:"updated_at"`
}

type DocumentEditorProviderEvent struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	DocumentID      uuid.UUID      `json:"document_id"`
	SessionID       *uuid.UUID     `json:"session_id,omitempty"`
	Provider        string         `json:"provider"`
	ProviderEventID *string        `json:"provider_event_id,omitempty"`
	EventType       string         `json:"event_type"`
	Status          string         `json:"status"`
	Payload         map[string]any `json:"payload"`
	Error           *string        `json:"error,omitempty"`
	ReceivedAt      time.Time      `json:"received_at"`
	ProcessedAt     *time.Time     `json:"processed_at,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
}

type DocumentEditorAnalyticsRollup struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	DocumentID   *uuid.UUID     `json:"document_id,omitempty"`
	Grain        string         `json:"grain"`
	PeriodStart  time.Time      `json:"period_start"`
	PeriodEnd    time.Time      `json:"period_end"`
	MetricKey    string         `json:"metric_key"`
	MetricValue  float64        `json:"metric_value"`
	Dimensions   map[string]any `json:"dimensions"`
	Metadata     map[string]any `json:"metadata"`
	CalculatedAt time.Time      `json:"calculated_at"`
	CreatedAt    time.Time      `json:"created_at"`
}
