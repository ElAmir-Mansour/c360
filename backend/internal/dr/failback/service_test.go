package failback

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// memTenantRunner runs fn directly against the in-memory store (the store ignores
// its DBTX argument), recording which tenant each call ran under so isolation can
// be asserted.
type memTenantRunner struct {
	lastWriteTenant uuid.UUID
	lastReadTenant  uuid.UUID
}

func (r *memTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.lastWriteTenant = tenantID
	return fn(nil)
}

func (r *memTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.lastReadTenant = tenantID
	return fn(nil)
}

func newTestService(t *testing.T, store *memStore, sink EventStager) *Service {
	t.Helper()
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{},
		Tracker: tracker,
		Cutback: &fakeCutback{detail: map[string]any{"ok": true}},
		Events:  &recordingSink{},
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New driver: %v", err)
	}
	svc, err := NewService(ServiceConfig{
		Tx:     &memTenantRunner{},
		Store:  store,
		Events: sink,
		Driver: drv,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

type recordingStager struct {
	types []string
}

func (s *recordingStager) Stage(_ context.Context, _ repository.DBTX, eventType, _ string, _ map[string]any) error {
	s.types = append(s.types, eventType)
	return nil
}

func TestService_PlanFailback_CreatesRunInPlanning(t *testing.T) {
	store := newMemStore()
	stager := &recordingStager{}
	svc := newTestService(t, store, stager)

	tenantID := uuid.New()
	run, err := svc.PlanFailback(context.Background(), tenantID, PlanFailbackInput{
		GroupID:                uuid.New(),
		FromSite:               uuid.New(),
		ToSite:                 uuid.New(),
		ConvergeThresholdBytes: 4096,
		InitiatedBy:            uuid.New(),
	})
	if err != nil {
		t.Fatalf("PlanFailback: %v", err)
	}
	if run.Status != StatusPlanning {
		t.Fatalf("status = %s, want PLANNING", run.Status)
	}
	if run.ConvergeThresholdBytes != 4096 {
		t.Fatalf("threshold = %d, want 4096", run.ConvergeThresholdBytes)
	}
	if len(stager.types) != 1 || stager.types[0] != "datastream.dr.failback.planned" {
		t.Fatalf("staged events = %#v", stager.types)
	}
}

func TestService_PlanFailback_Validation(t *testing.T) {
	store := newMemStore()
	svc := newTestService(t, store, &recordingStager{})
	good := func() PlanFailbackInput {
		return PlanFailbackInput{
			GroupID: uuid.New(), FromSite: uuid.New(), ToSite: uuid.New(), InitiatedBy: uuid.New(),
		}
	}
	tests := []struct {
		name   string
		mutate func(in *PlanFailbackInput)
	}{
		{"missing group", func(in *PlanFailbackInput) { in.GroupID = uuid.Nil }},
		{"missing from", func(in *PlanFailbackInput) { in.FromSite = uuid.Nil }},
		{"missing to", func(in *PlanFailbackInput) { in.ToSite = uuid.Nil }},
		{"missing initiator", func(in *PlanFailbackInput) { in.InitiatedBy = uuid.Nil }},
		{"negative threshold", func(in *PlanFailbackInput) { in.ConvergeThresholdBytes = -1 }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := good()
			tc.mutate(&in)
			if _, err := svc.PlanFailback(context.Background(), uuid.New(), in); !IsValidation(err) {
				t.Fatalf("error = %v, want validation error", err)
			}
		})
	}

	// from == to is rejected.
	in := good()
	same := uuid.New()
	in.FromSite = same
	in.ToSite = same
	if _, err := svc.PlanFailback(context.Background(), uuid.New(), in); !IsValidation(err) {
		t.Fatalf("from==to error = %v, want validation", err)
	}
}

func TestService_ApproveCutback_GatePath(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	stager := &recordingStager{}
	svc := newTestService(t, store, stager)

	tenantID := uuid.New()
	run := store.seed(&FailbackRun{
		TenantID: tenantID.String(), GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusAwaitingCutbackApproval, InitiatedBy: "u",
	})
	runID := uuid.MustParse(run.ID)

	approver := uuid.New()
	got, err := svc.ApproveCutback(ctx, tenantID, runID, approver)
	if err != nil {
		t.Fatalf("ApproveCutback: %v", err)
	}
	if got.Status != StatusCuttingBack {
		t.Fatalf("status = %s, want CUTTING_BACK", got.Status)
	}
	if got.ApprovedBy == nil || *got.ApprovedBy != approver.String() {
		t.Fatalf("approved_by = %v, want %s", got.ApprovedBy, approver)
	}

	// A second approval is rejected (already approved / wrong state -> 409).
	if _, err := svc.ApproveCutback(ctx, tenantID, runID, uuid.New()); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("second approval error = %v, want ErrInvalidState", err)
	}
}

func TestService_ApproveCutback_WrongStateRejected(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, &recordingStager{})
	tenantID := uuid.New()
	run := store.seed(&FailbackRun{
		TenantID: tenantID.String(), GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusReverseSyncing, InitiatedBy: "u",
	})
	// Cannot approve a run that is not awaiting cutback approval.
	if _, err := svc.ApproveCutback(ctx, tenantID, uuid.MustParse(run.ID), uuid.New()); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("error = %v, want ErrInvalidState", err)
	}
}

func TestService_Advance_DrivesOneState(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, &recordingStager{})
	tenantID := uuid.New()
	run := store.seed(&FailbackRun{
		TenantID: tenantID.String(), GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, ConvergeThresholdBytes: 0, InitiatedBy: "u",
	})
	got, err := svc.Advance(ctx, tenantID, uuid.MustParse(run.ID))
	if err != nil {
		t.Fatalf("Advance: %v", err)
	}
	if got.Status != StatusReverseSyncing {
		t.Fatalf("status = %s, want REVERSE_SYNCING", got.Status)
	}
}

func TestService_Advance_AtCutbackGateWithoutApprovalDoesNotCut(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, &recordingStager{})
	tenantID := uuid.New()
	run := store.seed(&FailbackRun{
		TenantID: tenantID.String(), GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusAwaitingCutbackApproval, InitiatedBy: "u",
	})
	// Advancing the gate via the operator endpoint without approval is rejected.
	if _, err := svc.Advance(ctx, tenantID, uuid.MustParse(run.ID)); !errors.Is(err, ErrNotApproved) {
		t.Fatalf("error = %v, want ErrNotApproved", err)
	}
	after := store.get(run.ID)
	if after.Status != StatusAwaitingCutbackApproval {
		t.Fatalf("run advanced past gate without approval: %s", after.Status)
	}
}

func TestService_GetFailback_TenantScoped(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, &recordingStager{})
	owner := uuid.New()
	run := store.seed(&FailbackRun{
		TenantID: owner.String(), GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, InitiatedBy: "u",
	})
	// Another tenant cannot read it.
	other := uuid.New()
	if _, err := svc.GetFailback(ctx, other, uuid.MustParse(run.ID)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant read error = %v, want ErrNotFound", err)
	}
	// The owner can.
	got, err := svc.GetFailback(ctx, owner, uuid.MustParse(run.ID))
	if err != nil {
		t.Fatalf("owner GetFailback: %v", err)
	}
	if got.ID != run.ID {
		t.Fatalf("got id %s, want %s", got.ID, run.ID)
	}
}

func TestNewService_RequiresStore(t *testing.T) {
	if _, err := NewService(ServiceConfig{Tx: &memTenantRunner{}}); err == nil {
		t.Fatal("expected error without a store")
	}
}
