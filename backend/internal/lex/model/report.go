package model

import (
	"time"

	"github.com/google/uuid"
)

type MatterSummary struct {
	ID           uuid.UUID     `json:"id"`
	MatterNumber string        `json:"matter_number"`
	Title        string        `json:"title"`
	Type         MatterType    `json:"type"`
	Status       MatterStatus  `json:"status"`
	Priority     LegalPriority `json:"priority"`
	OwnerUserID  uuid.UUID     `json:"owner_user_id"`
	OwnerName    string        `json:"owner_name"`
	Department   *string       `json:"department,omitempty"`
	OpenedAt     time.Time     `json:"opened_at"`
	DueDate      *time.Time    `json:"due_date,omitempty"`
	ClosedAt     *time.Time    `json:"closed_at,omitempty"`
	CreatedAt    time.Time     `json:"created_at"`
}

type MatterReport struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Total       int               `json:"total"`
	Filters     map[string]string `json:"filters"`
	Matters     []MatterSummary   `json:"matters"`
	ByStatus    map[string]int    `json:"by_status"`
	ByType      map[string]int    `json:"by_type"`
	ByPriority  map[string]int    `json:"by_priority"`
}

type ObligationSummary struct {
	ID            uuid.UUID        `json:"id"`
	Title         string           `json:"title"`
	Type          ObligationType   `json:"type"`
	Status        ObligationStatus `json:"status"`
	Priority      LegalPriority    `json:"priority"`
	OwnerUserID   uuid.UUID        `json:"owner_user_id"`
	OwnerName     string           `json:"owner_name"`
	ContractID    *uuid.UUID       `json:"contract_id,omitempty"`
	ContractTitle *string          `json:"contract_title,omitempty"`
	MatterID      *uuid.UUID       `json:"matter_id,omitempty"`
	MatterTitle   *string          `json:"matter_title,omitempty"`
	DueDate       time.Time        `json:"due_date"`
	DaysUntilDue  int              `json:"days_until_due"`
	CompletedAt   *time.Time       `json:"completed_at,omitempty"`
	CreatedAt     time.Time        `json:"created_at"`
}

type ObligationReport struct {
	GeneratedAt time.Time           `json:"generated_at"`
	Total       int                 `json:"total"`
	Filters     map[string]string   `json:"filters"`
	Obligations []ObligationSummary `json:"obligations"`
	ByStatus    map[string]int      `json:"by_status"`
	ByType      map[string]int      `json:"by_type"`
	ByPriority  map[string]int      `json:"by_priority"`
	Overdue     int                 `json:"overdue"`
	DueSoon     int                 `json:"due_soon"`
	Completed   int                 `json:"completed"`
}

// ResolutionRateCategory is a single domain's resolution rate: how many of its
// records for the tenant have reached a settled/terminal state.
type ResolutionRateCategory struct {
	Key      string `json:"key"`
	Total    int    `json:"total"`
	Resolved int    `json:"resolved"`
	Rate     int    `json:"rate"`
}

// ResolutionRateReport is the tenant-scoped resolution-rate roll-up across the
// four legal-affairs domains (contracts, litigation, advisory, requests) in that
// fixed order. CalculatedAt marshals RFC3339-compatible.
type ResolutionRateReport struct {
	Categories   []ResolutionRateCategory `json:"categories"`
	CalculatedAt time.Time                `json:"calculated_at"`
}
