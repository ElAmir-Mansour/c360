package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/failover"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/topology"
)

type fakeGateValidator struct {
	decision failover.RecoveryPointDecision
	err      error
}

func (f fakeGateValidator) ValidateRecoveryPoint(context.Context, *model.FailoverRun) (failover.RecoveryPointDecision, error) {
	return f.decision, f.err
}

type fakeTopologyRunner struct{}

func (fakeTopologyRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

type fakeTopologyStore struct {
	topo topology.Topology
	err  error
}

func (f fakeTopologyStore) LoadTopology(context.Context, repository.DBTX, string) (topology.Topology, error) {
	return f.topo, f.err
}

func TestTopologyAwareGateValidator_FailsOpenWhenTopologyAbsent(t *testing.T) {
	base := fakeGateValidator{decision: passingDecision()}
	v := topologyAwareGateValidator{
		base:   base,
		runner: fakeTopologyRunner{},
		store:  fakeTopologyStore{err: topology.ErrGroupNotFound},
		now:    fixedTopologyNow,
	}

	decision, err := v.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{GroupID: "group-1"})
	require.NoError(t, err)
	require.True(t, decision.Passed())
	require.Equal(t, false, decision.Details["topology_defined"])
}

func TestTopologyAwareGateValidator_RecordsSelectedTarget(t *testing.T) {
	lag := int64(2)
	base := fakeGateValidator{decision: passingDecision()}
	v := topologyAwareGateValidator{
		base:   base,
		runner: fakeTopologyRunner{},
		store: fakeTopologyStore{topo: topology.Topology{
			GroupID: "group-1",
			Nodes: []topology.Node{
				{ID: "n-source", GroupID: "group-1", SiteID: "site-source", Role: topology.RoleSource},
				{ID: "n-target", GroupID: "group-1", SiteID: "site-target", SiteName: "target", Role: topology.RoleTarget},
			},
			Edges: []topology.Edge{
				{ID: "edge-1", GroupID: "group-1", FromNodeID: "n-source", ToNodeID: "n-target", StreamID: "stream-1", Mode: topology.ModeAsync, Priority: 1, Health: topology.HealthHealthy, LagSeconds: &lag, AppliedSeq: 100},
			},
		}},
		now: fixedTopologyNow,
	}

	decision, err := v.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{GroupID: "group-1"})
	require.NoError(t, err)
	require.True(t, decision.Passed())
	require.Equal(t, true, decision.Details["topology_defined"])
	require.Equal(t, "site-target", decision.Details["topology_selected_site_id"])
	require.Equal(t, "stream-1", decision.Details["topology_selected_stream_id"])
	require.NotEmpty(t, decision.Details["topology_ranking"])
}

func TestTopologyAwareGateValidator_BlocksWhenDefinedTopologyHasNoEligibleTarget(t *testing.T) {
	base := fakeGateValidator{decision: passingDecision()}
	v := topologyAwareGateValidator{
		base:   base,
		runner: fakeTopologyRunner{},
		store: fakeTopologyStore{topo: topology.Topology{
			GroupID: "group-1",
			Nodes: []topology.Node{
				{ID: "n-source", GroupID: "group-1", SiteID: "site-source", Role: topology.RoleSource},
				{ID: "n-target", GroupID: "group-1", SiteID: "site-target", Role: topology.RoleTarget},
			},
			Edges: []topology.Edge{
				{ID: "edge-1", GroupID: "group-1", FromNodeID: "n-source", ToNodeID: "n-target", StreamID: "stream-1", Mode: topology.ModeAsync, Priority: 1, Health: topology.HealthUnknown},
			},
		}},
		now: fixedTopologyNow,
	}

	decision, err := v.ValidateRecoveryPoint(context.Background(), &model.FailoverRun{GroupID: "group-1"})
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrInvalidState))
	require.Equal(t, true, decision.Details["topology_defined"])
	require.Nil(t, decision.Details["topology_selected_site_id"])
}

func passingDecision() failover.RecoveryPointDecision {
	return failover.RecoveryPointDecision{
		RecoveryPointID: "rp-1",
		RPOSeconds:      5,
		ValidationRatio: 1,
		Details:         map[string]any{"base": "ok"},
	}
}

func fixedTopologyNow() time.Time {
	return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
}
