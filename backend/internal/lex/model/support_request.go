package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

type SupportRequestPriority string

const (
	SupportPriorityLow    SupportRequestPriority = "low"
	SupportPriorityNormal SupportRequestPriority = "normal"
	SupportPriorityHigh   SupportRequestPriority = "high"
)

func (p SupportRequestPriority) Valid() bool {
	return p == SupportPriorityLow || p == SupportPriorityNormal || p == SupportPriorityHigh
}

type SupportRequestSubjectType string

const (
	SupportSubjectCase          SupportRequestSubjectType = "case"
	SupportSubjectContract      SupportRequestSubjectType = "contract"
	SupportSubjectConsultation  SupportRequestSubjectType = "consultation"
	SupportSubjectMatter        SupportRequestSubjectType = "matter"
	SupportSubjectInvestigation SupportRequestSubjectType = "investigation"
	SupportSubjectRequest       SupportRequestSubjectType = "request"
)

func (t SupportRequestSubjectType) Valid() bool {
	switch t {
	case SupportSubjectCase, SupportSubjectContract, SupportSubjectConsultation,
		SupportSubjectMatter, SupportSubjectInvestigation, SupportSubjectRequest:
		return true
	default:
		return false
	}
}

type SupportRequestStatus string

const (
	// SupportStatusPendingManagerApproval is the gate in front of `open`. The
	// request exists but has not been routed to the colleague yet, so the
	// assignee must not see it and it carries no expiry clock.
	SupportStatusPendingManagerApproval SupportRequestStatus = "pending_manager_approval"
	SupportStatusOpen                   SupportRequestStatus = "open"
	SupportStatusAccepted               SupportRequestStatus = "accepted"
	SupportStatusResolved               SupportRequestStatus = "resolved"
	SupportStatusDeclined               SupportRequestStatus = "declined"
	SupportStatusExpired                SupportRequestStatus = "expired"
	SupportStatusCancelled              SupportRequestStatus = "cancelled"
	// SupportStatusRejected is terminal: the approver refused to route the
	// request. It is distinct from `declined`, which is the colleague refusing
	// work that was already routed to them.
	SupportStatusRejected SupportRequestStatus = "rejected"
)

func (s SupportRequestStatus) Valid() bool {
	switch s {
	case SupportStatusPendingManagerApproval, SupportStatusOpen, SupportStatusAccepted,
		SupportStatusResolved, SupportStatusDeclined, SupportStatusExpired,
		SupportStatusCancelled, SupportStatusRejected:
		return true
	default:
		return false
	}
}

func (s SupportRequestStatus) Terminal() bool {
	return s == SupportStatusResolved || s == SupportStatusDeclined ||
		s == SupportStatusExpired || s == SupportStatusCancelled ||
		s == SupportStatusRejected
}

// SupportApprovalRoute records how the approver for a request was arrived at.
// A request that skipped human approval must say so on its face, so the route
// is always written -- there is no "unknown" value.
type SupportApprovalRoute string

const (
	// SupportRouteManager: legal_org_memberships.manager_user_id for the requester.
	SupportRouteManager SupportApprovalRoute = "manager"
	// SupportRouteUnitHead: nearest department_manager / legal_director walking
	// up the legal_org_entities tree from the requester's own unit.
	SupportRouteUnitHead SupportApprovalRoute = "unit_head"
	// SupportRouteAutoNoManager: nobody above the requester in the org data.
	// Auto-approved rather than stranded in a silent dead end.
	SupportRouteAutoNoManager SupportApprovalRoute = "auto_no_manager"
	// SupportRouteAutoSelf: the resolved approver is the requester. Auto-approved
	// rather than inviting a four-eyes breach or stranding them.
	SupportRouteAutoSelf SupportApprovalRoute = "auto_self"
)

func (r SupportApprovalRoute) Valid() bool {
	switch r {
	case SupportRouteManager, SupportRouteUnitHead, SupportRouteAutoNoManager, SupportRouteAutoSelf:
		return true
	default:
		return false
	}
}

// Automatic reports whether the gate was cleared without a human decision.
func (r SupportApprovalRoute) Automatic() bool {
	return r == SupportRouteAutoNoManager || r == SupportRouteAutoSelf
}

type SupportUserSummary struct {
	ID        uuid.UUID `json:"id"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	AvatarURL string    `json:"avatar_url,omitempty"`
}

type SupportEntitySummary struct {
	ID         uuid.UUID           `json:"id"`
	Code       string              `json:"code"`
	Name       forms.LocalizedText `json:"name"`
	EntityType OrgEntityType       `json:"entity_type"`
}

type SupportDirectoryMember struct {
	UserID        uuid.UUID           `json:"user_id"`
	FirstName     string              `json:"first_name"`
	LastName      string              `json:"last_name"`
	AvatarURL     string              `json:"avatar_url,omitempty"`
	EmployeeCode  string              `json:"employee_code"`
	Title         forms.LocalizedText `json:"title"`
	ManagerUserID *uuid.UUID          `json:"manager_user_id"`
}

type SupportRequest struct {
	ID                uuid.UUID                  `json:"id"`
	TenantID          uuid.UUID                  `json:"tenant_id"`
	RequesterID       uuid.UUID                  `json:"requester_id"`
	RequesterEntityID *uuid.UUID                 `json:"requester_entity_id"`
	TargetEntityID    uuid.UUID                  `json:"target_entity_id"`
	AssigneeID        uuid.UUID                  `json:"assignee_id"`
	Subject           string                     `json:"subject"`
	Body              string                     `json:"body"`
	Priority          SupportRequestPriority     `json:"priority"`
	SubjectType       *SupportRequestSubjectType `json:"subject_type"`
	SubjectID         *uuid.UUID                 `json:"subject_id"`
	Status            SupportRequestStatus       `json:"status"`
	ResolutionNote    string                     `json:"resolution_note"`
	// ApproverUserID is resolved and frozen at creation. It is nil only for the
	// auto_no_manager route, where nobody above the requester exists.
	ApproverUserID    *uuid.UUID           `json:"approver_user_id"`
	ApprovalDecidedAt *time.Time           `json:"approval_decided_at"`
	ApprovalNote      string               `json:"approval_note"`
	ApprovalRoute     SupportApprovalRoute `json:"approval_route"`
	// BusinessDays is the validity window the requester asked for. It is stored
	// unmaterialised so ExpiresAt can be computed at approval time from the
	// tenant working calendar instead of being eaten by a slow approver.
	BusinessDays    *int                  `json:"business_days"`
	ExpiresAt       *time.Time            `json:"expires_at"`
	AcceptedAt      *time.Time            `json:"accepted_at"`
	ClosedAt        *time.Time            `json:"closed_at"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
	DeletedAt       *time.Time            `json:"deleted_at,omitempty"`
	Requester       *SupportUserSummary   `json:"requester,omitempty"`
	Assignee        *SupportUserSummary   `json:"assignee,omitempty"`
	Approver        *SupportUserSummary   `json:"approver,omitempty"`
	RequesterEntity *SupportEntitySummary `json:"requester_entity,omitempty"`
	TargetEntity    *SupportEntitySummary `json:"target_entity,omitempty"`
}

type SupportRequestBox string

const (
	SupportBoxInbox SupportRequestBox = "inbox"
	SupportBoxSent  SupportRequestBox = "sent"
	SupportBoxAll   SupportRequestBox = "all"
	// SupportBoxApprovals is the approver's "pending my approval" scope. It is a
	// party scope like the others, not a status filter: combine with
	// status=pending_manager_approval for the inbox group.
	SupportBoxApprovals SupportRequestBox = "approvals"
)

func (b SupportRequestBox) Valid() bool {
	switch b {
	case SupportBoxInbox, SupportBoxSent, SupportBoxAll, SupportBoxApprovals:
		return true
	default:
		return false
	}
}

type SupportRequestListFilters struct {
	Box      SupportRequestBox
	Statuses []SupportRequestStatus
	EntityID *uuid.UUID
	History  bool
	Page     int
	PerPage  int
}

type SupportDirectory struct {
	Entities         []SupportEntitySummary   `json:"entities"`
	SelectedEntityID *uuid.UUID               `json:"selected_entity_id,omitempty"`
	Members          []SupportDirectoryMember `json:"members"`
}

// SupportExpiryPreview is calculated from the same tenant calendar and clock
// as Create. Clients use it to show the exact validity boundary before submit;
// expires_at on the created request remains authoritative.
type SupportExpiryPreview struct {
	BusinessDays int       `json:"business_days"`
	ExpiresAt    time.Time `json:"expires_at"`
}
