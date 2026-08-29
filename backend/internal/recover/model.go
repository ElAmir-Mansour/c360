// Package recover is the productization layer that turns the existing dr/*
// modules into a discoverable "Recover" product with three named sub-solutions
// (IT Disaster Recovery, Cloud Disaster Recovery, Cyber Recovery), real
// per-tenant entitlement gating, and a capability registry that maps each
// sub-solution to the dr/* services it composes.
//
// This package COMPOSES the existing DR capabilities — it does not move, fork,
// or reimplement any dr/* service logic. Entitlement decisions are resolved by
// the existing licensing engine (internal/license + internal/gateway/
// entitlement); this package never builds a second entitlement system and never
// returns a hardcoded "all enabled".
package recover

import "github.com/clario360/platform/internal/license/model"

// Product is the stable identifier of the Recover product.
const Product = "recover"

// ProductLabel is the human-facing product name.
const ProductLabel = "Clario Recover"

// Sub-solution identifiers. These are the URL/registry slugs every other prompt
// (navigation, routing, analytics, onboarding) keys off; keep them stable.
const (
	SubSolutionITDR          = "it-dr"
	SubSolutionCloudDR       = "cloud-dr"
	SubSolutionCyberRecovery = "cyber-recovery"
)

// Entitlement keys for each sub-solution. These alias the canonical keys in the
// licensing model package (the single source of truth) so the resolver and the
// gateway agree on exactly the same strings.
const (
	EntitlementITDR          = model.RecoverITDRKey
	EntitlementCloudDR       = model.RecoverCloudDRKey
	EntitlementCyberRecovery = model.RecoverCyberRecoveryKey
)

// EntitlementState is the resolved per-tenant licensing state of one
// sub-solution. Active is true only when the licensing engine grants the key
// for the tenant; Reason carries the denial reason when it is not. Activated
// reflects whether the tenant has explicitly turned the sub-solution on (the
// onboarding selection persisted by this package) — a sub-solution can be
// entitled-but-not-yet-activated (visible to enable) or activated.
type EntitlementState struct {
	Key       string `json:"key"`
	Active    bool   `json:"active"`
	Activated bool   `json:"activated"`
	Reason    string `json:"reason,omitempty"`
}

// Capability is one dr/* service composed by a sub-solution. ID is the dr/*
// package/service name (e.g. "runbookstudio"); these are services that are
// actually wired into clario-dr-service, never aspirational names.
type Capability struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	// Service is the Go package path of the composed dr/* service, for traceability.
	Service string `json:"service"`
}

// SubSolution is one named recovery sub-solution: its slug, label, value
// proposition, entitlement key, the dr/* capabilities it composes, and (when
// resolved for a tenant) its live entitlement state.
type SubSolution struct {
	ID             string            `json:"id"`
	Label          string            `json:"label"`
	ValueProp      string            `json:"value_prop"`
	EntitlementKey string            `json:"entitlement_key"`
	Capabilities   []Capability      `json:"capabilities"`
	Entitlement    *EntitlementState `json:"entitlement,omitempty"`
}

// ProductView is the full GET /api/recover/products payload: the product
// identity plus each sub-solution with its resolved entitlement state and the
// underlying capabilities it composes.
type ProductView struct {
	Product      string        `json:"product"`
	Label        string        `json:"label"`
	SubSolutions []SubSolution `json:"sub_solutions"`
}

// capabilityRegistry is the immutable mapping of each sub-solution to the dr/*
// services it composes. It is package-level reference data (not tenant state),
// built once from the wired DR services; the registry reflects services that
// are actually mounted in clario-dr-service, not aspirational ones. It is never
// mutated at runtime and is never used as a source of truth for tenant data.
var capabilityRegistry = []SubSolution{
	{
		ID:             SubSolutionITDR,
		Label:          "IT Disaster Recovery",
		ValueProp:      "Author and execute dynamic recovery runbooks — editable live during an event — across your on-prem estate with dependency-aware sequencing, rehearsals, and regulator-grade evidence.",
		EntitlementKey: EntitlementITDR,
		Capabilities: []Capability{
			{ID: "runbookstudio", Label: "Runbook Studio", Description: "Editable recovery runbooks that sequence human and machine tasks, editable mid-event.", Service: "github.com/clario360/platform/internal/dr/runbookstudio"},
			{ID: "registry", Label: "Recovery Asset Registry", Description: "Generate recovery runbooks from application metadata; version history and drift detection.", Service: "github.com/clario360/platform/internal/dr/registry"},
			{ID: "topology", Label: "Replication Topology", Description: "Multi-site replication DAG with cycle-free enforcement and live-health failover-target selection.", Service: "github.com/clario360/platform/internal/dr/topology"},
			{ID: "recoverytier", Label: "Readiness Tiers", Description: "Recovery-tier classification and readiness scoring from real protected-estate state.", Service: "github.com/clario360/platform/internal/dr/recoverytier"},
			{ID: "drillsched", Label: "Drill Scheduler", Description: "Cron-based DR drills with RTA/RTO capture and drift diff versus the previous run.", Service: "github.com/clario360/platform/internal/dr/drillsched"},
			{ID: "attestledger", Label: "Attestation Ledger", Description: "Immutable, tamper-evident audit of every recovery and drill verdict, NCA-ready.", Service: "github.com/clario360/platform/internal/dr/attestledger"},
		},
	},
	{
		ID:             SubSolutionCloudDR,
		Label:          "Cloud Disaster Recovery",
		ValueProp:      "Multi-cloud and hybrid recovery: capture workloads, drive infrastructure-as-code DR, and execute region/AZ failover with real dependency-aware boot-graph sequencing and failback.",
		EntitlementKey: EntitlementCloudDR,
		Capabilities: []Capability{
			{ID: "iacdr", Label: "Infrastructure-as-Code DR", Description: "Terraform/Ansible playbook versioning, diff, and apply for cloud recovery.", Service: "github.com/clario360/platform/internal/dr/iacdr"},
			{ID: "vmcapture", Label: "VM Capture", Description: "Hypervisor workload snapshots (vSphere/Hyper-V/XenServer).", Service: "github.com/clario360/platform/internal/dr/vmcapture"},
			{ID: "bootgraph", Label: "Boot Graph", Description: "Dependency-aware boot sequencing: tiered DAG with health gates, executed tier-by-tier.", Service: "github.com/clario360/platform/internal/dr/bootgraph"},
			{ID: "appverify", Label: "Application Verification", Description: "Post-recovery application verification results across the recovered estate.", Service: "github.com/clario360/platform/internal/dr/appverify"},
			{ID: "failback", Label: "Failback", Description: "Reverse replication and re-cutover to production after a DR event.", Service: "github.com/clario360/platform/internal/dr/failback"},
		},
	},
	{
		ID:             SubSolutionCyberRecovery,
		Label:          "Cyber Recovery",
		ValueProp:      "Recover to clean/bare-metal targets from last-known-good clean points, with a mandatory integrity-check gate that blocks any return to the production network until checks pass.",
		EntitlementKey: EntitlementCyberRecovery,
		Capabilities: []Capability{
			{ID: "cleanroom", Label: "Clean Room", Description: "Restore-and-hash integrity gate that blocks return-to-production until a recovery point passes.", Service: "github.com/clario360/platform/internal/dr/cleanroom"},
			{ID: "cybervault", Label: "Cyber Vault", Description: "Cyber-posture registration, sync planning, and recovery-point evaluation against sealed clean points.", Service: "github.com/clario360/platform/internal/dr/cybervault"},
			{ID: "ransomware", Label: "Ransomware Detection", Description: "Real-time behavioral analysis (entropy/deletion-rate) folded into the frame apply path.", Service: "github.com/clario360/platform/internal/dr/ransomware"},
			{ID: "instant", Label: "Instant Recovery", Description: "Bare-metal boot from clean recovery points: stage mounts, finalize after the health gate.", Service: "github.com/clario360/platform/internal/dr/instant"},
			{ID: "attestledger", Label: "Immutable Proof", Description: "Tamper-evident proof of clean-room verdicts and approvals for return-to-production.", Service: "github.com/clario360/platform/internal/dr/attestledger"},
		},
	},
}

// Registry returns a deep copy of the capability registry: each sub-solution
// with its composed dr/* capabilities and no tenant-specific entitlement state.
// Returning a copy keeps the package-level reference data immutable against
// callers that decorate it with per-tenant state.
func Registry() []SubSolution {
	out := make([]SubSolution, len(capabilityRegistry))
	for i, ss := range capabilityRegistry {
		caps := make([]Capability, len(ss.Capabilities))
		copy(caps, ss.Capabilities)
		out[i] = SubSolution{
			ID:             ss.ID,
			Label:          ss.Label,
			ValueProp:      ss.ValueProp,
			EntitlementKey: ss.EntitlementKey,
			Capabilities:   caps,
		}
	}
	return out
}

// SubSolutionIDs returns the stable slugs of the three sub-solutions in
// registry order.
func SubSolutionIDs() []string {
	ids := make([]string, len(capabilityRegistry))
	for i, ss := range capabilityRegistry {
		ids[i] = ss.ID
	}
	return ids
}

// entitlementKeyForSubSolution maps a sub-solution slug to its entitlement key,
// returning ("", false) for an unknown slug.
func entitlementKeyForSubSolution(id string) (string, bool) {
	for _, ss := range capabilityRegistry {
		if ss.ID == id {
			return ss.EntitlementKey, true
		}
	}
	return "", false
}
