package model

import (
	"time"

	"github.com/google/uuid"
)

// PleadingStatus is the FSM lifecycle of a plaintiff statement-of-claim / pleading
// (CAP-052..055). draft → in_approval → approved | rejected. filed records the
// pleading lodged with the court after approval.
type PleadingStatus string

const (
	PleadingStatusDraft      PleadingStatus = "draft"
	PleadingStatusInApproval PleadingStatus = "in_approval"
	PleadingStatusApproved   PleadingStatus = "approved"
	PleadingStatusRejected   PleadingStatus = "rejected"
	PleadingStatusFiled      PleadingStatus = "filed"
)

// Valid reports whether the status is a known pleading FSM state.
func (s PleadingStatus) Valid() bool {
	switch s {
	case PleadingStatusDraft, PleadingStatusInApproval, PleadingStatusApproved,
		PleadingStatusRejected, PleadingStatusFiled:
		return true
	default:
		return false
	}
}

// PleadingType distinguishes the plaintiff statement-of-claim from later pleadings
// (replies, briefs, ضبط memos). statement_of_claim == صحيفة الدعوى (CAP-052/053).
type PleadingType string

const (
	PleadingTypeStatementOfClaim PleadingType = "statement_of_claim"
	PleadingTypeReply            PleadingType = "reply"
	PleadingTypeBrief            PleadingType = "brief"
	PleadingTypeMemorandum       PleadingType = "memorandum"
	PleadingTypeMotion           PleadingType = "motion"
	PleadingTypePetition         PleadingType = "petition"
	PleadingTypeAppeal           PleadingType = "appeal"
	PleadingTypeNotice           PleadingType = "notice"
	PleadingTypeRequest          PleadingType = "request"
	PleadingTypeOther            PleadingType = "other"
)

// Valid reports whether the pleading type is one of the allowed kinds.
func (t PleadingType) Valid() bool {
	switch t {
	case PleadingTypeStatementOfClaim, PleadingTypeReply, PleadingTypeBrief,
		PleadingTypeMemorandum, PleadingTypeMotion, PleadingTypePetition,
		PleadingTypeAppeal, PleadingTypeNotice, PleadingTypeRequest, PleadingTypeOther:
		return true
	default:
		return false
	}
}

type PleadingDirection string

const (
	PleadingDirectionIncoming PleadingDirection = "incoming"
	PleadingDirectionOutgoing PleadingDirection = "outgoing"
	PleadingDirectionInternal PleadingDirection = "internal"
)

func (d PleadingDirection) Valid() bool {
	switch d {
	case PleadingDirectionIncoming, PleadingDirectionOutgoing, PleadingDirectionInternal:
		return true
	default:
		return false
	}
}

// LegalPleading is a plaintiff pleading bound to a litigation case (CAP-052..055).
// case_id FKs legal_cases. body holds the (optionally AI-drafted) statement-of-claim
// text; ai_generated marks bodies produced by the drafting engine (CAP-052). The
// pleading is gated by the shared ApprovalOrchestrator (CAP-055): workflow_instance_id
// links the approval chain run, current_version tracks the latest draft revision.
type LegalPleading struct {
	ID                 uuid.UUID         `json:"id"`
	TenantID           uuid.UUID         `json:"tenant_id"`
	CaseID             uuid.UUID         `json:"case_id"`
	PleadingNumber     string            `json:"pleading_number"`
	Type               PleadingType      `json:"type"`
	Direction          PleadingDirection `json:"direction"`
	Title              string            `json:"title"`
	Body               string            `json:"body"`
	Recipient          *string           `json:"recipient,omitempty"`
	CourtReference     *string           `json:"court_reference,omitempty"`
	ResponseDeadline   *time.Time        `json:"response_deadline,omitempty"`
	ResponseOwnerID    *uuid.UUID        `json:"response_owner_id,omitempty"`
	Status             PleadingStatus    `json:"status"`
	AIGenerated        bool              `json:"ai_generated"`
	CurrentVersion     int               `json:"current_version"`
	WorkflowInstanceID *uuid.UUID        `json:"workflow_instance_id,omitempty"`
	ApprovedBy         *uuid.UUID        `json:"approved_by,omitempty"`
	ApprovedAt         *time.Time        `json:"approved_at,omitempty"`
	FiledAt            *time.Time        `json:"filed_at,omitempty"`
	Metadata           map[string]any    `json:"metadata"`
	CreatedBy          uuid.UUID         `json:"created_by"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
	DeletedAt          *time.Time        `json:"deleted_at,omitempty"`

	// Child aggregates, hydrated on Get.
	Attachments []LegalPleadingAttachment `json:"attachments,omitempty"`
	Versions    []LegalPleadingVersion    `json:"versions,omitempty"`
}

// LegalPleadingAttachment links a Files-service object (entity_type='legal_pleading')
// to a pleading (CAP-053): the uploaded صحيفة الدعوى / supporting documents.
type LegalPleadingAttachment struct {
	ID         uuid.UUID  `json:"id"`
	TenantID   uuid.UUID  `json:"tenant_id"`
	PleadingID uuid.UUID  `json:"pleading_id"`
	FileID     *uuid.UUID `json:"file_id,omitempty"`
	FileName   string     `json:"file_name"`
	Caption    string     `json:"caption"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
}

// LegalPleadingVersion is one immutable draft snapshot of a pleading body (CAP-054).
// Version numbers are monotonic per pleading; each material body edit appends one.
type LegalPleadingVersion struct {
	ID           uuid.UUID  `json:"id"`
	TenantID     uuid.UUID  `json:"tenant_id"`
	PleadingID   uuid.UUID  `json:"pleading_id"`
	Version      int        `json:"version"`
	Title        string     `json:"title"`
	Body         string     `json:"body"`
	AIGenerated  bool       `json:"ai_generated"`
	ChangeReason string     `json:"change_reason"`
	CreatedBy    *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// LegalPleadingListFilters carries the validated query parameters for the pleading
// list endpoint (scoped to a case).
type LegalPleadingListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *PleadingStatus
	Type          *PleadingType
	SortColumn    string
	SortDirection string
}
