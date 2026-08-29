package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Checkpoint persists the RPO ledger for a stream: the last contiguously
// applied Seq plus the source LSN and wall-clock at which it was applied, so a
// restart resumes exactly and live RPO is computable as now - AppliedAt.
type Checkpoint struct {
	StreamID   string
	AppliedSeq uint64
	SourceLSN  string
	AppliedAt  time.Time // wall clock of last apply -> RPO = now - AppliedAt
}

// Checkpointer persists the RPO ledger: per stream, the last applied Seq +
// source LSN + wall-clock, so a restart resumes exactly and RPO is computable.
type Checkpointer interface {
	Save(ctx context.Context, cp Checkpoint) error
	Load(ctx context.Context, streamID string) (Checkpoint, error)
}

// MemoryCheckpointer is an in-memory, concurrency-safe Checkpointer for tests
// and ephemeral use. The durable, DB-backed Checkpointer (writing the
// replication_stream RPO ledger) is delivered separately. Load returns a
// zero-valued Checkpoint (AppliedSeq == 0) for an unknown stream, which the
// orchestrator treats as "resume from scratch".
type MemoryCheckpointer struct {
	mu    sync.RWMutex
	store map[string]Checkpoint
}

// NewMemoryCheckpointer returns an empty in-memory Checkpointer.
func NewMemoryCheckpointer() *MemoryCheckpointer {
	return &MemoryCheckpointer{store: make(map[string]Checkpoint)}
}

// Save records cp for cp.StreamID, overwriting any prior checkpoint.
func (m *MemoryCheckpointer) Save(_ context.Context, cp Checkpoint) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store[cp.StreamID] = cp
	return nil
}

// Load returns the checkpoint for streamID, or a zero-valued Checkpoint (with
// StreamID set) when none exists yet.
func (m *MemoryCheckpointer) Load(_ context.Context, streamID string) (Checkpoint, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if cp, ok := m.store[streamID]; ok {
		return cp, nil
	}
	return Checkpoint{StreamID: streamID}, nil
}

// StreamCheckpointStore is the narrow persistence contract the DB-backed
// Checkpointer needs from the ClarioDR repository. It is declared here so the
// core stays free of any DR-specific import (§13, the build-once dividend):
// internal/dr/repository.Repository satisfies it directly (its
// UpdateStreamCheckpoint + GetStream methods have these signatures with a
// repository.DBTX, which the adapter below binds). The Checkpointer maps a
// core Checkpoint onto the replication_stream RPO ledger (applied_seq,
// source_lsn, applied_at) — the live-RPO source the rpo_monitor reads (§3.1,
// §7).
type StreamCheckpointStore interface {
	// UpdateStreamCheckpoint advances applied_seq/source_lsn/applied_at for the
	// stream row identified by (tenantID, id), setting its status.
	UpdateStreamCheckpoint(ctx context.Context, id string, appliedSeq int64, sourceLSN string, appliedAt time.Time, status string) error
	// LoadStreamCheckpoint returns the persisted ledger position for a stream:
	// the last contiguous applied Seq, the source LSN (empty if NULL) and the
	// wall clock of that apply (zero if never applied).
	LoadStreamCheckpoint(ctx context.Context, id string) (appliedSeq int64, sourceLSN string, appliedAt time.Time, err error)
}

// ErrCheckpointStreamMismatch is returned by DBCheckpointer when asked to
// persist a Checkpoint whose StreamID does not match the stream the
// checkpointer is bound to. A Checkpointer instance is bound to exactly one
// stream so a misrouted checkpoint can never corrupt another stream's ledger.
var ErrCheckpointStreamMismatch = errors.New("core: checkpoint stream id mismatch")

// DBCheckpointer is the durable, production Checkpointer: it persists the RPO
// ledger into replication_stream through a StreamCheckpointStore (the ClarioDR
// repository). One instance is bound to one stream (its replication_stream row
// id) so Save/Load require no cross-stream lookup and a restart resumes exactly
// from the persisted applied_seq.
//
// The stream's status while streaming is reported as model
// "streaming"; the caller may override it via WithStreamStatus (e.g. "seeding"
// during the snapshot phase). On Save the checkpointer never regresses
// applied_seq — a stale or duplicate Save (e.g. a no-op apply after resume) is
// ignored rather than rewinding the ledger.
type DBCheckpointer struct {
	store    StreamCheckpointStore
	streamID string
	status   string

	mu      sync.Mutex
	lastSeq uint64
	loaded  bool
}

// DBCheckpointerOption configures a DBCheckpointer.
type DBCheckpointerOption func(*DBCheckpointer)

// WithStreamStatus sets the replication_stream.status written on each Save
// (default "streaming"). The seeding phase passes "seeding".
func WithStreamStatus(status string) DBCheckpointerOption {
	return func(c *DBCheckpointer) {
		if status != "" {
			c.status = status
		}
	}
}

// NewDBCheckpointer binds a durable Checkpointer to one replication_stream row.
// streamID is the replication_stream.id (the core's StreamID). The store is the
// ClarioDR repository pre-bound to a tenant + execution context (see
// RepoCheckpointStore).
func NewDBCheckpointer(store StreamCheckpointStore, streamID string, opts ...DBCheckpointerOption) (*DBCheckpointer, error) {
	if store == nil {
		return nil, errors.New("core: DBCheckpointer requires a non-nil store")
	}
	if streamID == "" {
		return nil, errors.New("core: DBCheckpointer requires a stream id")
	}
	c := &DBCheckpointer{store: store, streamID: streamID, status: "streaming"}
	for _, o := range opts {
		o(c)
	}
	return c, nil
}

// Save persists cp into the replication_stream ledger. It is monotonic: a Save
// whose AppliedSeq is not strictly greater than the last persisted Seq is a
// safe no-op, so a duplicate checkpoint after a resume never rewinds the row.
func (c *DBCheckpointer) Save(ctx context.Context, cp Checkpoint) error {
	if cp.StreamID != "" && cp.StreamID != c.streamID {
		return fmt.Errorf("core: checkpointer bound to stream %q got %q: %w", c.streamID, cp.StreamID, ErrCheckpointStreamMismatch)
	}
	c.mu.Lock()
	if c.loaded && cp.AppliedSeq <= c.lastSeq {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	appliedAt := cp.AppliedAt
	if appliedAt.IsZero() {
		appliedAt = time.Now().UTC()
	}
	if err := c.store.UpdateStreamCheckpoint(ctx, c.streamID, int64(cp.AppliedSeq), cp.SourceLSN, appliedAt, c.status); err != nil {
		return fmt.Errorf("core: persist checkpoint stream=%s seq=%d: %w", c.streamID, cp.AppliedSeq, err)
	}
	c.mu.Lock()
	c.lastSeq = cp.AppliedSeq
	c.loaded = true
	c.mu.Unlock()
	return nil
}

// Load reads the persisted ledger position for the bound stream so the pipeline
// resumes from exactly the last contiguous applied Seq.
func (c *DBCheckpointer) Load(ctx context.Context, streamID string) (Checkpoint, error) {
	if streamID != "" && streamID != c.streamID {
		return Checkpoint{}, fmt.Errorf("core: checkpointer bound to stream %q got %q: %w", c.streamID, streamID, ErrCheckpointStreamMismatch)
	}
	appliedSeq, sourceLSN, appliedAt, err := c.store.LoadStreamCheckpoint(ctx, c.streamID)
	if err != nil {
		return Checkpoint{}, fmt.Errorf("core: load checkpoint stream=%s: %w", c.streamID, err)
	}
	if appliedSeq < 0 {
		appliedSeq = 0
	}
	c.mu.Lock()
	c.lastSeq = uint64(appliedSeq)
	c.loaded = true
	c.mu.Unlock()
	return Checkpoint{
		StreamID:   c.streamID,
		AppliedSeq: uint64(appliedSeq),
		SourceLSN:  sourceLSN,
		AppliedAt:  appliedAt,
	}, nil
}
