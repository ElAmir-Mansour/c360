// Package respond owns the Clario Respond incident foundation: the durable
// incident aggregate, lifecycle state machine, incident-scoped RBAC contract,
// and append-only timeline model used by downstream Respond modules.
package respond

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

const EntitlementMajorIncident = "respond.major_incident"

var (
	ErrIncidentNotFound    = errors.New("respond incident not found")
	ErrStakeholderNotFound = errors.New("respond stakeholder token not found")
	ErrInvalidSeverity     = errors.New("invalid respond severity")
	ErrInvalidStatus       = errors.New("invalid respond status")
	ErrInvalidTransition   = errors.New("respond incident status transition is not allowed")
	ErrVersionConflict     = errors.New("respond incident version conflict")
	ErrUnauthorized        = errors.New("respond action is not authorized")
	ErrValidation          = errors.New("respond validation failed")
	ErrTimelineEventEmpty  = errors.New("respond timeline event type is required")
)

type Severity string

const (
	SeveritySEV1 Severity = "SEV1"
	SeveritySEV2 Severity = "SEV2"
	SeveritySEV3 Severity = "SEV3"
	SeveritySEV4 Severity = "SEV4"
)

type SeverityDefinition struct {
	Severity              Severity `json:"severity"`
	Definition            string   `json:"definition"`
	UserBaseScope         string   `json:"user_base_scope"`
	BusinessProcessImpact string   `json:"business_process_impact"`
	RevenueImpact         string   `json:"revenue_impact"`
	RegulatoryExposure    string   `json:"regulatory_exposure"`
}

var SeverityDefinitions = []SeverityDefinition{
	{
		Severity:              SeveritySEV1,
		Definition:            "Critical incident causing broad service outage or severe business interruption.",
		UserBaseScope:         "All users, a whole region, or a critical customer cohort.",
		BusinessProcessImpact: "Mission-critical process stopped or materially impaired.",
		RevenueImpact:         "Material active revenue loss or settlement/transaction failure.",
		RegulatoryExposure:    "Confirmed or likely reportable regulatory exposure.",
	},
	{
		Severity:              SeveritySEV2,
		Definition:            "High-impact incident with major degradation or partial outage.",
		UserBaseScope:         "Large user group, major tenant, or multiple important services.",
		BusinessProcessImpact: "Critical process degraded with workaround available.",
		RevenueImpact:         "Meaningful revenue risk without full transaction stoppage.",
		RegulatoryExposure:    "Potential regulatory notification if unresolved.",
	},
	{
		Severity:              SeveritySEV3,
		Definition:            "Moderate incident affecting a limited scope or non-critical process.",
		UserBaseScope:         "Limited user group or one non-critical service.",
		BusinessProcessImpact: "Business process impaired but serviceable.",
		RevenueImpact:         "Low direct revenue impact.",
		RegulatoryExposure:    "Unlikely regulatory exposure.",
	},
	{
		Severity:              SeveritySEV4,
		Definition:            "Minor incident, localized issue, or operational concern.",
		UserBaseScope:         "Individual users or narrow internal population.",
		BusinessProcessImpact: "No critical process impact.",
		RevenueImpact:         "No material revenue impact.",
		RegulatoryExposure:    "No regulatory exposure expected.",
	},
}

func (s Severity) Valid() bool {
	switch s {
	case SeveritySEV1, SeveritySEV2, SeveritySEV3, SeveritySEV4:
		return true
	default:
		return false
	}
}

type Status string

const (
	StatusDeclared      Status = "Declared"
	StatusTriaged       Status = "Triaged"
	StatusMobilizing    Status = "Mobilizing"
	StatusInvestigating Status = "Investigating"
	StatusMitigating    Status = "Mitigating"
	StatusMitigated     Status = "Mitigated"
	StatusResolved      Status = "Resolved"
	StatusClosed        Status = "Closed"
	StatusCancelled     Status = "Cancelled"
)

var Statuses = []Status{
	StatusDeclared,
	StatusTriaged,
	StatusMobilizing,
	StatusInvestigating,
	StatusMitigating,
	StatusMitigated,
	StatusResolved,
	StatusClosed,
	StatusCancelled,
}

func (s Status) Valid() bool {
	return slices.Contains(Statuses, s)
}

var TransitionTable = map[Status][]Status{
	StatusDeclared:      {StatusTriaged, StatusCancelled},
	StatusTriaged:       {StatusMobilizing, StatusCancelled},
	StatusMobilizing:    {StatusInvestigating, StatusCancelled},
	StatusInvestigating: {StatusMitigating, StatusCancelled},
	StatusMitigating:    {StatusMitigated, StatusCancelled},
	StatusMitigated:     {StatusResolved, StatusCancelled},
	StatusResolved:      {StatusClosed},
	StatusClosed:        {},
	StatusCancelled:     {},
}

func CanTransition(from, to Status) bool {
	return slices.Contains(TransitionTable[from], to)
}

func ValidateTransition(from, to Status) error {
	if !from.Valid() || !to.Valid() {
		return ErrInvalidStatus
	}
	if !CanTransition(from, to) {
		return fmt.Errorf("%s -> %s: %w", from, to, ErrInvalidTransition)
	}
	return nil
}

type Incident struct {
	ID               uuid.UUID  `json:"id"`
	TenantID         uuid.UUID  `json:"tenant_id"`
	Reference        string     `json:"reference"`
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	Severity         Severity   `json:"severity"`
	Status           Status     `json:"status"`
	DeclaredBy       uuid.UUID  `json:"declared_by"`
	DeclaredAt       time.Time  `json:"declared_at"`
	DetectedAt       *time.Time `json:"detected_at,omitempty"`
	MitigatedAt      *time.Time `json:"mitigated_at,omitempty"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty"`
	ClosedAt         *time.Time `json:"closed_at,omitempty"`
	ImpactedServices []string   `json:"impacted_services"`
	RowVersion       int        `json:"row_version"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

func (i *Incident) ValidateForCreate() error {
	i.Title = strings.TrimSpace(i.Title)
	i.Description = strings.TrimSpace(i.Description)
	if i.TenantID == uuid.Nil || i.DeclaredBy == uuid.Nil {
		return fmt.Errorf("tenant_id and declared_by are required: %w", ErrValidation)
	}
	if i.Title == "" {
		return fmt.Errorf("title is required: %w", ErrValidation)
	}
	if !i.Severity.Valid() {
		return ErrInvalidSeverity
	}
	if i.Status == "" {
		i.Status = StatusDeclared
	}
	if i.Status != StatusDeclared {
		return fmt.Errorf("new incidents must start Declared: %w", ErrInvalidStatus)
	}
	if i.DeclaredAt.IsZero() {
		i.DeclaredAt = time.Now().UTC()
	}
	i.ImpactedServices = normalizeServices(i.ImpactedServices)
	return nil
}

func normalizeServices(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, service := range in {
		service = strings.TrimSpace(service)
		if service == "" {
			continue
		}
		if _, ok := seen[service]; ok {
			continue
		}
		seen[service] = struct{}{}
		out = append(out, service)
	}
	return out
}

type IncidentRole string

const (
	RoleCommander           IncidentRole = "incident_commander"
	RoleCommunicationsLead  IncidentRole = "communications_lead"
	RoleTechnicalLead       IncidentRole = "technical_lead"
	RoleSubjectMatterExpert IncidentRole = "subject_matter_expert"
	RoleScribe              IncidentRole = "scribe"
	RoleStakeholderLiaison  IncidentRole = "stakeholder_liaison"
	RoleResolver            IncidentRole = "resolver"
)

const (
	PermRespondRead       = "respond:incident:read"
	PermRespondDeclare    = "respond:incident:declare"
	PermRespondUpdate     = "respond:incident:update"
	PermRespondTransition = "respond:incident:transition"
	PermRespondSeverity   = "respond:incident:severity"
	PermRespondTimeline   = "respond:timeline:append"
	PermRespondAdmin      = "respond:admin"
)

type Actor struct {
	UserID            uuid.UUID      `json:"user_id"`
	GlobalPermissions []string       `json:"global_permissions,omitempty"`
	IncidentRoles     []IncidentRole `json:"incident_roles,omitempty"`
}

func (a Actor) Can(permission string) bool {
	if a.UserID == uuid.Nil {
		return false
	}
	for _, p := range a.GlobalPermissions {
		if p == permission || p == PermRespondAdmin || p == "respond:*" || p == "admin:*" {
			return true
		}
		if strings.HasSuffix(p, ":*") && strings.HasPrefix(permission, strings.TrimSuffix(p, "*")) {
			return true
		}
	}
	for _, role := range a.IncidentRoles {
		if slices.Contains(RolePermissions[role], permission) {
			return true
		}
	}
	return false
}

var RolePermissions = map[IncidentRole][]string{
	RoleCommander: {
		PermRespondRead, PermRespondDeclare, PermRespondUpdate, PermRespondTransition,
		PermRespondSeverity, PermRespondTimeline,
	},
	RoleCommunicationsLead:  {PermRespondRead, PermRespondTimeline},
	RoleTechnicalLead:       {PermRespondRead, PermRespondUpdate, PermRespondTransition, PermRespondTimeline},
	RoleSubjectMatterExpert: {PermRespondRead, PermRespondTimeline},
	RoleScribe:              {PermRespondRead, PermRespondTimeline},
	RoleStakeholderLiaison:  {PermRespondRead, PermRespondTimeline},
	RoleResolver:            {PermRespondRead, PermRespondUpdate, PermRespondTimeline},
}

type TimelineEvent struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	IncidentID uuid.UUID      `json:"incident_id"`
	ActorID    uuid.UUID      `json:"actor_id"`
	OccurredAt time.Time      `json:"occurred_at"`
	EventType  string         `json:"event_type"`
	Payload    map[string]any `json:"payload"`
}

type TimelineFilter struct {
	EventTypes []string
	ActorID    *uuid.UUID
	From       *time.Time
	To         *time.Time
	Limit      int
	AfterID    *uuid.UUID
}

const (
	EventIncidentDeclared     = "respond.incident.declared"
	EventIncidentUpdated      = "respond.incident.updated"
	EventIncidentTransitioned = "respond.incident.status_transitioned"
	EventSeverityChanged      = "respond.incident.severity_changed"
)
