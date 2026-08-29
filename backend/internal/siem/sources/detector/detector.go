package detector

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/repo"
)

// Elector is the Phase 3A leadership primitive. Only the leader runs
// the detector's emission steps.
type Elector interface {
	IsLeader() bool
}

// EventEmitter abstracts the kafka + WS publish surface.
type EventEmitter interface {
	EmitSourceEvent(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error
}

// Config captures detector knobs from SIEM-03 §4.11.
type Config struct {
	Interval            time.Duration
	BaselineMinSamples  int
	DriftThreshold      float64
	RecoveryThreshold   float64
	HeartbeatGap        time.Duration
	CertExpiryWindow    time.Duration
	EWMAAlpha           float64
	RecoveryConsecutive int
	EPSRetention        time.Duration
	CleanupInterval     time.Duration
}

// DefaultConfig returns SIEM-03 §4.11 defaults.
func DefaultConfig() Config {
	return Config{
		Interval:            time.Minute,
		BaselineMinSamples:  60,
		DriftThreshold:      -0.50,
		RecoveryThreshold:   -0.30,
		HeartbeatGap:        5 * time.Minute,
		CertExpiryWindow:    30 * 24 * time.Hour,
		EWMAAlpha:           0.05,
		RecoveryConsecutive: 3,
		EPSRetention:        7 * 24 * time.Hour,
		CleanupInterval:     6 * time.Hour,
	}
}

// Detector is the §4.8 silent-source detector.
type Detector struct {
	repo    *repo.SourcesRepo
	eps     *repo.EPSRepo
	elector Elector
	emitter EventEmitter
	rdb     *redis.Client
	metrics *sources.Metrics
	cfg     Config
	logger  zerolog.Logger
	now     func() time.Time
	state   *stateMap
	running atomic.Bool
}

// New constructs a Detector.
func New(
	r *repo.SourcesRepo,
	eps *repo.EPSRepo,
	elector Elector,
	emitter EventEmitter,
	rdb *redis.Client,
	metrics *sources.Metrics,
	cfg Config,
	logger zerolog.Logger,
) *Detector {
	if cfg.Interval == 0 {
		cfg = DefaultConfig()
	}
	return &Detector{
		repo:    r,
		eps:     eps,
		elector: elector,
		emitter: emitter,
		rdb:     rdb,
		metrics: metrics,
		cfg:     cfg,
		logger:  logger.With().Str("component", "siem-detector").Logger(),
		now:     func() time.Time { return time.Now().UTC() },
		state:   newStateMap(),
	}
}

// Start runs the detector loop until ctx is done.
func (d *Detector) Start(ctx context.Context) error {
	if !d.running.CompareAndSwap(false, true) {
		return errors.New("detector already running")
	}
	defer d.running.Store(false)
	t := time.NewTicker(d.cfg.Interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if d.elector != nil && !d.elector.IsLeader() {
				continue
			}
			d.runOnce(ctx)
		}
	}
}

// runOnce drives a single detector tick. Public for tests.
func (d *Detector) runOnce(ctx context.Context) {
	start := time.Now()
	defer func() {
		if d.metrics != nil {
			d.metrics.DetectorRunDuration.Observe(time.Since(start).Seconds())
		}
	}()

	list, err := d.repo.ListActive(ctx)
	if err != nil {
		d.logger.Warn().Err(err).Msg("list active sources")
		return
	}

	for i := range list {
		d.processSource(ctx, &list[i])
	}

	// Refresh the sources-by-status gauge.
	if d.metrics != nil {
		if counts, err := d.repo.CountByTenantStatus(ctx); err == nil {
			for tenant, byStatus := range counts {
				for status, n := range byStatus {
					d.metrics.SourcesTotal.WithLabelValues(tenant, string(status)).Set(float64(n))
				}
			}
		}
	}
}

func (d *Detector) processSource(ctx context.Context, src *sources.Source) {
	tenant := src.TenantID.String()
	id := src.ID.String()
	now := d.now()

	sample, _ := d.eps.Latest(ctx, src.ID, 90*time.Second)
	st := d.state.get(src.ID)

	// Heartbeat-gap check (independent of baseline).
	if src.LastSeenAt == nil || now.Sub(*src.LastSeenAt) > d.cfg.HeartbeatGap {
		d.maybeTransitionSilent(ctx, src, "gap", st)
		if d.metrics != nil {
			if src.LastSeenAt != nil {
				d.metrics.SourceLastSeenAge.WithLabelValues(tenant, id).Set(now.Sub(*src.LastSeenAt).Seconds())
			}
		}
		return
	}

	if sample == nil {
		return
	}

	// EWMA baseline update.
	alpha := d.cfg.EWMAAlpha
	prev := float64(src.BaselineEPS)
	samples := src.BaselineSamples
	if samples < d.cfg.BaselineMinSamples {
		// Warm-up: simple running average until baseline locks.
		new := (prev*float64(samples) + float64(sample.EPS5Min)) / float64(samples+1)
		_ = d.repo.UpdateBaseline(ctx, src.ID, int(new+0.5), samples+1)
		return
	}
	new := prev + alpha*(float64(sample.EPS5Min)-prev)
	if err := d.repo.UpdateBaseline(ctx, src.ID, int(new+0.5), samples+1); err != nil {
		d.logger.Warn().Err(err).Msg("update baseline")
	}

	drift := 0.0
	if src.BaselineEPS > 0 {
		drift = (float64(sample.EPS5Min) - float64(src.BaselineEPS)) / float64(src.BaselineEPS)
	}
	if d.metrics != nil {
		d.metrics.SourceEPSCurrent.WithLabelValues(tenant, id, "1min").Set(float64(sample.EPS1Min))
		d.metrics.SourceEPSCurrent.WithLabelValues(tenant, id, "5min").Set(float64(sample.EPS5Min))
		d.metrics.SourceBaselineEPS.WithLabelValues(tenant, id).Set(new)
		d.metrics.SourceDriftPct.WithLabelValues(tenant, id).Set(drift)
	}

	if drift < d.cfg.DriftThreshold {
		d.maybeTransitionSilent(ctx, src, "drift", st)
		st.recoverStreak = 0
		return
	}

	// Recovery: 3 consecutive in-range samples after silence.
	if src.Status == sources.StatusSilent && drift > d.cfg.RecoveryThreshold {
		st.recoverStreak++
		if st.recoverStreak >= d.cfg.RecoveryConsecutive {
			d.transitionRecovered(ctx, src, st)
		}
	} else {
		st.recoverStreak = 0
	}

	// Cert expiry warning.
	if src.CertExpiresAt != nil && time.Until(*src.CertExpiresAt) < d.cfg.CertExpiryWindow {
		d.maybeEmitCertExpiry(ctx, src)
	}
	if src.CertExpiresAt != nil && d.metrics != nil {
		d.metrics.SourceCertExpiryDays.WithLabelValues(tenant, id).Set(time.Until(*src.CertExpiresAt).Hours() / 24)
	}
}

func (d *Detector) maybeTransitionSilent(ctx context.Context, src *sources.Source, reason string, st *sourceState) {
	if src.Status == sources.StatusSilent {
		return // dedup: already silent
	}
	if err := d.repo.SetStatusUnchecked(ctx, src.ID, sources.StatusSilent); err != nil {
		d.logger.Warn().Err(err).Msg("flip silent")
		return
	}
	if d.metrics != nil {
		d.metrics.DetectorSilentTrans.WithLabelValues(src.TenantID.String(), reason).Inc()
	}
	if d.emitter != nil {
		eventType := "siem.source.silent"
		if reason == "gap" {
			eventType = "siem.source.heartbeat.gap"
		}
		_ = d.emitter.EmitSourceEvent(ctx, src.TenantID, src.ID, eventType, map[string]any{
			"reason": reason, "source": src,
		})
	}
	st.recoverStreak = 0
}

func (d *Detector) transitionRecovered(ctx context.Context, src *sources.Source, st *sourceState) {
	if err := d.repo.SetStatusUnchecked(ctx, src.ID, sources.StatusActive); err != nil {
		d.logger.Warn().Err(err).Msg("flip recovered")
		return
	}
	if d.metrics != nil {
		d.metrics.DetectorRecoveredTotal.WithLabelValues(src.TenantID.String()).Inc()
	}
	if d.emitter != nil {
		_ = d.emitter.EmitSourceEvent(ctx, src.TenantID, src.ID, "siem.source.recovered", src)
	}
	st.recoverStreak = 0
}

func (d *Detector) maybeEmitCertExpiry(ctx context.Context, src *sources.Source) {
	if d.rdb == nil {
		// No dedup available — emit conservatively at most once per
		// in-process state entry.
		st := d.state.get(src.ID)
		st.mu.Lock()
		defer st.mu.Unlock()
		if d.now().Sub(st.lastCertExpiryEmit) < 24*time.Hour {
			return
		}
		st.lastCertExpiryEmit = d.now()
		if d.emitter != nil {
			_ = d.emitter.EmitSourceEvent(ctx, src.TenantID, src.ID, "siem.source.cert.expiring", src)
		}
		return
	}
	key := fmt.Sprintf("siem:cert:expiring:%s:%s", src.TenantID, src.ID)
	ok, err := d.rdb.SetNX(ctx, key, "1", 24*time.Hour).Result()
	if err != nil || !ok {
		return
	}
	if d.emitter != nil {
		_ = d.emitter.EmitSourceEvent(ctx, src.TenantID, src.ID, "siem.source.cert.expiring", src)
	}
}

// --- state (in-process) ---

type sourceState struct {
	mu                 sync.Mutex
	recoverStreak      int
	lastCertExpiryEmit time.Time
}

type stateMap struct {
	mu   sync.RWMutex
	data map[uuid.UUID]*sourceState
}

func newStateMap() *stateMap { return &stateMap{data: map[uuid.UUID]*sourceState{}} }

func (m *stateMap) get(id uuid.UUID) *sourceState {
	m.mu.RLock()
	if s, ok := m.data[id]; ok {
		m.mu.RUnlock()
		return s
	}
	m.mu.RUnlock()
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.data[id]; ok {
		return s
	}
	s := &sourceState{}
	m.data[id] = s
	return s
}
