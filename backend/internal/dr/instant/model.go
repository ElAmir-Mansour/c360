// Package instant implements ClarioDR capability #8 — INSTANT RECOVERY.
//
// Instant recovery serves a recovered workload from a sealed DR recovery point
// in SECONDS by presenting that immutable point as a copy-on-write (COW)
// overlay. Reads fall through to the sealed recovery-point chunk (read-through);
// writes redirect to a private per-session overlay (redirect-on-write) WITHOUT
// mutating the immutable base; and the full dataset hydrates lazily in the
// background while the workload is already running.
//
// The package owns its own model, store, COW OverlayStore, Hydrator, HTTP
// router, and background hydration loop. Base reads come from the real
// WORM/DEK recovery-point store via the BaseReader interface (satisfied by
// *service.Service.ReadSealedChunk and a chunk-count source). Per the disjoint
// ownership rule it edits no shared DR files: it persists through
// repository.DBTX over its own two tables (migrations/dr_db/000013) and emits
// lifecycle events on the existing datastream.dr.events topic via the outbox.
package instant

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors mapped to HTTP statuses by the router layer.
var (
	// ErrNotFound is returned when a session does not exist for the tenant.
	ErrNotFound = errors.New("instant: session not found")
	// ErrInvalidState is returned for an illegal state transition.
	ErrInvalidState = errors.New("instant: invalid state transition")
	// ErrNoBaseChunks is returned when the base recovery point reports zero
	// chunks, so there is nothing to serve or hydrate.
	ErrNoBaseChunks = errors.New("instant: recovery point has no chunks")
	// ErrChunkOutOfRange is returned when a read/write targets a chunk index
	// outside the base recovery point's chunk count.
	ErrChunkOutOfRange = errors.New("instant: chunk index out of range")
	// ErrNotReady is returned when finalize is requested before hydration has
	// completed (the session is not yet READY).
	ErrNotReady = errors.New("instant: session not ready to finalize")
)

// Session lifecycle states. The full dataset hydrates in the background while
// the workload already serves from the COW overlay, so a session starts
// HYDRATING and only becomes READY once every base chunk is present in the
// overlay; Finalize() then produces a standalone full copy (FINALIZING ->
// FINALIZED). FAILED is reachable from any non-terminal state.
const (
	StateHydrating  = "HYDRATING"
	StateReady      = "READY"
	StateFinalizing = "FINALIZING"
	StateFinalized  = "FINALIZED"
	StateFailed     = "FAILED"
)

// Overlay chunk origin. A 'write' row is a redirect-on-write that overrides the
// base; a 'hydrate' row is a verbatim background copy of the base chunk. Only
// 'hydrate' rows count toward chunks_hydrated, and a 'write' is never overwritten
// by a later hydrate of the same index (the workload's write wins).
const (
	OriginWrite   = "write"
	OriginHydrate = "hydrate"
)

// allowedTransitions is the COW session state machine. A transition is legal
// only if next appears in allowedTransitions[current]. FAILED is reachable from
// every non-terminal state; the terminal states (FINALIZED, FAILED) allow no
// further transition.
var allowedTransitions = map[string]map[string]bool{
	StateHydrating: {
		StateReady:  true,
		StateFailed: true,
	},
	StateReady: {
		StateFinalizing: true,
		StateFailed:     true,
	},
	StateFinalizing: {
		StateFinalized: true,
		StateFailed:    true,
	},
	StateFinalized: {},
	StateFailed:    {},
}

// CanTransition reports whether moving from current to next is a legal state
// transition. A no-op (current == next) is NOT a transition and returns false,
// so callers must guard idempotent re-entry separately.
func CanTransition(current, next string) bool {
	nexts, ok := allowedTransitions[current]
	if !ok {
		return false
	}
	return nexts[next]
}

// IsTerminal reports whether a state allows no further transition.
func IsTerminal(state string) bool {
	return state == StateFinalized || state == StateFailed
}

// Session is one instant-recovery COW session over a sealed recovery point.
type Session struct {
	ID              uuid.UUID  `json:"id"`
	TenantID        uuid.UUID  `json:"tenant_id"`
	RecoveryPointID uuid.UUID  `json:"recovery_point_id"`
	GroupID         *uuid.UUID `json:"group_id,omitempty"`
	State           string     `json:"state"`
	ChunksTotal     int        `json:"chunks_total"`
	ChunksHydrated  int        `json:"chunks_hydrated"`
	ChunkSize       int        `json:"chunk_size"`
	OverlayLocation string     `json:"overlay_location"`
	// FinalizedLocation is the standalone full-copy location written by
	// Finalize(); nil until FINALIZED.
	FinalizedLocation *string    `json:"finalized_location,omitempty"`
	LastError         *string    `json:"last_error,omitempty"`
	StartedAt         time.Time  `json:"started_at"`
	ReadyAt           *time.Time `json:"ready_at,omitempty"`
	FinalizedAt       *time.Time `json:"finalized_at,omitempty"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// PercentComplete returns hydration progress as a 0..100 percentage. A session
// with zero total chunks is reported as 100% (nothing to hydrate). Once the
// session has left HYDRATING (it reached READY/FINALIZING/FINALIZED, or FAILED
// after completing), the dataset is fully materialized — including any indices a
// redirect-on-write supplied rather than a hydrate — so progress is 100% even
// though chunks_hydrated may be one short of the total for each written-over
// chunk. While still HYDRATING the value is the live hydrated/total ratio,
// clamped to [0,100].
func (s *Session) PercentComplete() float64 {
	if s.ChunksTotal <= 0 {
		return 100
	}
	if s.State == StateReady || s.State == StateFinalizing || s.State == StateFinalized {
		return 100
	}
	pct := float64(s.ChunksHydrated) / float64(s.ChunksTotal) * 100
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}

// HydrationComplete reports whether every base chunk is present in the overlay.
func (s *Session) HydrationComplete() bool {
	return s.ChunksTotal > 0 && s.ChunksHydrated >= s.ChunksTotal
}

// Progress is the read-model returned by GET /instant-sessions/{id}: the session
// plus its derived percentage so callers do not recompute it.
type Progress struct {
	Session         *Session `json:"session"`
	PercentComplete float64  `json:"percent_complete"`
}

// OverlayChunk is one persisted overlay block: either a redirect-on-write or a
// background-hydrated copy of the base chunk at chunk_index.
type OverlayChunk struct {
	SessionID      uuid.UUID
	TenantID       uuid.UUID
	ChunkIndex     int64
	Origin         string
	Data           []byte
	ContentHash    string
	ByteLen        int
	StorageBackend string
	StorageRef     string
	WrittenAt      time.Time
}
