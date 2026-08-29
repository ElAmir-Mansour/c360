package model

import (
	"time"

	"github.com/google/uuid"
)

type OrgImportRowError struct {
	Row     int    `json:"row"`
	Code    string `json:"code,omitempty"`
	Field   string `json:"field"`
	CodeKey string `json:"error_code"`
	Message string `json:"message"`
}

type OrgImportJob struct {
	ID              uuid.UUID           `json:"id"`
	TenantID        uuid.UUID           `json:"tenant_id"`
	Mode            string              `json:"mode"`
	DryRun          bool                `json:"dry_run"`
	Status          string              `json:"status"`
	SourceFilename  string              `json:"source_filename"`
	Errors          []OrgImportRowError `json:"errors"`
	TotalRows       int                 `json:"total_rows"`
	CreateCount     int                 `json:"create_count"`
	UpdateCount     int                 `json:"update_count"`
	DeactivateCount int                 `json:"deactivate_count"`
	RoleCount       int                 `json:"role_count"`
	EmployeeCount   int                 `json:"employee_count"`
	CreatedBy       uuid.UUID           `json:"created_by"`
	CreatedAt       time.Time           `json:"created_at"`
	CompletedAt     *time.Time          `json:"completed_at,omitempty"`
}

type OrgMembership struct {
	ID            uuid.UUID         `json:"id"`
	TenantID      uuid.UUID         `json:"tenant_id"`
	EntityID      uuid.UUID         `json:"entity_id"`
	UserID        uuid.UUID         `json:"user_id"`
	EmployeeCode  string            `json:"employee_code"`
	Title         map[string]string `json:"title"`
	ManagerUserID *uuid.UUID        `json:"manager_user_id,omitempty"`
	CapacityUnits *float64          `json:"capacity_units,omitempty"`
	Active        bool              `json:"active"`
	Metadata      map[string]any    `json:"metadata"`
	CreatedBy     uuid.UUID         `json:"created_by"`
}
