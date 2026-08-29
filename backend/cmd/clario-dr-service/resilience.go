package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/appconsistent"
	"github.com/clario360/platform/internal/dr/failback"
	"github.com/clario360/platform/internal/dr/instant"
	"github.com/clario360/platform/internal/dr/journal"
	drmodel "github.com/clario360/platform/internal/dr/model"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	drservice "github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/topology"
	drworm "github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events"
)

// resiliencePlane bundles the five ClarioDR resilience-depth packages (journal,
// appconsistent, instant, failback, topology) so main wires them with a single
// call, mirroring the Batch A intelligencePlane. Each is constructed with the
// real DR collaborators — the recovery-point sealer/reader (drservice.Service),
// the WORM/DEK store, the durable applied-frame store, and the replication
// stream/checkpoint state — no fakes. It exposes its HTTP surface for mounting
// under /api/v1/dr, the typed progress consumer it registers on every node, the
// frame observer the journal Appender folds into the apply path, and the
// leader-singleton background loops it must run on exactly one node.
type resiliencePlane struct {
	// mount mounts each package's chi.Router under the already-Auth+Tenant
	// protected /api/v1/dr group; each Router carries its own RequirePermission
	// gates (dr:read for queries, dr:write/dr:failover for actions).
	mount func(protected chi.Router)

	// progressConsumers are typed handlers that subscribe to the high-volume
	// datastream.dr.progress topic on EVERY node (no leadership), exactly like
	// predict's ingest. topology's per-edge health rollup is the only one.
	progressConsumers map[string][]events.TypedEventHandler

	// frameObservers are folded into the apply path so each durably-applied frame
	// is also appended into the CDP journal segment index. The journal Appender's
	// observer adapter is the only one.
	frameObservers []frameObserver

	// startLeaderLoops launches the leader-singleton background loops (journal
	// segment-rolling flush + retention, instant hydration, failback driver),
	// each gated by Redis leader election like startRPOMonitor/startFailoverDriver.
	startLeaderLoops func(ctx context.Context)

	// instantRecovery is the concrete COW session starter used by the failover
	// recovery executor so Gate 3 can boot from the instant overlay.
	instantRecovery drservice.InstantRecoveryService

	// flushJournal seals any open journal segment buffers on graceful shutdown so
	// the tail of un-rolled frames becomes recoverable. main defers it.
	flushJournal func(ctx context.Context)
}

// configureResiliencePlane constructs all five packages with their real
// collaborators. wormClient may be nil (WORM store not configured): the journal
// then seals segments by a deterministic framestore reference (the bytes are
// already durable in dr_applied_frame), instant serves from the same
// applied-frame base, and appconsistent still seals crash/app-consistent points
// through the DR service when the recovery-point store is wired (it returns
// dependency_not_configured otherwise, surfaced by the service).
func configureResiliencePlane(
	ctx context.Context,
	db *pgxpool.Pool,
	redisClient *redis.Client,
	repo *drrepo.Repository,
	drSvc *drservice.Service,
	wormClient *drworm.Client,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *resiliencePlane {
	plane := &resiliencePlane{
		progressConsumers: map[string][]events.TypedEventHandler{},
	}

	tenantRunner := drJournalRunner{pool: db}
	systemRunner := drservice.NewPGXSystemRunner(db)

	// ---- journal: continuous data protection (APIT) ---------------------
	journalStore := journal.NewStore()
	journalMetrics := journal.NewMetrics(metricsReg)
	segmentSink := drSegmentSink{worm: wormClient, retention: durationEnv("DR_JOURNAL_SEGMENT_RETENTION", 7*24*time.Hour)}
	segmentIO := drJournalSegmentStore{worm: wormClient, pool: db, repo: repo}
	journalAppender, err := journal.NewAppender(journal.AppenderConfig{
		Runner:    tenantRunner,
		Store:     journalStore,
		Sink:      segmentSink,
		Metrics:   journalMetrics,
		Logger:    logger,
		MaxFrames: intEnv("DR_JOURNAL_SEGMENT_MAX_FRAMES", 0),
		MaxBytes:  int64(intEnv("DR_JOURNAL_SEGMENT_MAX_BYTES", 0)),
		MaxAge:    durationEnv("DR_JOURNAL_SEGMENT_MAX_AGE", 30*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr journal appender")
	}
	journalSvc, err := journal.NewService(journal.ServiceConfig{
		Runner:  tenantRunner,
		Store:   journalStore,
		Metrics: journalMetrics,
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr journal service")
	}
	journalReplayer, err := journal.NewReplayer(journal.ReplayerConfig{
		Reader:   segmentIO,
		Metadata: segmentIO,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr journal replayer")
	}
	drSvc.WithJournal(journalSvc, journalReplayer)
	journalHandler := journal.NewHandler(journalSvc, logger)
	journalRetention, err := journal.NewRetentionLoop(journal.RetentionConfig{
		Runner:    tenantRunner,
		Source:    drJournalPruneSource{pool: db},
		Store:     journalStore,
		Reclaimer: segmentSink, // GOVERNANCE lifecycle reclaims WORM bytes; a nil-worm sink tombstones only.
		Metrics:   journalMetrics,
		Logger:    logger,
		Retention: durationEnv("DR_JOURNAL_SEGMENT_RETENTION", 7*24*time.Hour),
		Interval:  durationEnv("DR_JOURNAL_RETENTION_INTERVAL", time.Minute),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr journal retention loop")
	}
	// Fold the Appender into the apply path the SAME way Batch A folded the
	// ransomware Monitor: each durably-applied frame is appended into the journal
	// segment index after it is stored, behind the pipeline's ordered apply.
	plane.frameObservers = append(plane.frameObservers, &journalFrameObserver{appender: journalAppender})
	plane.flushJournal = func(flushCtx context.Context) {
		if ferr := journalAppender.FlushAll(flushCtx); ferr != nil {
			logger.Warn().Err(ferr).Msg("dr journal: flushing open segments on shutdown failed")
		}
	}

	// ---- appconsistent: application-consistent recovery points ----------
	appconsistentStore := appconsistent.NewStore()
	appconsistentCoord, err := appconsistent.NewCoordinator(appconsistent.Config{
		TX:     appconsistent.PGXRunner{Pool: db},
		Store:  appconsistentStore,
		Sealer: drAppConsistentSealer{drSvc: drSvc}, // the REAL recovery-point sealer (drservice.Service.SealRecoveryPoint)
		LSN:    drGroupLSNSource{pool: db, repo: repo},
		Fencer: drGroupMarkerFencer{
			pool: db,
			repo: repo,
			poll: durationEnv("DR_APPCONSISTENT_FENCE_POLL_INTERVAL", 250*time.Millisecond),
		},
		FenceTimeout: durationEnv("DR_APPCONSISTENT_FENCE_TIMEOUT", 60*time.Second),
		Logger:       logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr app-consistent coordinator")
	}
	appconsistentSvc, err := appconsistent.NewService(appconsistent.ServiceConfig{
		Coordinator: appconsistentCoord,
		Read:        appconsistent.PGXReadRunner{Pool: db},
		Store:       appconsistentStore,
		Logger:      logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr app-consistent service")
	}
	appconsistentHandler := appconsistent.NewHandler(appconsistentSvc, logger)

	// ---- instant: instant recovery (COW over a sealed recovery point) ---
	instantStoreOpts := []instant.StoreOption{}
	instantOverlayLocation := "db:dr_instant_overlay_chunk"
	if overlayDir := strings.TrimSpace(os.Getenv("DR_INSTANT_OVERLAY_DIR")); overlayDir != "" {
		overlayBlobs, err := instant.NewFileOverlayBlobStore(overlayDir)
		if err != nil {
			logger.Fatal().Err(err).Str("dir", overlayDir).Msg("failed to construct dr instant overlay blob store")
		}
		instantStoreOpts = append(instantStoreOpts, instant.WithOverlayBlobStore(overlayBlobs))
		instantOverlayLocation = "file:" + overlayDir
	}
	instantStore := instant.NewStore(instantStoreOpts...)
	instantMetrics := instant.NewMetrics(metricsReg)
	instantHydrator, err := instant.NewHydrator(instant.HydratorConfig{
		Store:      instantStore,
		Metrics:    instantMetrics,
		RatePerSec: float64(intEnv("DR_INSTANT_HYDRATE_RATE_PER_SEC", 0)),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr instant hydrator")
	}
	chunkSize := intEnv("DR_INSTANT_CHUNK_SIZE_BYTES", 4*1024*1024)
	baseReaders := drInstantBaseReaders{drSvc: drSvc, repo: repo, pool: db, chunkSize: chunkSize}
	instantDeps := instant.Deps{
		Store:           instantStore,
		Runner:          drInstantTenantRunner{pool: db},
		System:          systemRunner,
		BaseReaders:     baseReaders,
		Hydrator:        instantHydrator,
		Metrics:         instantMetrics,
		OverlayLocation: instantOverlayLocation,
		Logger:          logger,
	}
	// The finalize sink seals the assembled standalone copy back to WORM as a
	// fresh immutable object when the store is configured; without WORM the
	// FINALIZE action is unavailable (the sink factory is left nil, so a finalize
	// attempt surfaces "finalize sink factory is not configured").
	if wormClient != nil {
		instantDeps.Sinks = drInstantSinkFactory{worm: wormClient, chunkSize: chunkSize}
	}
	instantSvc, err := instant.NewService(instantDeps)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr instant service")
	}
	plane.instantRecovery = instantSvc
	instantRouter := instant.NewRouter(instantSvc, logger)
	instantLoop, err := instant.NewHydrateLoop(instant.HydrateLoopConfig{
		Driver:   instantSvc,
		Store:    instantStore,
		System:   systemRunner,
		Logger:   logger,
		Interval: durationEnv("DR_INSTANT_HYDRATE_INTERVAL", 2*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr instant hydrate loop")
	}

	// ---- failback: reverse replication + gated cutback ------------------
	failbackStore := failback.NewStore()
	failbackProber := drReverseStreamProber{pool: db, repo: repo, store: failbackStore}
	failbackTracker, err := failback.NewDeltaTracker(failbackProber)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr failback delta tracker")
	}
	failbackDriver, err := failback.New(failback.Config{
		Store:   failbackStore,
		Starter: drReverseStreamStarter{pool: db, repo: repo, store: failbackStore},
		Tracker: failbackTracker,
		Cutback: drCutbackExecutor{pool: db, repo: repo, store: failbackStore, logger: logger},
		Events:  failback.OutboxSink{},
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr failback driver")
	}
	failbackSvc, err := failback.NewService(failback.ServiceConfig{
		Pool:   db,
		Store:  failbackStore,
		Events: failback.OutboxStager{},
		Driver: failbackDriver,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr failback service")
	}
	failbackHandler := failback.NewHandler(failbackSvc, logger)
	failbackLoop, err := failback.NewLoop(failback.LoopConfig{
		Pool:     db,
		Claimer:  failbackStore,
		Driver:   failbackDriver,
		Logger:   logger,
		Interval: durationEnv("DR_FAILBACK_DRIVER_INTERVAL", 2*time.Second),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr failback driver loop")
	}

	// ---- topology: multi-site replication graph -------------------------
	topologyStore := topology.NewStore()
	topologyMetrics := topology.NewMetrics(metricsReg)
	topologySvc, err := topology.NewService(topology.Config{
		Store:   topologyStore,
		Runner:  topology.PGXRunner{Pool: db},
		Metrics: topologyMetrics,
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr topology service")
	}
	topologyRouter := topology.NewRouter(topologySvc, logger)
	topologyConsumer := topology.NewConsumer(topologySvc, topology.ConsumerConfig{
		Metrics: topologyMetrics,
		Logger:  logger,
	})
	// The per-edge health rollup is high-volume telemetry: like predict's ingest,
	// it runs on EVERY node (the Kafka consumer group balances partitions) — no
	// leadership — applying each datastream.dr.progress sample to every edge
	// carrying the sampled stream through a system (RLS-bypass) transaction.
	plane.progressConsumers[events.Topics.DRProgress] = append(
		plane.progressConsumers[events.Topics.DRProgress], topologyConsumer)

	// ---- HTTP mounting --------------------------------------------------
	// Each package's Router self-gates with RequirePermission per route, so all
	// five mount under the already-Auth+Tenant /api/v1/dr group at "/":
	//   - journal:       dr:read (timeline/resolve/bookmarks list), dr:write (bookmark create/delete)
	//   - appconsistent: dr:read (barrier history), dr:failover (trigger a quiesced point)
	//   - instant:       dr:read (session view), dr:failover (start + finalize)
	//   - failback:      dr:read (runs/steps), dr:failover (plan, approve-cutback, advance)
	//   - topology:      dr:read (view/select), dr:write (add edge)
	// The failback approve-cutback + advance routes are the dr:failover-gated
	// step-up cutback actions; its read views stay dr:read so a read-only operator
	// can watch convergence without the cutback permission.
	plane.mount = func(protected chi.Router) {
		mountRoutes(protected, journalHandler.Routes())
		mountRoutes(protected, appconsistentHandler.Routes())
		mountRoutes(protected, instantRouter.Routes())
		mountRoutes(protected, failbackHandler.Routes())
		mountRoutes(protected, topologyRouter.Routes())
	}

	// ---- leader-singleton background loops ------------------------------
	plane.startLeaderLoops = func(loopCtx context.Context) {
		// journal segment rolling + retention: a single leader sweeps aged
		// segments and force-rolls quiet streams' open buffers so the recovery
		// floor is bounded even with no fresh frames.
		runLeaderSingleton(loopCtx, redisClient, "dr-journal-retention",
			"DR_JOURNAL_RETENTION", logger, func(c context.Context) {
				go journalRollerLoop(c, journalAppender, durationEnv("DR_JOURNAL_ROLL_INTERVAL", 15*time.Second), logger)
				journalRetention.Run(c)
			}, nil)
		// instant hydration / deferred finalize.
		runLeaderSingleton(loopCtx, redisClient, "dr-instant-hydrator",
			"DR_INSTANT_HYDRATOR", logger, instantLoop.Run, nil)
		// failback driver claim loop (mirrors startFailoverDriver's discipline:
		// separate claim/advance system transactions inside the loop).
		runLeaderSingleton(loopCtx, redisClient, "dr-failback-driver",
			"DR_FAILBACK_DRIVER", logger, failbackLoop.Run, nil)
	}

	return plane
}

// mountRoutes copies every (method, pattern, middleware-wrapped handler) route
// of sub onto parent, so several package routers can share the SAME
// already-Auth+Tenant /api/v1/dr group. It is used instead of repeated
// parent.Mount("/", sub) calls because chi's Mount registers a "/*" subtree and
// panics if a second handler is mounted at the same "/" path — so multiple
// package routers cannot each be Mounted at "/". Walking and re-registering each
// concrete route preserves every package's own per-route RequirePermission
// middleware (chi.Walk yields the route's middleware chain) and keeps each
// route's own wildcard param name (so instant's {id} and the main handler's
// {recoveryPointID} both bind correctly under /recovery-points).
func mountRoutes(parent chi.Router, sub chi.Router) {
	if err := chi.Walk(sub, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		// chi.Walk appends a trailing slash to the mount root; normalise it so the
		// registered pattern matches the request path exactly.
		if route != "/" {
			route = strings.TrimSuffix(route, "/")
		}
		h := handler
		for i := len(middlewares) - 1; i >= 0; i-- {
			h = middlewares[i](h)
		}
		parent.Method(method, route, h)
		return nil
	}); err != nil {
		panic(fmt.Sprintf("dr resilience: walking package routes: %v", err))
	}
}

// journalRollerLoop force-seals any open segment buffers on a cadence so a quiet
// stream still rolls by time, bounding the un-journaled tail (the recovery
// floor). The Appender's own size/frame/age thresholds roll busy streams inline
// on Append; this loop is the time-based backstop for idle streams, run only on
// the leader alongside retention.
func journalRollerLoop(ctx context.Context, appender *journal.Appender, interval time.Duration, logger zerolog.Logger) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := appender.FlushAll(ctx); err != nil && ctx.Err() == nil {
				logger.Warn().Err(err).Msg("dr journal roller: flush failed")
			}
		}
	}
}

// ---------------------------------------------------------------------------
// journal collaborators
// ---------------------------------------------------------------------------

// journalFrameObserver adapts the journal Appender to the apply-path frameObserver
// contract. The apply path calls Observe(ctx, nil, tenantID, frame) AFTER a frame
// is durably stored (db is nil: observers own their transaction), and the
// Appender folds the frame into the open segment buffer, sealing through its own
// tenant transaction when a roll threshold trips.
type journalFrameObserver struct {
	appender *journal.Appender
}

func (o *journalFrameObserver) Observe(ctx context.Context, _ drrepo.DBTX, tenantID string, f core.Frame) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("dr journal observer: parsing tenant id %q: %w", tenantID, err)
	}
	return o.appender.Append(ctx, tid, f)
}

// drJournalRunner adapts the pool to journal.TenantRunner (read-write and
// read-only tenant transactions with RLS set).
type drJournalRunner struct{ pool *pgxpool.Pool }

func (r drJournalRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r drJournalRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// drSegmentSink durably backs sealed journal segments. The canonical sealed
// bytes are the length-prefixed applied-frame encoding for [minSeq,maxSeq] — the
// EXACT frames already durable in dr_applied_frame (the apply path wrote them
// before Observe ran). When WORM is configured it additionally writes an
// off-host immutable copy (GOVERNANCE object-lock + per-tenant DEK) and uses that
// key; otherwise it returns a deterministic framestore reference key. Both are
// real, resolvable durable references — no stub. It also satisfies
// journal.segmentReclaimer: a nil-worm sink tombstones the index row only (the
// GOVERNANCE lifecycle reclaims WORM bytes), matching the documented default.
type drSegmentSink struct {
	worm      *drworm.Client
	retention time.Duration
}

func (s drSegmentSink) SealSegment(ctx context.Context, tenantID uuid.UUID, streamID string, minSeq, maxSeq int64, payload []byte) (string, error) {
	if s.worm == nil {
		// Bytes are already durable in dr_applied_frame; the object_key is a
		// deterministic, resolvable reference into the framestore for this range.
		return fmt.Sprintf("framestore://%s/%s/%d-%d", tenantID, streamID, minSeq, maxSeq), nil
	}
	res, err := s.worm.Seal(ctx, bytes.NewReader(payload), drworm.SealOptions{
		TenantID:    tenantID,
		StreamID:    streamID,
		MarkerLSN:   fmt.Sprintf("journal:%d-%d", minSeq, maxSeq),
		RetainUntil: time.Now().Add(s.retention).UTC(),
	})
	if err != nil {
		return "", fmt.Errorf("dr journal: sealing segment bytes to worm: %w", err)
	}
	return res.Key, nil
}

func (s drSegmentSink) ReclaimSegment(ctx context.Context, _ uuid.UUID, _ string, objectKey string) error {
	if s.worm == nil || strings.HasPrefix(objectKey, "framestore://") {
		// No external object to delete: the framestore bytes are reclaimed with the
		// stream lifecycle, and GOVERNANCE-mode WORM objects are reclaimed by the
		// bucket's own retention lifecycle. Tombstoning the index row is sufficient.
		return nil
	}
	// Best-effort governance-bypass delete of the off-host copy past retention.
	if err := s.worm.BypassDelete(ctx, objectKey); err != nil {
		return fmt.Errorf("dr journal: reclaiming segment object %s: %w", objectKey, err)
	}
	return nil
}

// drJournalSegmentStore is the read side of drSegmentSink. WORM-backed journal
// objects are downloaded/decrypted directly; framestore references are
// reconstructed from dr_applied_frame into the same core.EncodeFrame byte stream
// the appender would have sealed.
type drJournalSegmentStore struct {
	worm *drworm.Client
	pool *pgxpool.Pool
	repo *drrepo.Repository
}

func (s drJournalSegmentStore) ReadSegment(ctx context.Context, tenantID uuid.UUID, seg journal.Segment) ([]byte, error) {
	if strings.HasPrefix(seg.ObjectKey, "framestore://") {
		return s.encodeFrameStoreRange(ctx, tenantID, seg)
	}
	if s.worm == nil {
		return nil, fmt.Errorf("journal segment %s is WORM-backed but WORM client is not configured", seg.ID)
	}
	return s.worm.Get(ctx, tenantID, seg.StreamID, seg.ObjectKey)
}

func (s drJournalSegmentStore) ListFrameMetadata(ctx context.Context, tenantID uuid.UUID, streamID string, minSeq, maxSeq int64) ([]journal.FrameMetadata, error) {
	frames, err := s.appliedFrameRange(ctx, tenantID, streamID, minSeq, maxSeq)
	if err != nil {
		return nil, err
	}
	out := make([]journal.FrameMetadata, 0, len(frames))
	for _, frame := range frames {
		out = append(out, journal.FrameMetadata{
			Seq:       uint64(frame.Seq),
			SourceLSN: frame.SourceMarker,
			At:        frame.AppliedAt,
		})
	}
	return out, nil
}

func (s drJournalSegmentStore) encodeFrameStoreRange(ctx context.Context, tenantID uuid.UUID, seg journal.Segment) ([]byte, error) {
	frames, err := s.appliedFrameRange(ctx, tenantID, seg.StreamID, seg.MinSeq, seg.MaxSeq)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	expected := seg.MinSeq
	for _, frame := range frames {
		if frame.Seq != expected {
			return nil, fmt.Errorf("framestore journal segment %s missing seq %d before %d", seg.ID, expected, frame.Seq)
		}
		kind, err := frameKindFromStore(frame.Kind)
		if err != nil {
			return nil, fmt.Errorf("framestore journal segment %s seq %d: %w", seg.ID, frame.Seq, err)
		}
		if err := core.EncodeFrame(&buf, core.Frame{
			StreamID:  seg.StreamID,
			Seq:       uint64(frame.Seq),
			Kind:      kind,
			Payload:   frame.Payload,
			SourceLSN: frame.SourceMarker,
			EmittedAt: frame.AppliedAt,
		}); err != nil {
			return nil, fmt.Errorf("encoding framestore journal frame seq=%d: %w", frame.Seq, err)
		}
		expected++
	}
	if expected != seg.MaxSeq+1 {
		return nil, fmt.Errorf("framestore journal segment %s ended at seq %d, expected through %d", seg.ID, expected-1, seg.MaxSeq)
	}
	return buf.Bytes(), nil
}

func (s drJournalSegmentStore) appliedFrameRange(ctx context.Context, tenantID uuid.UUID, streamID string, minSeq, maxSeq int64) ([]drrepo.AppliedFrame, error) {
	if s.pool == nil || s.repo == nil {
		return nil, fmt.Errorf("journal framestore reader is not configured")
	}
	var frames []drrepo.AppliedFrame
	if err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		var err error
		frames, err = s.repo.ListAppliedFramesRange(ctx, tx, tenantID.String(), streamID, minSeq-1, maxSeq)
		return err
	}); err != nil {
		return nil, fmt.Errorf("reading applied frame range stream=%s [%d,%d]: %w", streamID, minSeq, maxSeq, err)
	}
	return frames, nil
}

func frameKindFromStore(kind string) (core.FrameKind, error) {
	switch strings.ToUpper(strings.TrimSpace(kind)) {
	case core.FrameKindSnapshotChunk.String():
		return core.FrameKindSnapshotChunk, nil
	case core.FrameKindWAL.String():
		return core.FrameKindWAL, nil
	case core.FrameKindFileDelta.String():
		return core.FrameKindFileDelta, nil
	case core.FrameKindMarker.String():
		return core.FrameKindMarker, nil
	default:
		return 0, fmt.Errorf("unknown frame kind %q", kind)
	}
}

// drJournalPruneSource resolves the distinct streams that have live journal
// coverage across all tenants (system path) for the retention loop, exactly as
// the design reserves the integration phase to supply. It never edits the shared
// repository — it issues a system read against dr_journal_segment.
type drJournalPruneSource struct{ pool *pgxpool.Pool }

const streamsWithJournalSQL = `
SELECT DISTINCT tenant_id, stream_id
FROM dr_journal_segment
WHERE pruned = false
ORDER BY tenant_id, stream_id
LIMIT $1`

func (s drJournalPruneSource) StreamsWithJournal(ctx context.Context, limit int) ([]journal.PruneTarget, error) {
	if limit <= 0 {
		limit = 64
	}
	var targets []journal.PruneTarget
	err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(ctx, streamsWithJournalSQL, limit)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		for rows.Next() {
			var tenantID, streamID uuid.UUID
			if scanErr := rows.Scan(&tenantID, &streamID); scanErr != nil {
				return scanErr
			}
			targets = append(targets, journal.PruneTarget{TenantID: tenantID, StreamID: streamID})
		}
		return rows.Err()
	})
	if err != nil {
		return nil, fmt.Errorf("dr journal prune source: %w", err)
	}
	return targets, nil
}

// ---------------------------------------------------------------------------
// appconsistent collaborators
// ---------------------------------------------------------------------------

// drAppConsistentSealer adapts the DR service's SealRecoveryPoint to the
// appconsistent.RecoveryPointSealer contract (translating the one-field
// SealInput <-> drservice.SealRecoveryPointInput). It IS the real sealer: the
// Coordinator calls it only after a successful quiesce, so the sealed point is
// application-consistent.
type drAppConsistentSealer struct {
	drSvc *drservice.Service
}

func (s drAppConsistentSealer) SealRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in appconsistent.SealInput) (*drmodel.RecoveryPoint, error) {
	return s.drSvc.SealRecoveryPoint(ctx, tenantID, groupID, drservice.SealRecoveryPointInput{
		RetentionUntil: in.RetentionUntil,
	})
}

// drGroupLSNSource resolves the barrier LSN at quiesce: the max applied source
// LSN across a consistency group's member streams, so the sealed
// application-consistent point records the exact point in the change stream it
// corresponds to.
type drGroupLSNSource struct {
	pool *pgxpool.Pool
	repo *drrepo.Repository
}

func (s drGroupLSNSource) CurrentLSN(ctx context.Context, tenantID, groupID uuid.UUID) (string, error) {
	var lsn string
	err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		members, err := s.repo.ListGroupMembers(ctx, tx, groupID.String())
		if err != nil {
			return err
		}
		for _, m := range members {
			stream, gerr := s.repo.GetStreamBySite(ctx, tx, tenantID.String(), m.SiteID)
			if gerr != nil {
				return gerr
			}
			if stream.SourceLSN != nil && (lsn == "" || *stream.SourceLSN > lsn) {
				lsn = *stream.SourceLSN
			}
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("dr appconsistent LSN source: %w", err)
	}
	return lsn, nil
}

// drGroupMarkerFencer is the production application-consistency fence for
// source-cursor markers. A quiesce provider must return marker_lsn from the
// frozen source (for PostgreSQL, a script commonly runs CHECKPOINT followed by
// SELECT pg_current_wal_lsn()). This fencer then waits until every member stream
// has applied at or beyond that marker before the coordinator is allowed to seal
// a point as application-consistent.
type drGroupMarkerFencer struct {
	pool *pgxpool.Pool
	repo *drrepo.Repository
	poll time.Duration
}

func (s drGroupMarkerFencer) Fence(ctx context.Context, tenantID, groupID uuid.UUID, quiesce appconsistent.QuiesceResult) (appconsistent.StreamFence, error) {
	marker := strings.TrimSpace(quiesce.MarkerLSN)
	fence := appconsistent.StreamFence{MarkerLSN: marker}
	if marker == "" {
		return fence, fmt.Errorf("quiesce provider did not return marker_lsn")
	}
	if s.pool == nil || s.repo == nil {
		return fence, fmt.Errorf("database/repository not configured")
	}
	poll := s.poll
	if poll <= 0 {
		poll = 250 * time.Millisecond
	}

	ok, detail, err := s.drained(ctx, tenantID, groupID, marker)
	if err != nil {
		return fence, err
	}
	if ok {
		fence.Detail = detail
		return fence, nil
	}

	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fence, fmt.Errorf("timed out waiting for streams to drain to marker %s: %s: %w", marker, detail, ctx.Err())
		case <-ticker.C:
			ok, detail, err = s.drained(ctx, tenantID, groupID, marker)
			if err != nil {
				return fence, err
			}
			if ok {
				fence.Detail = detail
				return fence, nil
			}
		}
	}
}

func (s drGroupMarkerFencer) drained(ctx context.Context, tenantID, groupID uuid.UUID, marker string) (bool, string, error) {
	var pending []string
	var count int
	err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		members, err := s.repo.ListGroupMembers(ctx, tx, groupID.String())
		if err != nil {
			return err
		}
		count = len(members)
		for _, m := range members {
			stream, gerr := s.repo.GetStreamBySite(ctx, tx, tenantID.String(), m.SiteID)
			if gerr != nil {
				return gerr
			}
			current := ""
			if stream.SourceLSN != nil {
				current = strings.TrimSpace(*stream.SourceLSN)
			}
			if !sourceMarkerAtOrAfter(current, marker) {
				pending = append(pending, fmt.Sprintf("site=%s stream=%s source_lsn=%q", m.SiteID, stream.ID, current))
			}
		}
		return nil
	})
	if err != nil {
		return false, "", fmt.Errorf("dr appconsistent stream fence: %w", err)
	}
	if count == 0 {
		return false, "", fmt.Errorf("consistency group %s has no members to fence", groupID)
	}
	if len(pending) == 0 {
		return true, fmt.Sprintf("all %d member stream(s) drained to marker %s", count, marker), nil
	}
	sort.Strings(pending)
	return false, strings.Join(pending, "; "), nil
}

func sourceMarkerAtOrAfter(current, target string) bool {
	current = strings.TrimSpace(current)
	target = strings.TrimSpace(target)
	if current == "" || target == "" {
		return false
	}
	if c, ok := parsePGMarkerLSN(current); ok {
		if t, ok := parsePGMarkerLSN(target); ok {
			return c >= t
		}
	}
	return current >= target
}

func parsePGMarkerLSN(value string) (uint64, bool) {
	parts := strings.Split(strings.TrimSpace(value), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return 0, false
	}
	hi, err := strconv.ParseUint(parts[0], 16, 32)
	if err != nil {
		return 0, false
	}
	lo, err := strconv.ParseUint(parts[1], 16, 32)
	if err != nil {
		return 0, false
	}
	return (hi << 32) | lo, true
}

// ---------------------------------------------------------------------------
// instant collaborators
// ---------------------------------------------------------------------------

// drInstantTenantRunner adapts the pool to instant.TenantRunner (string tenant
// id variant).
type drInstantTenantRunner struct{ pool *pgxpool.Pool }

func (r drInstantTenantRunner) RunWithTenant(ctx context.Context, tenantID string, fn func(drrepo.DBTX) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("dr instant runner: parsing tenant id %q: %w", tenantID, err)
	}
	return database.RunWithTenant(ctx, r.pool, tid, func(tx pgx.Tx) error { return fn(tx) })
}

func (r drInstantTenantRunner) RunReadWithTenant(ctx context.Context, tenantID string, fn func(drrepo.DBTX) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return fmt.Errorf("dr instant runner: parsing tenant id %q: %w", tenantID, err)
	}
	return database.RunReadWithTenant(ctx, r.pool, tid, func(tx pgx.Tx) error { return fn(tx) })
}

// drInstantBaseReaders resolves the immutable base reader for a recovery point.
// The base is the REAL WORM/DEK sealed-chunk path: it loads the recovery point's
// sealed object keys, reads each member stream's sealed plaintext through
// drservice.Service.ReadSealedChunk (which downloads + decrypts via the per-tenant
// DEK), concatenates them in deterministic stream-id order, and slices the result
// into fixed-size chunks. The base is never mutated — the COW overlay redirects
// writes — so the recovery point stays ransomware-safe and re-usable.
type drInstantBaseReaders struct {
	drSvc     *drservice.Service
	repo      *drrepo.Repository
	pool      *pgxpool.Pool
	chunkSize int
}

func (b drInstantBaseReaders) BaseReader(ctx context.Context, tenantID, recoveryPointID uuid.UUID) (instant.BaseReader, error) {
	var point *drmodel.RecoveryPoint
	if err := database.RunReadWithTenant(ctx, b.pool, tenantID, func(tx pgx.Tx) error {
		var err error
		point, err = b.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), recoveryPointID.String())
		return err
	}); err != nil {
		return nil, fmt.Errorf("dr instant base reader: loading recovery point %s: %w", recoveryPointID, err)
	}

	streamIDs := make([]string, 0, len(point.ObjectKeys))
	for streamID := range point.ObjectKeys {
		streamIDs = append(streamIDs, streamID)
	}
	sort.Strings(streamIDs)

	chunkSize := b.chunkSize
	if chunkSize <= 0 {
		chunkSize = 4 * 1024 * 1024
	}
	return &drSealedPointBaseReader{
		drSvc:           b.drSvc,
		tenantID:        tenantID,
		recoveryPointID: recoveryPointID,
		streamIDs:       streamIDs,
		chunkSize:       chunkSize,
	}, nil
}

// drSealedPointBaseReader presents a recovery point's concatenated sealed
// plaintext (decrypted through the per-tenant DEK) as a fixed-size-chunk base. It
// lazily materializes and caches each member stream's plaintext on first read so
// chunk reads are served without re-downloading per chunk; the bytes are never
// mutated.
type drSealedPointBaseReader struct {
	drSvc           *drservice.Service
	tenantID        uuid.UUID
	recoveryPointID uuid.UUID
	streamIDs       []string
	chunkSize       int

	loaded bool
	data   []byte
	err    error
}

func (r *drSealedPointBaseReader) load(ctx context.Context) error {
	if r.loaded {
		return r.err
	}
	r.loaded = true
	var buf []byte
	for _, streamID := range r.streamIDs {
		plaintext, err := r.drSvc.ReadSealedChunk(ctx, r.tenantID, r.recoveryPointID, streamID)
		if err != nil {
			r.err = fmt.Errorf("dr instant base reader: reading sealed chunk for stream %s: %w", streamID, err)
			return r.err
		}
		buf = append(buf, plaintext...)
	}
	r.data = buf
	return nil
}

func (r *drSealedPointBaseReader) ChunkCount(ctx context.Context) (int, error) {
	if err := r.load(ctx); err != nil {
		return 0, err
	}
	if len(r.data) == 0 {
		return 0, nil
	}
	return (len(r.data) + r.chunkSize - 1) / r.chunkSize, nil
}

func (r *drSealedPointBaseReader) ChunkSize(ctx context.Context) (int, error) {
	return r.chunkSize, nil
}

func (r *drSealedPointBaseReader) ReadBaseChunk(ctx context.Context, i int) ([]byte, error) {
	if err := r.load(ctx); err != nil {
		return nil, err
	}
	start := i * r.chunkSize
	if start < 0 || start >= len(r.data) {
		return nil, fmt.Errorf("dr instant base reader: chunk %d out of range (bytes %d)", i, len(r.data))
	}
	end := start + r.chunkSize
	if end > len(r.data) {
		end = len(r.data)
	}
	out := make([]byte, end-start)
	copy(out, r.data[start:end])
	return out, nil
}

// drInstantSinkFactory seals an instant session's assembled standalone full copy
// back to the WORM bucket as a fresh immutable object (GOVERNANCE object-lock +
// per-tenant DEK), so a finalized recovery is itself a re-usable recovery point.
type drInstantSinkFactory struct {
	worm      *drworm.Client
	chunkSize int
}

func (f drInstantSinkFactory) FinalizeSink(ctx context.Context, tenantID, sessionID uuid.UUID) (instant.FinalizeSink, error) {
	return &drInstantWORMSink{
		worm:      f.worm,
		tenantID:  tenantID,
		sessionID: sessionID,
	}, nil
}

// drInstantWORMSink accumulates the finalized chunks and seals them as one WORM
// object on Close. The recovered dataset is bounded by the base recovery point,
// so buffering the standalone copy in memory before the single sealed write is
// acceptable and keeps the sealed object a single immutable blob.
type drInstantWORMSink struct {
	worm      *drworm.Client
	tenantID  uuid.UUID
	sessionID uuid.UUID
	buf       []byte
	location  string
}

func (s *drInstantWORMSink) WriteChunk(_ context.Context, _ int, data []byte) error {
	s.buf = append(s.buf, data...)
	return nil
}

func (s *drInstantWORMSink) Close(ctx context.Context) error {
	streamID := "instant-" + s.sessionID.String()
	res, err := s.worm.Seal(ctx, bytes.NewReader(s.buf), drworm.SealOptions{
		TenantID:  s.tenantID,
		StreamID:  streamID,
		MarkerLSN: "instant-finalize:" + s.sessionID.String(),
	})
	if err != nil {
		return fmt.Errorf("dr instant finalize: sealing standalone copy: %w", err)
	}
	s.location = "worm://" + res.Key
	return nil
}

func (s *drInstantWORMSink) Location() string { return s.location }

// ---------------------------------------------------------------------------
// failback collaborators
// ---------------------------------------------------------------------------

// drReverseStreamStarter establishes the durable reverse replication ledger (DR
// site -> original primary) during REVERSE_SYNCING. It is idempotent for a run:
// it reuses a deterministic reverse stream id derived from the run, binds it to
// the DR-side source stream and restored-primary target stream, and performs an
// initial durable frame-store sync so the handle represents real data movement,
// not only a synthetic id.
type drReverseStreamStarter struct {
	pool  *pgxpool.Pool
	repo  *drrepo.Repository
	store *failback.Store
}

func (s drReverseStreamStarter) StartReverseStream(ctx context.Context, cfg failback.ReverseStreamConfig) (failback.ReverseStreamHandle, error) {
	tenantID, err := uuid.Parse(cfg.TenantID)
	if err != nil {
		return failback.ReverseStreamHandle{}, fmt.Errorf("dr failback reverse-stream: parsing tenant id: %w", err)
	}
	if s.store == nil {
		return failback.ReverseStreamHandle{}, errors.New("dr failback reverse-stream: store is required")
	}
	var handle failback.ReverseStreamHandle
	if rerr := database.RunWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		rec, eerr := ensureFailbackReverseStream(ctx, tx, s.repo, s.store, cfg)
		if eerr != nil {
			return eerr
		}
		if serr := syncFailbackReverseStream(ctx, tx, s.repo, s.store, rec.StreamID); serr != nil {
			return serr
		}
		rec, eerr = s.store.GetReverseStream(ctx, tx, rec.StreamID)
		if eerr != nil {
			return eerr
		}
		handle = failback.ReverseStreamHandle{
			StreamID:  rec.StreamID,
			SourceLSN: stringValue(rec.HeadLSN),
		}
		return nil
	}); rerr != nil {
		return failback.ReverseStreamHandle{}, fmt.Errorf("dr failback reverse-stream: starting reverse ledger: %w", rerr)
	}
	return handle, nil
}

// drReverseStreamProber reports the live reverse-stream backlog from the
// dedicated failback ledger. Each probe first advances the reverse data plane by
// copying durable applied-frame bytes from the DR-side source stream into the
// restored-primary target stream, then reads the ledger's head/applied cursors.
// The cutover window still comes from the DR-side source stream being paused:
// without quiesce, the stream may be drained for this tick but cannot converge.
type drReverseStreamProber struct {
	pool  *pgxpool.Pool
	repo  *drrepo.Repository
	store *failback.Store
}

func (p drReverseStreamProber) Probe(ctx context.Context, streamID string) (failback.ReverseStreamProbe, error) {
	probe := failback.ReverseStreamProbe{StreamID: streamID}
	if p.store == nil {
		return probe, errors.New("dr failback prober: store is required")
	}
	err := database.RunSystemTx(ctx, p.pool, func(tx pgx.Tx) error {
		if err := syncFailbackReverseStream(ctx, tx, p.repo, p.store, streamID); err != nil {
			return err
		}
		rec, err := p.store.GetReverseStream(ctx, tx, streamID)
		if err != nil {
			return err
		}
		probe = rec.Probe()
		return nil
	})
	if err != nil {
		return failback.ReverseStreamProbe{}, fmt.Errorf("dr failback prober: %w", err)
	}
	return probe, nil
}

// drCutbackExecutor performs the gated cutback: it directs forward replication
// back to primary -> DR after proving the reverse stream is still drained under
// an open cutover window. It runs only in CUTTING_BACK (only reachable after an
// explicit approval) and is idempotent for a run.
type drCutbackExecutor struct {
	pool   *pgxpool.Pool
	repo   *drrepo.Repository
	store  *failback.Store
	logger zerolog.Logger
}

func (e drCutbackExecutor) ExecuteCutback(ctx context.Context, run *failback.FailbackRun) (map[string]any, error) {
	tenantID, err := uuid.Parse(run.TenantID)
	if err != nil {
		return nil, fmt.Errorf("dr failback cutback: parsing tenant id: %w", err)
	}
	if e.store == nil {
		return nil, errors.New("dr failback cutback: store is required")
	}
	if run.ReverseStreamID == nil || *run.ReverseStreamID == "" {
		return nil, errors.New("dr failback cutback: reverse stream is required")
	}

	detail := map[string]any{
		"from_site":         run.FromSite,
		"to_site":           run.ToSite,
		"group_id":          run.GroupID,
		"reverse_stream_id": *run.ReverseStreamID,
	}
	if rerr := database.RunWithTenant(ctx, e.pool, tenantID, func(tx pgx.Tx) error {
		if err := syncFailbackReverseStream(ctx, tx, e.repo, e.store, *run.ReverseStreamID); err != nil {
			return err
		}
		rec, err := e.store.GetReverseStream(ctx, tx, *run.ReverseStreamID)
		if err != nil {
			return err
		}
		if rec.HeadSeq > rec.AppliedSeq || rec.BytesPending > 0 {
			return fmt.Errorf("reverse stream %s not drained: head_seq=%d applied_seq=%d bytes_pending=%d: %w",
				rec.StreamID, rec.HeadSeq, rec.AppliedSeq, rec.BytesPending, failback.ErrInvalidState)
		}
		if !rec.CutoverWindowOpen {
			return fmt.Errorf("reverse stream %s cutover window is closed: %w", rec.StreamID, failback.ErrInvalidState)
		}

		source, err := e.repo.GetStream(ctx, tx, run.TenantID, rec.SourceStreamID)
		if err != nil {
			return fmt.Errorf("loading DR source stream %s: %w", rec.SourceStreamID, err)
		}
		target, err := e.repo.GetStream(ctx, tx, run.TenantID, rec.TargetStreamID)
		if err != nil {
			return fmt.Errorf("loading restored-primary target stream %s: %w", rec.TargetStreamID, err)
		}
		if source.Status != drmodel.StreamStatusPaused {
			return fmt.Errorf("DR source stream %s must be paused before cutback: %w", source.ID, failback.ErrInvalidState)
		}

		if serr := e.repo.SetStreamStatus(ctx, tx, run.TenantID, source.ID, drmodel.StreamStatusPaused); serr != nil {
			return serr
		}
		if serr := e.repo.SetStreamStatus(ctx, tx, run.TenantID, target.ID, drmodel.StreamStatusStreaming); serr != nil {
			return serr
		}
		if err := e.store.UpdateReverseProgress(ctx, tx, rec.StreamID, failback.ReverseStreamProgress{
			HeadSeq:           rec.HeadSeq,
			AppliedSeq:        rec.AppliedSeq,
			HeadLSN:           rec.HeadLSN,
			AppliedLSN:        rec.AppliedLSN,
			BytesPending:      0,
			CutoverWindowOpen: rec.CutoverWindowOpen,
			Status:            failback.ReverseStreamStatusClosed,
		}); err != nil {
			return err
		}
		detail["dr_source_stream"] = source.ID
		detail["restored_primary_stream"] = target.ID
		detail["head_seq"] = rec.HeadSeq
		detail["applied_seq"] = rec.AppliedSeq
		detail["source_lsn"] = stringValue(rec.HeadLSN)
		detail["applied_lsn"] = stringValue(rec.AppliedLSN)
		return nil
	}); rerr != nil {
		return nil, fmt.Errorf("dr failback cutback: re-pointing forward replication: %w", rerr)
	}
	return detail, nil
}

func failbackReverseStreamID(runID string) string {
	return "reverse-" + runID
}

func ensureFailbackReverseStream(ctx context.Context, db drrepo.DBTX, repo *drrepo.Repository, store *failback.Store, cfg failback.ReverseStreamConfig) (*failback.ReverseStreamRecord, error) {
	source, err := repo.GetStreamBySite(ctx, db, cfg.TenantID, cfg.FromSite)
	if err != nil {
		return nil, fmt.Errorf("loading failback DR source stream for site %s: %w", cfg.FromSite, err)
	}
	target, err := repo.GetStreamBySite(ctx, db, cfg.TenantID, cfg.ToSite)
	if err != nil {
		return nil, fmt.Errorf("loading failback restored-primary target stream for site %s: %w", cfg.ToSite, err)
	}
	return store.UpsertReverseStream(ctx, db, failback.ReverseStreamUpsert{
		StreamID:       failbackReverseStreamID(cfg.RunID),
		RunID:          cfg.RunID,
		TenantID:       cfg.TenantID,
		GroupID:        cfg.GroupID,
		FromSite:       cfg.FromSite,
		ToSite:         cfg.ToSite,
		SourceStreamID: source.ID,
		TargetStreamID: target.ID,
	})
}

func syncFailbackReverseStream(ctx context.Context, db drrepo.DBTX, repo *drrepo.Repository, store *failback.Store, streamID string) error {
	rec, err := store.GetReverseStream(ctx, db, streamID)
	if err != nil {
		return err
	}
	source, err := repo.GetStream(ctx, db, rec.TenantID, rec.SourceStreamID)
	if err != nil {
		return fmt.Errorf("loading failback reverse source stream %s: %w", rec.SourceStreamID, err)
	}
	target, err := repo.GetStream(ctx, db, rec.TenantID, rec.TargetStreamID)
	if err != nil {
		return fmt.Errorf("loading failback reverse target stream %s: %w", rec.TargetStreamID, err)
	}
	if source.AppliedSeq < 0 {
		return fmt.Errorf("source stream %s has negative applied seq %d: %w", source.ID, source.AppliedSeq, failback.ErrInvalidState)
	}
	if rec.AppliedSeq < 0 {
		return fmt.Errorf("reverse stream %s has negative applied seq %d: %w", rec.StreamID, rec.AppliedSeq, failback.ErrInvalidState)
	}
	if source.AppliedSeq < rec.AppliedSeq {
		return fmt.Errorf("source stream %s rewound from reverse applied seq %d to head %d: %w",
			source.ID, rec.AppliedSeq, source.AppliedSeq, failback.ErrInvalidState)
	}

	appliedSeq := rec.AppliedSeq
	appliedLSN := rec.AppliedLSN
	targetSeq := target.AppliedSeq
	if targetSeq < 0 {
		targetSeq = 0
	}
	if source.AppliedSeq > appliedSeq {
		frames, err := repo.ListAppliedFramesRange(ctx, db, rec.TenantID, source.ID, appliedSeq, source.AppliedSeq)
		if err != nil {
			return err
		}
		expected := appliedSeq + 1
		nextTargetSeq := targetSeq + 1
		appliedAt := time.Now().UTC()
		// sourceCommittedAt tracks the last applied source frame's original
		// apply time — when that data became durable at the origin (now the
		// source). It is the source-commit input to the true source-to-target
		// RPO (applied_at - source_committed_at) surfaced by the RPO monitor.
		var sourceCommittedAt *time.Time
		for _, frame := range frames {
			if frame.Seq != expected {
				return fmt.Errorf("source stream %s missing contiguous frame seq %d before %d: %w",
					source.ID, expected, frame.Seq, failback.ErrInvalidState)
			}
			if _, err := repo.AppendAppliedFrame(ctx, db, drrepo.AppendAppliedFrameInput{
				TenantID:      rec.TenantID,
				StreamID:      target.ID,
				Seq:           nextTargetSeq,
				Kind:          frame.Kind,
				SourceMarker:  frame.SourceMarker,
				Payload:       frame.Payload,
				PayloadSHA256: frame.PayloadSHA256,
				PayloadBytes:  frame.PayloadBytes,
				AppliedAt:     appliedAt,
			}); err != nil {
				return fmt.Errorf("applying reverse frame source_seq=%d target_seq=%d: %w", frame.Seq, nextTargetSeq, err)
			}
			appliedSeq = frame.Seq
			nextTargetSeq++
			targetSeq++
			if !frame.AppliedAt.IsZero() {
				committed := frame.AppliedAt.UTC()
				sourceCommittedAt = &committed
			}
			if frame.SourceMarker != "" {
				marker := frame.SourceMarker
				appliedLSN = &marker
			}
			expected++
		}
		if appliedSeq != source.AppliedSeq {
			return fmt.Errorf("source stream %s has incomplete durable frame range: applied reverse seq %d, source head %d: %w",
				source.ID, appliedSeq, source.AppliedSeq, failback.ErrInvalidState)
		}
		status := target.Status
		if status == "" {
			status = drmodel.StreamStatusSeeding
		}
		if err := repo.UpdateStreamCheckpoint(ctx, db, rec.TenantID, target.ID, targetSeq, stringValue(appliedLSN), appliedAt, status, sourceCommittedAt); err != nil {
			return err
		}
	}

	headLSN := source.SourceLSN
	if headLSN == nil && appliedLSN != nil {
		headLSN = appliedLSN
	}
	bytesPending := int64(0)
	if source.AppliedSeq > appliedSeq {
		bytesPending = source.AppliedSeq - appliedSeq
	}
	status := failback.ReverseStreamStatusSyncing
	if bytesPending == 0 && source.Status == drmodel.StreamStatusPaused {
		status = failback.ReverseStreamStatusDrained
	}
	return store.UpdateReverseProgress(ctx, db, rec.StreamID, failback.ReverseStreamProgress{
		HeadSeq:           source.AppliedSeq,
		AppliedSeq:        appliedSeq,
		HeadLSN:           headLSN,
		AppliedLSN:        appliedLSN,
		BytesPending:      bytesPending,
		CutoverWindowOpen: source.Status == drmodel.StreamStatusPaused,
		Status:            status,
	})
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
