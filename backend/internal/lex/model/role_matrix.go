package model

import (
	"time"

	"github.com/google/uuid"
)

// Tenant Role-Matrix Import (Lex_Role_Matrix_Import_Design.md §4).
//
// A VERSION is an immutable, per-tenant snapshot of the complete role→permission
// matrix (draft → active → superseded); activation applies the snapshot to
// platform_core.roles and the enforcement overlay. An IMPORT row records every
// dry-run/commit attempt with its validation outcome and diff (append-only).

// RoleMatrixVersionStatus values (CHECK-constrained in the migration).
const (
	RoleMatrixVersionDraft      = "draft"
	RoleMatrixVersionActive     = "active"
	RoleMatrixVersionSuperseded = "superseded"
)

// RoleMatrixImportStatus values.
const (
	RoleMatrixImportValidated = "validated"
	RoleMatrixImportFailed    = "failed"
	RoleMatrixImportCommitted = "committed"
)

// RoleMatrixImportMode values.
const (
	RoleMatrixModeMerge   = "merge"
	RoleMatrixModeReplace = "replace"
)

// RoleMatrixRoleSnapshot is one role's complete state inside a version snapshot.
// Activation applies EXACTLY this (plus the auto-granted baselines at overlay
// load time) — nothing is derived at activation.
type RoleMatrixRoleSnapshot struct {
	Slug            string   `json:"slug"`
	Code            string   `json:"code,omitempty"`
	NameEN          string   `json:"name_en"`
	NameAR          string   `json:"name_ar,omitempty"`
	Description     string   `json:"description,omitempty"`
	Tier            string   `json:"tier,omitempty"`
	OrgUnit         string   `json:"org_unit,omitempty"`
	ReportsTo       string   `json:"reports_to,omitempty"`
	EscalationLevel int      `json:"escalation_level,omitempty"`
	IsSystem        bool     `json:"is_system"`
	Active          bool     `json:"active"`
	Permissions     []string `json:"permissions"`
}

// RoleMatrixVersion is one immutable matrix snapshot.
type RoleMatrixVersion struct {
	ID             uuid.UUID                `json:"id"`
	TenantID       uuid.UUID                `json:"tenant_id"`
	Version        int                      `json:"version"`
	Status         string                   `json:"status"`
	SourceFilename string                   `json:"source_filename"`
	Checksum       string                   `json:"checksum"`
	ChangeReason   string                   `json:"change_reason"`
	Snapshot       []RoleMatrixRoleSnapshot `json:"snapshot"`
	CreatedBy      uuid.UUID                `json:"created_by"`
	CreatedAt      time.Time                `json:"created_at"`
	ActivatedBy    *uuid.UUID               `json:"activated_by,omitempty"`
	ActivatedAt    *time.Time               `json:"activated_at,omitempty"`
}

// RoleMatrixIssue is one validation error or warning, addressable to the exact
// role/permission cell the admin must fix in the template.
type RoleMatrixIssue struct {
	RoleSlug   string `json:"role_slug,omitempty"`
	Permission string `json:"permission,omitempty"`
	Field      string `json:"field,omitempty"`
	CodeKey    string `json:"code_key"`
	Message    string `json:"message"`
}

// RoleMatrixRoleDiff lists the grant changes one role would undergo.
type RoleMatrixRoleDiff struct {
	RoleSlug string   `json:"role_slug"`
	Added    []string `json:"added,omitempty"`
	Removed  []string `json:"removed,omitempty"`
}

// RoleMatrixDiff summarizes the effect of applying an import against the
// tenant's currently-enforced matrix.
type RoleMatrixDiff struct {
	RolesAdded       []string             `json:"roles_added,omitempty"`
	RolesDeactivated []string             `json:"roles_deactivated,omitempty"`
	RolesChanged     []RoleMatrixRoleDiff `json:"roles_changed,omitempty"`
	RolesUnchanged   int                  `json:"roles_unchanged"`
	GrantsAdded      int                  `json:"grants_added"`
	GrantsRemoved    int                  `json:"grants_removed"`
}

// RoleMatrixImportJob is one dry-run/commit attempt (append-only log).
type RoleMatrixImportJob struct {
	ID             uuid.UUID         `json:"id"`
	TenantID       uuid.UUID         `json:"tenant_id"`
	VersionID      *uuid.UUID        `json:"version_id,omitempty"`
	Mode           string            `json:"mode"`
	DryRun         bool              `json:"dry_run"`
	Status         string            `json:"status"`
	SourceFilename string            `json:"source_filename"`
	RoleCount      int               `json:"role_count"`
	GrantCount     int               `json:"grant_count"`
	ErrorCount     int               `json:"error_count"`
	WarningCount   int               `json:"warning_count"`
	Errors         []RoleMatrixIssue `json:"errors"`
	Warnings       []RoleMatrixIssue `json:"warnings"`
	Diff           RoleMatrixDiff    `json:"diff"`
	CreatedBy      uuid.UUID         `json:"created_by"`
	CreatedAt      time.Time         `json:"created_at"`
}
