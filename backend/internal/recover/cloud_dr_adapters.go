package recover

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/iacdr"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// This file binds the EXISTING dr/* services to the Cloud DR composition seams
// (BootPlanner / EstateReader / WorkloadReader). It is production wiring: it
// composes the public read APIs of bootgraph, vmcapture, iacdr, and the DR
// repository — it adds no recovery logic and reads no canned data.

// estateRepo is the repository surface the estate reader composes. The concrete
// *repository.Repository satisfies it; the interface keeps the reader testable.
type estateRepo interface {
	ListGroups(ctx context.Context, db repository.DBTX, tenantID string) ([]*drmodel.ConsistencyGroup, error)
	ListGroupMembers(ctx context.Context, db repository.DBTX, groupID string) ([]drmodel.ConsistencyGroupMember, error)
	ListSites(ctx context.Context, db repository.DBTX, tenantID string) ([]*drmodel.ProtectedSite, error)
	ListFailoverRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*drmodel.FailoverRun, error)
}

// RepositoryEstateReader is the production EstateReader: it resolves recovery
// scopes, members, sites, and failover-run history from the DR repository, each
// call inside a single read-only tenant transaction (RLS-isolated). It reuses
// the same repository the rest of the DR service reads from — no second source
// of truth.
type RepositoryEstateReader struct {
	pool *pgxpool.Pool
	repo estateRepo
}

// NewRepositoryEstateReader constructs the estate reader over a dr_db pool. A
// nil repo defaults to repository.New().
func NewRepositoryEstateReader(pool *pgxpool.Pool, repo estateRepo) *RepositoryEstateReader {
	if repo == nil {
		repo = repository.New()
	}
	return &RepositoryEstateReader{pool: pool, repo: repo}
}

func (r *RepositoryEstateReader) readTx(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.pool == nil {
		return errors.New("recover cloud-dr: nil estate pool")
	}
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// ListGroups returns the tenant's consistency groups (recovery scopes).
func (r *RepositoryEstateReader) ListGroups(ctx context.Context, tenantID uuid.UUID) ([]drmodel.ConsistencyGroup, error) {
	var out []drmodel.ConsistencyGroup
	err := r.readTx(ctx, tenantID, func(db repository.DBTX) error {
		groups, lerr := r.repo.ListGroups(ctx, db, tenantID.String())
		if lerr != nil {
			return lerr
		}
		out = derefSlice(groups)
		return nil
	})
	return out, err
}

// ListGroupMembers returns one group's member bindings.
func (r *RepositoryEstateReader) ListGroupMembers(ctx context.Context, tenantID uuid.UUID, groupID string) ([]drmodel.ConsistencyGroupMember, error) {
	var out []drmodel.ConsistencyGroupMember
	err := r.readTx(ctx, tenantID, func(db repository.DBTX) error {
		members, lerr := r.repo.ListGroupMembers(ctx, db, groupID)
		if lerr != nil {
			return lerr
		}
		out = members
		return nil
	})
	return out, err
}

// ListSites returns the tenant's protected sites.
func (r *RepositoryEstateReader) ListSites(ctx context.Context, tenantID uuid.UUID) ([]drmodel.ProtectedSite, error) {
	var out []drmodel.ProtectedSite
	err := r.readTx(ctx, tenantID, func(db repository.DBTX) error {
		sites, lerr := r.repo.ListSites(ctx, db, tenantID.String())
		if lerr != nil {
			return lerr
		}
		out = derefSlice(sites)
		return nil
	})
	return out, err
}

// ListFailoverRuns returns the tenant's failover/drill run history.
func (r *RepositoryEstateReader) ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]drmodel.FailoverRun, error) {
	var out []drmodel.FailoverRun
	err := r.readTx(ctx, tenantID, func(db repository.DBTX) error {
		runs, lerr := r.repo.ListFailoverRuns(ctx, db, tenantID.String())
		if lerr != nil {
			return lerr
		}
		out = derefSlice(runs)
		return nil
	})
	return out, err
}

// derefSlice flattens a slice of pointers into a slice of values, dropping nils.
func derefSlice[T any](in []*T) []T {
	out := make([]T, 0, len(in))
	for _, p := range in {
		if p != nil {
			out = append(out, *p)
		}
	}
	return out
}

// vmSourceLister is the vmcapture surface the workload reader composes.
// *vmcapture.Service satisfies it.
type vmSourceLister interface {
	ListSources(ctx context.Context, tenantID uuid.UUID) ([]vmcapture.Source, error)
}

// iacSnapshotLister is the iacdr surface the workload reader composes.
// *iacdr.Service satisfies it.
type iacSnapshotLister interface {
	ListSnapshots(ctx context.Context, tenantID uuid.UUID) ([]iacdr.Snapshot, error)
}

// ServiceWorkloadReader is the production WorkloadReader: it projects vmcapture
// sources and iacdr snapshots into the Cloud-DR-facing summaries, composing the
// services' public list APIs.
type ServiceWorkloadReader struct {
	vm  vmSourceLister
	iac iacSnapshotLister
}

// NewServiceWorkloadReader constructs the workload reader over the vmcapture and
// iacdr services.
func NewServiceWorkloadReader(vm vmSourceLister, iac iacSnapshotLister) *ServiceWorkloadReader {
	return &ServiceWorkloadReader{vm: vm, iac: iac}
}

// ListVMSources projects vmcapture sources into Cloud DR summaries.
func (r *ServiceWorkloadReader) ListVMSources(ctx context.Context, tenantID uuid.UUID) ([]VMSourceSummary, error) {
	sources, err := r.vm.ListSources(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]VMSourceSummary, 0, len(sources))
	for _, s := range sources {
		out = append(out, VMSourceSummary{
			ID:         s.ID,
			Name:       s.Name,
			SourceKind: s.SourceKind,
			Enabled:    s.Enabled,
			EpochCount: s.EpochCount,
			LastRunAt:  s.LastRunAt,
		})
	}
	return out, nil
}

// ListIaCSnapshots projects iacdr snapshots into Cloud DR summaries.
func (r *ServiceWorkloadReader) ListIaCSnapshots(ctx context.Context, tenantID uuid.UUID) ([]IaCSnapshotSummary, error) {
	snaps, err := r.iac.ListSnapshots(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]IaCSnapshotSummary, 0, len(snaps))
	for _, s := range snaps {
		out = append(out, IaCSnapshotSummary{
			ID:            s.ID,
			Name:          s.Name,
			SourceKind:    s.SourceKind,
			Version:       s.Version,
			ResourceCount: s.ResourceCount,
			CreatedAt:     s.CreatedAt,
		})
	}
	return out, nil
}

// Compile-time conformance: the production adapters satisfy the composition
// seams, and the concrete dr/* services satisfy the narrow lister interfaces.
var (
	_ EstateReader      = (*RepositoryEstateReader)(nil)
	_ WorkloadReader    = (*ServiceWorkloadReader)(nil)
	_ estateRepo        = (*repository.Repository)(nil)
	_ vmSourceLister    = (*vmcapture.Service)(nil)
	_ iacSnapshotLister = (*iacdr.Service)(nil)
	// *bootgraph.Manager.GetPlan satisfies BootPlanner; the cmd wiring passes the
	// real Manager directly.
	_ BootPlanner = (*bootgraph.Manager)(nil)
)
