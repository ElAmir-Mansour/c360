package ransomware

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	// EventTypeRansomwareSuspected is staged to the DR alerts topic on a
	// confirmed anomaly.
	EventTypeRansomwareSuspected = "dr.ransomware.suspected"

	defaultSource = "clario360/clario-dr-service/ransomware-monitor"
)

// EventSink stages an alert event into a durable bus. OutboxSink stages to the
// transactional outbox; tests use an in-memory recorder.
type EventSink interface {
	Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error
}

// OutboxSink stages monitor events in event_outbox.
type OutboxSink struct{}

// Stage writes event to the transactional outbox using the caller's DB handle.
func (OutboxSink) Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error {
	return outbox.Write(ctx, db, topic, event)
}

// WORMPinner mirrors the recovery-point legal-hold onto the underlying WORM
// objects (the real ransomware-immutability floor). *worm.Client's SetLegalHold
// satisfies a thin adapter; it is optional so unit tests need no object store.
type WORMPinner interface {
	SetLegalHold(ctx context.Context, key string, hold bool) error
}

// SignalStore is the persistence + curation surface the monitor drives. *Store
// satisfies it against PostgreSQL; tests inject an in-memory implementation that
// performs the same real lookups (resolve newest clean point, pin it, insert
// signals) so the monitor test exercises the curation logic, not only mocks.
type SignalStore interface {
	InsertSignal(ctx context.Context, db repository.DBTX, sig *Signal) error
	UpsertBaseline(ctx context.Context, db repository.DBTX, b Baseline) error
	SystemLatestCleanRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID string, notLaterThan time.Time) (*CleanPoint, error)
	SystemPinCleanRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) (bool, error)
}

// TxRunner runs a unit of work inside one transaction so the signal insert, the
// clean-point pin, and the outbox event commit atomically. The system path does
// not set a tenant (the detector loop is a leader singleton).
type TxRunner interface {
	RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error
}

// PGXTxRunner adapts a pgx pool to TxRunner on the system path.
type PGXTxRunner struct {
	Pool *pgxpool.Pool
}

// RunInTx executes fn inside a PostgreSQL transaction with RLS bypass enabled so
// the cross-tenant detector loop can read recovery points and write signals.
func (r PGXTxRunner) RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("ransomware monitor: nil transaction pool")
	}
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// MonitorConfig wires the monitor.
type MonitorConfig struct {
	Topic   string
	Source  string
	Now     func() time.Time
	Metrics *Metrics
	// PinWORM, when set, mirrors the pinned recovery point's legal-hold onto its
	// sealed WORM objects after the DB commit.
	PinWORM WORMPinner
}

// Monitor turns the streaming Detector's window verdicts into persisted signals,
// staged events, and clean-point curation. It is the wiring layer; the Detector
// holds the algorithm. The apply/ingest path calls Observe per frame; the
// returned Detection (on a closed window) is handed to HandleDetection.
type Monitor struct {
	det     *Detector
	store   SignalStore
	sink    EventSink
	tx      TxRunner
	topic   string
	source  string
	now     func() time.Time
	metrics *Metrics
	pinWORM WORMPinner
	logger  zerolog.Logger
}

// NewMonitor constructs a Monitor. sink and tx may be nil in tests; when tx is
// nil HandleDetection runs against the DB handle passed to it directly.
func NewMonitor(det *Detector, store SignalStore, sink EventSink, tx TxRunner, cfg MonitorConfig, logger zerolog.Logger) *Monitor {
	topic := cfg.Topic
	if topic == "" {
		topic = events.Topics.DRAlerts
	}
	source := cfg.Source
	if source == "" {
		source = defaultSource
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Monitor{
		det:     det,
		store:   store,
		sink:    sink,
		tx:      tx,
		topic:   topic,
		source:  source,
		now:     now,
		metrics: cfg.Metrics,
		pinWORM: cfg.PinWORM,
		logger:  logger.With().Str("component", "dr-ransomware-monitor").Logger(),
	}
}

// Observe folds a frame into the detector and, when the frame closes a window,
// processes the resulting Detection (persist signals, emit metrics, and on a
// confirmed anomaly curate the clean recovery point). It is the single entry
// point the apply/ingest path calls per frame. db is the handle used when no
// TxRunner is wired; production wires a TxRunner and may pass a nil db.
func (m *Monitor) Observe(ctx context.Context, db repository.DBTX, tenantID string, f core.Frame) error {
	det := m.det.Observe(tenantID, f, m.now())
	if det == nil {
		return nil
	}
	_, err := m.HandleDetection(ctx, db, det)
	return err
}

// FlushStream forces evaluation of a stream's open window and processes any
// resulting Detection — used by a periodic tick when frames stop arriving and
// on graceful shutdown so a half-full attack window is not lost.
func (m *Monitor) FlushStream(ctx context.Context, db repository.DBTX, tenantID, streamID string) error {
	det := m.det.Flush(tenantID, streamID)
	if det == nil {
		return nil
	}
	_, err := m.HandleDetection(ctx, db, det)
	return err
}

// Result summarizes the side effects of handling one Detection.
type Result struct {
	SignalsPersisted int
	Confirmed        bool
	CuratedPointID   string
	EventStaged      bool
}

// HandleDetection persists the detection's signals, emits metrics, and — when
// the detection is confirmed — resolves and pins the last-known-clean recovery
// point and stages dr.ransomware.suspected. The persistence + pin + event run in
// one transaction so they commit atomically. A detection with no signals only
// updates the learned baseline (already done in the detector) and the entropy
// gauge; it never curates.
func (m *Monitor) HandleDetection(ctx context.Context, db repository.DBTX, det *Detection) (*Result, error) {
	if det == nil {
		return &Result{}, nil
	}
	// The entropy gauge is updated every closed window so the dashboard tracks
	// the live entropy even before any signal fires.
	m.metrics.SetEntropy(det.StreamID, det.MeanEntropy)

	if len(det.Signals) == 0 {
		return &Result{}, nil
	}

	res := &Result{Confirmed: det.Confirmed}

	// Persist the baseline drift snapshot alongside the signals so a restart
	// resumes the learned steady-state. The snapshot reads the detector's
	// post-window state.
	baseline, hasBaseline := m.det.SnapshotBaseline(det.TenantID, det.StreamID)

	var curated *CleanPoint

	work := func(tx repository.DBTX) error {
		// 1. Resolve the clean recovery point BEFORE persisting (a confirmed
		//    anomaly curates the newest validated point sealed before the window
		//    that confirmed it, so a point sealed mid-attack is excluded).
		var curatedID string
		if det.Confirmed {
			cp, err := m.store.SystemLatestCleanRecoveryPoint(ctx, tx, det.TenantID, windowStart(det))
			switch {
			case err == nil:
				ok, perr := m.store.SystemPinCleanRecoveryPoint(ctx, tx, det.TenantID, cp.ID)
				if perr != nil {
					return perr
				}
				if ok {
					curatedID = cp.ID
					curated = cp
				}
			case errors.Is(err, ErrNoCleanPoint):
				// No clean point to pin yet (e.g. a brand-new stream attacked
				// before its first validated recovery point). The signals are
				// still persisted and the event still staged so operators see it.
				m.logger.Warn().Str("tenant", det.TenantID).Str("stream", det.StreamID).
					Msg("confirmed ransomware anomaly but no clean recovery point to curate")
			default:
				return err
			}
		}
		res.CuratedPointID = curatedID

		// 2. Persist each signal (stamping the curated point id on confirmed ones).
		for i := range det.Signals {
			sig := det.Signals[i]
			if det.Confirmed && curatedID != "" {
				sig.CuratedRecoveryPointID = curatedID
			}
			if err := m.store.InsertSignal(ctx, tx, &sig); err != nil {
				return err
			}
			det.Signals[i] = sig
			res.SignalsPersisted++
		}

		// 3. Persist the learned baseline.
		if hasBaseline {
			if err := m.store.UpsertBaseline(ctx, tx, baseline); err != nil {
				return err
			}
		}

		// 4. On a confirmed anomaly, stage the alert event in the same tx.
		if det.Confirmed && m.sink != nil {
			event, err := m.newEvent(det, curatedID)
			if err != nil {
				return err
			}
			if err := m.sink.Stage(ctx, tx, m.topic, event); err != nil {
				return err
			}
			res.EventStaged = true
		}
		return nil
	}

	if m.tx != nil {
		if err := m.tx.RunInTx(ctx, work); err != nil {
			return nil, err
		}
	} else if err := work(db); err != nil {
		return nil, err
	}

	// Metrics after a successful commit so counters reflect durable state.
	for _, sig := range det.Signals {
		m.metrics.IncSignal(det.StreamID, sig.Kind)
	}
	if det.Confirmed {
		m.metrics.IncConfirmed(det.StreamID)
		if res.CuratedPointID != "" {
			m.metrics.IncCurated()
			// Mirror the legal-hold onto the curated point's sealed WORM objects
			// (best-effort, post-commit) so the real object-lock floor is set.
			if m.pinWORM != nil && curated != nil {
				m.mirrorWORMHold(ctx, curated)
			}
		}
	}
	return res, nil
}

// mirrorWORMHold sets the object-lock legal-hold on every sealed object of the
// curated recovery point, using the object keys captured when the point was
// pinned. Failures are logged, not fatal: the DB legal_hold column is already
// authoritative and committed.
func (m *Monitor) mirrorWORMHold(ctx context.Context, cp *CleanPoint) {
	if m.pinWORM == nil || cp == nil {
		return
	}
	var keys map[string]string
	if len(cp.ObjectKeys) > 0 {
		if err := json.Unmarshal(cp.ObjectKeys, &keys); err != nil {
			m.logger.Warn().Err(err).Str("recovery_point", cp.ID).Msg("unmarshaling curated object keys")
			return
		}
	}
	for _, key := range keys {
		if err := m.pinWORM.SetLegalHold(ctx, key, true); err != nil {
			m.logger.Warn().Err(err).Str("object", key).Msg("mirroring WORM legal-hold on curated recovery point")
		}
	}
}

func (m *Monitor) newEvent(det *Detection, curatedID string) (*events.Event, error) {
	kinds := make([]string, 0, len(det.Signals))
	for _, s := range det.Signals {
		kinds = append(kinds, s.Kind)
	}
	payload := EventPayload{
		TenantID:               det.TenantID,
		StreamID:               det.StreamID,
		Severity:               SeverityConfirmed,
		SignalKinds:            kinds,
		Signals:                det.Signals,
		MeanEntropy:            det.MeanEntropy,
		LastSeq:                det.LastSeq,
		SourceLSN:              det.LastLSN,
		CuratedRecoveryPointID: curatedID,
		ObservedAt:             det.WindowEnd,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("ransomware: marshaling event payload: %w", err)
	}
	return &events.Event{
		ID:              events.GenerateUUID(),
		Source:          m.source,
		SpecVersion:     "1.0",
		Type:            normalizeEventType(EventTypeRansomwareSuspected),
		DataContentType: "application/json",
		Subject:         det.StreamID,
		Time:            det.WindowEnd,
		Timestamp:       det.WindowEnd,
		TenantID:        det.TenantID,
		CorrelationID:   events.GenerateUUID(),
		Data:            data,
		Metadata: map[string]string{
			"stream_id": det.StreamID,
		},
	}, nil
}

// EventPayload is the JSON body of a dr.ransomware.suspected event.
type EventPayload struct {
	TenantID               string    `json:"tenant_id"`
	StreamID               string    `json:"stream_id"`
	Severity               string    `json:"severity"`
	SignalKinds            []string  `json:"signal_kinds"`
	Signals                []Signal  `json:"signals"`
	MeanEntropy            float64   `json:"mean_entropy"`
	LastSeq                uint64    `json:"last_seq"`
	SourceLSN              string    `json:"source_lsn,omitempty"`
	CuratedRecoveryPointID string    `json:"curated_recovery_point_id,omitempty"`
	ObservedAt             time.Time `json:"observed_at"`
}

// windowStart derives the clean-point cutoff: the start of the confirmed window.
// We use the window end minus the detector's window so a point sealed inside the
// attack window is excluded as a restore target. The detector exposes WindowEnd;
// the cutoff is conservative (the window start).
func windowStart(det *Detection) time.Time {
	// The detector does not expose the window start on Detection (only the end),
	// so use the earliest signal observation when available, else the end.
	cutoff := det.WindowEnd
	for _, s := range det.Signals {
		if !s.ObservedAt.IsZero() && s.ObservedAt.Before(cutoff) {
			cutoff = s.ObservedAt
		}
	}
	return cutoff
}

func normalizeEventType(t string) string {
	return t
}
