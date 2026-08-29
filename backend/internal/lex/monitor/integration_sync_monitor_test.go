package monitor

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service/integration"
)

// withInterval builds an endpoint config carrying a sync_interval_minutes value.
func withInterval(minutes any) map[string]any {
	return map[string]any{integration.SyncIntervalMinutesKey: minutes}
}

func TestIntegrationSyncMonitorDueLogic(t *testing.T) {
	tenant := uuid.New()
	now := time.Date(2026, time.June, 26, 12, 0, 0, 0, time.UTC)

	// dueDelta: synced 90m ago, 60m interval ⇒ due, delta.
	dueDelta := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(60)}
	// notDue: synced 10m ago, 60m interval ⇒ not due.
	notDue := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(60)}
	// firstSync: never synced, 30m interval ⇒ due, FULL.
	firstSync := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindNajiz, Status: model.IntegrationStatusActive, Config: withInterval("30")}
	// noInterval: active + syncer but no cadence ⇒ skip.
	noInterval := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: map[string]any{}}
	// notSyncer: active + interval but adapter unsupported ⇒ skip.
	notSyncer := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindEmail, Status: model.IntegrationStatusActive, Config: withInterval(5)}

	fake := &fakeSyncRegistry{
		tenantIDs: []uuid.UUID{tenant},
		endpoints: map[uuid.UUID][]model.IntegrationEndpoint{
			tenant: {dueDelta, notDue, firstSync, noInterval, notSyncer},
		},
		lastSync: map[uuid.UUID]map[uuid.UUID]time.Time{
			tenant: {
				dueDelta.ID: now.Add(-90 * time.Minute),
				notDue.ID:   now.Add(-10 * time.Minute),
			},
		},
		supportsSync: map[model.IntegrationKind]bool{
			model.IntegrationKindHR:    true,
			model.IntegrationKindNajiz: true,
		},
	}

	m := NewIntegrationSyncMonitor(fake, time.Minute, zerolog.Nop())
	m.now = func() time.Time { return now }

	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}

	if len(fake.syncCalls) != 2 {
		t.Fatalf("SyncNow calls = %d, want 2 (dueDelta + firstSync)", len(fake.syncCalls))
	}
	modes := map[uuid.UUID]integration.SyncMode{}
	for _, c := range fake.syncCalls {
		if c.tenantID != tenant {
			t.Fatalf("sync tenant = %s, want %s", c.tenantID, tenant)
		}
		if c.userID == uuid.Nil {
			t.Fatalf("sync userID must be a non-nil system actor")
		}
		modes[c.endpointID] = c.mode
	}
	if modes[dueDelta.ID] != integration.SyncModeDelta {
		t.Fatalf("dueDelta mode = %q, want delta", modes[dueDelta.ID])
	}
	if modes[firstSync.ID] != integration.SyncModeFull {
		t.Fatalf("firstSync mode = %q, want full", modes[firstSync.ID])
	}
	if _, ok := modes[notDue.ID]; ok {
		t.Fatalf("notDue should not have been synced")
	}
}

func TestIntegrationSyncMonitorSkipsInactiveAndFansOutTenants(t *testing.T) {
	tenantA := uuid.New()
	tenantB := uuid.New()
	now := time.Now().UTC()

	planned := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenantA, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusPlanned, Config: withInterval(5)}
	activeA := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenantA, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(5)}
	activeB := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenantB, Kind: model.IntegrationKindNajiz, Status: model.IntegrationStatusActive, Config: withInterval(5)}

	fake := &fakeSyncRegistry{
		tenantIDs: []uuid.UUID{tenantA, tenantB},
		// List only ever returns the status it is asked for (active); planned is
		// filtered at the repo, but we also assert the monitor passes "active".
		endpoints: map[uuid.UUID][]model.IntegrationEndpoint{
			tenantA: {activeA},
			tenantB: {activeB},
		},
		supportsSync: map[model.IntegrationKind]bool{model.IntegrationKindHR: true, model.IntegrationKindNajiz: true},
	}

	m := NewIntegrationSyncMonitor(fake, time.Minute, zerolog.Nop())
	m.now = func() time.Time { return now }

	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if fake.listStatusSeen != string(model.IntegrationStatusActive) {
		t.Fatalf("List status = %q, want active", fake.listStatusSeen)
	}
	if len(fake.syncCalls) != 2 {
		t.Fatalf("SyncNow calls = %d, want 2 (one per tenant, never the planned one)", len(fake.syncCalls))
	}
	for _, c := range fake.syncCalls {
		if c.endpointID == planned.ID {
			t.Fatalf("planned endpoint must never be synced")
		}
	}
}

func TestIntegrationSyncMonitorPerEndpointErrorIsolated(t *testing.T) {
	tenant := uuid.New()
	now := time.Now().UTC()
	bad := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(1)}
	good := model.IntegrationEndpoint{ID: uuid.New(), TenantID: tenant, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(1)}

	fake := &fakeSyncRegistry{
		tenantIDs:    []uuid.UUID{tenant},
		endpoints:    map[uuid.UUID][]model.IntegrationEndpoint{tenant: {bad, good}},
		supportsSync: map[model.IntegrationKind]bool{model.IntegrationKindHR: true},
		syncErr:      map[uuid.UUID]error{bad.ID: errors.New("connector blew up")},
	}
	m := NewIntegrationSyncMonitor(fake, time.Minute, zerolog.Nop())
	m.now = func() time.Time { return now }

	// A per-endpoint error must NOT surface as a RunOnce error and must NOT stop
	// the good endpoint from syncing.
	if err := m.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v, want nil (per-endpoint errors are swallowed)", err)
	}
	if len(fake.syncCalls) != 2 {
		t.Fatalf("SyncNow calls = %d, want 2 (both attempted)", len(fake.syncCalls))
	}
}

func TestIntegrationSyncMonitorTenantErrorsJoined(t *testing.T) {
	tenantA := uuid.New()
	tenantB := uuid.New()
	sentinel := errors.New("list failed")
	fake := &fakeSyncRegistry{
		tenantIDs:    []uuid.UUID{tenantA, tenantB},
		endpoints:    map[uuid.UUID][]model.IntegrationEndpoint{tenantB: {{ID: uuid.New(), TenantID: tenantB, Kind: model.IntegrationKindHR, Status: model.IntegrationStatusActive, Config: withInterval(1)}}},
		supportsSync: map[model.IntegrationKind]bool{model.IntegrationKindHR: true},
		listErr:      map[uuid.UUID]error{tenantA: sentinel},
	}
	m := NewIntegrationSyncMonitor(fake, time.Minute, zerolog.Nop())

	err := m.RunOnce(context.Background())
	if !errors.Is(err, sentinel) {
		t.Fatalf("RunOnce() error = %v, want sentinel", err)
	}
	// tenantB still processed despite tenantA's error.
	if len(fake.syncCalls) != 1 {
		t.Fatalf("SyncNow calls = %d, want 1 (tenantB processed)", len(fake.syncCalls))
	}
}

// --- fake registry ---------------------------------------------------------

type fakeSyncCall struct {
	tenantID   uuid.UUID
	userID     uuid.UUID
	endpointID uuid.UUID
	mode       integration.SyncMode
}

type fakeSyncRegistry struct {
	tenantIDs    []uuid.UUID
	endpoints    map[uuid.UUID][]model.IntegrationEndpoint // returned by List(status=active)
	lastSync     map[uuid.UUID]map[uuid.UUID]time.Time
	supportsSync map[model.IntegrationKind]bool
	listErr      map[uuid.UUID]error
	syncErr      map[uuid.UUID]error

	listStatusSeen string
	syncCalls      []fakeSyncCall
}

func (f *fakeSyncRegistry) ListTenantIDs(context.Context) ([]uuid.UUID, error) {
	return append([]uuid.UUID(nil), f.tenantIDs...), nil
}

func (f *fakeSyncRegistry) List(_ context.Context, tenantID uuid.UUID, _ string, status string) ([]model.IntegrationEndpoint, error) {
	f.listStatusSeen = status
	if err := f.listErr[tenantID]; err != nil {
		return nil, err
	}
	return append([]model.IntegrationEndpoint(nil), f.endpoints[tenantID]...), nil
}

func (f *fakeSyncRegistry) SupportsSync(kind model.IntegrationKind) bool {
	return f.supportsSync[kind]
}

func (f *fakeSyncRegistry) LastSuccessfulSyncByEndpoint(_ context.Context, tenantID uuid.UUID) (map[uuid.UUID]time.Time, error) {
	if f.lastSync == nil {
		return map[uuid.UUID]time.Time{}, nil
	}
	return f.lastSync[tenantID], nil
}

func (f *fakeSyncRegistry) SyncNow(_ context.Context, tenantID, userID, id uuid.UUID, mode integration.SyncMode, _ bool) (*integration.SyncReport, error) {
	f.syncCalls = append(f.syncCalls, fakeSyncCall{tenantID: tenantID, userID: userID, endpointID: id, mode: mode})
	if err := f.syncErr[id]; err != nil {
		return nil, err
	}
	return &integration.SyncReport{Mode: mode}, nil
}
