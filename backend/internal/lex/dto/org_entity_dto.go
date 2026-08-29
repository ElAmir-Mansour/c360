package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateOrgEntityRequest creates a node in the legal-org master-data tree.
type CreateOrgEntityRequest struct {
	ParentID          *uuid.UUID          `json:"parent_id,omitempty"`
	EntityType        model.OrgEntityType `json:"entity_type"`
	Code              string              `json:"code"`
	Name              forms.LocalizedText `json:"name"`
	PlatformOrgUnitID *uuid.UUID          `json:"platform_org_unit_id,omitempty"`
	Active            *bool               `json:"active,omitempty"`
	Metadata          map[string]any      `json:"metadata,omitempty"`
	Roles             []OrgRoleRequest    `json:"roles,omitempty"`
}

// UpdateOrgEntityRequest patches a node. Nil fields are left unchanged.
type UpdateOrgEntityRequest struct {
	ParentID          *uuid.UUID           `json:"parent_id,omitempty"`
	EntityType        *model.OrgEntityType `json:"entity_type,omitempty"`
	Code              *string              `json:"code,omitempty"`
	Name              *forms.LocalizedText `json:"name,omitempty"`
	PlatformOrgUnitID *uuid.UUID           `json:"platform_org_unit_id,omitempty"`
	Active            *bool                `json:"active,omitempty"`
	Metadata          map[string]any       `json:"metadata,omitempty"`
}

// OrgRoleRequest binds a responsibility key + user to an entity.
type OrgRoleRequest struct {
	RoleKey model.OrgRoleKey    `json:"role_key"`
	UserID  uuid.UUID           `json:"user_id"`
	Label   forms.LocalizedText `json:"label"`
}

// OrgStructureImportMode controls how normalized rows interact with the current
// registry. Replace is a merge plus soft-deactivation of active codes omitted
// from the submitted structure.
type OrgStructureImportMode string

const (
	OrgImportCreate  OrgStructureImportMode = "create"
	OrgImportUpdate  OrgStructureImportMode = "update"
	OrgImportMerge   OrgStructureImportMode = "merge"
	OrgImportReplace OrgStructureImportMode = "replace"
)

// OrgStructureImportRow is the canonical transport shared by XLSX, CSV and JSON
// clients. Parent references are stable business codes, never database UUIDs.
type OrgStructureImportRow struct {
	Row               int                  `json:"row"`
	Code              string               `json:"code"`
	ParentCode        string               `json:"parent_code,omitempty"`
	EntityType        model.OrgEntityType  `json:"entity_type"`
	Name              forms.LocalizedText  `json:"name"`
	PlatformOrgUnitID *uuid.UUID           `json:"platform_org_unit_id,omitempty"`
	Active            *bool                `json:"active,omitempty"`
	Metadata          map[string]any       `json:"metadata,omitempty"`
	Roles             []OrgRoleRequest     `json:"roles,omitempty"`
	ManagerUserID     *uuid.UUID           `json:"manager_user_id,omitempty"`
	Employees         []OrgEmployeeRequest `json:"employees,omitempty"`
}

type OrgEmployeeRequest struct {
	UserID        uuid.UUID           `json:"user_id"`
	EmployeeCode  string              `json:"employee_code,omitempty"`
	Title         forms.LocalizedText `json:"title,omitempty"`
	ManagerUserID *uuid.UUID          `json:"manager_user_id,omitempty"`
	CapacityUnits *float64            `json:"capacity_units,omitempty"`
	Active        *bool               `json:"active,omitempty"`
	Metadata      map[string]any      `json:"metadata,omitempty"`
}

type OrgStructureImportRequest struct {
	Mode           OrgStructureImportMode  `json:"mode"`
	DryRun         bool                    `json:"dry_run"`
	SourceFilename string                  `json:"source_filename,omitempty"`
	Rows           []OrgStructureImportRow `json:"rows"`
}

func (r *OrgStructureImportRequest) Normalize() {
	r.SourceFilename = strings.TrimSpace(r.SourceFilename)
	for i := range r.Rows {
		row := &r.Rows[i]
		if row.Row <= 0 {
			row.Row = i + 2 // row 1 is the spreadsheet header
		}
		row.Code = strings.ToUpper(strings.TrimSpace(row.Code))
		row.ParentCode = strings.ToUpper(strings.TrimSpace(row.ParentCode))
		row.Name.AR = strings.TrimSpace(row.Name.AR)
		row.Name.EN = strings.TrimSpace(row.Name.EN)
		if row.EntityType == "" {
			row.EntityType = model.OrgEntityTypeDepartment
		}
		if row.Metadata == nil {
			row.Metadata = map[string]any{}
		}
		for j := range row.Roles {
			row.Roles[j].Normalize()
		}
		for j := range row.Employees {
			employee := &row.Employees[j]
			employee.EmployeeCode = strings.TrimSpace(employee.EmployeeCode)
			employee.Title.AR = strings.TrimSpace(employee.Title.AR)
			employee.Title.EN = strings.TrimSpace(employee.Title.EN)
			if employee.Metadata == nil {
				employee.Metadata = map[string]any{}
			}
		}
	}
}

func (r *CreateOrgEntityRequest) Normalize() {
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	r.Name.AR = strings.TrimSpace(r.Name.AR)
	r.Name.EN = strings.TrimSpace(r.Name.EN)
	if r.EntityType == "" {
		r.EntityType = model.OrgEntityTypeDepartment
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for i := range r.Roles {
		r.Roles[i].Normalize()
	}
}

func (r *UpdateOrgEntityRequest) Normalize() {
	if r.Code != nil {
		trimmed := strings.ToUpper(strings.TrimSpace(*r.Code))
		r.Code = &trimmed
	}
	if r.Name != nil {
		r.Name.AR = strings.TrimSpace(r.Name.AR)
		r.Name.EN = strings.TrimSpace(r.Name.EN)
	}
}

func (r *OrgRoleRequest) Normalize() {
	r.Label.AR = strings.TrimSpace(r.Label.AR)
	r.Label.EN = strings.TrimSpace(r.Label.EN)
}
