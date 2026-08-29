package migrate

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// WaveDependencyGraph returns the wave's move-group / workload dependency graph in
// a react-flow-renderable shape (nodes with id/label/status/type, edges with
// source/target/type). It REUSES the wave critical-path / runbook edge sources
// (workload hard dependencies + move-group sequence) and, for any move group bound
// to a DR consistency/topology group, overlays that group's replication topology
// fetched through the Wave-2 DR Topology bridge — it never builds a second graph
// engine. When the DR engine is unreachable the native dependency graph is still
// returned (the replication overlay for that group is simply omitted), so the
// visualization degrades gracefully rather than failing the whole request.
func (s *Service) WaveDependencyGraph(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*DependencyGraph, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}

	var wave *Wave
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		wave, err = s.store.GetWave(ctx, tx, tenantID, waveID)
		return err
	}); err != nil {
		return nil, err
	}

	// Fetch the DR topology for each move group that is bound to a DR consistency
	// group. Deduplicate by DR group id so the same group is fetched once, then
	// map it back onto every move group that references it. A DR-engine failure is
	// non-fatal: the overlay is dropped for that group and the native graph stands.
	topologies := map[uuid.UUID]*DRTopology{}
	if s.dr != nil {
		byDRGroup := map[uuid.UUID]*DRTopology{}
		for _, g := range wave.MoveGroups {
			if g.DRTopologyGroupID == nil {
				continue
			}
			drGroup := *g.DRTopologyGroupID
			topo, ok := byDRGroup[drGroup]
			if !ok {
				fetched, err := s.dr.GetTopology(ctx, tenantID, drGroup)
				if err != nil {
					if errors.Is(err, ErrDRBridgeUnavailable) {
						// Degrade gracefully: no replication overlay for this group.
						byDRGroup[drGroup] = nil
						continue
					}
					return nil, err
				}
				topo = fetched
				byDRGroup[drGroup] = topo
			}
			if topo != nil {
				topologies[g.ID] = topo
			}
		}
	}

	graph := buildWaveDependencyGraph(*wave, topologies)
	return &graph, nil
}
