package monitor

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type supportExpiryCall struct {
	tenantID uuid.UUID
	now      time.Time
	limit    int
}

type fakeSupportExpiryService struct {
	mu      sync.Mutex
	tenants []uuid.UUID
	rows    map[uuid.UUID]int
	errs    map[uuid.UUID]error
	calls   []supportExpiryCall
	listNow []time.Time
	called  chan struct{}
}

func (f *fakeSupportExpiryService) ListTenantIDs(_ context.Context, now time.Time) ([]uuid.UUID, error) {
	f.mu.Lock()
	f.listNow = append(f.listNow, now)
	f.mu.Unlock()
	return f.tenants, nil
}

func (f *fakeSupportExpiryService) ExpireDue(_ context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]model.SupportRequest, error) {
	f.mu.Lock()
	f.calls = append(f.calls, supportExpiryCall{tenantID: tenantID, now: now, limit: limit})
	called := f.called
	err := f.errs[tenantID]
	count := f.rows[tenantID]
	f.mu.Unlock()
	if called != nil {
		select {
		case called <- struct{}{}:
		default:
		}
	}
	if err != nil {
		return nil, err
	}
	return make([]model.SupportRequest, count), nil
}

func (f *fakeSupportExpiryService) snapshotCalls() []supportExpiryCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]supportExpiryCall(nil), f.calls...)
}

func (f *fakeSupportExpiryService) snapshotListNow() []time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]time.Time(nil), f.listNow...)
}

type fakeSupportExpiryMetrics struct {
	mu    sync.Mutex
	count int
}

func (f *fakeSupportExpiryMetrics) RecordSupportRequestsExpired(count int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.count += count
}

func (f *fakeSupportExpiryMetrics) value() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.count
}

func TestSupportExpiryMonitorFansOutWithOneBoundedSweepPerTenant(t *testing.T) {
	tenantA, tenantB, tenantC := uuid.New(), uuid.New(), uuid.New()
	sweepErr := errors.New("sweep failed")
	service := &fakeSupportExpiryService{
		tenants: []uuid.UUID{tenantA, tenantB, tenantC},
		rows:    map[uuid.UUID]int{tenantA: 2, tenantC: 1},
		errs:    map[uuid.UUID]error{tenantB: sweepErr},
	}
	metrics := &fakeSupportExpiryMetrics{}
	monitor := NewSupportExpiryMonitor(service, metrics, time.Minute, zerolog.Nop())
	fixedNow := time.Date(2026, time.July, 31, 9, 30, 0, 0, time.FixedZone("test", 3600))
	monitor.now = func() time.Time { return fixedNow }

	err := monitor.RunOnce(context.Background())
	if !errors.Is(err, sweepErr) {
		t.Fatalf("RunOnce() error = %v, want tenant error", err)
	}
	calls := service.snapshotCalls()
	if len(calls) != 3 {
		t.Fatalf("ExpireDue calls = %d, want one per tenant", len(calls))
	}
	if got, want := []uuid.UUID{calls[0].tenantID, calls[1].tenantID, calls[2].tenantID}, []uuid.UUID{tenantA, tenantB, tenantC}; !reflect.DeepEqual(got, want) {
		t.Fatalf("tenant fanout = %v, want %v", got, want)
	}
	for _, call := range calls {
		if call.limit != supportExpiryBatch {
			t.Fatalf("ExpireDue limit = %d, want %d", call.limit, supportExpiryBatch)
		}
		if !call.now.Equal(fixedNow) || call.now.Location() != time.UTC {
			t.Fatalf("ExpireDue now = %v (%v), want fixed UTC instant", call.now, call.now.Location())
		}
	}
	listNow := service.snapshotListNow()
	if len(listNow) != 1 || !listNow[0].Equal(calls[0].now) {
		t.Fatalf("ListTenantIDs boundaries = %v, want same UTC boundary as ExpireDue (%v)", listNow, calls[0].now)
	}
	if got := metrics.value(); got != 3 {
		t.Fatalf("expired metric count = %d, want successful rows only (3)", got)
	}
}

func TestSupportExpiryMonitorRunsImmediatelyAndAtCadence(t *testing.T) {
	tenantID := uuid.New()
	called := make(chan struct{}, 4)
	service := &fakeSupportExpiryService{
		tenants: []uuid.UUID{tenantID},
		rows:    map[uuid.UUID]int{},
		called:  called,
	}
	monitor := NewSupportExpiryMonitor(service, &fakeSupportExpiryMetrics{}, 5*time.Millisecond, zerolog.Nop())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- monitor.Run(ctx) }()

	for i := 0; i < 2; i++ {
		select {
		case <-called:
		case <-time.After(time.Second):
			cancel()
			t.Fatalf("timed out waiting for monitor call %d", i+1)
		}
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context canceled", err)
	}
	if calls := len(service.snapshotCalls()); calls < 2 {
		t.Fatalf("ExpireDue calls = %d, want immediate run plus ticker run", calls)
	}
}

func TestSupportExpiryMonitorDefaultsNonPositiveCadence(t *testing.T) {
	monitor := NewSupportExpiryMonitor(&fakeSupportExpiryService{}, &fakeSupportExpiryMetrics{}, 0, zerolog.Nop())
	if monitor.interval != defaultSupportExpiryInterval {
		t.Fatalf("interval = %s, want %s", monitor.interval, defaultSupportExpiryInterval)
	}
}
