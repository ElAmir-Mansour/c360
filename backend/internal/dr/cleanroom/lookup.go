package cleanroom

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
)

// RecoveryPointReader loads one recovery-point row scoped to the tenant. The DR
// service satisfies it via GetRecoveryPoint, so the integration phase can build a
// RepoLookup from the existing service without this package importing it
// directly (the function-typed seam keeps ownership disjoint).
type RecoveryPointReader func(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error)

// RepoLookup adapts a RecoveryPointReader to the RecoveryPointLookup the service
// needs, projecting the row onto the clean-room-relevant fields (object keys +
// sealed content hash + group). It is the production lookup.
type RepoLookup struct {
	read RecoveryPointReader
}

// NewRepoLookup builds a lookup over a recovery-point reader.
func NewRepoLookup(read RecoveryPointReader) *RepoLookup {
	return &RepoLookup{read: read}
}

// LookupRecoveryPoint loads the recovery point and projects it for the engine.
func (l *RepoLookup) LookupRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (RecoveryPointInfo, error) {
	if l.read == nil {
		return RecoveryPointInfo{}, fmt.Errorf("%w: recovery-point reader", ErrNotConfigured)
	}
	rp, err := l.read(ctx, tenantID, pointID)
	if err != nil {
		return RecoveryPointInfo{}, err
	}
	groupID, err := uuid.Parse(rp.GroupID)
	if err != nil {
		return RecoveryPointInfo{}, fmt.Errorf("recovery point %s has invalid group id %q: %w", pointID, rp.GroupID, err)
	}
	return RecoveryPointInfo{
		ID:          pointID,
		GroupID:     groupID,
		ContentHash: rp.ContentHash,
		ObjectKeys:  rp.ObjectKeys,
	}, nil
}
