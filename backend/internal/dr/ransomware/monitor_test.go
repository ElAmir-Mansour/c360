package ransomware

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"sort"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
)

// memRecoveryPoint is an in-memory recovery_point row for the fake store.
type memRecoveryPoint struct {
	id          string
	groupID     string
	markerLSN   string
	sealedAt    time.Time
	isValidated bool
	legalHold   bool
	objectKeys  map[string]string
}

// memStore is an in-memory SignalStore that performs the SAME real lookups the
// PostgreSQL Store does: it resolves the newest validated recovery point sealed
// at or before a cutoff, pins it (legal_hold), and records inserted signals and
// baselines. This makes the monitor test exercise the curation logic for real,
// not against a no-op mock.
type memStore struct {
	points    []memRecoveryPoint
	signals   []Signal
	baselines map[string]Baseline

	pinCalls     int
	pinnedIDs    []string
	resolveCalls int
}

func newMemStore() *memStore {
	return &memStore{baselines: map[string]Baseline{}}
}

func (m *memStore) InsertSignal(_ context.Context, _ repository.DBTX, sig *Signal) error {
	if !ValidSignalKind(sig.Kind) {
		return errors.New("invalid kind")
	}
	sig.ID = events.GenerateUUID()
	sig.CreatedAt = time.Now().UTC()
	m.signals = append(m.signals, *sig)
	return nil
}

func (m *memStore) UpsertBaseline(_ context.Context, _ repository.DBTX, b Baseline) error {
	m.baselines[b.StreamID] = b
	return nil
}

func (m *memStore) SystemLatestCleanRecoveryPoint(_ context.Context, _ repository.DBTX, tenantID string, notLaterThan time.Time) (*CleanPoint, error) {
	m.resolveCalls++
	if notLaterThan.IsZero() {
		notLaterThan = time.Now().UTC()
	}
	// Newest validated point sealed at or before the cutoff (the real query).
	var best *memRecoveryPoint
	for i := range m.points {
		p := &m.points[i]
		if !p.isValidated {
			continue
		}
		if p.sealedAt.After(notLaterThan) {
			continue
		}
		if best == nil || p.sealedAt.After(best.sealedAt) {
			best = p
		}
	}
	if best == nil {
		return nil, ErrNoCleanPoint
	}
	keysJSON, _ := json.Marshal(best.objectKeys)
	return &CleanPoint{
		ID:         best.id,
		GroupID:    best.groupID,
		MarkerLSN:  best.markerLSN,
		SealedAt:   best.sealedAt,
		ObjectKeys: keysJSON,
	}, nil
}

func (m *memStore) SystemPinCleanRecoveryPoint(_ context.Context, _ repository.DBTX, tenantID, recoveryPointID string) (bool, error) {
	m.pinCalls++
	for i := range m.points {
		if m.points[i].id == recoveryPointID {
			m.points[i].legalHold = true
			m.pinnedIDs = append(m.pinnedIDs, recoveryPointID)
			return true, nil
		}
	}
	return false, nil
}

// memSink records staged events.
type memSink struct {
	topics []string
	events []*events.Event
}

func (s *memSink) Stage(_ context.Context, _ repository.DBTX, topic string, e *events.Event) error {
	s.topics = append(s.topics, topic)
	s.events = append(s.events, e)
	return nil
}

// memPinner records WORM legal-hold mirrors.
type memPinner struct {
	held []string
	err  error
}

func (p *memPinner) SetLegalHold(_ context.Context, key string, hold bool) error {
	if p.err != nil {
		return p.err
	}
	if hold {
		p.held = append(p.held, key)
	}
	return nil
}

func newTestMonitor(t *testing.T, store SignalStore, sink EventSink, pinner WORMPinner) *Monitor {
	t.Helper()
	det := NewDetector(testConfig())
	return NewMonitor(det, store, sink, nil, MonitorConfig{
		Now:     func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) },
		PinWORM: pinner,
	}, zerolog.Nop())
}

// confirmedDetection builds a Detection with two distinct signal kinds (so it
// is confirmed) anchored at observedAt — independent of the streaming detector,
// so the monitor's curation path is tested in isolation.
func confirmedDetection(observedAt time.Time) *Detection {
	return &Detection{
		StreamID:    detTestStream,
		TenantID:    detTestTenant,
		WindowEnd:   observedAt,
		MeanEntropy: 7.9,
		Confirmed:   true,
		Signals: []Signal{
			{TenantID: detTestTenant, StreamID: detTestStream, Kind: SignalEntropy, Severity: SeverityConfirmed, Observed: 7.9, Threshold: 7.5, ObservedAt: observedAt},
			{TenantID: detTestTenant, StreamID: detTestStream, Kind: SignalByteRate, Severity: SeverityConfirmed, Observed: 1e6, Ratio: 20, Threshold: 5, ObservedAt: observedAt},
		},
	}
}

func warningDetection(observedAt time.Time) *Detection {
	return &Detection{
		StreamID:    detTestStream,
		TenantID:    detTestTenant,
		WindowEnd:   observedAt,
		MeanEntropy: 7.9,
		Confirmed:   false,
		Signals: []Signal{
			{TenantID: detTestTenant, StreamID: detTestStream, Kind: SignalEntropy, Severity: SeverityWarning, Observed: 7.9, Threshold: 7.5, ObservedAt: observedAt},
		},
	}
}

// Confirmed anomaly: the clean point is curated exactly once, its id is stamped
// on the signals, and the event is staged to the DR alerts topic.
func TestMonitor_ConfirmedAnomaly_CuratesCleanPoint(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := newMemStore()
	store.points = []memRecoveryPoint{
		{id: "rp-old", groupID: "g1", sealedAt: now.Add(-2 * time.Hour), isValidated: true, objectKeys: map[string]string{"s1": "k-old"}},
		{id: "rp-clean", groupID: "g1", sealedAt: now.Add(-10 * time.Minute), isValidated: true, objectKeys: map[string]string{"s1": "k-clean"}},
		// A point sealed DURING the attack window must be excluded as a target.
		{id: "rp-dirty", groupID: "g1", sealedAt: now.Add(1 * time.Minute), isValidated: true, objectKeys: map[string]string{"s1": "k-dirty"}},
		// An unvalidated point is never a clean target.
		{id: "rp-unval", groupID: "g1", sealedAt: now.Add(-1 * time.Minute), isValidated: false, objectKeys: map[string]string{"s1": "k-unval"}},
	}
	sink := &memSink{}
	pinner := &memPinner{}
	m := newTestMonitor(t, store, sink, pinner)

	res, err := m.HandleDetection(context.Background(), nil, confirmedDetection(now))
	if err != nil {
		t.Fatalf("HandleDetection: %v", err)
	}

	if store.pinCalls != 1 {
		t.Fatalf("clean-point pin invoked %d times, want exactly 1", store.pinCalls)
	}
	if res.CuratedPointID != "rp-clean" {
		t.Fatalf("curated point = %q, want rp-clean (newest validated before the window)", res.CuratedPointID)
	}
	if !res.Confirmed || !res.EventStaged {
		t.Fatalf("expected confirmed+event staged, got %+v", res)
	}
	if res.SignalsPersisted != 2 {
		t.Fatalf("persisted %d signals, want 2", res.SignalsPersisted)
	}
	// Every persisted signal must carry the curated point id.
	for _, s := range store.signals {
		if s.CuratedRecoveryPointID != "rp-clean" {
			t.Fatalf("signal %q curated id = %q, want rp-clean", s.Kind, s.CuratedRecoveryPointID)
		}
	}
	// Event staged to DR alerts with the right type.
	if len(sink.events) != 1 || sink.topics[0] != events.Topics.DRAlerts {
		t.Fatalf("expected 1 event to %s, got topics=%v", events.Topics.DRAlerts, sink.topics)
	}
	if sink.events[0].Type != EventTypeRansomwareSuspected {
		t.Fatalf("event type = %q, want %q", sink.events[0].Type, EventTypeRansomwareSuspected)
	}
	var payload EventPayload
	if err := sink.events[0].Unmarshal(&payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.CuratedRecoveryPointID != "rp-clean" || payload.Severity != SeverityConfirmed {
		t.Fatalf("event payload = %+v", payload)
	}
	// WORM legal-hold mirrored onto the curated point's sealed object.
	if len(pinner.held) != 1 || pinner.held[0] != "k-clean" {
		t.Fatalf("WORM legal-hold mirror = %v, want [k-clean]", pinner.held)
	}
}

// A warning-level detection (single signal kind) must NOT curate: no pin, no
// event. This is the exactly-on-confirmed-anomaly assertion's negative case.
func TestMonitor_Warning_DoesNotCurate(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := newMemStore()
	store.points = []memRecoveryPoint{
		{id: "rp-clean", groupID: "g1", sealedAt: now.Add(-10 * time.Minute), isValidated: true, objectKeys: map[string]string{"s1": "k-clean"}},
	}
	sink := &memSink{}
	pinner := &memPinner{}
	m := newTestMonitor(t, store, sink, pinner)

	res, err := m.HandleDetection(context.Background(), nil, warningDetection(now))
	if err != nil {
		t.Fatalf("HandleDetection: %v", err)
	}

	if store.pinCalls != 0 || store.resolveCalls != 0 {
		t.Fatalf("warning must not resolve/pin a clean point (resolve=%d pin=%d)", store.resolveCalls, store.pinCalls)
	}
	if res.CuratedPointID != "" || res.EventStaged {
		t.Fatalf("warning must not curate or stage: %+v", res)
	}
	if res.SignalsPersisted != 1 {
		t.Fatalf("warning should still persist its 1 signal, got %d", res.SignalsPersisted)
	}
	if len(pinner.held) != 0 {
		t.Fatalf("no WORM hold expected for a warning, got %v", pinner.held)
	}
	if len(sink.events) != 0 {
		t.Fatalf("no event expected for a warning, got %d", len(sink.events))
	}
}

// A confirmed anomaly with no clean recovery point still persists signals and
// stages the event (so operators are alerted) but curates nothing.
func TestMonitor_ConfirmedNoCleanPoint_StillAlerts(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := newMemStore() // no recovery points at all
	sink := &memSink{}
	pinner := &memPinner{}
	m := newTestMonitor(t, store, sink, pinner)

	res, err := m.HandleDetection(context.Background(), nil, confirmedDetection(now))
	if err != nil {
		t.Fatalf("HandleDetection: %v", err)
	}

	if store.resolveCalls != 1 {
		t.Fatalf("confirmed anomaly must attempt to resolve a clean point once, got %d", store.resolveCalls)
	}
	if store.pinCalls != 0 || res.CuratedPointID != "" {
		t.Fatalf("no clean point to pin: pin=%d curated=%q", store.pinCalls, res.CuratedPointID)
	}
	if !res.EventStaged || res.SignalsPersisted != 2 {
		t.Fatalf("should still alert + persist: %+v", res)
	}
	if len(pinner.held) != 0 {
		t.Fatalf("no WORM hold without a curated point, got %v", pinner.held)
	}
}

// Observe -> HandleDetection through the real streaming detector: a full attack
// window confirms and curates the clean point exactly once.
func TestMonitor_Observe_EndToEndCuratesOnce(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := newMemStore()
	store.points = []memRecoveryPoint{
		{id: "rp-clean", groupID: "g1", sealedAt: start.Add(-1 * time.Minute), isValidated: true, objectKeys: map[string]string{"s1": "k-clean"}},
	}
	sink := &memSink{}
	pinner := &memPinner{}
	det := NewDetector(testConfig())
	m := NewMonitor(det, store, sink, nil, MonitorConfig{
		Now: func() time.Time { return start },
	}, zerolog.Nop())

	// Warm the baseline with quiet windows, then unleash an attack window.
	seq := uint64(1)
	for w := 0; w < 6; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		if err := m.Observe(context.Background(), nil, detTestTenant, walFrame(seq, walOpUpsert, lowEntropyBody(4), base)); err != nil {
			t.Fatalf("observe warm: %v", err)
		}
		seq++
	}
	attackBase := start.Add(7 * time.Second)
	for i := 0; i < 15; i++ {
		op := byte(walOpUpsert)
		if i%2 == 0 {
			op = byte(walOpDelete)
		}
		if err := m.Observe(context.Background(), nil, detTestTenant, walFrame(seq, op, highEntropyBody(t, 2000), attackBase.Add(time.Duration(i)*time.Millisecond))); err != nil {
			t.Fatalf("observe attack: %v", err)
		}
		seq++
	}
	// Flush the open attack window.
	if err := m.FlushStream(context.Background(), nil, detTestTenant, detTestStream); err != nil {
		t.Fatalf("flush: %v", err)
	}

	if store.pinCalls != 1 {
		t.Fatalf("end-to-end attack should pin the clean point exactly once, got %d", store.pinCalls)
	}
	if len(store.pinnedIDs) != 1 || store.pinnedIDs[0] != "rp-clean" {
		t.Fatalf("pinned ids = %v, want [rp-clean]", store.pinnedIDs)
	}
	// At least one confirmed event must have been staged.
	confirmed := 0
	for _, e := range sink.events {
		if e.Type == EventTypeRansomwareSuspected {
			confirmed++
		}
	}
	if confirmed == 0 {
		t.Fatal("expected at least one dr.ransomware.suspected event end-to-end")
	}
	if len(pinner.held) == 0 {
		// pinner is nil here (not wired), so this should be skipped; guard for clarity.
		t.Log("no WORM pinner wired in this scenario")
	}
}

func TestMonitor_NoSignals_OnlyUpdatesEntropyGauge(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	store := newMemStore()
	sink := &memSink{}
	m := newTestMonitor(t, store, sink, nil)

	det := &Detection{StreamID: detTestStream, TenantID: detTestTenant, WindowEnd: now, MeanEntropy: 3.2}
	res, err := m.HandleDetection(context.Background(), nil, det)
	if err != nil {
		t.Fatalf("HandleDetection: %v", err)
	}
	if res.SignalsPersisted != 0 || res.EventStaged || res.CuratedPointID != "" {
		t.Fatalf("a no-signal detection must be inert, got %+v", res)
	}
	if len(store.signals) != 0 || len(sink.events) != 0 {
		t.Fatalf("nothing should be persisted or staged: signals=%d events=%d", len(store.signals), len(sink.events))
	}
}

// windowStart must pick the earliest signal observation as the clean-point
// cutoff so a point sealed within the attack window is excluded.
func TestWindowStartUsesEarliestSignal(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 6, 13, 12, 0, 10, 0, time.UTC)
	early := end.Add(-9 * time.Second)
	det := &Detection{
		WindowEnd: end,
		Signals: []Signal{
			{ObservedAt: end},
			{ObservedAt: early},
		},
	}
	if got := windowStart(det); !got.Equal(early) {
		t.Fatalf("windowStart = %v, want earliest signal %v", got, early)
	}
}

// Compile-time guarantee that the production Store satisfies the interfaces the
// monitor and handler depend on.
var (
	_ SignalStore  = (*Store)(nil)
	_ SignalReader = (*Store)(nil)
)

func TestDetectorEmitsSignalsInStableOrder(t *testing.T) {
	t.Parallel()
	// The real detector must emit a confirmed window's signals in a stable
	// (sorted-by-kind) order so persistence and event payloads are deterministic.
	d := NewDetector(testConfig())
	start := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	seq := uint64(1)
	var dets []*Detection
	for w := 0; w < 6; w++ {
		base := start.Add(time.Duration(w) * time.Second)
		if det := d.Observe(detTestTenant, walFrame(seq, walOpUpsert, lowEntropyBody(4), base), start); det != nil {
			dets = append(dets, det)
		}
		seq++
	}
	attackBase := start.Add(7 * time.Second)
	for i := 0; i < 15; i++ {
		op := byte(walOpUpsert)
		if i%2 == 0 {
			op = byte(walOpDelete)
		}
		if det := d.Observe(detTestTenant, walFrame(seq, op, highEntropyBody(t, 2000), attackBase.Add(time.Duration(i)*time.Millisecond)), start); det != nil {
			dets = append(dets, det)
		}
		seq++
	}
	if det := d.Flush(detTestTenant, detTestStream); det != nil {
		dets = append(dets, det)
	}

	sawMulti := false
	for _, det := range dets {
		if len(det.Signals) < 2 {
			continue
		}
		sawMulti = true
		kinds := make([]string, len(det.Signals))
		for i, s := range det.Signals {
			kinds[i] = s.Kind
		}
		if !sort.StringsAreSorted(kinds) {
			t.Fatalf("expected sorted signal kinds, got %v", kinds)
		}
	}
	if !sawMulti {
		t.Fatal("expected at least one multi-signal window to validate ordering")
	}
}

var _ = rand.Reader
var _ = core.FrameKindWAL
