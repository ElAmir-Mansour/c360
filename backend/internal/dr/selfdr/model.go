// Package selfdr evaluates whether the Clario DR control plane has enough
// independently recoverable evidence to restore itself after a control-plane
// loss. It is intentionally pure model/planning logic: no storage, network, or
// handler dependencies live here.
package selfdr

import (
	"errors"
	"time"
)

// Sentinel errors returned by the restore-wave planner.
var (
	// ErrCycle is returned when component dependencies contain a cycle, so no
	// valid restore wave order exists.
	ErrCycle = errors.New("selfdr: dependency graph contains a cycle")
	// ErrSelfDependency is returned when a component depends on itself.
	ErrSelfDependency = errors.New("selfdr: component cannot depend on itself")
	// ErrUnknownDependency is returned when a dependency references a component
	// ID not present in the profile.
	ErrUnknownDependency = errors.New("selfdr: dependency references unknown component")
	// ErrDuplicateComponent is returned when two components share an ID.
	ErrDuplicateComponent = errors.New("selfdr: duplicate component id")
	// ErrInvalidComponent is returned when a component cannot participate in a
	// dependency graph.
	ErrInvalidComponent = errors.New("selfdr: invalid component")
)

// ComponentKind is the stable classifier for a DR control-plane dependency.
type ComponentKind string

const (
	ComponentKindPostgresControlDB        ComponentKind = "postgres_control_db"
	ComponentKindObjectWORMStore          ComponentKind = "object_worm_store"
	ComponentKindEventOutboxQueue         ComponentKind = "event_outbox_queue"
	ComponentKindVaultPKISecrets          ComponentKind = "vault_pki_secrets"
	ComponentKindContainerImagesArtifacts ComponentKind = "container_images_artifacts"
	ComponentKindConfigIaC                ComponentKind = "config_iac"
	ComponentKindObservability            ComponentKind = "observability"
	ComponentKindDRService                ComponentKind = "dr_service"
)

// RequiredComponentKinds returns the built-in control-plane component baseline
// in deterministic order.
func RequiredComponentKinds() []ComponentKind {
	return []ComponentKind{
		ComponentKindPostgresControlDB,
		ComponentKindObjectWORMStore,
		ComponentKindEventOutboxQueue,
		ComponentKindVaultPKISecrets,
		ComponentKindContainerImagesArtifacts,
		ComponentKindConfigIaC,
		ComponentKindObservability,
		ComponentKindDRService,
	}
}

// KnownComponentKind reports whether kind has built-in self-DR semantics.
func KnownComponentKind(kind ComponentKind) bool {
	switch kind {
	case ComponentKindPostgresControlDB,
		ComponentKindObjectWORMStore,
		ComponentKindEventOutboxQueue,
		ComponentKindVaultPKISecrets,
		ComponentKindContainerImagesArtifacts,
		ComponentKindConfigIaC,
		ComponentKindObservability,
		ComponentKindDRService:
		return true
	default:
		return false
	}
}

// Severity describes how strongly a finding affects readiness.
type Severity string

const (
	SeverityInfo     Severity = "info"
	SeverityWarning  Severity = "warning"
	SeverityCritical Severity = "critical"
)

// Verdict is the aggregate readiness outcome.
type Verdict string

const (
	VerdictReady    Verdict = "ready"
	VerdictDegraded Verdict = "degraded"
	VerdictNotReady Verdict = "not_ready"
)

// RecoveryObjective is the target a component must be able to meet.
type RecoveryObjective struct {
	RTOSeconds int `json:"rto_seconds,omitempty"`
	RPOSeconds int `json:"rpo_seconds,omitempty"`
}

// BackupEvidence proves a component has a usable recovery point.
type BackupEvidence struct {
	Available     bool      `json:"available"`
	Immutable     bool      `json:"immutable"`
	Encrypted     bool      `json:"encrypted"`
	LocationID    string    `json:"location_id,omitempty"`
	URI           string    `json:"uri,omitempty"`
	CapturedAt    time.Time `json:"captured_at,omitempty"`
	MaxRPOSeconds int       `json:"max_rpo_seconds,omitempty"`
}

// RestoreEvidence proves a component has been restored successfully.
type RestoreEvidence struct {
	Passed     bool      `json:"passed"`
	TestedAt   time.Time `json:"tested_at,omitempty"`
	LocationID string    `json:"location_id,omitempty"`
	RTOSeconds int       `json:"rto_seconds,omitempty"`
	RPOSeconds int       `json:"rpo_seconds,omitempty"`
	Notes      string    `json:"notes,omitempty"`
}

// Component is one recoverable control-plane building block.
type Component struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Kind              ComponentKind     `json:"kind"`
	Required          bool              `json:"required,omitempty"`
	Objective         RecoveryObjective `json:"objective"`
	Backup            BackupEvidence    `json:"backup"`
	Restore           RestoreEvidence   `json:"restore"`
	RecoveryLocations []string          `json:"recovery_locations,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
}

// Dependency is a directed depends_on edge: ComponentID depends on DependsOnID,
// so DependsOnID must be restored in an earlier wave.
type Dependency struct {
	ComponentID string `json:"component_id"`
	DependsOnID string `json:"depends_on_id"`
}

// RecoveryLocation is a place where control-plane recovery can be executed.
// Independent means it is not operationally dependent on the failed control
// plane it is meant to recover.
type RecoveryLocation struct {
	ID          string `json:"id"`
	Name        string `json:"name,omitempty"`
	Region      string `json:"region,omitempty"`
	Available   bool   `json:"available"`
	Independent bool   `json:"independent"`
	Offline     bool   `json:"offline,omitempty"`
}

// BreakGlassAccess records emergency credentials and operating access for
// bootstrapping recovery when the normal control plane is unavailable.
type BreakGlassAccess struct {
	Available               bool      `json:"available"`
	ControlPlaneIndependent bool      `json:"control_plane_independent"`
	Holders                 int       `json:"holders,omitempty"`
	TestedAt                time.Time `json:"tested_at,omitempty"`
	LocationID              string    `json:"location_id,omitempty"`
}

// OfflineRestoreBundle records the out-of-band bundle needed to restore the DR
// control plane without reaching the failed control plane.
type OfflineRestoreBundle struct {
	Available   bool      `json:"available"`
	Complete    bool      `json:"complete"`
	LocationID  string    `json:"location_id,omitempty"`
	GeneratedAt time.Time `json:"generated_at,omitempty"`
}

// SelfDRProfile is the complete input to a readiness assessment.
type SelfDRProfile struct {
	ID                string               `json:"id"`
	Name              string               `json:"name,omitempty"`
	Components        []Component          `json:"components"`
	Dependencies      []Dependency         `json:"dependencies,omitempty"`
	RecoveryLocations []RecoveryLocation   `json:"recovery_locations,omitempty"`
	BreakGlass        BreakGlassAccess     `json:"break_glass"`
	OfflineBundle     OfflineRestoreBundle `json:"offline_bundle"`
	RestoreTestWindow time.Duration        `json:"restore_test_window,omitempty"`
	RequiredKinds     []ComponentKind      `json:"required_kinds,omitempty"`
	Metadata          map[string]string    `json:"metadata,omitempty"`
}

// Finding is one readiness gap or diagnostic emitted by the evaluator.
type Finding struct {
	Code          string        `json:"code"`
	Severity      Severity      `json:"severity"`
	ComponentID   string        `json:"component_id,omitempty"`
	ComponentKind ComponentKind `json:"component_kind,omitempty"`
	Message       string        `json:"message"`
}

// ReadinessAssessment is the deterministic output of evaluating a profile.
type ReadinessAssessment struct {
	ProfileID   string      `json:"profile_id"`
	Verdict     Verdict     `json:"verdict"`
	EvaluatedAt time.Time   `json:"evaluated_at"`
	Findings    []Finding   `json:"findings,omitempty"`
	RestorePlan RestorePlan `json:"restore_plan"`
}

// RestoreWave is one parallel restore tier.
type RestoreWave struct {
	Sequence   int         `json:"sequence"`
	Components []Component `json:"components"`
}

// RestorePlan is the ordered restore-wave plan for the profile.
type RestorePlan struct {
	ProfileID string        `json:"profile_id"`
	Waves     []RestoreWave `json:"waves"`
}

// ComponentIDs returns wave component IDs in execution order.
func (p RestorePlan) ComponentIDs() [][]string {
	out := make([][]string, len(p.Waves))
	for i, wave := range p.Waves {
		ids := make([]string, len(wave.Components))
		for j, c := range wave.Components {
			ids[j] = c.ID
		}
		out[i] = ids
	}
	return out
}

// ComponentNames returns wave component names in execution order.
func (p RestorePlan) ComponentNames() [][]string {
	out := make([][]string, len(p.Waves))
	for i, wave := range p.Waves {
		names := make([]string, len(wave.Components))
		for j, c := range wave.Components {
			names[j] = c.Name
		}
		out[i] = names
	}
	return out
}
