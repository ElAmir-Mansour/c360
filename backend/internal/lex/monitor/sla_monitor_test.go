package monitor

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
)

func TestSLAMonitorRunOnceFansOutTenants(t *testing.T) {
	tenantA := uuid.New()
	tenantB := uuid.New()
	asOf := time.Date(2026, time.June, 24, 9, 30, 0, 0, time.FixedZone("UTC+3", 3*60*60))
	processor := &fakeSLAProcessor{tenantIDs: []uuid.UUID{tenantA, tenantB}}
	monitor := NewSLAMonitor(processor, time.Minute, zerolog.Nop())
	monitor.now = func() time.Time { return asOf }
	monitor.limit = 25

	if err := monitor.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if processor.listCalls != 1 {
		t.Fatalf("ListTenantIDs calls = %d, want 1", processor.listCalls)
	}
	if len(processor.processCalls) != 2 {
		t.Fatalf("ProcessDueClocks calls = %d, want 2", len(processor.processCalls))
	}
	for i, wantTenant := range []uuid.UUID{tenantA, tenantB} {
		got := processor.processCalls[i]
		if got.tenantID != wantTenant {
			t.Fatalf("call[%d] tenant = %s, want %s", i, got.tenantID, wantTenant)
		}
		if !got.asOf.Equal(asOf.UTC()) {
			t.Fatalf("call[%d] asOf = %s, want %s", i, got.asOf, asOf.UTC())
		}
		if got.limit != 25 {
			t.Fatalf("call[%d] limit = %d, want 25", i, got.limit)
		}
	}
}

func TestSLAMonitorRunOnceJoinsTenantErrors(t *testing.T) {
	tenantA := uuid.New()
	tenantB := uuid.New()
	sentinel := errors.New("tenant failed")
	processor := &fakeSLAProcessor{
		tenantIDs:  []uuid.UUID{tenantA, tenantB},
		processErr: map[uuid.UUID]error{tenantB: sentinel},
	}
	monitor := NewSLAMonitor(processor, time.Minute, zerolog.Nop())
	monitor.now = func() time.Time { return time.Date(2026, time.June, 24, 9, 0, 0, 0, time.UTC) }

	err := monitor.RunOnce(context.Background())
	if !errors.Is(err, sentinel) {
		t.Fatalf("RunOnce() error = %v, want sentinel", err)
	}
	if len(processor.processCalls) != 2 {
		t.Fatalf("ProcessDueClocks calls = %d, want both tenants processed", len(processor.processCalls))
	}
}

type fakeSLAProcessor struct {
	tenantIDs    []uuid.UUID
	listErr      error
	processErr   map[uuid.UUID]error
	listCalls    int
	processCalls []fakeSLAProcessCall
}

type fakeSLAProcessCall struct {
	tenantID uuid.UUID
	asOf     time.Time
	limit    int
}

func (f *fakeSLAProcessor) ListTenantIDs(context.Context) ([]uuid.UUID, error) {
	f.listCalls++
	if f.listErr != nil {
		return nil, f.listErr
	}
	return append([]uuid.UUID(nil), f.tenantIDs...), nil
}

func (f *fakeSLAProcessor) ProcessDueClocks(_ context.Context, tenantID uuid.UUID, asOf time.Time, limit int) (service.SLAMonitorTenantResult, error) {
	f.processCalls = append(f.processCalls, fakeSLAProcessCall{
		tenantID: tenantID,
		asOf:     asOf,
		limit:    limit,
	})
	if f.processErr != nil {
		if err := f.processErr[tenantID]; err != nil {
			return service.SLAMonitorTenantResult{}, err
		}
	}
	return service.SLAMonitorTenantResult{ScannedClocks: 1}, nil
}
