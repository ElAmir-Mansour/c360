package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// ConsultationType is the subject-matter classification of a legal consultation
// (CAP-127). It is a free-ish controlled vocabulary: the service validates
// against the allowed set below, but the column stores a plain text value so a
// tenant taxonomy can grow without a migration.
type ConsultationType string

const (
	ConsultationTypeGeneral     ConsultationType = "general"
	ConsultationTypeContractual ConsultationType = "contractual"
	ConsultationTypeLabor       ConsultationType = "labor"
	ConsultationTypeRegulatory  ConsultationType = "regulatory"
	ConsultationTypeCorporate   ConsultationType = "corporate"
	ConsultationTypeLitigation  ConsultationType = "litigation"
	ConsultationTypeIP          ConsultationType = "intellectual_property"
	ConsultationTypeTax         ConsultationType = "tax"
	ConsultationTypeOther       ConsultationType = "other"
)

// Valid reports whether the type is a known classification value.
func (t ConsultationType) Valid() bool {
	switch t {
	case ConsultationTypeGeneral, ConsultationTypeContractual, ConsultationTypeLabor,
		ConsultationTypeRegulatory, ConsultationTypeCorporate, ConsultationTypeLitigation,
		ConsultationTypeIP, ConsultationTypeTax, ConsultationTypeOther:
		return true
	default:
		return false
	}
}

// ConsultationStatus is the finite-state lifecycle of a legal consultation
// (CAP-126..132):
//
//	submitted → classified → routed → responded → approved → archived
//
// with no other legal moves. The service enforces the edge set in
// consultationStatusTransitions.
type ConsultationStatus string

const (
	ConsultationStatusSubmitted  ConsultationStatus = "submitted"
	ConsultationStatusClassified ConsultationStatus = "classified"
	ConsultationStatusRouted     ConsultationStatus = "routed"
	ConsultationStatusResponded  ConsultationStatus = "responded"
	ConsultationStatusApproved   ConsultationStatus = "approved"
	ConsultationStatusArchived   ConsultationStatus = "archived"
)

// Valid reports whether the status is a known FSM state.
func (s ConsultationStatus) Valid() bool {
	switch s {
	case ConsultationStatusSubmitted, ConsultationStatusClassified, ConsultationStatusRouted,
		ConsultationStatusResponded, ConsultationStatusApproved, ConsultationStatusArchived:
		return true
	default:
		return false
	}
}

// Consultation is a legal advisory request/answer record (CAP-126..132). It may
// be spawned from a legal request (legal_request_id back-links the spine) or
// stand alone (standalone fallback: legal_request_id is NULL). The question and
// response carry the (optionally encrypted-at-rest) advisory text; the advisor
// is the routed legal counsel and approved_* records the CAP-131 sign-off.
type Consultation struct {
	ID                 uuid.UUID              `json:"id"`
	TenantID           uuid.UUID              `json:"tenant_id"`
	ConsultationNumber string                 `json:"consultation_number"`
	Type               ConsultationType       `json:"type"`
	Title              forms.LocalizedText    `json:"title"`
	Status             ConsultationStatus     `json:"status"`
	Priority           LegalPriority          `json:"priority"`
	LegalRequestID     *uuid.UUID             `json:"legal_request_id,omitempty"`
	RequesterUserID    uuid.UUID              `json:"requester_user_id"`
	RequesterName      string                 `json:"requester_name"`
	Department         *string                `json:"department,omitempty"`
	AdvisorID          *uuid.UUID             `json:"advisor_id,omitempty"`
	AdvisorName        *string                `json:"advisor_name,omitempty"`
	Question           string                 `json:"question"`
	Response           *string                `json:"response,omitempty"`
	WorkflowInstanceID *uuid.UUID             `json:"workflow_instance_id,omitempty"`
	RespondedBy        *uuid.UUID             `json:"responded_by,omitempty"`
	RespondedAt        *time.Time             `json:"responded_at,omitempty"`
	ApprovedBy         *uuid.UUID             `json:"approved_by,omitempty"`
	ApprovedAt         *time.Time             `json:"approved_at,omitempty"`
	ArchivedAt         *time.Time             `json:"archived_at,omitempty"`
	Tags               []string               `json:"tags"`
	Metadata           map[string]any         `json:"metadata"`
	CreatedBy          uuid.UUID              `json:"created_by"`
	CreatedAt          time.Time              `json:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at"`
	DeletedAt          *time.Time             `json:"deleted_at,omitempty"`
	Documents          []ConsultationDocument `json:"documents,omitempty"`

	// Self-contained ack + response SLA clock (migration 000041). All fields are
	// projected by the consultation List/Get queries so the frontend can render
	// SLA badges/countdowns. A consultation whose clock never materialised reports
	// nil deadlines, SLAOutcome="pending", and SLABreached=false.
	SLAStartedAt                 *time.Time      `json:"sla_started_at,omitempty"`
	SLAAckDueAt                  *time.Time      `json:"sla_ack_due_at,omitempty"`
	SLAResponseDueAt             *time.Time      `json:"sla_response_due_at,omitempty"`
	SLAAckDone                   bool            `json:"sla_ack_done"`
	SLAAckDoneAt                 *time.Time      `json:"sla_ack_done_at,omitempty"`
	SLAEscalationLevel           int             `json:"sla_escalation_level"`
	SLABreached                  bool            `json:"sla_breached"`
	SLABreachedAt                *time.Time      `json:"sla_breached_at,omitempty"`
	SLAOutcome                   SLAClockOutcome `json:"sla_outcome"`
	SLAResolvedAt                *time.Time      `json:"sla_resolved_at,omitempty"`
	SLATargetMinutes             *int            `json:"sla_target_minutes,omitempty"`
	LateJustification            *string         `json:"late_justification,omitempty"`
	LateJustificationSubmittedBy *uuid.UUID      `json:"late_justification_submitted_by,omitempty"`
	LateJustificationSubmittedAt *time.Time      `json:"late_justification_submitted_at,omitempty"`
	LateJustificationManagerRole *string         `json:"late_justification_manager_role,omitempty"`

	// LegalHold is true when this consultation is under an active legal hold
	// (preservation). It is populated only by Get (the detail view), not List, so
	// the frontend can show a banner and pre-disable hold-guarded actions
	// (archive, document detach, delete). Zero value (false) when not populated.
	LegalHold       bool       `json:"legal_hold,omitempty"`
	LegalHoldID     *uuid.UUID `json:"legal_hold_id,omitempty"`
	LegalHoldReason *string    `json:"legal_hold_reason,omitempty"`
}

// ConsultationDocument links a Files-service object (entity_type='consultation',
// entity_id=consultation_id, suite='lex') to a consultation (CAP-128). The row
// is the lex-side index; the bytes live in the File service.
type ConsultationDocument struct {
	ID             uuid.UUID      `json:"id"`
	TenantID       uuid.UUID      `json:"tenant_id"`
	ConsultationID uuid.UUID      `json:"consultation_id"`
	FileID         uuid.UUID      `json:"file_id"`
	FileName       string         `json:"file_name"`
	FileSize       int64          `json:"file_size"`
	ContentType    *string        `json:"content_type,omitempty"`
	Kind           string         `json:"kind"`
	Metadata       map[string]any `json:"metadata"`
	CreatedBy      uuid.UUID      `json:"created_by"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ConsultationAuditEntry is an immutable (append-only) governance audit row for a
// consultation (CAP-126..132): every lifecycle mutation appends one in the same
// transaction as the mutation.
type ConsultationAuditEntry struct {
	ID             uuid.UUID      `json:"id"`
	TenantID       uuid.UUID      `json:"tenant_id"`
	ConsultationID uuid.UUID      `json:"consultation_id"`
	Action         string         `json:"action"`
	FromStatus     *string        `json:"from_status,omitempty"`
	ToStatus       *string        `json:"to_status,omitempty"`
	Detail         map[string]any `json:"detail"`
	ActorUserID    uuid.UUID      `json:"actor_user_id"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ConsultationListFilters carries the validated query parameters for the list
// endpoint. All filters are tenant-scoped by the service; zero values mean "no
// filter".
type ConsultationListFilters struct {
	Page            int
	PerPage         int
	Search          string
	Status          *ConsultationStatus
	Statuses        []ConsultationStatus
	Type            *ConsultationType
	Priority        *LegalPriority
	RequesterUserID *uuid.UUID
	AdvisorID       *uuid.UUID
	LegalRequestID  *uuid.UUID
	Department      string
	Tag             string
	SortColumn      string
	SortDirection   string

	// SLARisk filters by SLA state (additive, validated against the allowlist):
	//   "breached"  → sla_breached = TRUE OR sla_outcome = 'breached'
	//   "due_soon"  → on-clock, unresolved, not breached, response deadline within
	//                 the next 24 clock hours (and not already past)
	//   "on_track"  → on-clock, unresolved, not breached, and NOT due_soon
	// An empty value means "no SLA filter".
	SLARisk string
	// CreatedFrom/CreatedTo filter on created_at (RFC3339, inclusive bounds).
	CreatedFrom *time.Time
	CreatedTo   *time.Time
	// RespondedFrom/RespondedTo filter on responded_at (RFC3339, inclusive bounds).
	RespondedFrom *time.Time
	RespondedTo   *time.Time
}

// ConsultationSLARisk is the validated allowlist of SLA-risk filter values.
type ConsultationSLARisk string

const (
	ConsultationSLARiskBreached ConsultationSLARisk = "breached"
	ConsultationSLARiskDueSoon  ConsultationSLARisk = "due_soon"
	ConsultationSLARiskOnTrack  ConsultationSLARisk = "on_track"
)

// ValidConsultationSLARisk reports whether v is a known SLA-risk filter value.
func ValidConsultationSLARisk(v string) bool {
	switch ConsultationSLARisk(v) {
	case ConsultationSLARiskBreached, ConsultationSLARiskDueSoon, ConsultationSLARiskOnTrack:
		return true
	default:
		return false
	}
}

// ConsultationStats is the aggregate KPI rollup over the FULL filtered dataset
// (not a single page) returned by GET /consultations/stats.
type ConsultationStats struct {
	Total     int `json:"total"`
	Open      int `json:"open"`      // status in (submitted, classified, routed)
	Responded int `json:"responded"` // status = responded
	Approved  int `json:"approved"`  // status in (approved, archived)
	Breached  int `json:"breached"`  // sla_breached OR sla_outcome = 'breached'
	DueSoon   int `json:"due_soon"`  // on-clock, unresolved, due within 24h, not breached
	// AvgRespondMinutes is the average working-minutes time-to-respond over the
	// consultation_answer duration facts in the same window; ResponseSample is the
	// number of facts averaged (0 means no data / fact store unavailable).
	AvgRespondMinutes float64 `json:"avg_respond_minutes"`
	ResponseSample    int     `json:"response_sample"`
}

// ConsultationAdvisorWorkload is one advisor's open-consultation load.
type ConsultationAdvisorWorkload struct {
	AdvisorID   uuid.UUID `json:"advisor_id"`
	AdvisorName string    `json:"advisor_name"`
	OpenCount   int       `json:"open_count"`
}
