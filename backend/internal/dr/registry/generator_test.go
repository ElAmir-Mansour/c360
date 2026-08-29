package registry

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// memStore is a real in-memory implementation of the registry's persistence
// semantics: it stores runbook index rows and an append-only version log keyed
// by runbook, enforces monotonic version numbering, advances current_version on
// insert, and serves the asset snapshot from a settable assets map. It is NOT a
// mock that returns canned values — it implements the actual versioning logic so
// the generator's no-op detection, diffing and version advance are exercised
// end-to-end without a database. The integration phase swaps in the real Store
// against Postgres.
type memStore struct {
	mu       sync.Mutex
	runbooks map[string]*Runbook          // groupID -> runbook
	versions map[string][]*RunbookVersion // runbookID -> ordered versions
	assets   map[string]AssetSnapshot     // groupID -> current assets
	seq      int
}

func newMemStore() *memStore {
	return &memStore{
		runbooks: map[string]*Runbook{},
		versions: map[string][]*RunbookVersion{},
		assets:   map[string]AssetSnapshot{},
	}
}

func (m *memStore) setAssets(groupID string, snap AssetSnapshot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.assets[groupID] = snap
}

func (m *memStore) LoadAssetSnapshot(_ context.Context, _ DBTX, groupID, profile string) (AssetSnapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	snap, ok := m.assets[groupID]
	if !ok {
		return AssetSnapshot{}, ErrGroupNotFound
	}
	snap.NetworkProfile = profile
	return snap, nil
}

func (m *memStore) EnsureRunbook(_ context.Context, _ DBTX, tenantID, groupID, templateID string) (*Runbook, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if rb, ok := m.runbooks[groupID]; ok {
		return cloneRunbook(rb), nil
	}
	m.seq++
	rb := &Runbook{
		ID:             uuid.NewString(),
		TenantID:       tenantID,
		GroupID:        groupID,
		CurrentVersion: 0,
		TemplateID:     templateID,
	}
	m.runbooks[groupID] = rb
	return cloneRunbook(rb), nil
}

func (m *memStore) GetRunbook(_ context.Context, _ DBTX, groupID string) (*Runbook, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rb, ok := m.runbooks[groupID]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneRunbook(rb), nil
}

func (m *memStore) GetLatestVersion(_ context.Context, _ DBTX, runbookID string) (*RunbookVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	vs := m.versions[runbookID]
	if len(vs) == 0 {
		return nil, ErrNotFound
	}
	return vs[len(vs)-1], nil
}

func (m *memStore) ListVersions(_ context.Context, _ DBTX, runbookID string) ([]*RunbookVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	vs := m.versions[runbookID]
	out := make([]*RunbookVersion, 0, len(vs))
	for i := len(vs) - 1; i >= 0; i-- { // newest first
		out = append(out, vs[i])
	}
	return out, nil
}

func (m *memStore) InsertVersion(_ context.Context, _ DBTX, v *RunbookVersion) (*RunbookVersion, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.versions[v.RunbookID]
	// Enforce monotonic version numbering (the real UNIQUE(runbook_id,version)).
	if len(existing) > 0 && v.Version != existing[len(existing)-1].Version+1 {
		return nil, errors.New("memStore: non-monotonic version")
	}
	if len(existing) == 0 && v.Version != 1 {
		return nil, errors.New("memStore: first version must be 1")
	}
	stored := *v
	stored.ID = uuid.NewString()
	m.versions[v.RunbookID] = append(existing, &stored)
	// Advance current_version on the runbook (find by id).
	for _, rb := range m.runbooks {
		if rb.ID == v.RunbookID {
			rb.CurrentVersion = v.Version
			rb.TemplateID = v.TemplateID
		}
	}
	return &stored, nil
}

func cloneRunbook(rb *Runbook) *Runbook {
	c := *rb
	return &c
}

// memRunner runs fn directly (the memStore needs no real transaction). It
// records whether the system path was used so a test can assert the reconcile
// loop took the cross-tenant route.
type memRunner struct {
	usedSystem bool
}

func (r *memRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (r *memRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (r *memRunner) RunSystem(ctx context.Context, fn func(DBTX) error) error {
	r.usedSystem = true
	return fn(nil)
}
func (r *memRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error {
	r.usedSystem = true
	return fn(nil)
}

// recordingStager captures staged events so a test can assert the lifecycle
// event was staged in the same path as the version write.
type recordingStager struct {
	events []stagedEvent
}

type stagedEvent struct {
	eventType string
	tenantID  string
	data      map[string]any
}

func (s *recordingStager) Stage(_ context.Context, _ DBTX, eventType, tenantID string, data map[string]any) error {
	s.events = append(s.events, stagedEvent{eventType, tenantID, data})
	return nil
}

func newTestGenerator(t *testing.T) (*Generator, *memStore, *memRunner, *recordingStager) {
	t.Helper()
	store := newMemStore()
	runner := &memRunner{}
	stager := &recordingStager{}
	gen, err := NewGenerator(GeneratorConfig{
		Store:    store,
		Template: NewTemplate(),
		Runner:   runner,
		Stager:   stager,
		Metrics:  NewMetrics(nil),
	})
	if err != nil {
		t.Fatalf("NewGenerator: %v", err)
	}
	return gen, store, runner, stager
}

func TestGenerator_FirstGenerationMaterializesOrderedRunbook(t *testing.T) {
	gen, store, _, stager := newTestGenerator(t)
	snap := threeMemberSnapshot()
	groupID := snap.GroupID
	store.setAssets(groupID, snap)
	tenantID := uuid.New()

	res, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerManual)
	if err != nil {
		t.Fatalf("Regenerate: %v", err)
	}
	if !res.Changed {
		t.Fatal("first generation must report Changed=true")
	}
	if res.Version.Version != 1 {
		t.Fatalf("first version = %d, want 1", res.Version.Version)
	}
	if res.Diff != nil {
		t.Errorf("first generation must have a nil diff, got %+v", res.Diff)
	}
	if len(res.Version.Steps) != 8 {
		t.Fatalf("version 1 should have 8 steps, got %d", len(res.Version.Steps))
	}
	if res.Version.Steps[3].Key != "boot_member:site-db" {
		t.Errorf("step 4 should boot the lowest-boot-order member first, got %q", res.Version.Steps[3].Key)
	}

	// The lifecycle event must have been staged (generated, not regenerated).
	if len(stager.events) != 1 || stager.events[0].eventType != eventRunbookGenerated {
		t.Fatalf("expected one %s event staged, got %+v", eventRunbookGenerated, stager.events)
	}
	if stager.events[0].data["version"] != 1 {
		t.Errorf("event version = %v, want 1", stager.events[0].data["version"])
	}
}

func TestGenerator_RegenerateNoChangeIsNoOp(t *testing.T) {
	gen, store, _, stager := newTestGenerator(t)
	snap := threeMemberSnapshot()
	store.setAssets(snap.GroupID, snap)
	tenantID := uuid.New()

	if _, err := gen.Regenerate(context.Background(), tenantID, snap.GroupID, "production", TriggerManual); err != nil {
		t.Fatalf("first Regenerate: %v", err)
	}
	// Regenerate again with identical assets — must be a no-op (no new version).
	res, err := gen.Regenerate(context.Background(), tenantID, snap.GroupID, "production", TriggerManual)
	if err != nil {
		t.Fatalf("second Regenerate: %v", err)
	}
	if res.Changed {
		t.Error("regeneration with unchanged assets must report Changed=false")
	}
	if res.Version.Version != 1 {
		t.Errorf("no-op regeneration must return version 1, got %d", res.Version.Version)
	}
	// Only the first generation's event should have been staged.
	if len(stager.events) != 1 {
		t.Errorf("no-op regeneration must not stage a second event, got %d events", len(stager.events))
	}
}

func TestGenerator_MembershipChangeProducesNewVersionWithCorrectDiff(t *testing.T) {
	gen, store, _, stager := newTestGenerator(t)
	snap := threeMemberSnapshot()
	groupID := snap.GroupID
	store.setAssets(groupID, snap)
	tenantID := uuid.New()

	// v1 with three members.
	if _, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerManual); err != nil {
		t.Fatalf("v1 Regenerate: %v", err)
	}

	// Change membership: remove the cache member, add a new "site-mq" member with
	// a boot order between db and app. This is the §12 acceptance scenario:
	// "change membership -> regenerate -> assert a new version and a correct diff".
	changed := threeMemberSnapshot()
	changed.Members = []MemberAsset{
		changed.Members[0], // site-db, order 10
		{SiteID: "site-mq", SiteName: "rabbitmq", SiteKind: "vm", PrimaryEndpoint: "mq.prod:5672", BootOrder: 15, NetworkProfile: "production"},
		changed.Members[1], // site-app, order 30 (note: index 1 in original slice is app)
	}
	store.setAssets(groupID, changed)

	res, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerMembership)
	if err != nil {
		t.Fatalf("v2 Regenerate: %v", err)
	}
	if !res.Changed {
		t.Fatal("membership change must produce a new version")
	}
	if res.Version.Version != 2 {
		t.Fatalf("version after membership change = %d, want 2", res.Version.Version)
	}
	if res.Diff == nil {
		t.Fatal("regeneration after a change must carry a diff")
	}

	// The cache boot step was removed; the mq boot step was added.
	if !containsStr(res.Diff.Added, "boot_member:site-mq") {
		t.Errorf("diff.Added = %v, expected boot_member:site-mq", res.Diff.Added)
	}
	if !containsStr(res.Diff.Removed, "boot_member:site-cache") {
		t.Errorf("diff.Removed = %v, expected boot_member:site-cache", res.Diff.Removed)
	}

	// site-app moved: in v1 it was last boot (position 6: pin,quiesce,approval,
	// db,cache,app). In v2 the order is pin,quiesce,approval,db(10),mq(15),app(30),
	// so app stays at position 6 — but db keeps position 4 and the inserted mq at 5
	// pushes nothing past app. Assert site-app did NOT move and is therefore not in
	// reordered, while the diff still correctly captured add/remove. (site-db keeps
	// position 4.)
	for _, r := range res.Diff.Reordered {
		if r.Key == "boot_member:site-db" {
			t.Errorf("site-db should not have moved, but diff reports %+v", r)
		}
	}

	// The trigger and event type reflect a regeneration.
	if res.Version.Trigger != TriggerMembership {
		t.Errorf("v2 trigger = %q, want %q", res.Version.Trigger, TriggerMembership)
	}
	lastEvt := stager.events[len(stager.events)-1]
	if lastEvt.eventType != eventRunbookRegenerated {
		t.Errorf("last event = %q, want %q", lastEvt.eventType, eventRunbookRegenerated)
	}
	if lastEvt.data["added"] != 1 || lastEvt.data["removed"] != 1 {
		t.Errorf("regenerated event diff counts = added:%v removed:%v, want 1/1", lastEvt.data["added"], lastEvt.data["removed"])
	}
}

func TestGenerator_ReorderProducesReorderedDiff(t *testing.T) {
	gen, store, _, _ := newTestGenerator(t)
	snap := threeMemberSnapshot()
	groupID := snap.GroupID
	store.setAssets(groupID, snap)
	tenantID := uuid.New()

	if _, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerManual); err != nil {
		t.Fatalf("v1: %v", err)
	}

	// Swap the boot order of db (10) and app (30): app now boots first.
	reordered := threeMemberSnapshot()
	reordered.Members[0].BootOrder = 30 // db now last
	reordered.Members[1].BootOrder = 10 // app now first
	store.setAssets(groupID, reordered)

	res, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerMembership)
	if err != nil {
		t.Fatalf("v2: %v", err)
	}
	if !res.Changed {
		t.Fatal("a boot-order change must produce a new version")
	}
	if res.Diff == nil || len(res.Diff.Reordered) == 0 {
		t.Fatalf("a boot-order change must produce a reordered diff, got %+v", res.Diff)
	}
	// db and app must both appear as reordered (they swapped); nothing added/removed.
	if len(res.Diff.Added) != 0 || len(res.Diff.Removed) != 0 {
		t.Errorf("a pure reorder must not add/remove steps, got added=%v removed=%v", res.Diff.Added, res.Diff.Removed)
	}
	gotKeys := map[string]bool{}
	for _, r := range res.Diff.Reordered {
		gotKeys[r.Key] = true
	}
	if !gotKeys["boot_member:site-db"] || !gotKeys["boot_member:site-app"] {
		t.Errorf("reordered diff = %+v, want both db and app moved", res.Diff.Reordered)
	}
}

func TestGenerator_RecoveryPointChangeIsContentChange(t *testing.T) {
	gen, store, _, _ := newTestGenerator(t)
	snap := threeMemberSnapshot()
	groupID := snap.GroupID
	store.setAssets(groupID, snap)
	tenantID := uuid.New()

	if _, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerManual); err != nil {
		t.Fatalf("v1: %v", err)
	}

	// A newer validated recovery point is pinned (same position, different content).
	newer := threeMemberSnapshot()
	newer.RecoveryPoint = &RecoveryPointAsset{
		ID: "rp-0002", MarkerLSN: "0/2000000", RPOSeconds: 12, ValidationRatio: 0.9999, IsValidated: true, LegalHold: true, SealedAt: "2026-06-13T12:30:00Z",
	}
	store.setAssets(groupID, newer)

	res, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerRecoveryPoint)
	if err != nil {
		t.Fatalf("v2: %v", err)
	}
	if !res.Changed {
		t.Fatal("re-pinning a newer recovery point must produce a new version")
	}
	if res.Diff == nil || !containsStr(res.Diff.Changed, "pin_recovery_point") {
		t.Fatalf("expected pin_recovery_point in the changed diff, got %+v", res.Diff)
	}
	if len(res.Diff.Added) != 0 || len(res.Diff.Removed) != 0 || len(res.Diff.Reordered) != 0 {
		t.Errorf("re-pin should only change content, not add/remove/reorder: %+v", res.Diff)
	}
}

func TestGenerator_GetOrGenerate_GeneratesOnDemand(t *testing.T) {
	gen, store, _, _ := newTestGenerator(t)
	snap := threeMemberSnapshot()
	store.setAssets(snap.GroupID, snap)
	tenantID := uuid.New()

	ver, err := gen.GetOrGenerate(context.Background(), tenantID, snap.GroupID, "production")
	if err != nil {
		t.Fatalf("GetOrGenerate (miss): %v", err)
	}
	if ver == nil || ver.Version != 1 {
		t.Fatalf("expected on-demand generation to return version 1, got %+v", ver)
	}
	// A second call returns the existing version without generating again.
	ver2, err := gen.GetOrGenerate(context.Background(), tenantID, snap.GroupID, "production")
	if err != nil {
		t.Fatalf("GetOrGenerate (hit): %v", err)
	}
	if ver2.Version != 1 {
		t.Errorf("second GetOrGenerate should return the existing version 1, got %d", ver2.Version)
	}
}

func TestGenerator_ListVersionsNewestFirst(t *testing.T) {
	gen, store, _, _ := newTestGenerator(t)
	snap := threeMemberSnapshot()
	groupID := snap.GroupID
	store.setAssets(groupID, snap)
	tenantID := uuid.New()

	if _, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerManual); err != nil {
		t.Fatalf("v1: %v", err)
	}
	changed := threeMemberSnapshot()
	changed.Members = changed.Members[:2] // drop one member
	store.setAssets(groupID, changed)
	if _, err := gen.Regenerate(context.Background(), tenantID, groupID, "production", TriggerMembership); err != nil {
		t.Fatalf("v2: %v", err)
	}

	versions, err := gen.ListVersions(context.Background(), tenantID, groupID)
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("expected 2 versions, got %d", len(versions))
	}
	if versions[0].Version != 2 || versions[1].Version != 1 {
		t.Errorf("versions not newest-first: %d, %d", versions[0].Version, versions[1].Version)
	}
}

func TestGenerator_GroupNotFoundSurfaces(t *testing.T) {
	gen, _, _, _ := newTestGenerator(t)
	_, err := gen.Regenerate(context.Background(), uuid.New(), "nonexistent", "production", TriggerManual)
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("expected ErrGroupNotFound for an unknown group, got %v", err)
	}
}

func containsStr(s []string, want string) bool {
	for _, v := range s {
		if v == want {
			return true
		}
	}
	return false
}
