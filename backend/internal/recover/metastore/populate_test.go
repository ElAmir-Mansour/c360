package metastore

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

// fakeAuthor is an in-memory RunbookAuthor: it records the import steps it was
// asked to materialize and returns a runbook with a generated id, modelling
// runbookstudio.Service.CreateRunbook without a database.
type fakeAuthor struct {
	lastInput runbookstudio.CreateRunbookInput
	calls     int
}

func (a *fakeAuthor) CreateRunbook(_ context.Context, tenantID uuid.UUID, in runbookstudio.CreateRunbookInput) (*runbookstudio.Runbook, []runbookstudio.Task, error) {
	a.calls++
	a.lastInput = in
	rb := &runbookstudio.Runbook{
		ID:       uuid.NewString(),
		TenantID: tenantID.String(),
		Name:     in.Name,
		Source:   runbookstudio.SourceRegistry,
	}
	tasks := make([]runbookstudio.Task, len(in.ImportSteps))
	for i, st := range in.ImportSteps {
		tasks[i] = runbookstudio.Task{ID: uuid.NewString(), TaskKey: st.Key, Name: st.Name, TaskType: st.TaskType}
	}
	return rb, tasks, nil
}

func newTestPopulator(t *testing.T, store storeAPI, author RunbookAuthor) (*Populator, *DefaultRegistry) {
	t.Helper()
	reg := newTestRegistry(t, store)
	pop, err := NewPopulator(reg, author)
	if err != nil {
		t.Fatalf("NewPopulator: %v", err)
	}
	return pop, reg
}

// TestPopulate_FromRealRegistryData proves the populate action turns an
// application's REAL persisted metadata into ordered runbook import steps and
// links the runbook back, stamped with the source metadata revision.
func TestPopulate_FromRealRegistryData(t *testing.T) {
	store := newMemStore()
	author := &fakeAuthor{}
	pop, reg := newTestPopulator(t, store, author)
	tenant := uuid.New()

	app, err := reg.CreateApplication(context.Background(), tenant, sampleInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	res, err := pop.Populate(context.Background(), tenant, app.ID, nil)
	if err != nil {
		t.Fatalf("Populate: %v", err)
	}
	if author.calls != 1 {
		t.Fatalf("author called %d times, want 1", author.calls)
	}
	if res.SourceRevision != app.MetadataRevision {
		t.Fatalf("source revision = %d, want %d", res.SourceRevision, app.MetadataRevision)
	}

	// The derived steps must reflect the real metadata: a notify step, a
	// recover-dependency step for the HARD dependency only (identity, not the soft
	// analytics), an approval gate (mission_critical), a provision step for the
	// recovery-target environment (dr-jed only), and a verify step.
	keys := map[string]bool{}
	for _, st := range author.lastInput.ImportSteps {
		keys[st.Key] = true
	}
	wantPresent := []string{"notify_owners", "recover_dependency:identity", "approve_recovery", "provision_env:dr-jed", "verify_application"}
	for _, k := range wantPresent {
		if !keys[k] {
			t.Fatalf("expected step %q in derived runbook; got keys %v", k, keys)
		}
	}
	if keys["recover_dependency:analytics"] {
		t.Fatal("soft dependency 'analytics' must NOT produce a recover-dependency step")
	}
	if keys["provision_env:prod-rh"] {
		t.Fatal("non-recovery-target environment 'prod-rh' must NOT produce a provision step")
	}

	// The link is recorded so a sync can find it.
	link, err := store.GetRunbookLink(context.Background(), nil, app.ID, res.RunbookID)
	if err != nil {
		t.Fatalf("GetRunbookLink after populate: %v", err)
	}
	if link.SourceRevision != app.MetadataRevision || link.SourceHash != app.MetadataHash {
		t.Fatalf("link stamp = (%d,%s), want (%d,%s)", link.SourceRevision, link.SourceHash, app.MetadataRevision, app.MetadataHash)
	}
}

// TestPopulate_NoApprovalGateForLowTier proves the tier drives the gate: a
// tier_3 application's runbook has no approval gate.
func TestPopulate_NoApprovalGateForLowTier(t *testing.T) {
	author := &fakeAuthor{}
	pop, reg := newTestPopulator(t, newMemStore(), author)
	tenant := uuid.New()
	in := sampleInput()
	in.RecoveryTier = TierThree
	app, _ := reg.CreateApplication(context.Background(), tenant, in)
	if _, err := pop.Populate(context.Background(), tenant, app.ID, nil); err != nil {
		t.Fatalf("Populate: %v", err)
	}
	for _, st := range author.lastInput.ImportSteps {
		if st.Key == "approve_recovery" {
			t.Fatal("tier_3 application must not get an approval gate")
		}
	}
}

// TestPopulate_NoRecoveryTarget rejects populating an app with no recovery-target
// environment (an empty runbook would be misleading).
func TestPopulate_NoRecoveryTarget(t *testing.T) {
	author := &fakeAuthor{}
	pop, reg := newTestPopulator(t, newMemStore(), author)
	tenant := uuid.New()
	in := sampleInput()
	for i := range in.Environments {
		in.Environments[i].IsRecoveryTarget = false
	}
	app, _ := reg.CreateApplication(context.Background(), tenant, in)
	_, err := pop.Populate(context.Background(), tenant, app.ID, nil)
	if err != ErrNoRecoveryTarget {
		t.Fatalf("err = %v, want ErrNoRecoveryTarget", err)
	}
	if author.calls != 0 {
		t.Fatal("author must not be called when there is no recovery target")
	}
}

func TestPopulate_AppNotFound(t *testing.T) {
	pop, _ := newTestPopulator(t, newMemStore(), &fakeAuthor{})
	_, err := pop.Populate(context.Background(), uuid.New(), uuid.NewString(), nil)
	if err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// TestSync_DetectsDriftAcrossMetadataChange is the core drift test: populate a
// runbook from an application, then change the application's drift-relevant
// metadata; sync must flag the linked runbook as stale, with the current
// revision ahead of the source.
func TestSync_DetectsDriftAcrossMetadataChange(t *testing.T) {
	store := newMemStore()
	author := &fakeAuthor{}
	pop, reg := newTestPopulator(t, store, author)
	tenant := uuid.New()

	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())
	res, err := pop.Populate(context.Background(), tenant, app.ID, nil)
	if err != nil {
		t.Fatalf("Populate: %v", err)
	}

	// Before any change, sync reports NO drift.
	sync, err := pop.Sync(context.Background(), tenant, app.ID, res.RunbookID)
	if err != nil {
		t.Fatalf("Sync (pre-change): %v", err)
	}
	if sync.Drifted || sync.Kind != DriftNone {
		t.Fatalf("expected no drift before change; got %+v", sync)
	}

	// Change the recovery tier (drift-relevant) — the runbook is now stale.
	in := sampleInput()
	in.RecoveryTier = TierTwo
	if _, err := reg.UpdateApplication(context.Background(), tenant, app.ID, in); err != nil {
		t.Fatalf("update: %v", err)
	}

	sync, err = pop.Sync(context.Background(), tenant, app.ID, res.RunbookID)
	if err != nil {
		t.Fatalf("Sync (post-change): %v", err)
	}
	if !sync.Drifted || sync.Kind != DriftStale {
		t.Fatalf("expected stale drift after change; got %+v", sync)
	}
	if sync.CurrentRevision <= sync.SourceRevision {
		t.Fatalf("current revision %d should exceed source %d", sync.CurrentRevision, sync.SourceRevision)
	}
	if len(sync.ChangedFields) == 0 {
		t.Fatal("expected at least one changed-field entry")
	}
}

// TestSync_NoDriftOnNonRelevantEdit proves an edit to a NON-drift field
// (description) does not flag the linked runbook as stale.
func TestSync_NoDriftOnNonRelevantEdit(t *testing.T) {
	store := newMemStore()
	pop, reg := newTestPopulator(t, store, &fakeAuthor{})
	tenant := uuid.New()
	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())
	res, _ := pop.Populate(context.Background(), tenant, app.ID, nil)

	in := sampleInput()
	in.Description = "edited description only"
	if _, err := reg.UpdateApplication(context.Background(), tenant, app.ID, in); err != nil {
		t.Fatalf("update: %v", err)
	}
	sync, err := pop.Sync(context.Background(), tenant, app.ID, res.RunbookID)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if sync.Drifted {
		t.Fatalf("non-drift edit should not flag drift; got %+v", sync)
	}
}

// TestSync_RunbookNotLinked rejects syncing a runbook never populated from the
// application.
func TestSync_RunbookNotLinked(t *testing.T) {
	pop, reg := newTestPopulator(t, newMemStore(), &fakeAuthor{})
	tenant := uuid.New()
	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())
	_, err := pop.Sync(context.Background(), tenant, app.ID, uuid.NewString())
	if err != ErrRunbookNotLinked {
		t.Fatalf("err = %v, want ErrRunbookNotLinked", err)
	}
}

// TestSyncFrom_ItemizesChangedFields proves the precise variant produces the
// field-level diff when the caller retains the source snapshot.
func TestSyncFrom_ItemizesChangedFields(t *testing.T) {
	store := newMemStore()
	pop, reg := newTestPopulator(t, store, &fakeAuthor{})
	tenant := uuid.New()
	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())
	source, _ := reg.ResolveApplication(context.Background(), tenant, app.ID)
	res, _ := pop.Populate(context.Background(), tenant, app.ID, nil)

	in := sampleInput()
	in.RTOTargetSeconds = 99
	if _, err := reg.UpdateApplication(context.Background(), tenant, app.ID, in); err != nil {
		t.Fatalf("update: %v", err)
	}
	sync, err := pop.SyncFrom(context.Background(), tenant, app.ID, res.RunbookID, *source)
	if err != nil {
		t.Fatalf("SyncFrom: %v", err)
	}
	if !sync.Drifted {
		t.Fatal("expected drift")
	}
	found := false
	for _, f := range sync.ChangedFields {
		if f.Field == "rto_target_seconds" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected rto_target_seconds in changed fields; got %+v", sync.ChangedFields)
	}
}
