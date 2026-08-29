package repository

import (
	"context"
	"time"

	"github.com/clario360/platform/internal/dr/model"
)

// CheckpointStore adapts the ClarioDR Repository to the
// datastream/core.StreamCheckpointStore contract so the replication core's
// DB-backed Checkpointer (core.NewDBCheckpointer) can persist the RPO ledger
// without importing any DR-specific type. It binds a single tenant + a single
// execution context (a pool for the streaming hot path, or an open tx when a
// checkpoint must commit atomically with other DR state) so the core sees the
// minimal Update/Load pair keyed only by the stream's replication_stream.id.
//
// This adapter lives in the repository package (not core) so the dependency
// arrow points DR -> core, never core -> DR (§13).
type CheckpointStore struct {
	repo     *Repository
	db       DBTX
	tenantID string
}

// NewCheckpointStore binds the repository to a tenant and an execution context.
// db is typically the service's *pgxpool.Pool (the streaming checkpoint is a
// fast standalone UPDATE) but may be an open pgx.Tx when a checkpoint advance
// must commit with surrounding DR state.
func NewCheckpointStore(repo *Repository, db DBTX, tenantID string) *CheckpointStore {
	return &CheckpointStore{repo: repo, db: db, tenantID: tenantID}
}

// UpdateStreamCheckpoint advances the replication_stream RPO ledger
// (applied_seq, source_lsn, applied_at, status) for the bound tenant.
func (s *CheckpointStore) UpdateStreamCheckpoint(ctx context.Context, id string, appliedSeq int64, sourceLSN string, appliedAt time.Time, status string) error {
	if status == "" {
		status = model.StreamStatusStreaming
	}
	return s.repo.UpdateStreamCheckpoint(ctx, s.db, s.tenantID, id, appliedSeq, sourceLSN, appliedAt, status)
}

// LoadStreamCheckpoint reads the persisted ledger position for the stream so a
// restart resumes from exactly the last contiguous applied Seq. A NULL
// source_lsn maps to "" and a NULL applied_at to the zero time.
func (s *CheckpointStore) LoadStreamCheckpoint(ctx context.Context, id string) (appliedSeq int64, sourceLSN string, appliedAt time.Time, err error) {
	stream, err := s.repo.GetStream(ctx, s.db, s.tenantID, id)
	if err != nil {
		return 0, "", time.Time{}, err
	}
	if stream.SourceLSN != nil {
		sourceLSN = *stream.SourceLSN
	}
	if stream.AppliedAt != nil {
		appliedAt = *stream.AppliedAt
	}
	return stream.AppliedSeq, sourceLSN, appliedAt, nil
}
