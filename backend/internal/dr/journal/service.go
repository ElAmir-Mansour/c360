package journal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// journalStore is the persistence surface the service uses for timeline,
// bookmark and resolve reads/writes.
type journalStore interface {
	ListSegments(ctx context.Context, db repository.DBTX, tenantID, streamID string) ([]Segment, error)
	ListBookmarks(ctx context.Context, db repository.DBTX, tenantID, streamID string) ([]Bookmark, error)
	GetBookmark(ctx context.Context, db repository.DBTX, tenantID, streamID, id string) (*Bookmark, error)
	CreateBookmark(ctx context.Context, db repository.DBTX, b *Bookmark) error
	DeleteBookmark(ctx context.Context, db repository.DBTX, tenantID, streamID, id string) error
}

// Service is the request-path API for the CDP journal: timeline, bookmark CRUD,
// and any-point-in-time resolution. Every method runs inside a tenant-scoped
// transaction (RLS set), and a bookmark write stages its lifecycle event in the
// same transaction via the outbox so the restore point and its event commit
// together.
type Service struct {
	runner  TenantRunner
	store   journalStore
	metrics *Metrics
	logger  zerolog.Logger
	now     func() time.Time
	compare func(a, b string) int
}

// ServiceConfig wires a Service.
type ServiceConfig struct {
	Runner  TenantRunner
	Store   journalStore
	Metrics *Metrics
	Logger  zerolog.Logger
	Now     func() time.Time
	// CompareLSNFn orders source LSNs for LSN resolution; nil uses CompareLSN.
	CompareLSNFn func(a, b string) int
}

// NewService constructs the journal service. Runner and Store are required.
func NewService(cfg ServiceConfig) (*Service, error) {
	if cfg.Runner == nil {
		return nil, errors.New("journal service: tenant runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("journal service: store is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	compare := cfg.CompareLSNFn
	if compare == nil {
		compare = CompareLSN
	}
	return &Service{
		runner:  cfg.Runner,
		store:   cfg.Store,
		metrics: cfg.Metrics,
		logger:  cfg.Logger.With().Str("service", "dr-journal").Logger(),
		now:     now,
		compare: compare,
	}, nil
}

// Timeline returns a stream's journal coverage: live segments, bookmarks, and
// the earliest/latest recoverable instant. It also updates the live-coverage
// SLO gauge as a side effect of the read so the dashboard reflects the window.
func (s *Service) Timeline(ctx context.Context, tenantID, streamID uuid.UUID) (*Timeline, error) {
	if tenantID == uuid.Nil || streamID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and stream id are required", ErrInvalid)
	}
	var segs []Segment
	var bms []Bookmark
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		if segs, err = s.store.ListSegments(ctx, tx, tenantID.String(), streamID.String()); err != nil {
			return err
		}
		bms, err = s.store.ListBookmarks(ctx, tx, tenantID.String(), streamID.String())
		return err
	}); err != nil {
		return nil, err
	}
	tl := BuildTimeline(streamID.String(), segs, bms)
	if tl.Recoverable {
		s.metrics.SetCoverageSeconds(streamID.String(), tl.LatestTS.Sub(tl.EarliestTS).Seconds())
	} else {
		s.metrics.SetCoverageSeconds(streamID.String(), 0)
	}
	return &tl, nil
}

// CreateBookmarkInput is the request body for POST .../bookmarks.
type CreateBookmarkInput struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	// AtSeq pins the restore point by Seq. When zero, AtTS or AtLSN is resolved
	// to a Seq against the current segment index first.
	AtSeq int64 `json:"at_seq"`
	// AtTS / AtLSN are alternative pin targets, resolved to the cut Seq.
	AtTS  *time.Time `json:"at_ts"`
	AtLSN string     `json:"at_lsn"`
	Note  string     `json:"note"`
}

// CreateBookmark records a named restore point. The pin is normalized to a
// concrete (Seq, LSN, TS) by resolving the request against the current segment
// index, so a bookmark always references a recoverable instant. The row and a
// dr.journal.bookmark.created event are written in one transaction.
func (s *Service) CreateBookmark(ctx context.Context, tenantID, streamID uuid.UUID, userID *uuid.UUID, in CreateBookmarkInput) (*Bookmark, error) {
	if tenantID == uuid.Nil || streamID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and stream id are required", ErrInvalid)
	}
	if in.Name == "" {
		return nil, fmt.Errorf("%w: bookmark name is required", ErrInvalid)
	}
	kind := in.Kind
	if kind == "" {
		kind = BookmarkManual
	}
	if !ValidBookmarkKind(kind) {
		return nil, fmt.Errorf("%w: bookmark kind %q", ErrInvalid, kind)
	}
	if in.AtSeq == 0 && in.AtTS == nil && in.AtLSN == "" {
		return nil, fmt.Errorf("%w: one of at_seq, at_ts, at_lsn is required", ErrInvalid)
	}

	bm := &Bookmark{
		TenantID: tenantID.String(),
		StreamID: streamID.String(),
		Name:     in.Name,
		Kind:     kind,
		Note:     in.Note,
		AtSeq:    in.AtSeq,
		AtLSN:    in.AtLSN,
	}
	if userID != nil {
		uid := userID.String()
		bm.CreatedBy = &uid
	}
	if in.AtTS != nil {
		bm.AtTS = *in.AtTS
	}

	if err := s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		// Resolve the pin to a concrete Seq/LSN/TS against the live index so the
		// bookmark protects the right segment.
		if err := s.normalizePin(ctx, tx, tenantID, streamID, in, bm); err != nil {
			return err
		}
		if err := s.store.CreateBookmark(ctx, tx, bm); err != nil {
			return err
		}
		evt, err := events.NewEvent(EventTypeBookmarkCreated, eventSource, tenantID.String(), map[string]any{
			"stream_id":   bm.StreamID,
			"bookmark_id": bm.ID,
			"name":        bm.Name,
			"kind":        bm.Kind,
			"at_seq":      bm.AtSeq,
			"at_lsn":      bm.AtLSN,
			"at_ts":       bm.AtTS,
		})
		if err != nil {
			return fmt.Errorf("building bookmark-created event: %w", err)
		}
		return outbox.Write(ctx, tx, drEventsTopic, evt)
	}); err != nil {
		return nil, err
	}

	s.metrics.IncBookmark(bm.Kind)
	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("stream_id", bm.StreamID).
		Str("name", bm.Name).
		Str("kind", bm.Kind).
		Int64("at_seq", bm.AtSeq).
		Msg("journal bookmark created")
	return bm, nil
}

// normalizePin fills bm.AtSeq/AtLSN/AtTS from whatever pin the request supplied,
// by resolving it against the current segment index inside the open tx.
func (s *Service) normalizePin(ctx context.Context, tx repository.DBTX, tenantID, streamID uuid.UUID, in CreateBookmarkInput, bm *Bookmark) error {
	// An explicit Seq pin is authoritative; only backfill TS/LSN if absent.
	if in.AtSeq > 0 {
		if bm.AtTS.IsZero() || bm.AtLSN == "" {
			segs, err := s.store.ListSegments(ctx, tx, tenantID.String(), streamID.String())
			if err != nil {
				return err
			}
			if res, rerr := ResolveAtSeq(segs, in.AtSeq); rerr == nil {
				if bm.AtTS.IsZero() {
					bm.AtTS = res.CutTS
				}
				if bm.AtLSN == "" {
					bm.AtLSN = res.CutLSN
				}
			} else if bm.AtTS.IsZero() {
				bm.AtTS = s.now()
			}
		}
		return nil
	}

	segs, err := s.store.ListSegments(ctx, tx, tenantID.String(), streamID.String())
	if err != nil {
		return err
	}
	var res *Resolution
	switch {
	case in.AtTS != nil:
		res, err = ResolveAt(segs, *in.AtTS)
	case in.AtLSN != "":
		res, err = ResolveAtLSN(segs, in.AtLSN, s.compare)
	}
	if err != nil {
		return fmt.Errorf("pinning bookmark: %w", err)
	}
	bm.AtSeq = res.CutSeq
	if bm.AtLSN == "" {
		bm.AtLSN = res.CutLSN
	}
	if bm.AtTS.IsZero() {
		bm.AtTS = res.CutTS
	}
	return nil
}

// ListBookmarks returns a stream's restore points (newest pins last).
func (s *Service) ListBookmarks(ctx context.Context, tenantID, streamID uuid.UUID) ([]Bookmark, error) {
	var bms []Bookmark
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		bms, err = s.store.ListBookmarks(ctx, tx, tenantID.String(), streamID.String())
		return err
	}); err != nil {
		return nil, err
	}
	return bms, nil
}

// DeleteBookmark removes a restore point, un-protecting its segment from
// retention. It stages no event (deletion is an operator action, not a
// replication lifecycle event) but is transactional for RLS scoping.
func (s *Service) DeleteBookmark(ctx context.Context, tenantID, streamID, id uuid.UUID) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		return s.store.DeleteBookmark(ctx, tx, tenantID.String(), streamID.String(), id.String())
	})
}

// ResolveRequest names the target instant for a resolve.
type ResolveRequest struct {
	// Exactly one of At / LSN / Seq must be set.
	At  *time.Time
	LSN string
	Seq *int64
}

// Resolve computes the exact ordered segment set + cut to reconstruct the
// stream's state as of the requested instant (timestamp, LSN, or Seq). It is a
// pure read; the resolver math runs against the live + tombstoned segment index.
func (s *Service) Resolve(ctx context.Context, tenantID, streamID uuid.UUID, req ResolveRequest) (*Resolution, error) {
	if tenantID == uuid.Nil || streamID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant and stream id are required", ErrInvalid)
	}
	set := 0
	if req.At != nil {
		set++
	}
	if req.LSN != "" {
		set++
	}
	if req.Seq != nil {
		set++
	}
	if set != 1 {
		return nil, fmt.Errorf("%w: exactly one of at, lsn, seq is required", ErrInvalid)
	}

	var segs []Segment
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		segs, err = s.store.ListSegments(ctx, tx, tenantID.String(), streamID.String())
		return err
	}); err != nil {
		return nil, err
	}

	var (
		res    *Resolution
		err    error
		target string
	)
	switch {
	case req.At != nil:
		target = "timestamp"
		res, err = ResolveAt(segs, *req.At)
	case req.LSN != "":
		target = "lsn"
		res, err = ResolveAtLSN(segs, req.LSN, s.compare)
	default:
		target = "seq"
		res, err = ResolveAtSeq(segs, *req.Seq)
	}
	if err != nil {
		s.metrics.IncResolve(target, resolveOutcome(err))
		return nil, err
	}
	res.StreamID = streamID.String()
	if res.BoundaryClamped {
		s.metrics.IncResolve(target, "clamped")
	} else {
		s.metrics.IncResolve(target, "resolved")
	}
	return res, nil
}

func resolveOutcome(err error) string {
	switch {
	case errors.Is(err, ErrPruned):
		return "pruned"
	case errors.Is(err, ErrNoCoverage):
		return "no_coverage"
	default:
		return "error"
	}
}
