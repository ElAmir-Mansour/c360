package bcm

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// This file defines the REAL evidence the scorer consumes and the narrow source
// interfaces the EvidenceCollector reads it through. The interfaces are the
// boundary the integrate phase wires to the live stores (drillsched results,
// attest attestations, the recovery-point store, the failover-run store, and the
// clean-room engine). Each source returns plain value types — no DB handles
// cross the boundary — so the collector and scorer are pure and unit-testable
// with synthetic evidence.
//
// Naming the sources narrowly (one method each) keeps this package decoupled
// from the concrete stores: a store satisfies a source by exposing exactly the
// one read the collector needs.

// DrillEvidence is one DR drill (a non-disruptive failover rehearsal) result,
// normalised from drillsched.DrillResult. Passed is the drill's overall verdict;
// RTOActual/RTOObjective drive the RTO-met check; ExecutedAt drives recency.
type DrillEvidence struct {
	ID                  uuid.UUID `json:"id"`
	GroupID             uuid.UUID `json:"group_id"`
	Passed              bool      `json:"passed"`
	RTOActualSeconds    int       `json:"rto_actual_seconds"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds"`
	RPOSeconds          int       `json:"rpo_seconds"`
	ExecutedAt          time.Time `json:"executed_at"`
}

// FailoverEvidence is one completed failover or drill run, normalised from the
// failover_run table. Completed runs only (an in-flight run carries no actual).
type FailoverEvidence struct {
	ID                  uuid.UUID `json:"id"`
	GroupID             uuid.UUID `json:"group_id"`
	Mode                string    `json:"mode"` // real | drill
	Status              string    `json:"status"`
	RTOActualSeconds    int       `json:"rto_actual_seconds"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds"`
	CompletedAt         time.Time `json:"completed_at"`
}

// RecoveryPointEvidence is one immutable recovery point, normalised from the
// recovery_point table plus its WORM object-lock state. Immutable is true when
// the sealed objects are under object-lock with RetentionUntil in the future.
type RecoveryPointEvidence struct {
	ID              uuid.UUID `json:"id"`
	GroupID         uuid.UUID `json:"group_id"`
	RPOSeconds      int       `json:"rpo_seconds"`
	ValidationRatio float64   `json:"validation_ratio"`
	IsValidated     bool      `json:"is_validated"`
	Immutable       bool      `json:"immutable"`
	SealedAt        time.Time `json:"sealed_at"`
	RetentionUntil  time.Time `json:"retention_until"`
}

// AttestationEvidence is one immutable Gate-4 attestation, normalised from the
// attestation table. Its mere existence (within window) is the evidence.
type AttestationEvidence struct {
	ID                  uuid.UUID `json:"id"`
	GroupID             uuid.UUID `json:"group_id"`
	RunID               uuid.UUID `json:"run_id"`
	RTOObjectiveSeconds int       `json:"rto_objective_seconds"`
	RTOActualSeconds    int       `json:"rto_actual_seconds"`
	RPOSeconds          int       `json:"rpo_seconds"`
	ValidationRatio     float64   `json:"validation_ratio"`
	CreatedAt           time.Time `json:"created_at"`
}

// CleanRoomEvidence is one clean-room scan verdict, normalised from the
// cleanroom engine. Clean is true only for the "clean" verdict.
type CleanRoomEvidence struct {
	ID         uuid.UUID `json:"id"`
	GroupID    uuid.UUID `json:"group_id"`
	Verdict    string    `json:"verdict"`
	Clean      bool      `json:"clean"`
	VerifiedAt time.Time `json:"verified_at"`
}

// GroupTopology is the structural fact: the consistency group's member-site
// count and whether a replication stream exists. Exists is false when no group
// of the requested id is found in the tenant's scope.
type GroupTopology struct {
	GroupID     uuid.UUID `json:"group_id"`
	Name        string    `json:"name"`
	Exists      bool      `json:"exists"`
	MemberCount int       `json:"member_count"`
	HasStream   bool      `json:"has_stream"`
}

// ---------------------------------------------------------------------------
// Source interfaces — the integrate phase wires these to the live stores. Each
// returns evidence for one consistency group within the caller's tenant scope.
// The collector passes the DBTX through so every read runs under the tenant
// transaction (RLS backstop); a source is free to ignore it for non-DB origins.
// ---------------------------------------------------------------------------

// DrillSource yields drill results for a group (newest first preferred, but the
// collector does not rely on ordering — the scorer sorts).
type DrillSource interface {
	DrillEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]DrillEvidence, error)
}

// FailoverSource yields completed failover/drill runs for a group.
type FailoverSource interface {
	FailoverEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]FailoverEvidence, error)
}

// RecoveryPointSource yields recovery points for a group.
type RecoveryPointSource interface {
	RecoveryPointEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]RecoveryPointEvidence, error)
}

// AttestationSource yields attestations for a group.
type AttestationSource interface {
	AttestationEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]AttestationEvidence, error)
}

// CleanRoomSource yields clean-room verdicts for a group.
type CleanRoomSource interface {
	CleanRoomEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]CleanRoomEvidence, error)
}

// TopologySource yields the group's structural topology.
type TopologySource interface {
	GroupTopology(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (GroupTopology, error)
}

// Sources bundles every evidence source. Integrate constructs it with the live
// store-backed implementations; tests construct it with in-memory fakes. Any
// field may be nil — the collector treats a nil source as "no evidence of that
// kind", which (per the scorer) fails any control requiring it rather than
// vacuously passing.
type Sources struct {
	Drills         DrillSource
	Failovers      FailoverSource
	RecoveryPoints RecoveryPointSource
	Attestations   AttestationSource
	CleanRoom      CleanRoomSource
	Topology       TopologySource
}

// Evidence is the normalised bundle the scorer evaluates. Each slice/field holds
// the real platform data the collector gathered for one group. The collector
// records which kinds were actually queryable (a nil source => absent) so the
// gap analysis can distinguish "no evidence collected for this kind" from "data
// queried, none qualified".
type Evidence struct {
	GroupID        uuid.UUID
	Drills         []DrillEvidence
	Failovers      []FailoverEvidence
	RecoveryPoints []RecoveryPointEvidence
	Attestations   []AttestationEvidence
	CleanRoom      []CleanRoomEvidence
	Topology       GroupTopology

	// available reports, per evidence kind, whether a source was wired and read
	// without error. A control whose required evidence is unavailable is reported
	// as failed with an explicit "evidence source unavailable" gap reason.
	available map[EvidenceKind]bool
}

// Available reports whether evidence of kind was collectable (source wired and
// read succeeded). Used by the scorer to phrase gap reasons precisely.
func (e *Evidence) Available(kind EvidenceKind) bool {
	return e != nil && e.available != nil && e.available[kind]
}

// EvidenceCollector reads real DR data through the Sources and assembles an
// Evidence bundle for a group. It is stateless beyond the sources, so it is safe
// to share and reuse across assessments.
type EvidenceCollector struct {
	sources Sources
}

// NewEvidenceCollector constructs a collector over the given sources.
func NewEvidenceCollector(sources Sources) *EvidenceCollector {
	return &EvidenceCollector{sources: sources}
}

// Collect gathers evidence for one group. It queries every wired source; a nil
// source leaves that kind absent (and unavailable). A source error aborts the
// whole collection with a wrapped error — partial evidence would silently skew
// the score, so collection is all-or-nothing per wired source. The returned
// bundle's Topology is always populated (defaulting to a non-existent group when
// no TopologySource is wired) so a group-configured rule can fail cleanly.
func (c *EvidenceCollector) Collect(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (*Evidence, error) {
	ev := &Evidence{
		GroupID:   groupID,
		Topology:  GroupTopology{GroupID: groupID, Exists: false},
		available: make(map[EvidenceKind]bool, 6),
	}

	if c.sources.Drills != nil {
		items, err := c.sources.Drills.DrillEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect drill evidence: %w", err)
		}
		ev.Drills = items
		ev.available[EvidenceDrill] = true
	}
	if c.sources.Failovers != nil {
		items, err := c.sources.Failovers.FailoverEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect failover evidence: %w", err)
		}
		ev.Failovers = items
		ev.available[EvidenceFailover] = true
	}
	if c.sources.RecoveryPoints != nil {
		items, err := c.sources.RecoveryPoints.RecoveryPointEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect recovery-point evidence: %w", err)
		}
		ev.RecoveryPoints = items
		ev.available[EvidenceRecoveryPoint] = true
	}
	if c.sources.Attestations != nil {
		items, err := c.sources.Attestations.AttestationEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect attestation evidence: %w", err)
		}
		ev.Attestations = items
		ev.available[EvidenceAttestation] = true
	}
	if c.sources.CleanRoom != nil {
		items, err := c.sources.CleanRoom.CleanRoomEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect clean-room evidence: %w", err)
		}
		ev.CleanRoom = items
		ev.available[EvidenceCleanRoom] = true
	}
	if c.sources.Topology != nil {
		topo, err := c.sources.Topology.GroupTopology(ctx, db, tenantID, groupID)
		if err != nil {
			return nil, fmt.Errorf("collect group topology: %w", err)
		}
		ev.Topology = topo
		ev.available[EvidenceGroupTopology] = true
	}

	return ev, nil
}
