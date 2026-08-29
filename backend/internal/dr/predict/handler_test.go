package predict

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
)

// memSampleStore is an in-memory SampleStore that records inserts and prunes.
type memSampleStore struct {
	samples   []Sample
	pruneKeep int
	pruneN    int
	dupKeys   map[string]bool
	insertErr error
	pruneErr  error
}

func newMemSampleStore() *memSampleStore {
	return &memSampleStore{dupKeys: map[string]bool{}}
}

func (m *memSampleStore) InsertSample(_ context.Context, _ repository.DBTX, s Sample) (bool, error) {
	if m.insertErr != nil {
		return false, m.insertErr
	}
	key := s.StreamID + "|" + s.ObservedAt.UTC().Format(time.RFC3339Nano)
	if m.dupKeys[key] {
		return false, nil
	}
	m.dupKeys[key] = true
	m.samples = append(m.samples, s)
	return true, nil
}

func (m *memSampleStore) PruneSamples(_ context.Context, _ repository.DBTX, _, _ string, keep int) (int64, error) {
	if m.pruneErr != nil {
		return 0, m.pruneErr
	}
	m.pruneKeep = keep
	m.pruneN++
	return 0, nil
}

func progressEvent(t *testing.T, sample ProgressSample) *events.Event {
	t.Helper()
	data, err := json.Marshal(sample)
	if err != nil {
		t.Fatalf("marshal sample: %v", err)
	}
	return &events.Event{
		ID:       events.GenerateUUID(),
		Type:     "com.clario360.datastream.dr.stream.progress",
		Source:   "clario360/clario-dr-agent",
		TenantID: sample.TenantID,
		Subject:  sample.StreamID,
		Time:     sample.ObservedAt,
		Data:     data,
	}
}

func TestIngestHandler_AppendsAndPrunes(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	h := NewIngestHandler(store, IngestConfig{KeepWindow: 500})

	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	evt := progressEvent(t, ProgressSample{
		TenantID: "t1", StreamID: "s1", LagSeconds: 42, ThroughputBPS: 1e6,
		AppliedSeq: 7, ObservedAt: now,
	})

	if err := h.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(store.samples) != 1 {
		t.Fatalf("expected 1 sample stored, got %d", len(store.samples))
	}
	got := store.samples[0]
	if got.LagSeconds != 42 || got.ThroughputBPS != 1e6 || got.AppliedSeq != 7 {
		t.Fatalf("sample fields mis-mapped: %+v", got)
	}
	if !got.ObservedAt.Equal(now) {
		t.Fatalf("observed_at not mapped: %v", got.ObservedAt)
	}
	if store.pruneN != 1 || store.pruneKeep != 500 {
		t.Fatalf("expected one prune with keep=500, got n=%d keep=%d", store.pruneN, store.pruneKeep)
	}
}

func TestIngestHandler_DuplicateIsSilentNoPrune(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	h := NewIngestHandler(store, IngestConfig{})
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	evt := progressEvent(t, ProgressSample{TenantID: "t1", StreamID: "s1", LagSeconds: 1, ObservedAt: now})

	if err := h.Handle(context.Background(), evt); err != nil {
		t.Fatalf("first Handle: %v", err)
	}
	// Re-deliver the same event: must succeed, not double-store, not prune.
	if err := h.Handle(context.Background(), evt); err != nil {
		t.Fatalf("duplicate Handle must not error: %v", err)
	}
	if len(store.samples) != 1 {
		t.Fatalf("duplicate must not be stored twice, got %d", len(store.samples))
	}
	if store.pruneN != 1 {
		t.Fatalf("prune should run only on a real insert, got %d", store.pruneN)
	}
}

func TestIngestHandler_FallsBackToEventTenantAndSubject(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	h := NewIngestHandler(store, IngestConfig{})
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	// Payload omits tenant/stream/observed_at; they come from the envelope.
	evt := progressEvent(t, ProgressSample{LagSeconds: 5, ThroughputBPS: 2e6, AppliedSeq: 3})
	evt.TenantID = "t9"
	evt.Subject = "s9"
	evt.Time = now

	if err := h.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(store.samples) != 1 {
		t.Fatalf("expected 1 sample, got %d", len(store.samples))
	}
	got := store.samples[0]
	if got.TenantID != "t9" || got.StreamID != "s9" || !got.ObservedAt.Equal(now) {
		t.Fatalf("envelope fallbacks not applied: %+v", got)
	}
}

func TestIngestHandler_RejectsMissingIdentity(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	h := NewIngestHandler(store, IngestConfig{})
	evt := progressEvent(t, ProgressSample{LagSeconds: 5})
	evt.TenantID = ""
	evt.Subject = ""

	if err := h.Handle(context.Background(), evt); err == nil {
		t.Fatal("expected an error when tenant/stream are missing")
	}
	if len(store.samples) != 0 {
		t.Fatal("nothing should be stored on a rejected event")
	}
}

func TestIngestHandler_RejectsNegativeValues(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	h := NewIngestHandler(store, IngestConfig{})
	evt := progressEvent(t, ProgressSample{TenantID: "t1", StreamID: "s1", LagSeconds: -1})

	if err := h.Handle(context.Background(), evt); err == nil {
		t.Fatal("expected an error for negative lag")
	}
}

func TestIngestHandler_PropagatesInsertError(t *testing.T) {
	t.Parallel()
	store := newMemSampleStore()
	store.insertErr = errors.New("db down")
	h := NewIngestHandler(store, IngestConfig{})
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	evt := progressEvent(t, ProgressSample{TenantID: "t1", StreamID: "s1", LagSeconds: 1, ObservedAt: now})

	if err := h.Handle(context.Background(), evt); err == nil {
		t.Fatal("insert error must propagate so the consumer retries")
	}
}

func TestIngestHandler_EventTypesFilter(t *testing.T) {
	t.Parallel()
	h := NewIngestHandler(newMemSampleStore(), IngestConfig{})
	types := h.EventTypes()
	if len(types) == 0 {
		t.Fatal("handler must declare its progress event types for filtering")
	}
	found := false
	for _, ty := range types {
		if ty == "com.clario360.datastream.dr.stream.progress" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected the canonical progress event type, got %v", types)
	}
}

func TestIngestHandler_NilEvent(t *testing.T) {
	t.Parallel()
	h := NewIngestHandler(newMemSampleStore(), IngestConfig{})
	if err := h.Handle(context.Background(), nil); err == nil {
		t.Fatal("nil event must error")
	}
}

// TestIngestHandler_ImplementsEventHandler asserts the type satisfies the
// platform consumer contract so main.go can Subscribe it directly.
func TestIngestHandler_ImplementsEventHandler(t *testing.T) {
	t.Parallel()
	var _ events.EventHandler = (*IngestHandler)(nil)
	var _ events.TypedEventHandler = (*IngestHandler)(nil)
}
