// Package registry implements ClarioDR's Recovery Asset Registry (D-10, the
// Cutover-Metastore analogue, DESIGN_DataStream_DR.md §14.3). It generates a
// structured, versioned recovery RUNBOOK for a consistency group from that
// group's REAL assets — members (boot_order), network mappings, the latest
// validated recovery point, and the group's RPO/RTO objectives — by applying a
// template. The runbook self-maintains: a reconcile path consumes
// datastream.dr.events (group/site/mapping/recovery-point changes), regenerates
// the runbook, computes a real step-level diff against the prior version, and
// stores a new immutable version only when the materialized steps actually
// changed. This mirrors the Cutover idea "template x asset data = a
// self-maintaining runbook" and the §6 four-gate failover sequence the runbook
// documents.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries; it does not edit the shared repository),
// its OWN chi.Router, and its OWN reconcile loop/consumer. It reuses the shared
// repository.DBTX execution-context pattern and internal/events + outbox.
package registry

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrNotFound is returned when a runbook or version does not exist.
	ErrNotFound = errors.New("recovery runbook not found")
	// ErrNoAssets is returned when a group has no members, so no runbook can be
	// materialized — generating an empty runbook would be misleading.
	ErrNoAssets = errors.New("consistency group has no members; cannot generate runbook")
	// ErrGroupNotFound is returned when the consistency group itself is absent.
	ErrGroupNotFound = errors.New("consistency group not found")
)

// Step kinds — the ordered phases a recovery runbook materializes. They mirror
// the real §6 gated failover sequence so the runbook is the human-readable,
// asset-bound projection of the FSM the Driver actually executes.
const (
	// StepKindPinRecoveryPoint pins the latest validated recovery point (Gate 1).
	StepKindPinRecoveryPoint = "pin_recovery_point"
	// StepKindQuiesce quiesces the primary and confirms the final sync.
	StepKindQuiesce = "quiesce"
	// StepKindApproval is the Gate-2 human approval gate.
	StepKindApproval = "approval"
	// StepKindBootMember boots one consistency-group member in boot order with its
	// network profile (Gate 3).
	StepKindBootMember = "boot_member"
	// StepKindHealthGate blocks until every booted member's workload probe is green.
	StepKindHealthGate = "health_gate"
	// StepKindAttest issues the immutable NCA-ready attestation (Gate 4).
	StepKindAttest = "attest"
)

// Trigger records what caused a runbook regeneration, for the audit trail.
const (
	TriggerManual         = "manual"
	TriggerMembership     = "membership"
	TriggerRecoveryPoint  = "recovery_point"
	TriggerNetworkMapping = "network_mapping"
	TriggerSite           = "site"
	TriggerGroup          = "group"
)

// MemberAsset is the real member row a runbook boots: a protected site bound
// into the group with a boot order and its primary endpoint, plus the network
// profile that applies to it (from the group's network mappings).
type MemberAsset struct {
	SiteID          string `json:"site_id"`
	SiteName        string `json:"site_name"`
	SiteKind        string `json:"site_kind"`
	PrimaryEndpoint string `json:"primary_endpoint"`
	BootOrder       int    `json:"boot_order"`
	// NetworkProfile is the mapping profile the recovery executor would use for
	// this member ("production" for a real failover, "isolated" for a drill). The
	// runbook records both the active profile and the remap CIDRs.
	NetworkProfile string `json:"network_profile"`
	PrimaryCIDR    string `json:"primary_cidr,omitempty"`
	RecoveryCIDR   string `json:"recovery_cidr,omitempty"`
}

// RecoveryPointAsset is the latest validated recovery point pinned at Gate 1.
type RecoveryPointAsset struct {
	ID              string  `json:"id"`
	MarkerLSN       string  `json:"marker_lsn"`
	RPOSeconds      int     `json:"rpo_seconds"`
	ValidationRatio float64 `json:"validation_ratio"`
	IsValidated     bool    `json:"is_validated"`
	LegalHold       bool    `json:"legal_hold"`
	SealedAt        string  `json:"sealed_at"`
}

// AssetSnapshot is the deterministic set of real assets a runbook version was
// materialized from. Persisting it makes each version auditable and lets a diff
// be recomputed without re-reading the (possibly since-changed) database.
type AssetSnapshot struct {
	GroupID             string              `json:"group_id"`
	GroupName           string              `json:"group_name"`
	RTOObjectiveSeconds int                 `json:"rto_objective_seconds"`
	RPOObjectiveSeconds int                 `json:"rpo_objective_seconds"`
	NetworkProfile      string              `json:"network_profile"`
	Members             []MemberAsset       `json:"members"`
	RecoveryPoint       *RecoveryPointAsset `json:"recovery_point,omitempty"`
	CapturedAt          time.Time           `json:"captured_at"`
}

// RunbookStep is one ordered, structured action in a recovery runbook. The
// stable Key is what the diff compares on (so a boot step keeps its identity
// across regenerations even when its order index changes), while Order is the
// 1-based position used to detect a reorder.
type RunbookStep struct {
	// Key is the step's stable identity across versions, e.g. "pin_recovery_point"
	// or "boot_member:<site_id>". The diff keys on this, not on Order.
	Key string `json:"key"`
	// Order is the 1-based position in the runbook.
	Order int `json:"order"`
	// Kind is one of the StepKind* constants.
	Kind string `json:"kind"`
	// Gate is the §6 gate this step belongs to ("gate1".."gate4" or "" for
	// non-gated steps), so the runbook reads against the real failover sequence.
	Gate string `json:"gate,omitempty"`
	// Title is a human-readable one-line summary.
	Title string `json:"title"`
	// Description spells out the action, bound to the real asset values.
	Description string `json:"description"`
	// Params carries the structured, machine-actionable parameters (site_id,
	// boot_order, network_profile, recovery_point_id, objective seconds, ...).
	Params map[string]any `json:"params,omitempty"`
}

// Runbook is the current runbook for a consistency group (the registry index
// row). The materialized steps live on the latest RunbookVersion.
type Runbook struct {
	ID             string    `json:"id"`
	TenantID       string    `json:"tenant_id"`
	GroupID        string    `json:"group_id"`
	CurrentVersion int       `json:"current_version"`
	TemplateID     string    `json:"template_id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// RunbookVersion is one immutable, append-only version of a runbook: the fully
// materialized ordered steps, the asset snapshot they were generated from, a
// content hash, and the step-level diff from the immediately prior version.
type RunbookVersion struct {
	ID            string        `json:"id"`
	RunbookID     string        `json:"runbook_id"`
	TenantID      string        `json:"tenant_id"`
	GroupID       string        `json:"group_id"`
	Version       int           `json:"version"`
	TemplateID    string        `json:"template_id"`
	Steps         []RunbookStep `json:"steps"`
	AssetSnapshot AssetSnapshot `json:"asset_snapshot"`
	ContentHash   string        `json:"content_hash"`
	// Diff is nil for version 1 (nothing to diff against).
	Diff      *RunbookDiff `json:"diff,omitempty"`
	Trigger   string       `json:"trigger"`
	CreatedAt time.Time    `json:"created_at"`
}

// RunbookDiff is the real step-level difference between two consecutive runbook
// versions: which step keys were added, which were removed, and which kept their
// identity but moved position (reordered). It is computed by keying on
// RunbookStep.Key and comparing both presence and order/content.
type RunbookDiff struct {
	Added     []string        `json:"added"`
	Removed   []string        `json:"removed"`
	Reordered []ReorderedStep `json:"reordered"`
	// Changed lists step keys whose content (title/description/params) changed
	// while keeping their position — e.g. a recovery point re-pinned to a newer
	// validated point at the same order index.
	Changed []string `json:"changed"`
}

// IsEmpty reports whether the diff records no change at all (the two versions
// are step-identical). The reconcile path uses this to avoid storing a no-op
// version.
func (d RunbookDiff) IsEmpty() bool {
	return len(d.Added) == 0 && len(d.Removed) == 0 && len(d.Reordered) == 0 && len(d.Changed) == 0
}

// ReorderedStep records a step that moved position between versions.
type ReorderedStep struct {
	Key     string `json:"key"`
	FromPos int    `json:"from_pos"`
	ToPos   int    `json:"to_pos"`
}
