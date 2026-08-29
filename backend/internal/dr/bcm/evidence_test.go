package bcm

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// stub sources for the collector tests.

type stubDrills struct {
	items []DrillEvidence
	err   error
	calls int
}

func (s *stubDrills) DrillEvidence(_ context.Context, _ DBTX, _, _ uuid.UUID) ([]DrillEvidence, error) {
	s.calls++
	return s.items, s.err
}

type stubTopology struct {
	topo GroupTopology
	err  error
}

func (s *stubTopology) GroupTopology(_ context.Context, _ DBTX, _, _ uuid.UUID) (GroupTopology, error) {
	return s.topo, s.err
}

type stubRP struct {
	items []RecoveryPointEvidence
	err   error
}

func (s *stubRP) RecoveryPointEvidence(_ context.Context, _ DBTX, _, _ uuid.UUID) ([]RecoveryPointEvidence, error) {
	return s.items, s.err
}

// TestCollectAggregatesWiredSources asserts wired sources populate their kind
// and mark it available, while nil sources leave the kind unavailable (the
// scorer then fails any control requiring it).
func TestCollectAggregatesWiredSources(t *testing.T) {
	t.Parallel()
	drill := &stubDrills{items: []DrillEvidence{{ID: uuid.New(), Passed: true}}}
	topo := &stubTopology{topo: GroupTopology{Exists: true, MemberCount: 2, HasStream: true}}

	c := NewEvidenceCollector(Sources{Drills: drill, Topology: topo})
	ev, err := c.Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}

	if !ev.Available(EvidenceDrill) {
		t.Error("drill evidence should be available")
	}
	if len(ev.Drills) != 1 {
		t.Errorf("got %d drills, want 1", len(ev.Drills))
	}
	if drill.calls != 1 {
		t.Errorf("drill source called %d times, want 1", drill.calls)
	}
	if !ev.Available(EvidenceGroupTopology) {
		t.Error("topology should be available")
	}
	if !ev.Topology.Exists {
		t.Error("topology should report group exists")
	}
	// Unwired kinds must be unavailable.
	if ev.Available(EvidenceFailover) || ev.Available(EvidenceRecoveryPoint) ||
		ev.Available(EvidenceAttestation) || ev.Available(EvidenceCleanRoom) {
		t.Error("unwired sources must leave their kinds unavailable")
	}
}

// TestCollectDefaultTopologyWhenUnwired asserts that with no TopologySource the
// bundle still carries a non-existent group topology (so a group-configured rule
// fails cleanly rather than nil-panicking).
func TestCollectDefaultTopologyWhenUnwired(t *testing.T) {
	t.Parallel()
	c := NewEvidenceCollector(Sources{})
	groupID := uuid.New()
	ev, err := c.Collect(context.Background(), nil, uuid.New(), groupID)
	if err != nil {
		t.Fatalf("Collect: %v", err)
	}
	if ev.Topology.Exists {
		t.Error("default topology must report group does not exist")
	}
	if ev.Topology.GroupID != groupID {
		t.Errorf("default topology group = %s, want %s", ev.Topology.GroupID, groupID)
	}
	if ev.Available(EvidenceGroupTopology) {
		t.Error("topology must be unavailable when no source is wired")
	}
}

// TestCollectPropagatesSourceError asserts a source error aborts collection with
// a wrapped error (partial evidence would skew the score).
func TestCollectPropagatesSourceError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db down")
	c := NewEvidenceCollector(Sources{RecoveryPoints: &stubRP{err: sentinel}})
	_, err := c.Collect(context.Background(), nil, uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected error from failing source")
	}
	if !errors.Is(err, sentinel) {
		t.Errorf("error %v does not wrap sentinel", err)
	}
}

// TestAvailableNilSafe asserts Available is safe on a nil/zero Evidence.
func TestAvailableNilSafe(t *testing.T) {
	t.Parallel()
	var ev *Evidence
	if ev.Available(EvidenceDrill) {
		t.Error("nil Evidence.Available must be false")
	}
	if (&Evidence{}).Available(EvidenceDrill) {
		t.Error("zero Evidence.Available must be false")
	}
}
