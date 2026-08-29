package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/dr/failover"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/topology"
)

type topologyStore interface {
	LoadTopology(ctx context.Context, db repository.DBTX, groupID string) (topology.Topology, error)
}

type topologySystemReader interface {
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

type topologyAwareGateValidator struct {
	base   failover.GateValidator
	runner topologySystemReader
	store  topologyStore
	now    func() time.Time
}

func newTopologyAwareGateValidator(base failover.GateValidator, runner topologySystemReader, store topologyStore) failover.GateValidator {
	return topologyAwareGateValidator{
		base:   base,
		runner: runner,
		store:  store,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (v topologyAwareGateValidator) ValidateRecoveryPoint(ctx context.Context, run *model.FailoverRun) (failover.RecoveryPointDecision, error) {
	decision, err := v.base.ValidateRecoveryPoint(ctx, run)
	if err != nil {
		return decision, err
	}
	if v.runner == nil || v.store == nil || run == nil {
		return decision, nil
	}
	if decision.Details == nil {
		decision.Details = map[string]any{}
	}

	var topo topology.Topology
	if err := v.runner.RunSystemRead(ctx, func(db repository.DBTX) error {
		var lerr error
		topo, lerr = v.store.LoadTopology(ctx, db, run.GroupID)
		return lerr
	}); err != nil {
		if errors.Is(err, topology.ErrGroupNotFound) {
			decision.Details["topology_defined"] = false
			return decision, nil
		}
		return decision, fmt.Errorf("topology failover selection: %w", err)
	}
	if len(topo.Nodes) == 0 {
		decision.Details["topology_defined"] = false
		return decision, nil
	}

	selection := topology.NewGraph(topo).SelectFailoverTarget(v.now())
	decision.Details["topology_defined"] = true
	decision.Details["topology_evaluated_at"] = selection.EvaluatedAt
	decision.Details["topology_ranking"] = selection.Ranking
	if selection.Selected == nil {
		return decision, fmt.Errorf("topology has no eligible failover target for group %s: %w", run.GroupID, model.ErrInvalidState)
	}
	decision.Details["topology_selected_node_id"] = selection.Selected.NodeID
	decision.Details["topology_selected_site_id"] = selection.Selected.SiteID
	decision.Details["topology_selected_stream_id"] = selection.Selected.StreamID
	decision.Details["topology_selected_reason"] = selection.Selected.Reason
	return decision, nil
}
