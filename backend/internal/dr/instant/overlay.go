package instant

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// BaseReader is the immutable sealed recovery point an instant-recovery session
// is served from. It is the REAL WORM/DEK read path: the integration wiring
// satisfies it with an adapter over *service.Service.ReadSealedChunk (which
// downloads + decrypts a sealed chunk through the per-tenant DEK), sliced into
// fixed-size chunks. The base is NEVER mutated — WriteChunk redirects to the
// overlay instead — so the recovery point stays ransomware-safe and re-usable.
//
// Implementations must be safe for concurrent reads (the workload reads while
// the hydrator copies). ChunkCount and ChunkSize describe the base's geometry so
// the session can account hydration progress and reject out-of-range indices.
type BaseReader interface {
	// ChunkCount returns the total number of chunks in the base recovery point.
	ChunkCount(ctx context.Context) (int, error)
	// ChunkSize returns the nominal bytes per chunk (the last chunk may be
	// shorter). 0 means variable / source-defined.
	ChunkSize(ctx context.Context) (int, error)
	// ReadBaseChunk returns the sealed base bytes for chunk index i. It must NOT
	// mutate anything; it is a pure read-through of the immutable recovery point.
	ReadBaseChunk(ctx context.Context, i int) ([]byte, error)
}

// overlayStore is the persistence subset OverlayStore drives (satisfied by
// *Store). Declared as an interface so the COW semantics are unit-tested against
// a real in-memory store, not a no-op mock.
type overlayStore interface {
	GetOverlayChunk(ctx context.Context, db repository.DBTX, sessionID uuid.UUID, index int64) ([]byte, bool, error)
	PutWriteChunk(ctx context.Context, db repository.DBTX, tenantID, sessionID uuid.UUID, index int64, data []byte) error
	PutHydrateChunk(ctx context.Context, db repository.DBTX, tenantID, sessionID uuid.UUID, index int64, data []byte) (bool, error)
	PresentIndices(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) (map[int64]bool, error)
}

// OverlayStore is the copy-on-write block layer that makes instant recovery
// instant: it presents a sealed recovery point (the base) as a writable view in
// seconds without copying the dataset up front.
//
//   - ReadChunk(i)  returns the overlay chunk if one was written/hydrated for i,
//     else reads through to the immutable base recovery-point chunk.
//   - WriteChunk(i) records the bytes in the private overlay (redirect-on-write)
//     and NEVER touches the base.
//
// It binds one session, its tenant, the base reader, the persistence store, and
// the DBTX execution context (a tenant tx on the request/IO path, a system tx on
// the hydration loop). It carries the base chunk count so reads/writes outside
// the dataset are rejected rather than silently mis-served.
type OverlayStore struct {
	store      overlayStore
	base       BaseReader
	db         repository.DBTX
	tenantID   uuid.UUID
	sessionID  uuid.UUID
	chunkCount int
}

// NewOverlayStore binds a copy-on-write overlay to a session. chunkCount is the
// base recovery point's chunk count (used to bound indices). db is the execution
// context the caller chooses; pass an open tx so a write commits with whatever
// the caller wraps around it.
func NewOverlayStore(store overlayStore, base BaseReader, db repository.DBTX, tenantID, sessionID uuid.UUID, chunkCount int) *OverlayStore {
	return &OverlayStore{
		store:      store,
		base:       base,
		db:         db,
		tenantID:   tenantID,
		sessionID:  sessionID,
		chunkCount: chunkCount,
	}
}

// WithDB returns a shallow copy of the overlay bound to a different execution
// context (e.g. swapping a pool read for an open write tx) without re-resolving
// the base geometry. The original is left unchanged so it is safe to derive
// per-operation handles concurrently.
func (o *OverlayStore) WithDB(db repository.DBTX) *OverlayStore {
	clone := *o
	clone.db = db
	return &clone
}

// ChunkCount returns the bounded chunk count of the base this overlay covers.
func (o *OverlayStore) ChunkCount() int { return o.chunkCount }

// ReadChunk returns the bytes the recovered workload sees at chunk index i:
// the overlay chunk if one exists (a prior write OR a hydrated copy), otherwise
// a read-through of the immutable base recovery-point chunk. The base is never
// mutated by a read. An index outside [0, chunkCount) is rejected.
func (o *OverlayStore) ReadChunk(ctx context.Context, i int) ([]byte, error) {
	if i < 0 || i >= o.chunkCount {
		return nil, fmt.Errorf("read chunk %d (count %d): %w", i, o.chunkCount, ErrChunkOutOfRange)
	}
	data, ok, err := o.store.GetOverlayChunk(ctx, o.db, o.sessionID, int64(i))
	if err != nil {
		return nil, err
	}
	if ok {
		return data, nil
	}
	// Read-through: the overlay has no row for i, so serve the immutable base.
	baseData, err := o.base.ReadBaseChunk(ctx, i)
	if err != nil {
		return nil, fmt.Errorf("reading base chunk %d for session %s: %w", i, o.sessionID, err)
	}
	return baseData, nil
}

// WriteChunk records data at chunk index i in the private overlay
// (redirect-on-write). It does NOT mutate the base recovery point: a subsequent
// ReadChunk(i) returns the overlay bytes, while every other index still reads
// through to the sealed base. A redirect-on-write also shadows the base for the
// hydrator, which never overwrites a 'write' row. An out-of-range index is
// rejected so a write cannot extend the dataset past the base geometry.
func (o *OverlayStore) WriteChunk(ctx context.Context, i int, data []byte) error {
	if i < 0 || i >= o.chunkCount {
		return fmt.Errorf("write chunk %d (count %d): %w", i, o.chunkCount, ErrChunkOutOfRange)
	}
	// Copy the caller's slice so a later mutation of their buffer cannot change
	// what we persist (the store hashes + stores these exact bytes).
	buf := make([]byte, len(data))
	copy(buf, data)
	return o.store.PutWriteChunk(ctx, o.db, o.tenantID, o.sessionID, int64(i), buf)
}

// HydrateChunk copies the base chunk at index i into the overlay as a 'hydrate'
// row. It is used by the Hydrator, not the workload. It NEVER overwrites a
// redirect-on-write at i (the store's INSERT ... ON CONFLICT DO NOTHING), and
// returns true iff this call genuinely materialized a previously-absent chunk —
// the signal the hydrator counts exactly once per chunk. Reading the base here
// is a pure read-through; the base is not mutated.
func (o *OverlayStore) HydrateChunk(ctx context.Context, i int) (bool, error) {
	if i < 0 || i >= o.chunkCount {
		return false, fmt.Errorf("hydrate chunk %d (count %d): %w", i, o.chunkCount, ErrChunkOutOfRange)
	}
	baseData, err := o.base.ReadBaseChunk(ctx, i)
	if err != nil {
		return false, fmt.Errorf("reading base chunk %d to hydrate session %s: %w", i, o.sessionID, err)
	}
	return o.store.PutHydrateChunk(ctx, o.db, o.tenantID, o.sessionID, int64(i), baseData)
}

// MissingIndices returns the base chunk indices that are NOT yet present in the
// overlay (neither written nor hydrated), in ascending order. The hydrator walks
// exactly these. Indices already shadowed by a redirect-on-write are considered
// present and skipped — the workload's write is the authoritative content, so
// the base copy is unnecessary.
func (o *OverlayStore) MissingIndices(ctx context.Context) ([]int, error) {
	present, err := o.store.PresentIndices(ctx, o.db, o.sessionID)
	if err != nil {
		return nil, err
	}
	missing := make([]int, 0, o.chunkCount-len(present))
	for i := 0; i < o.chunkCount; i++ {
		if !present[int64(i)] {
			missing = append(missing, i)
		}
	}
	return missing, nil
}
