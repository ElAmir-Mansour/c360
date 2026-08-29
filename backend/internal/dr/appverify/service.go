package appverify

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// QueryService is the read-path facade over persisted app-verification results.
// It runs every read under a tenant transaction (RLS backstop) so a caller only
// ever sees its own tenant's results.
type QueryService struct {
	store  *Store
	runner txRunner
}

// NewQueryService constructs a read service over the store and tenant runner.
func NewQueryService(store *Store, runner txRunner) *QueryService {
	return &QueryService{store: store, runner: runner}
}

// ListByGroup returns the most recent app-verification results for a group.
func (q *QueryService) ListByGroup(ctx context.Context, tenantID, groupID uuid.UUID, limit int) ([]StoredResult, error) {
	var out []StoredResult
	err := q.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var lerr error
		out, lerr = q.store.ListByGroup(ctx, db, groupID, limit)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetByID returns one app-verification result by id, or ErrResultNotFound.
func (q *QueryService) GetByID(ctx context.Context, tenantID, id uuid.UUID) (*StoredResult, error) {
	var rec *StoredResult
	err := q.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var gerr error
		rec, gerr = q.store.GetByID(ctx, db, id)
		return gerr
	})
	if err != nil {
		if errors.Is(err, ErrResultNotFound) {
			return nil, ErrResultNotFound
		}
		return nil, err
	}
	return rec, nil
}
