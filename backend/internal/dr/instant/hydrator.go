package instant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"golang.org/x/time/rate"

	"github.com/clario360/platform/internal/dr/repository"
)

// hydratorStore is the persistence subset the Hydrator drives directly
// (satisfied by *Store). Overlay chunk reads/writes go through an OverlayStore.
type hydratorStore interface {
	GetSessionSystem(ctx context.Context, db repository.DBTX, id uuid.UUID) (*Session, error)
	SetChunksHydrated(ctx context.Context, db repository.DBTX, id uuid.UUID, hydrated int) error
	CountHydrated(ctx context.Context, db repository.DBTX, sessionID uuid.UUID) (int, error)
}

// HydrateResult reports the outcome of hydrating one session in a single pass.
type HydrateResult struct {
	// Copied is the number of base chunks newly materialized into the overlay on
	// this call (excludes chunks already present / written-over).
	Copied int
	// TotalHydrated is the session's authoritative hydrated count after the pass.
	TotalHydrated int
	// Total is the base chunk count.
	Total int
	// Complete is true iff every base chunk is now present in the overlay.
	Complete bool
}

// Hydrator lazily copies a session's base recovery-point chunks into its
// copy-on-write overlay in the background, while the recovered workload is
// already serving reads/writes from that overlay. It walks only the chunks NOT
// yet present (skipping redirect-on-writes), throttles the copy to a configured
// chunks/sec rate (a real token-bucket limiter), and keeps the session's
// chunks_hydrated accounting authoritative by recomputing it from the overlay.
//
// The Hydrator does not own a loop schedule itself; HydrateSession is invoked by
// the leader-singleton HydrateLoop (or directly in tests). Each call makes
// progress and is safe to re-invoke after a crash: it resumes from whatever is
// already in the overlay because PutHydrateChunk is INSERT ... ON CONFLICT DO
// NOTHING and the count is derived, not incremented.
type Hydrator struct {
	store   hydratorStore
	metrics *Metrics
	// ratePerSec throttles base-chunk copies. 0 means unthrottled (copy as fast
	// as the store allows). The limiter is created per HydrateSession pass so the
	// rate can change between passes without shared mutable state.
	ratePerSec float64
	// burst is the token-bucket burst (max chunks copied back-to-back before the
	// rate kicks in). Defaults to 1 so the very first chunk is immediate.
	burst int
	now   func() time.Time
}

// HydratorConfig wires a Hydrator.
type HydratorConfig struct {
	Store      hydratorStore
	Metrics    *Metrics
	RatePerSec float64 // base chunks copied per second; <= 0 = unthrottled
	Burst      int     // token-bucket burst; <= 0 defaults to 1
	Now        func() time.Time
}

// NewHydrator constructs a Hydrator.
func NewHydrator(cfg HydratorConfig) (*Hydrator, error) {
	if cfg.Store == nil {
		return nil, errors.New("instant hydrator: store is required")
	}
	burst := cfg.Burst
	if burst <= 0 {
		burst = 1
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Hydrator{
		store:      cfg.Store,
		metrics:    cfg.Metrics,
		ratePerSec: cfg.RatePerSec,
		burst:      burst,
		now:        now,
	}, nil
}

// HydrateSession copies the still-missing base chunks of one session into its
// overlay, throttled to the configured rate, then persists the authoritative
// hydrated count. It stops early (without error) if ctx is cancelled, having
// recorded whatever progress it made. overlay must be bound to the same session
// and execution context as db.
//
// It does NOT itself transition the session to READY — the HydrateLoop does that
// transactionally with the lifecycle event once Complete is true — so this
// method is a pure, idempotent progress step.
func (h *Hydrator) HydrateSession(ctx context.Context, db repository.DBTX, overlay *OverlayStore, sessionID uuid.UUID) (HydrateResult, error) {
	missing, err := overlay.MissingIndices(ctx)
	if err != nil {
		return HydrateResult{}, err
	}

	var limiter *rate.Limiter
	if h.ratePerSec > 0 {
		limiter = rate.NewLimiter(rate.Limit(h.ratePerSec), h.burst)
	}

	copied := 0
	for _, idx := range missing {
		select {
		case <-ctx.Done():
			// Persist progress made so far before returning so the count never
			// regresses across a cancellation.
			if perr := h.persistCount(ctx, db, overlay, sessionID, copied); perr != nil {
				return HydrateResult{}, perr
			}
			return h.result(ctx, db, overlay, sessionID, copied)
		default:
		}

		if limiter != nil {
			if werr := limiter.Wait(ctx); werr != nil {
				// ctx cancelled while waiting for a token; persist and return.
				if perr := h.persistCount(ctx, db, overlay, sessionID, copied); perr != nil {
					return HydrateResult{}, perr
				}
				return h.result(ctx, db, overlay, sessionID, copied)
			}
		}

		inserted, herr := overlay.HydrateChunk(ctx, idx)
		if herr != nil {
			return HydrateResult{}, herr
		}
		if inserted {
			copied++
		}
	}

	if err := h.persistCount(ctx, db, overlay, sessionID, copied); err != nil {
		return HydrateResult{}, err
	}
	return h.result(ctx, db, overlay, sessionID, copied)
}

// persistCount recomputes the authoritative hydrated count from the overlay and
// stores it, and records the newly-copied chunks on the metric. Recomputing
// (rather than trusting copied) keeps the count correct after a re-claim.
func (h *Hydrator) persistCount(ctx context.Context, db repository.DBTX, overlay *OverlayStore, sessionID uuid.UUID, copied int) error {
	hydrated, err := h.store.CountHydrated(ctx, db, sessionID)
	if err != nil {
		return err
	}
	if err := h.store.SetChunksHydrated(ctx, db, sessionID, hydrated); err != nil {
		return err
	}
	h.metrics.AddChunksHydrated(copied)
	total := overlay.ChunkCount()
	pct := 100.0
	if total > 0 {
		pct = float64(hydrated) / float64(total) * 100
	}
	h.metrics.SetHydrationProgress(sessionID.String(), pct)
	return nil
}

// result assembles the HydrateResult from the persisted count and the base
// geometry. Completion is defined as "no base index is missing from the overlay"
// — every chunk is present either because it was hydrated OR because the
// workload already wrote it (a redirect-on-write materializes that index). This
// is why Complete is not simply hydrated == total: a session whose only gap was
// a written-over chunk is fully materialized even though its hydrated count is
// one short of the total.
func (h *Hydrator) result(ctx context.Context, db repository.DBTX, overlay *OverlayStore, sessionID uuid.UUID, copied int) (HydrateResult, error) {
	hydrated, err := h.store.CountHydrated(ctx, db, sessionID)
	if err != nil {
		return HydrateResult{}, err
	}
	missing, err := overlay.MissingIndices(ctx)
	if err != nil {
		return HydrateResult{}, err
	}
	total := overlay.ChunkCount()
	return HydrateResult{
		Copied:        copied,
		TotalHydrated: hydrated,
		Total:         total,
		Complete:      total > 0 && len(missing) == 0,
	}, nil
}

// FinalizeCopy assembles the standalone full copy of a READY session by reading
// every chunk through the overlay (overlay chunks override the base; for a READY
// session every base chunk has been hydrated, so the whole dataset is materially
// in the overlay) and writing it to the sink. It returns the total bytes copied.
// This is the real "produce a standalone full copy" step Finalize() invokes: it
// performs actual chunk-by-chunk I/O, not a metadata flip.
func FinalizeCopy(ctx context.Context, overlay *OverlayStore, sink FinalizeSink) (int64, error) {
	total := overlay.ChunkCount()
	var written int64
	for i := 0; i < total; i++ {
		if err := ctx.Err(); err != nil {
			return written, err
		}
		data, err := overlay.ReadChunk(ctx, i)
		if err != nil {
			return written, fmt.Errorf("finalize: reading chunk %d: %w", i, err)
		}
		if err := sink.WriteChunk(ctx, i, data); err != nil {
			return written, fmt.Errorf("finalize: writing chunk %d to standalone copy: %w", i, err)
		}
		written += int64(len(data))
	}
	if err := sink.Close(ctx); err != nil {
		return written, fmt.Errorf("finalize: closing standalone copy: %w", err)
	}
	return written, nil
}

// FinalizeSink receives the assembled standalone full copy chunk-by-chunk. The
// integration wiring satisfies it with a WORM-sealing sink (so the finalized
// copy is itself a fresh immutable recovery point); tests use an in-memory sink
// that records the bytes. Location reports where the copy landed.
type FinalizeSink interface {
	WriteChunk(ctx context.Context, i int, data []byte) error
	Close(ctx context.Context) error
	Location() string
}
