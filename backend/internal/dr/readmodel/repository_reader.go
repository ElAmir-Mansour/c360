package readmodel

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// RepositoryStore is the repository surface required by the readmodel adapter.
// *repository.Repository satisfies this interface.
type RepositoryStore interface {
	ListSites(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ProtectedSite, error)
	GetGroup(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ConsistencyGroup, error)
	ListGroups(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ConsistencyGroup, error)
	ListGroupMembers(ctx context.Context, db repository.DBTX, groupID string) ([]model.ConsistencyGroupMember, error)
	ListStreams(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ReplicationStream, error)
	ListRecoveryPointsByGroup(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error)
	ListFailoverRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.FailoverRun, error)
}

// RepositoryReader adapts the DR repository to the readmodel.Reader interface
// using a caller-owned DBTX. Bind it to the transaction passed by TenantReadRunner
// so all reads for a build see the same tenant-scoped snapshot.
type RepositoryReader struct {
	store RepositoryStore
	db    repository.DBTX
}

var _ Reader = (*RepositoryReader)(nil)

// NewRepositoryReader binds store to db for readmodel construction.
func NewRepositoryReader(store RepositoryStore, db repository.DBTX) *RepositoryReader {
	if store == nil {
		store = repository.New()
	}
	return &RepositoryReader{store: store, db: db}
}

// ListSites returns all protected sites for the tenant.
func (r *RepositoryReader) ListSites(ctx context.Context, tenantID uuid.UUID) ([]*model.ProtectedSite, error) {
	return r.store.ListSites(ctx, r.db, tenantID.String())
}

// GetGroup returns one consistency group for the tenant.
func (r *RepositoryReader) GetGroup(ctx context.Context, tenantID, groupID uuid.UUID) (*model.ConsistencyGroup, error) {
	return r.store.GetGroup(ctx, r.db, tenantID.String(), groupID.String())
}

// ListGroups returns all consistency groups for the tenant.
func (r *RepositoryReader) ListGroups(ctx context.Context, tenantID uuid.UUID) ([]*model.ConsistencyGroup, error) {
	return r.store.ListGroups(ctx, r.db, tenantID.String())
}

// ListGroupMembers returns members for a consistency group.
func (r *RepositoryReader) ListGroupMembers(ctx context.Context, _ uuid.UUID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error) {
	return r.store.ListGroupMembers(ctx, r.db, groupID.String())
}

// ListStreams returns all replication streams for the tenant.
func (r *RepositoryReader) ListStreams(ctx context.Context, tenantID uuid.UUID) ([]*model.ReplicationStream, error) {
	return r.store.ListStreams(ctx, r.db, tenantID.String())
}

// ListRecoveryPoints returns a group's recovery points for the tenant.
func (r *RepositoryReader) ListRecoveryPoints(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.RecoveryPoint, error) {
	return r.store.ListRecoveryPointsByGroup(ctx, r.db, tenantID.String(), groupID.String())
}

// ListFailoverRuns returns all failover and drill runs for the tenant.
func (r *RepositoryReader) ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]*model.FailoverRun, error) {
	return r.store.ListFailoverRuns(ctx, r.db, tenantID.String())
}
