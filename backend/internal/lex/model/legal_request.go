package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// RequestPriority is the two-tier urgency classification for a legal request.
// CAP-010 mandates that the "urgent" tier carries a documented, structured
// justification; CAP-011 audits every reclassification between the two tiers.
type RequestPriority string

const (
	// RequestPriorityEmergency is the fastest response tier (Al Othaim PRD —
	// "Emergency, within 24 hours"). Unlike the user-elevated Urgent tier it does
	// NOT require a structured justification (CAP-010 gates urgent only); it is a
	// distinct published SLA tier.
	RequestPriorityEmergency RequestPriority = "emergency"
	RequestPriorityUrgent    RequestPriority = "urgent"
	RequestPriorityNormal    RequestPriority = "normal"
)

// Valid reports whether the priority is one of the allowed tiers.
func (p RequestPriority) Valid() bool {
	switch p {
	case RequestPriorityEmergency, RequestPriorityUrgent, RequestPriorityNormal:
		return true
	default:
		return false
	}
}

// RequestStatus is the finite-state lifecycle of a legal request. The spine
// ships the full FSM so downstream services (case, consultation, contract,
// litigation, ...) can drive a request through intake → approval → routing →
// execution → delivery → closure, with explicit returned/cancelled terminals.
type RequestStatus string

const (
	RequestStatusDraft                    RequestStatus = "draft"
	RequestStatusSubmitted                RequestStatus = "submitted"
	RequestStatusPendingRequesterApproval RequestStatus = "pending_requester_approval"
	RequestStatusPendingProviderApproval  RequestStatus = "pending_provider_approval"
	RequestStatusApproved                 RequestStatus = "approved"
	RequestStatusRouted                   RequestStatus = "routed"
	RequestStatusInExecution              RequestStatus = "in_execution"
	RequestStatusDelivered                RequestStatus = "delivered"
	RequestStatusClosed                   RequestStatus = "closed"
	RequestStatusReturned                 RequestStatus = "returned"
	RequestStatusCancelled                RequestStatus = "cancelled"
)

// Valid reports whether the status is a known FSM state.
func (s RequestStatus) Valid() bool {
	switch s {
	case RequestStatusDraft, RequestStatusSubmitted, RequestStatusPendingRequesterApproval,
		RequestStatusPendingProviderApproval, RequestStatusApproved, RequestStatusRouted,
		RequestStatusInExecution, RequestStatusDelivered, RequestStatusClosed,
		RequestStatusReturned, RequestStatusCancelled:
		return true
	default:
		return false
	}
}

// LegalRequest is the canonical request row (CAP-009). Every legal-affairs
// service and downstream domain (case, consultation, contract, litigation,
// fatwa, ...) references it via request_id; the back-link subject_type/subject_id
// records which domain row, if any, was spawned from this request.
//
// service_id and beneficiary_entity_id are decoupled uuid references (NOT Go
// package imports) so the spine ships before the service-catalog and org-entity
// modules; both are nullable for the same reason.
type LegalRequest struct {
	ID                  uuid.UUID           `json:"id"`
	TenantID            uuid.UUID           `json:"tenant_id"`
	RequestNumber       string              `json:"request_number"`
	RequestType         string              `json:"request_type"`
	ServiceID           *uuid.UUID          `json:"service_id,omitempty"`
	Title               forms.LocalizedText `json:"title"`
	Description         string              `json:"description"`
	RequesterUserID     uuid.UUID           `json:"requester_user_id"`
	RequesterName       string              `json:"requester_name"`
	BeneficiaryEntityID *uuid.UUID          `json:"beneficiary_entity_id,omitempty"`
	Department          *string             `json:"department,omitempty"`
	Priority            RequestPriority     `json:"priority"`
	Status              RequestStatus       `json:"status"`
	// Cycle is the 1-based review round. It starts at 1 and increments on every
	// returned→submitted resubmission, making it the authoritative round counter
	// for the whole request: notes and attachments are stamped from it, and the SLA
	// clock materialised for a round carries the same number.
	//
	// It lives here rather than being derived from legal_sla_clocks because notes
	// and attachments exist while the request is still a draft, before completeness
	// confirmation materialises any clock.
	Cycle                 int            `json:"cycle"`
	UrgencyJustification  *string        `json:"urgency_justification,omitempty"`
	RequesterApprovalReqd bool           `json:"requester_approval_required"`
	ProviderApprovalReqd  bool           `json:"provider_approval_required"`
	SubjectType           *string        `json:"subject_type,omitempty"`
	SubjectID             *uuid.UUID     `json:"subject_id,omitempty"`
	WorkflowInstanceID    *uuid.UUID     `json:"workflow_instance_id,omitempty"`
	Metadata              map[string]any `json:"metadata"`
	CreatedBy             uuid.UUID      `json:"created_by"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
	DeletedAt             *time.Time     `json:"deleted_at,omitempty"`
}

// LegalRequestListFilters carries the (already-validated) query parameters for
// the request list/search endpoint.
type LegalRequestListFilters struct {
	Page                int
	PerPage             int
	Search              string
	Status              *RequestStatus
	Statuses            []RequestStatus
	Priority            *RequestPriority
	RequestType         string
	RequesterUserID     *uuid.UUID
	BeneficiaryEntityID *uuid.UUID
	ServiceID           *uuid.UUID
	Department          string
	SubjectType         string
	SortColumn          string
	SortDirection       string
	UpdatedFrom         *time.Time
	UpdatedTo           *time.Time
	// VisibilityActorID is an internal-only own-records scope. It restricts a
	// base requester's results to rows they created or where they are the named
	// requester, independently of any public requester_user_id filter.
	VisibilityActorID *uuid.UUID
	// ApprovalActor* is an internal-only queue scope used by "Awaiting me".
	// When set, the repository returns requests with at least one current open
	// workflow task this actor can decide under assignment/claim/role + SoD.
	ApprovalActorID         *uuid.UUID
	ApprovalActorRoles      []string
	ApprovalActorRoleBypass bool
}
