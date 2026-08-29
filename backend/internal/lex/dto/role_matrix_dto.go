package dto

import (
	"sort"
	"strings"
)

// Tenant Role-Matrix Import request payload (Lex_Role_Matrix_Import_Design.md
// §6/§8). The frontend parses the uploaded XLSX/CSV/JSON template into this
// normalized shape; the SERVER re-validates everything (catalog membership, SoD
// gates, lockout guard) — the client parse is deserialization, not authority.

// RoleMatrixImportRole is one roster row from the template's Roles sheet.
// Active is a POINTER so an omitted field defaults to "keep active" — a JSON
// bool's zero-value must never silently deactivate a role.
type RoleMatrixImportRole struct {
	Code            string `json:"code,omitempty"`
	Slug            string `json:"slug"`
	NameEN          string `json:"name_en"`
	NameAR          string `json:"name_ar,omitempty"`
	Description     string `json:"description,omitempty"`
	Tier            string `json:"tier,omitempty"`
	OrgUnit         string `json:"org_unit,omitempty"`
	ReportsTo       string `json:"reports_to,omitempty"`
	EscalationLevel int    `json:"escalation_level,omitempty"`
	IsSystem        bool   `json:"is_system"`
	Active          *bool  `json:"active,omitempty"`
}

// IsActive resolves the tri-state Active flag (nil ⇒ true).
func (r RoleMatrixImportRole) IsActive() bool {
	return r.Active == nil || *r.Active
}

// RoleMatrixImportRequest carries one template upload.
//   - Grants maps role slug → the DIRECT permission keys marked X in the grid.
//   - Roles carries roster metadata; entries are OPTIONAL for slugs that already
//     exist on the tenant (metadata is preserved) and REQUIRED for new slugs.
//   - ConfirmWarnings must be true to COMMIT a matrix that raised warnings
//     (elevated-grant confirmations); dry-runs never require it.
type RoleMatrixImportRequest struct {
	Mode            string                 `json:"mode"`
	DryRun          bool                   `json:"dry_run"`
	SourceFilename  string                 `json:"source_filename,omitempty"`
	ChangeReason    string                 `json:"change_reason,omitempty"`
	ConfirmWarnings bool                   `json:"confirm_warnings,omitempty"`
	Roles           []RoleMatrixImportRole `json:"roles,omitempty"`
	Grants          map[string][]string    `json:"grants"`
}

// Normalize trims/cases every identifier and dedupes+sorts each grant list so
// validation, diffing and checksums are deterministic.
func (r *RoleMatrixImportRequest) Normalize() {
	r.Mode = strings.ToLower(strings.TrimSpace(r.Mode))
	if r.Mode == "" {
		r.Mode = "merge"
	}
	r.SourceFilename = strings.TrimSpace(r.SourceFilename)
	r.ChangeReason = strings.TrimSpace(r.ChangeReason)

	for i := range r.Roles {
		role := &r.Roles[i]
		role.Code = strings.ToUpper(strings.TrimSpace(role.Code))
		role.Slug = strings.ToLower(strings.TrimSpace(role.Slug))
		role.NameEN = strings.TrimSpace(role.NameEN)
		role.NameAR = strings.TrimSpace(role.NameAR)
		role.Description = strings.TrimSpace(role.Description)
		role.Tier = strings.TrimSpace(role.Tier)
		role.OrgUnit = strings.TrimSpace(role.OrgUnit)
		role.ReportsTo = strings.TrimSpace(role.ReportsTo)
	}

	normalized := make(map[string][]string, len(r.Grants))
	for slug, perms := range r.Grants {
		key := strings.ToLower(strings.TrimSpace(slug))
		if key == "" {
			continue
		}
		seen := make(map[string]struct{}, len(perms))
		clean := make([]string, 0, len(perms))
		for _, perm := range perms {
			p := strings.ToLower(strings.TrimSpace(perm))
			if p == "" {
				continue
			}
			if _, dup := seen[p]; dup {
				continue
			}
			seen[p] = struct{}{}
			clean = append(clean, p)
		}
		sort.Strings(clean)
		normalized[key] = clean
	}
	r.Grants = normalized
}
