package instant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists instant-recovery sessions and their copy-on-write overlay
// chunks. Every method takes a repository.DBTX (the same pgx subset the rest of
// dr_db uses) so a write can run inside the caller's tenant-scoped transaction
// (RLS active) or, for the hydration loop, a system transaction (RLS bypassed).
// The DB row is always the metadata authority; large payloads can optionally be
// stored outside Postgres through OverlayBlobStore.
type Store struct {
	blobs OverlayBlobStore
}

// StoreOption customizes Store construction.
type StoreOption func(*Store)

// WithOverlayBlobStore stores overlay chunk payload bytes outside Postgres. The
// dr_instant_overlay_chunk row still records origin, length, hash, backend, and
// ref so reads remain tamper-evident and tenant-scoped.
func WithOverlayBlobStore(blobs OverlayBlobStore) StoreOption {
	return func(s *Store) {
		s.blobs = blobs
	}
}

// NewStore constructs a Store.
func NewStore(opts ...StoreOption) *Store {
	s := &Store{}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
	}
	return s
}

const insertSessionSQL = `
INSERT INTO dr_instant_session
    (tenant_id, recovery_point_id, group_id, state, chunks_total, chunks_hydrated,
     chunk_size, overlay_location)
VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
RETURNING id, started_at, updated_at`

// CreateSession inserts a new HYDRATING session and populates its generated
// fields. The session begins with chunks_hydrated = 0 and the supplied
// chunks_total / chunk_size taken from the base recovery point. tenant_id must
// match the surrounding transaction's app.current_tenant_id or RLS rejects it.
func (s *Store) CreateSession(ctx context.Context, db repository.DBTX, sess *Session) error {
	if sess.State == "" {
		sess.State = StateHydrating
	}
	var groupID *string
	if sess.GroupID != nil {
		g := sess.GroupID.String()
		groupID = &g
	}
	err := db.QueryRow(ctx, insertSessionSQL,
		sess.TenantID, sess.RecoveryPointID, groupID, sess.State,
		sess.ChunksTotal, sess.ChunkSize, sess.OverlayLocation,
	).Scan(&sess.ID, &sess.StartedAt, &sess.UpdatedAt)
	if err != nil {
		return fmt.Errorf("instant: creating session: %w", err)
	}
	sess.ChunksHydrated = 0
	return nil
}

const selectSessionByTenantSQL = `
SELECT id, tenant_id, recovery_point_id, group_id, state, chunks_total,
       chunks_hydrated, chunk_size, overlay_location, finalized_location,
       last_error, started_at, ready_at, finalized_at, updated_at
FROM dr_instant_session
WHERE tenant_id = $1 AND id = $2`

// GetSession loads a session by id within the tenant. Returns ErrNotFound when
// the session does not exist or belongs to another tenant.
func (s *Store) GetSession(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*Session, error) {
	return scanSession(db.QueryRow(ctx, selectSessionByTenantSQL, tenantID, id))
}

const selectSessionSystemSQL = `
SELECT id, tenant_id, recovery_point_id, group_id, state, chunks_total,
       chunks_hydrated, chunk_size, overlay_location, finalized_location,
       last_error, started_at, ready_at, finalized_at, updated_at
FROM dr_instant_session
WHERE id = $1`

// GetSessionSystem loads a session by id without a tenant filter. It is the
// background-loop-only path (hydration / finalize) and must run under a system
// transaction (app.bypass_rls); request-path code uses GetSession.
func (s *Store) GetSessionSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Session, error) {
	return scanSession(db.QueryRow(ctx, selectSessionSystemSQL, id))
}

const claimActiveSessionsSQL = `
SELECT id, tenant_id, recovery_point_id, group_id, state, chunks_total,
       chunks_hydrated, chunk_size, overlay_location, finalized_location,
       last_error, started_at, ready_at, finalized_at, updated_at
FROM dr_instant_session
WHERE state IN ('HYDRATING','FINALIZING')
ORDER BY started_at ASC
LIMIT $1
FOR UPDATE SKIP LOCKED`

// ClaimActiveSessions returns up to limit sessions still hydrating or
// finalizing, locked FOR UPDATE SKIP LOCKED so concurrent loop instances do not
// process the same session. It is the system (RLS-bypass) path the leader
// hydration loop uses; it must run inside a system transaction held open across
// the work that advances each claimed session.
func (s *Store) ClaimActiveSessions(ctx context.Context, db repository.DBTX, limit int) ([]*Session, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := db.Query(ctx, claimActiveSessionsSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("instant: claiming active sessions: %w", err)
	}
	defer rows.Close()

	var out []*Session
	for rows.Next() {
		sess, serr := scanSessionRows(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("instant: iterating active sessions: %w", err)
	}
	return out, nil
}

const setChunksHydratedSQL = `
UPDATE dr_instant_session
   SET chunks_hydrated = $2, updated_at = now()
 WHERE id = $1`

// SetChunksHydrated stores the authoritative hydrated count for a session. It is
// recomputed from the overlay (CountHydrated) rather than incremented blindly so
// a re-claimed, restarted hydration never double-counts.
func (s *Store) SetChunksHydrated(ctx context.Context, db repository.DBTX, id uuid.UUID, hydrated int) error {
	tag, err := db.Exec(ctx, setChunksHydratedSQL, id, hydrated)
	if err != nil {
		return fmt.Errorf("instant: updating hydrated count for %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("instant: session %s vanished while updating count: %w", id, ErrNotFound)
	}
	return nil
}

const transitionToReadySQL = `
UPDATE dr_instant_session
   SET state = 'READY', chunks_hydrated = $2, ready_at = now(), updated_at = now()
 WHERE id = $1 AND state = 'HYDRATING'`

// TransitionToReady moves a session HYDRATING -> READY, recording the final
// hydrated count and the ready timestamp. The WHERE guard makes a concurrent
// second transition a no-op (returns false), so two loop instances racing on the
// same session do not both fire the event.
func (s *Store) TransitionToReady(ctx context.Context, db repository.DBTX, id uuid.UUID, hydrated int) (bool, error) {
	tag, err := db.Exec(ctx, transitionToReadySQL, id, hydrated)
	if err != nil {
		return false, fmt.Errorf("instant: transitioning %s to READY: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const transitionToFinalizingSQL = `
UPDATE dr_instant_session
   SET state = 'FINALIZING', updated_at = now()
 WHERE id = $1 AND state = 'READY'`

// TransitionToFinalizing moves a session READY -> FINALIZING. The WHERE guard
// enforces the FSM: a session not in READY (e.g. still HYDRATING, or already
// FINALIZING) is left untouched and false is returned.
func (s *Store) TransitionToFinalizing(ctx context.Context, db repository.DBTX, id uuid.UUID) (bool, error) {
	tag, err := db.Exec(ctx, transitionToFinalizingSQL, id)
	if err != nil {
		return false, fmt.Errorf("instant: transitioning %s to FINALIZING: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const transitionToFinalizedSQL = `
UPDATE dr_instant_session
   SET state = 'FINALIZED', finalized_location = $2, finalized_at = now(), updated_at = now()
 WHERE id = $1 AND state = 'FINALIZING'`

// TransitionToFinalized moves a session FINALIZING -> FINALIZED, recording where
// the standalone full copy was written. Guarded so a re-claim does not re-finalize.
func (s *Store) TransitionToFinalized(ctx context.Context, db repository.DBTX, id uuid.UUID, location string) (bool, error) {
	tag, err := db.Exec(ctx, transitionToFinalizedSQL, id, location)
	if err != nil {
		return false, fmt.Errorf("instant: transitioning %s to FINALIZED: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

const failSessionSQL = `
UPDATE dr_instant_session
   SET state = 'FAILED', last_error = $2, updated_at = now()
 WHERE id = $1 AND state NOT IN ('FINALIZED','FAILED')`

// FailSession moves a non-terminal session to FAILED with a reason. Terminal
// sessions are left untouched (returns false), so a fault during finalize of an
// already-FINALIZED session cannot clobber it.
func (s *Store) FailSession(ctx context.Context, db repository.DBTX, id uuid.UUID, reason string) (bool, error) {
	tag, err := db.Exec(ctx, failSessionSQL, id, reason)
	if err != nil {
		return false, fmt.Errorf("instant: failing session %s: %w", id, err)
	}
	return tag.RowsAffected() == 1, nil
}

// ---------------------------------------------------------------------------
// Overlay chunk persistence — the copy-on-write store.
// ---------------------------------------------------------------------------

const upsertWriteChunkSQL = `
INSERT INTO dr_instant_overlay_chunk
    (session_id, tenant_id, chunk_index, origin, data, content_hash, byte_len,
     storage_backend, storage_ref)
VALUES ($1, $2, $3, 'write', $4, $5, $6, $7, $8)
ON CONFLICT (session_id, chunk_index)
DO UPDATE SET origin = 'write', data = EXCLUDED.data, content_hash = EXCLUDED.content_hash,
              byte_len = EXCLUDED.byte_len, storage_backend = EXCLUDED.storage_backend,
              storage_ref = EXCLUDED.storage_ref, written_at = now()`

// PutWriteChunk records a redirect-on-write: the workload wrote chunk_index, so
// the overlay now holds these bytes and a read of that index returns them
// instead of falling through to the base. A 'write' always wins on conflict
// (even over a prior 'hydrate'), so a workload write is never lost to a later
// background hydrate of the same index.
func (s *Store) PutWriteChunk(ctx context.Context, db repository.DBTX, tenantID, sessionID uuid.UUID, index int64, data []byte) error {
	storedData, contentHash, byteLen, backend, ref, err := s.prepareOverlayPayload(ctx, tenantID, sessionID, index, OriginWrite, data)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, upsertWriteChunkSQL,
		sessionID, tenantID, index, storedData, contentHash, byteLen, backend, ref)
	if err != nil {
		return fmt.Errorf("instant: writing overlay chunk %d for session %s: %w", index, sessionID, err)
	}
	return nil
}

const insertHydrateChunkSQL = `
INSERT INTO dr_instant_overlay_chunk
    (session_id, tenant_id, chunk_index, origin, data, content_hash, byte_len,
     storage_backend, storage_ref)
VALUES ($1, $2, $3, 'hydrate', $4, $5, $6, $7, $8)
ON CONFLICT (session_id, chunk_index) DO NOTHING`

// PutHydrateChunk records a background hydration copy of a base chunk. It does
// NOTHING on conflict, so it never overwrites a redirect-on-write ('write') row
// nor re-copies an already-hydrated chunk. Returns true iff a row was inserted
// (i.e. this index was genuinely newly hydrated), which the hydrator uses to
// advance its count exactly once per chunk.
func (s *Store) PutHydrateChunk(ctx context.Context, db repository.DBTX, tenantID, sessionID uuid.UUID, index int64, data []byte) (bool, error) {
	storedData, contentHash, byteLen, backend, ref, err := s.prepareOverlayPayload(ctx, tenantID, sessionID, index, OriginHydrate, data)
	if err != nil {
		return false, err
	}
	tag, err := db.Exec(ctx, insertHydrateChunkSQL,
		sessionID, tenantID, index, storedData, contentHash, byteLen, backend, ref)
	if err != nil {
		return false, fmt.Errorf("instant: hydrating overlay chunk %d for session %s: %w", index, sessionID, err)
	}
	return tag.RowsAffected() == 1, nil
}

const selectOverlayChunkSQL = `
SELECT data, content_hash, byte_len, storage_backend, storage_ref
FROM dr_instant_overlay_chunk
WHERE session_id = $1 AND chunk_index = $2`

// GetOverlayChunk returns the overlay bytes for chunk_index, or (nil, false, nil)
// if no overlay row exists (the caller must then read through to the base).
func (s *Store) GetOverlayChunk(ctx context.Context, db repository.DBTX, sessionID uuid.UUID, index int64) ([]byte, bool, error) {
	var (
		data        []byte
		contentHash string
		byteLen     int
		backend     string
		ref         string
	)
	err := db.QueryRow(ctx, selectOverlayChunkSQL, sessionID, index).Scan(&data, &contentHash, &byteLen, &backend, &ref)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("instant: reading overlay chunk %d for session %s: %w", index, sessionID, err)
	}
	data, err = s.loadOverlayPayload(ctx, data, contentHash, byteLen, backend, ref)
	if err != nil {
		return nil, false, fmt.Errorf("instant: loading overlay chunk %d for session %s: %w", index, sessionID, err)
	}
	return data, true, nil
}

const presentIndicesSQL = `
SELECT chunk_index
FROM dr_instant_overlay_chunk
WHERE session_id = $1
ORDER BY chunk_index ASC`

// PresentIndices returns the set of chunk indices that already have an overlay
// row (written OR hydrated). The hydrator walks the base chunks NOT in this set.
func (s *Store) PresentIndices(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) (map[int64]bool, error) {
	rows, err := db.Query(ctx, presentIndicesSQL, sessionID)
	if err != nil {
		return nil, fmt.Errorf("instant: listing overlay indices for session %s: %w", sessionID, err)
	}
	defer rows.Close()

	present := make(map[int64]bool)
	for rows.Next() {
		var idx int64
		if err := rows.Scan(&idx); err != nil {
			return nil, fmt.Errorf("instant: scanning overlay index for session %s: %w", sessionID, err)
		}
		present[idx] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("instant: iterating overlay indices for session %s: %w", sessionID, err)
	}
	return present, nil
}

const countHydratedSQL = `
SELECT count(*)
FROM dr_instant_overlay_chunk
WHERE session_id = $1 AND origin = 'hydrate'`

// CountHydrated returns the number of base chunks copied into the overlay by the
// background hydrator (origin = 'hydrate'). This is the authoritative hydrated
// count: it is derived from the overlay, not an incrementing counter, so a
// restarted/re-claimed hydration recomputes it without drift. Redirect-on-write
// chunks are intentionally NOT counted — they are workload data, not progress
// toward hydrating the base.
func (s *Store) CountHydrated(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) (int, error) {
	var n int
	if err := db.QueryRow(ctx, countHydratedSQL, sessionID).Scan(&n); err != nil {
		return 0, fmt.Errorf("instant: counting hydrated chunks for session %s: %w", sessionID, err)
	}
	return n, nil
}

const listOverlayChunksSQL = `
SELECT chunk_index, origin, data, content_hash, byte_len, written_at, storage_backend, storage_ref
FROM dr_instant_overlay_chunk
WHERE session_id = $1
ORDER BY chunk_index ASC`

// ListOverlayChunks returns every overlay chunk for a session in index order. It
// is used by Finalize() to assemble the standalone full copy (overlay chunks
// override the base; base chunks not in the overlay are read through and copied
// during hydration, so a READY session's overlay holds the entire dataset).
func (s *Store) ListOverlayChunks(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) ([]OverlayChunk, error) {
	rows, err := db.Query(ctx, listOverlayChunksSQL, sessionID)
	if err != nil {
		return nil, fmt.Errorf("instant: listing overlay chunks for session %s: %w", sessionID, err)
	}
	defer rows.Close()

	var out []OverlayChunk
	for rows.Next() {
		var c OverlayChunk
		c.SessionID = sessionID
		if err := rows.Scan(&c.ChunkIndex, &c.Origin, &c.Data, &c.ContentHash, &c.ByteLen, &c.WrittenAt, &c.StorageBackend, &c.StorageRef); err != nil {
			return nil, fmt.Errorf("instant: scanning overlay chunk for session %s: %w", sessionID, err)
		}
		c.Data, err = s.loadOverlayPayload(ctx, c.Data, c.ContentHash, c.ByteLen, c.StorageBackend, c.StorageRef)
		if err != nil {
			return nil, fmt.Errorf("instant: loading overlay chunk %d for session %s: %w", c.ChunkIndex, sessionID, err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("instant: iterating overlay chunks for session %s: %w", sessionID, err)
	}
	return out, nil
}

func (s *Store) prepareOverlayPayload(ctx context.Context, tenantID, sessionID uuid.UUID, index int64, origin string, data []byte) ([]byte, string, int, string, string, error) {
	sum := sha256.Sum256(data)
	contentHash := hex.EncodeToString(sum[:])
	if s.blobs == nil {
		return data, contentHash, len(data), "db", "", nil
	}
	ref, err := s.blobs.Put(ctx, tenantID, sessionID, index, origin, data, contentHash)
	if err != nil {
		return nil, "", 0, "", "", fmt.Errorf("instant: storing overlay chunk %d for session %s in %s store: %w", index, sessionID, s.blobs.Backend(), err)
	}
	return []byte{}, contentHash, len(data), s.blobs.Backend(), ref, nil
}

func (s *Store) loadOverlayPayload(ctx context.Context, data []byte, contentHash string, byteLen int, backend, ref string) ([]byte, error) {
	switch backend {
	case "", "db":
		return verifyOverlayPayload(data, contentHash, byteLen)
	default:
		if s.blobs == nil {
			return nil, fmt.Errorf("overlay chunk stored in %q but no blob store is configured", backend)
		}
		if backend != s.blobs.Backend() {
			return nil, fmt.Errorf("overlay chunk stored in %q but configured blob store is %q", backend, s.blobs.Backend())
		}
		out, err := s.blobs.Get(ctx, ref)
		if err != nil {
			return nil, err
		}
		return verifyOverlayPayload(out, contentHash, byteLen)
	}
}

func verifyOverlayPayload(data []byte, contentHash string, byteLen int) ([]byte, error) {
	if len(data) != byteLen {
		return nil, fmt.Errorf("overlay chunk length mismatch: got %d want %d", len(data), byteLen)
	}
	sum := sha256.Sum256(data)
	if got := hex.EncodeToString(sum[:]); got != contentHash {
		return nil, fmt.Errorf("overlay chunk hash mismatch: got %s want %s", got, contentHash)
	}
	return data, nil
}

// rowScanner is the common Scan surface of pgx.Row and pgx.Rows so the QueryRow
// and Query paths share one decode.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSession(row pgx.Row) (*Session, error) {
	return scanSessionInto(row)
}

func scanSessionRows(rows pgx.Rows) (*Session, error) {
	return scanSessionInto(rows)
}

func scanSessionInto(sc rowScanner) (*Session, error) {
	var (
		sess     Session
		groupID  *string
		finalLoc *string
		lastErr  *string
	)
	err := sc.Scan(
		&sess.ID, &sess.TenantID, &sess.RecoveryPointID, &groupID, &sess.State,
		&sess.ChunksTotal, &sess.ChunksHydrated, &sess.ChunkSize, &sess.OverlayLocation,
		&finalLoc, &lastErr, &sess.StartedAt, &sess.ReadyAt, &sess.FinalizedAt, &sess.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("instant: scanning session: %w", err)
	}
	if groupID != nil {
		g, perr := uuid.Parse(*groupID)
		if perr != nil {
			return nil, fmt.Errorf("instant: parsing group_id %q: %w", *groupID, perr)
		}
		sess.GroupID = &g
	}
	sess.FinalizedLocation = finalLoc
	sess.LastError = lastErr
	return &sess, nil
}
