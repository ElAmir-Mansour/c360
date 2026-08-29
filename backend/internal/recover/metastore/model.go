// Package metastore is the Application Metastore seam for Clario Recover
// (Prompt 7, the Cutover "Application Metastore" analogue). It defines a real,
// stable interface — MetastoreClient — that resolves an application's
// recovery-relevant metadata (owners, environments, dependencies, recovery
// tier, RTO TARGET, cloud accounts, and linked runbooks) AND ships a complete,
// persistence-backed default implementation (DefaultRegistry, a real CMDB-like
// registry with real schema, CRUD, population, and drift logic).
//
// The seam (RECOVER §3.4): the interface enables the dedicated Metastore
// product, later in the roadmap, to swap the implementation; what ships here is
// a real, working feature today — never a thin stub and never canned data.
//
// COMPOSITION, not forking: the "populate from Metastore" action drives the
// EXISTING internal/dr/runbookstudio service (CreateRunbook with import steps)
// to materialize a runbook from an application's metadata; this package never
// reimplements runbook authoring or the studio engine. The "sync" action diffs
// an application's current metadata revision against the revision a linked
// runbook was populated from and flags real drift, mirroring the registry
// package's self-maintaining-runbook idea without forking its code.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries), its OWN chi.Router, its OWN migration pair
// (000037). It reuses the repository.DBTX execution-context pattern,
// internal/database, internal/auth + middleware, and internal/suiteapi.
package metastore

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrNotFound is returned when an application (by id or app_key) does not
	// exist for the tenant. The router maps it to 404.
	ErrNotFound = errors.New("metastore: application not found")
	// ErrAlreadyExists is returned when an app_key collides on create. 409.
	ErrAlreadyExists = errors.New("metastore: application already exists")
	// ErrInvalid is returned when a create/update payload fails validation. 400.
	ErrInvalid = errors.New("metastore: invalid application metadata")
	// ErrNoRecoveryTarget is returned when a populate is requested for an
	// application that has no recovery-target environment, so no boot phase could
	// be materialized — generating an empty runbook would be misleading. 422.
	ErrNoRecoveryTarget = errors.New("metastore: application has no recovery-target environment; cannot populate a runbook")
	// ErrRunbookNotLinked is returned when a sync is requested for a runbook that
	// was never populated from the application. 404.
	ErrRunbookNotLinked = errors.New("metastore: runbook is not linked to the application")
)

// Recovery tiers — the application criticality classification that shapes which
// gates a generated runbook includes. mission_critical and tier_1 applications
// get an explicit approval gate before the recovery boot phases; lower tiers
// recover without the human gate.
const (
	TierMissionCritical = "mission_critical"
	TierOne             = "tier_1"
	TierTwo             = "tier_2"
	TierThree           = "tier_3"
)

// ValidTier reports whether t is a recognised recovery tier.
func ValidTier(t string) bool {
	switch t {
	case TierMissionCritical, TierOne, TierTwo, TierThree:
		return true
	default:
		return false
	}
}

// requiresApprovalGate reports whether a tier's runbook includes the pre-boot
// human approval gate. Mission-critical and tier-1 recoveries are gated.
func requiresApprovalGate(tier string) bool {
	return tier == TierMissionCritical || tier == TierOne
}

// Environment kinds.
const (
	EnvProduction       = "production"
	EnvDisasterRecovery = "disaster_recovery"
	EnvStaging          = "staging"
	EnvTest             = "test"
	EnvDevelopment      = "development"
)

// ValidEnvKind reports whether k is a recognised environment kind.
func ValidEnvKind(k string) bool {
	switch k {
	case EnvProduction, EnvDisasterRecovery, EnvStaging, EnvTest, EnvDevelopment:
		return true
	default:
		return false
	}
}

// Owner roles.
const (
	OwnerBusiness  = "business"
	OwnerTechnical = "technical"
	OwnerIncident  = "incident"
	OwnerApprover  = "approver"
)

// Dependency criticality.
const (
	DependencyHard = "hard"
	DependencySoft = "soft"
)

// ValidDependencyCriticality reports whether c is hard or soft.
func ValidDependencyCriticality(c string) bool {
	return c == DependencyHard || c == DependencySoft
}

// Cloud providers.
const (
	ProviderAWS    = "aws"
	ProviderAzure  = "azure"
	ProviderGCP    = "gcp"
	ProviderOCI    = "oci"
	ProviderOnPrem = "on_prem"
)

// ValidProvider reports whether p is a recognised provider.
func ValidProvider(p string) bool {
	switch p {
	case ProviderAWS, ProviderAzure, ProviderGCP, ProviderOCI, ProviderOnPrem:
		return true
	default:
		return false
	}
}

// Owner is a role-tagged contact responsible for an application.
type Owner struct {
	Role    string `json:"role"`
	Name    string `json:"name"`
	Contact string `json:"contact,omitempty"`
}

// Environment is one environment an application runs in. Only environments
// flagged IsRecoveryTarget become a boot phase in a generated runbook.
type Environment struct {
	Key              string `json:"key"`
	Kind             string `json:"kind"`
	Region           string `json:"region,omitempty"`
	IsRecoveryTarget bool   `json:"is_recovery_target"`
}

// Dependency is a directed edge to another application this one depends on,
// referenced by the dependency's stable app_key (soft reference; the dependency
// app need not be registered yet). The runbook orders a hard dependency's
// recovery before this application's.
type Dependency struct {
	DependsOnAppKey string `json:"depends_on_app_key"`
	Criticality     string `json:"criticality"`
}

// CloudAccount is a cloud account/subscription the application's infrastructure
// lives in — a recovery target to fail into.
type CloudAccount struct {
	Provider   string `json:"provider"`
	AccountRef string `json:"account_ref"`
	Region     string `json:"region,omitempty"`
}

// RunbookLink records a runbook populated from an application and the
// application metadata_revision it was populated from. The sync action compares
// SourceRevision to the application's current MetadataRevision to flag drift.
type RunbookLink struct {
	RunbookID      string    `json:"runbook_id"`
	SourceRevision int       `json:"source_revision"`
	SourceHash     string    `json:"source_hash"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Application is the full recovery-relevant metadata the Metastore resolves for
// one application — the value the MetastoreClient interface returns and the
// populate action materializes a runbook from. MetadataRevision/MetadataHash
// fingerprint the drift-relevant metadata; they advance on every mutating write
// that changes that metadata.
type Application struct {
	ID               string         `json:"id"`
	TenantID         string         `json:"tenant_id"`
	AppKey           string         `json:"app_key"`
	Name             string         `json:"name"`
	Description      string         `json:"description,omitempty"`
	RecoveryTier     string         `json:"recovery_tier"`
	RTOTargetSeconds int            `json:"rto_target_seconds"`
	Owners           []Owner        `json:"owners"`
	Environments     []Environment  `json:"environments"`
	Dependencies     []Dependency   `json:"dependencies"`
	CloudAccounts    []CloudAccount `json:"cloud_accounts"`
	LinkedRunbooks   []RunbookLink  `json:"linked_runbooks"`
	MetadataRevision int            `json:"metadata_revision"`
	MetadataHash     string         `json:"metadata_hash"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

// PopulateResult is the outcome of populating a runbook from an application's
// metadata: the linked runbook id, the studio runbook source, the number of
// tasks materialized, and the metadata revision the runbook was populated from.
type PopulateResult struct {
	ApplicationID  string `json:"application_id"`
	AppKey         string `json:"app_key"`
	RunbookID      string `json:"runbook_id"`
	RunbookName    string `json:"runbook_name"`
	TaskCount      int    `json:"task_count"`
	SourceRevision int    `json:"source_revision"`
}

// DriftKind classifies how a linked runbook has drifted from the application's
// current metadata.
type DriftKind string

const (
	// DriftNone means the runbook is in sync with the current metadata.
	DriftNone DriftKind = "none"
	// DriftStale means the application metadata advanced past the revision the
	// runbook was populated from — the runbook should be re-populated.
	DriftStale DriftKind = "stale"
)

// DriftField is one specific metadata facet that changed between the runbook's
// source snapshot and the application's current metadata, with a human summary.
type DriftField struct {
	Field   string `json:"field"`
	Summary string `json:"summary"`
}

// SyncResult is the outcome of a sync (diff) of a linked runbook against the
// application's current metadata. It is a READ-ONLY diff — it FLAGS drift, it
// does not silently re-populate. Drifted is true when Kind != none.
type SyncResult struct {
	ApplicationID   string       `json:"application_id"`
	AppKey          string       `json:"app_key"`
	RunbookID       string       `json:"runbook_id"`
	Drifted         bool         `json:"drifted"`
	Kind            DriftKind    `json:"kind"`
	SourceRevision  int          `json:"source_revision"`
	CurrentRevision int          `json:"current_revision"`
	SourceHash      string       `json:"source_hash"`
	CurrentHash     string       `json:"current_hash"`
	ChangedFields   []DriftField `json:"changed_fields"`
}
