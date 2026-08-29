package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// OrgEntityType enumerates the legal-org master-data node kinds. The hierarchy is
// the unowned blocker behind ~8 Watheeq Musts: SLA escalation (CAP-019),
// eligibility/distribution (CAP-008), and org-data lookups (CAP-153). Values
// mirror the platform_core org-unit taxonomy so a legal entity can optionally
// project onto a platform org-unit (platform_org_unit_id).
type OrgEntityType string

const (
	OrgEntityTypeBusinessUnit       OrgEntityType = "business_unit"
	OrgEntityTypeCompany            OrgEntityType = "company"
	OrgEntityTypeDepartment         OrgEntityType = "department"
	OrgEntityTypeSection            OrgEntityType = "section"
	OrgEntityTypeSharedServicesUnit OrgEntityType = "shared_services_unit"
)

// OrgRoleKey enumerates the responsibility keys attached to an entity. The first
// three (section_supervisor / department_manager / shared_services_manager) are
// the L1/L2/L3 escalation ladder consumed by ResolveEscalationRecipients
// (CAP-019). The remainder are addressable distribution/eligibility targets
// (CAP-008, CAP-153).
type OrgRoleKey string

const (
	OrgRoleSectionSupervisor     OrgRoleKey = "section_supervisor"
	OrgRoleDepartmentManager     OrgRoleKey = "department_manager"
	OrgRoleSharedServicesManager OrgRoleKey = "shared_services_manager"
	OrgRoleLegalDirector         OrgRoleKey = "legal_director"
	OrgRoleContractsManager      OrgRoleKey = "contracts_manager"
	OrgRoleComplianceOfficer     OrgRoleKey = "compliance_officer"
	OrgRoleGeneralCounsel        OrgRoleKey = "general_counsel"
)

// OrgRBACVerb is the 5-verb org-scoped action vocabulary required by CAP-153:
// view/add/edit/approve/close. The org registry does not enforce route access
// itself; it resolves the org-role prerequisites that the RBAC layer consumes.
type OrgRBACVerb string

const (
	OrgRBACVerbView    OrgRBACVerb = "view"
	OrgRBACVerbAdd     OrgRBACVerb = "add"
	OrgRBACVerbEdit    OrgRBACVerb = "edit"
	OrgRBACVerbApprove OrgRBACVerb = "approve"
	OrgRBACVerbClose   OrgRBACVerb = "close"
)

// Valid reports whether the verb is one of the five org-RBAC actions.
func (v OrgRBACVerb) Valid() bool {
	switch v {
	case OrgRBACVerbView, OrgRBACVerbAdd, OrgRBACVerbEdit, OrgRBACVerbApprove, OrgRBACVerbClose:
		return true
	default:
		return false
	}
}

// OrgEntity is one node of the legal-org master-data tree. tenant_id leads every
// row (multitenant RLS); parent_id is a self-FK; path is the materialized
// ancestry (root-first array of entity ids as text) used for cheap subtree and
// escalation-ladder traversal without recursive CTEs at read time.
type OrgEntity struct {
	ID                uuid.UUID           `json:"id"`
	TenantID          uuid.UUID           `json:"tenant_id"`
	ParentID          *uuid.UUID          `json:"parent_id,omitempty"`
	EntityType        OrgEntityType       `json:"entity_type"`
	Code              string              `json:"code"`
	Name              forms.LocalizedText `json:"name"`
	PlatformOrgUnitID *uuid.UUID          `json:"platform_org_unit_id,omitempty"`
	Path              []string            `json:"path"`
	Active            bool                `json:"active"`
	Metadata          map[string]any      `json:"metadata"`
	CreatedBy         uuid.UUID           `json:"created_by"`
	CreatedAt         time.Time           `json:"created_at"`
	UpdatedAt         time.Time           `json:"updated_at"`
	DeletedAt         *time.Time          `json:"deleted_at,omitempty"`
	Roles             []OrgRole           `json:"roles,omitempty"`
}

// OrgRole binds a responsibility key + user to an org entity. label is an
// optional bilingual override of the human-facing role caption.
type OrgRole struct {
	ID        uuid.UUID           `json:"id"`
	TenantID  uuid.UUID           `json:"tenant_id"`
	EntityID  uuid.UUID           `json:"entity_id"`
	RoleKey   OrgRoleKey          `json:"role_key"`
	UserID    uuid.UUID           `json:"user_id"`
	Label     forms.LocalizedText `json:"label"`
	CreatedBy uuid.UUID           `json:"created_by"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	DeletedAt *time.Time          `json:"deleted_at,omitempty"`
}

// EscalationRecipient is one rung of the resolved escalation ladder. Level is
// 1 (section supervisor), 2 (department manager) or 3 (shared-services manager).
// EntityID/EntityName identify the org node that supplied the recipient; UserID
// is the addressable user. A rung is omitted when no role binding exists up the
// ancestry path, so callers can detect coverage gaps.
type EscalationRecipient struct {
	Level      int                 `json:"level"`
	RoleKey    OrgRoleKey          `json:"role_key"`
	UserID     uuid.UUID           `json:"user_id"`
	Label      forms.LocalizedText `json:"label"`
	EntityID   uuid.UUID           `json:"entity_id"`
	EntityCode string              `json:"entity_code"`
	EntityName forms.LocalizedText `json:"entity_name"`
}

// EscalationLadder is the resolved L1/L2/L3 recipient set for an org entity,
// the primary product the SLA-escalation engine (CAP-019) consumes.
type EscalationLadder struct {
	EntityID   uuid.UUID             `json:"entity_id"`
	EntityCode string                `json:"entity_code"`
	EntityName forms.LocalizedText   `json:"entity_name"`
	ResolvedAt time.Time             `json:"resolved_at"`
	Recipients []EscalationRecipient `json:"recipients"`
}

// AddressableRoleRecipient is the normalized user target for a registry role
// resolved from an entity's ancestry. EntityID/EntityName identify the nearest
// org node that supplied the role binding.
type AddressableRoleRecipient struct {
	RoleKey    OrgRoleKey          `json:"role_key"`
	UserID     uuid.UUID           `json:"user_id"`
	Label      forms.LocalizedText `json:"label"`
	EntityID   uuid.UUID           `json:"entity_id"`
	EntityCode string              `json:"entity_code"`
	EntityName forms.LocalizedText `json:"entity_name"`
}

// AddressableRoleResolution is the resolved recipient set for requested role
// keys. Missing role coverage is represented by omission from Recipients so
// callers can distinguish partial coverage from hard lookup errors.
type AddressableRoleResolution struct {
	EntityID   uuid.UUID                  `json:"entity_id"`
	EntityCode string                     `json:"entity_code"`
	EntityName forms.LocalizedText        `json:"entity_name"`
	ResolvedAt time.Time                  `json:"resolved_at"`
	Recipients []AddressableRoleRecipient `json:"recipients"`
}

// OrgRBACPrerequisite is the org-registry side of CAP-153. RoleKeys records the
// role keys that can satisfy a verb for an entity; Recipients is the resolved
// nearest ancestry binding for those keys. Enforcement remains in the RBAC layer.
type OrgRBACPrerequisite struct {
	Verb       OrgRBACVerb                `json:"verb"`
	RoleKeys   []OrgRoleKey               `json:"role_keys"`
	Recipients []AddressableRoleRecipient `json:"recipients"`
}

// OrgRBACPrerequisiteResolution groups all requested verb prerequisites for a
// beneficiary org entity.
type OrgRBACPrerequisiteResolution struct {
	EntityID      uuid.UUID             `json:"entity_id"`
	EntityCode    string                `json:"entity_code"`
	EntityName    forms.LocalizedText   `json:"entity_name"`
	ResolvedAt    time.Time             `json:"resolved_at"`
	Prerequisites []OrgRBACPrerequisite `json:"prerequisites"`
}

// OrgEntityAuditEvent is one entry of the org-entity activity timeline. The
// registry has no dedicated append-only audit table (legal_org_entities carries
// no per-mutation history), so these events are SYNTHESIZED from each entity's
// own row metadata: created_by/created_at -> a "created" event, and a distinct
// updated_at -> an "updated" event. This is an honest, read-only projection of
// the data the registry actually persists; it is not a tamper-evident ledger.
// The shape is kept stable (snake_case, RFC3339 At) so the frontend timeline can
// consume it unchanged if a real audit log is wired later.
type OrgEntityAuditEvent struct {
	ID         uuid.UUID      `json:"id"`
	At         time.Time      `json:"at"`
	Actor      uuid.UUID      `json:"actor"`
	Action     string         `json:"action"`
	EntityID   uuid.UUID      `json:"entity_id"`
	EntityCode string         `json:"entity_code"`
	Summary    string         `json:"summary"`
	Before     map[string]any `json:"before,omitempty"`
	After      map[string]any `json:"after,omitempty"`
}

// PlatformOrgUnit is one platform_core org-unit reference surfaced for
// reconciliation against the legal-org registry. Name may be a localized object
// or a plain string depending on the source; here it is whatever the registry
// can resolve for the referenced unit (currently a localized object derived from
// the linking legal entity — see OrgEntityRepository.ListPlatformOrgUnitRefs).
type PlatformOrgUnit struct {
	ID       uuid.UUID  `json:"id"`
	Code     string     `json:"code"`
	Name     any        `json:"name"`
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
	Active   bool       `json:"active"`
}

// OrgEntityAuditFilters is the tenant-wide audit pagination surface.
type OrgEntityAuditFilters struct {
	Page    int
	PerPage int
}

// OrgEntityListFilters is the list/search/sort surface for the registry.
type OrgEntityListFilters struct {
	Page          int
	PerPage       int
	Search        string
	EntityType    *OrgEntityType
	ParentID      *uuid.UUID
	Active        *bool
	SortColumn    string
	SortDirection string
}
