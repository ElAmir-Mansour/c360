package model

import (
	"time"

	"github.com/google/uuid"
)

type MatterType string

const (
	MatterTypeGeneral    MatterType = "general"
	MatterTypeContract   MatterType = "contract"
	MatterTypeLitigation MatterType = "litigation"
	MatterTypeRegulatory MatterType = "regulatory"
	MatterTypeEmployment MatterType = "employment"
	MatterTypeDispute    MatterType = "dispute"
	MatterTypeAdvisory   MatterType = "advisory"
	MatterTypeOther      MatterType = "other"
)

type MatterStatus string

const (
	MatterStatusIntake            MatterStatus = "intake"
	MatterStatusOpen              MatterStatus = "open"
	MatterStatusInReview          MatterStatus = "in_review"
	MatterStatusWaitingOnBusiness MatterStatus = "waiting_on_business"
	MatterStatusOnHold            MatterStatus = "on_hold"
	MatterStatusClosed            MatterStatus = "closed"
	MatterStatusCancelled         MatterStatus = "cancelled"
)

type LegalPriority string

const (
	LegalPriorityCritical LegalPriority = "critical"
	LegalPriorityHigh     LegalPriority = "high"
	LegalPriorityMedium   LegalPriority = "medium"
	LegalPriorityLow      LegalPriority = "low"
)

type Matter struct {
	ID              uuid.UUID        `json:"id"`
	TenantID        uuid.UUID        `json:"tenant_id"`
	MatterNumber    string           `json:"matter_number"`
	Title           string           `json:"title"`
	Description     string           `json:"description"`
	Type            MatterType       `json:"type"`
	Status          MatterStatus     `json:"status"`
	Priority        LegalPriority    `json:"priority"`
	OwnerUserID     uuid.UUID        `json:"owner_user_id"`
	OwnerName       string           `json:"owner_name"`
	RequesterUserID *uuid.UUID       `json:"requester_user_id,omitempty"`
	RequesterName   *string          `json:"requester_name,omitempty"`
	Department      *string          `json:"department,omitempty"`
	OpenedAt        time.Time        `json:"opened_at"`
	DueDate         *time.Time       `json:"due_date,omitempty"`
	ClosedAt        *time.Time       `json:"closed_at,omitempty"`
	Tags            []string         `json:"tags"`
	Metadata        map[string]any   `json:"metadata"`
	CreatedBy       uuid.UUID        `json:"created_by"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
	DeletedAt       *time.Time       `json:"deleted_at,omitempty"`
	Contracts       []MatterContract `json:"contracts,omitempty"`
}

type MatterContract struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	MatterID      uuid.UUID `json:"matter_id"`
	ContractID    uuid.UUID `json:"contract_id"`
	ContractTitle *string   `json:"contract_title,omitempty"`
	Relationship  string    `json:"relationship"`
	CreatedBy     uuid.UUID `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

type MatterListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *MatterStatus
	Type          *MatterType
	Priority      *LegalPriority
	OwnerUserID   *uuid.UUID
	ContractID    *uuid.UUID
	Department    string
	DueBefore     *time.Time
	DueAfter      *time.Time
	Tag           string
	SortColumn    string
	SortDirection string
}
