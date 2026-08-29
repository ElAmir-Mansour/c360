package metastore

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeRunner runs fn with a nil DBTX; the memStore ignores the DBTX. It uses a
// mutex so concurrent transactions are serialised (the real PGX runner gives the
// same single-writer-at-a-time guarantee via the row lock in FinalizeRevision).
type fakeRunner struct {
	mu sync.Mutex
}

func (f *fakeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return fn(nil)
}

func (f *fakeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	return fn(nil)
}

// memStore is an in-memory storeAPI for registry tests (mocks live only in test
// files; it is never a product source of truth). It models the real store's
// contract: child replacement, the metadata fingerprint/revision finalize, and
// the runbook-link upsert.
type memStore struct {
	apps   map[string]*Application // by id
	byKey  map[string]string       // app_key -> id
	links  map[string]*RunbookLink // appID|runbookID -> link
	nextID int
}

func newMemStore() *memStore {
	return &memStore{
		apps:  map[string]*Application{},
		byKey: map[string]string{},
		links: map[string]*RunbookLink{},
	}
}

func (m *memStore) GetApplicationByID(_ context.Context, _ DBTX, _, id string) (*Application, error) {
	app, ok := m.apps[id]
	if !ok {
		return nil, ErrNotFound
	}
	cp := *app
	return &cp, nil
}

func (m *memStore) GetApplicationByKey(_ context.Context, _ DBTX, _, appKey string) (*Application, error) {
	id, ok := m.byKey[appKey]
	if !ok {
		return nil, ErrNotFound
	}
	return m.GetApplicationByID(context.Background(), nil, "", id)
}

func (m *memStore) ListApplications(_ context.Context, _ DBTX, _ string, limit, offset int) (ListPage, error) {
	var all []Application
	for _, a := range m.apps {
		all = append(all, *a)
	}
	total := len(all)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return ListPage{Applications: all[offset:end], Total: total}, nil
}

func (m *memStore) InsertApplication(_ context.Context, _ DBTX, tenantID string, app Application, now time.Time) (string, error) {
	if _, ok := m.byKey[app.AppKey]; ok {
		return "", ErrAlreadyExists
	}
	m.nextID++
	id := uuid.NewString()
	app.ID = id
	app.TenantID = tenantID
	app.MetadataRevision = 1
	app.MetadataHash = ""
	app.CreatedAt = now
	app.UpdatedAt = now
	m.apps[id] = &app
	m.byKey[app.AppKey] = id
	return id, nil
}

func (m *memStore) UpdateApplicationScalars(_ context.Context, _ DBTX, _, id string, app Application, now time.Time) error {
	existing, ok := m.apps[id]
	if !ok {
		return ErrNotFound
	}
	existing.Name = app.Name
	existing.Description = app.Description
	existing.RecoveryTier = app.RecoveryTier
	existing.RTOTargetSeconds = app.RTOTargetSeconds
	existing.UpdatedAt = now
	return nil
}

func (m *memStore) ReplaceChildren(_ context.Context, _ DBTX, _, appID string, app Application) error {
	existing, ok := m.apps[appID]
	if !ok {
		return ErrNotFound
	}
	existing.Owners = app.Owners
	existing.Environments = app.Environments
	existing.Dependencies = app.Dependencies
	existing.CloudAccounts = app.CloudAccounts
	return nil
}

func (m *memStore) FinalizeRevision(_ context.Context, _ DBTX, _, id, newHash string, now time.Time) (int, string, error) {
	app, ok := m.apps[id]
	if !ok {
		return 0, "", ErrNotFound
	}
	if app.MetadataHash == newHash && app.MetadataHash != "" {
		return app.MetadataRevision, app.MetadataHash, nil
	}
	if app.MetadataHash == "" {
		app.MetadataHash = newHash
		app.UpdatedAt = now
		return app.MetadataRevision, app.MetadataHash, nil
	}
	app.MetadataRevision++
	app.MetadataHash = newHash
	app.UpdatedAt = now
	return app.MetadataRevision, app.MetadataHash, nil
}

func (m *memStore) DeleteApplication(_ context.Context, _ DBTX, _, id string) error {
	app, ok := m.apps[id]
	if !ok {
		return ErrNotFound
	}
	delete(m.byKey, app.AppKey)
	delete(m.apps, id)
	return nil
}

func (m *memStore) UpsertRunbookLink(_ context.Context, _ DBTX, _, appID, runbookID string, rev int, hash string, now time.Time) error {
	key := appID + "|" + runbookID
	m.links[key] = &RunbookLink{RunbookID: runbookID, SourceRevision: rev, SourceHash: hash, CreatedAt: now, UpdatedAt: now}
	app := m.apps[appID]
	if app != nil {
		app.LinkedRunbooks = append([]RunbookLink(nil), *m.links[key])
	}
	return nil
}

func (m *memStore) GetRunbookLink(_ context.Context, _ DBTX, appID, runbookID string) (*RunbookLink, error) {
	l, ok := m.links[appID+"|"+runbookID]
	if !ok {
		return nil, ErrRunbookNotLinked
	}
	cp := *l
	return &cp, nil
}

var _ storeAPI = (*memStore)(nil)

func newTestRegistry(t *testing.T, store storeAPI) *DefaultRegistry {
	t.Helper()
	reg, err := NewDefaultRegistry(Config{
		Store:  store,
		Runner: &fakeRunner{},
		Logger: zerolog.Nop(),
		Now:    func() time.Time { return time.Unix(1700000000, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("NewDefaultRegistry: %v", err)
	}
	return reg
}

func sampleInput() ApplicationInput {
	return ApplicationInput{
		AppKey:           "core-banking",
		Name:             "Core Banking",
		RecoveryTier:     TierMissionCritical,
		RTOTargetSeconds: 3600,
		Owners: []Owner{
			{Role: OwnerBusiness, Name: "Layla", Contact: "layla@bank"},
			{Role: OwnerTechnical, Name: "Omar", Contact: "omar@bank"},
		},
		Environments: []Environment{
			{Key: "prod-rh", Kind: EnvProduction, Region: "me-central-1", IsRecoveryTarget: false},
			{Key: "dr-jed", Kind: EnvDisasterRecovery, Region: "me-central-2", IsRecoveryTarget: true},
		},
		Dependencies: []Dependency{
			{DependsOnAppKey: "identity", Criticality: DependencyHard},
			{DependsOnAppKey: "analytics", Criticality: DependencySoft},
		},
		CloudAccounts: []CloudAccount{
			{Provider: ProviderAWS, AccountRef: "1234567890", Region: "me-central-2"},
		},
	}
}

// TestMetastoreClient_InterfaceConformance proves the shipped default registry
// satisfies the MetastoreClient seam at runtime, not just at compile time.
func TestMetastoreClient_InterfaceConformance(t *testing.T) {
	var client MetastoreClient = newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	app, err := client.CreateApplication(context.Background(), tenant, sampleInput())
	if err != nil {
		t.Fatalf("CreateApplication via interface: %v", err)
	}
	got, err := client.ResolveApplication(context.Background(), tenant, app.ID)
	if err != nil {
		t.Fatalf("ResolveApplication via interface: %v", err)
	}
	if got.AppKey != "core-banking" {
		t.Fatalf("app_key = %q, want core-banking", got.AppKey)
	}
}

func TestCreateApplication_HappyPath(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	app, err := reg.CreateApplication(context.Background(), tenant, sampleInput())
	if err != nil {
		t.Fatalf("CreateApplication: %v", err)
	}
	if app.MetadataRevision != 1 {
		t.Fatalf("initial revision = %d, want 1", app.MetadataRevision)
	}
	if app.MetadataHash == "" {
		t.Fatal("metadata hash should be set after create")
	}
	if len(app.Owners) != 2 || len(app.Environments) != 2 || len(app.Dependencies) != 2 || len(app.CloudAccounts) != 1 {
		t.Fatalf("children not persisted: %+v", app)
	}
}

func TestCreateApplication_DuplicateKey(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	if _, err := reg.CreateApplication(context.Background(), tenant, sampleInput()); err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err := reg.CreateApplication(context.Background(), tenant, sampleInput())
	if err != ErrAlreadyExists {
		t.Fatalf("duplicate create err = %v, want ErrAlreadyExists", err)
	}
}

func TestCreateApplication_Validation(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	cases := map[string]func(in *ApplicationInput){
		"empty app_key":     func(in *ApplicationInput) { in.AppKey = "" },
		"empty name":        func(in *ApplicationInput) { in.Name = "" },
		"bad tier":          func(in *ApplicationInput) { in.RecoveryTier = "tier_99" },
		"negative rto":      func(in *ApplicationInput) { in.RTOTargetSeconds = -1 },
		"bad env kind":      func(in *ApplicationInput) { in.Environments[0].Kind = "weird" },
		"dup env key":       func(in *ApplicationInput) { in.Environments[1].Key = in.Environments[0].Key },
		"self dependency":   func(in *ApplicationInput) { in.Dependencies[0].DependsOnAppKey = in.AppKey },
		"bad provider":      func(in *ApplicationInput) { in.CloudAccounts[0].Provider = "ibmcloud" },
		"empty account ref": func(in *ApplicationInput) { in.CloudAccounts[0].AccountRef = "" },
		"empty owner name":  func(in *ApplicationInput) { in.Owners[0].Name = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			in := sampleInput()
			mutate(&in)
			if _, err := reg.CreateApplication(context.Background(), tenant, in); err == nil {
				t.Fatalf("expected validation error for %q", name)
			}
		})
	}
}

func TestResolveApplication_NotFound(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	_, err := reg.ResolveApplication(context.Background(), uuid.New(), uuid.NewString())
	if err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// TestUpdateApplication_RevisionBumpsOnlyOnRealChange proves the drift-relevant
// fingerprint logic: editing a NON-drift field (description) keeps the revision;
// editing a drift-relevant field (RTO) advances it. This is what keeps an
// idempotent re-save from spuriously flagging drift on linked runbooks.
func TestUpdateApplication_RevisionBumpsOnlyOnRealChange(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	app, err := reg.CreateApplication(context.Background(), tenant, sampleInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if app.MetadataRevision != 1 {
		t.Fatalf("rev = %d, want 1", app.MetadataRevision)
	}

	// Re-save identical drift-relevant metadata (description differs only) → no bump.
	in := sampleInput()
	in.Description = "now with a description"
	updated, err := reg.UpdateApplication(context.Background(), tenant, app.ID, in)
	if err != nil {
		t.Fatalf("update (no drift change): %v", err)
	}
	if updated.MetadataRevision != 1 {
		t.Fatalf("rev after non-drift edit = %d, want 1", updated.MetadataRevision)
	}

	// Change the RTO target (a drift-relevant field) → revision advances.
	in.RTOTargetSeconds = 7200
	updated, err = reg.UpdateApplication(context.Background(), tenant, app.ID, in)
	if err != nil {
		t.Fatalf("update (drift change): %v", err)
	}
	if updated.MetadataRevision != 2 {
		t.Fatalf("rev after drift edit = %d, want 2", updated.MetadataRevision)
	}
}

func TestDeleteApplication(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())
	if err := reg.DeleteApplication(context.Background(), tenant, app.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := reg.ResolveApplication(context.Background(), tenant, app.ID); err != ErrNotFound {
		t.Fatalf("resolve after delete err = %v, want ErrNotFound", err)
	}
	if err := reg.DeleteApplication(context.Background(), tenant, app.ID); err != ErrNotFound {
		t.Fatalf("double delete err = %v, want ErrNotFound", err)
	}
}

// TestConcurrentUpdates_NoLostRevision exercises the stateful path under
// concurrency: many goroutines update the same application; the serialised
// transaction (FinalizeRevision's FOR UPDATE in production, the runner mutex
// here) must not lose a revision bump. Each distinct RTO is a drift-relevant
// change, so the final revision equals the number of distinct-value updates + 1.
func TestConcurrentUpdates_NoLostRevision(t *testing.T) {
	reg := newTestRegistry(t, newMemStore())
	tenant := uuid.New()
	app, _ := reg.CreateApplication(context.Background(), tenant, sampleInput())

	const n = 16
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			in := sampleInput()
			in.RTOTargetSeconds = 1000 + i // distinct → each is a real change
			if _, err := reg.UpdateApplication(context.Background(), tenant, app.ID, in); err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent update: %v", err)
	}
	final, err := reg.ResolveApplication(context.Background(), tenant, app.ID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	// Revision started at 1; each of the n distinct-value updates bumps once.
	if final.MetadataRevision != 1+n {
		t.Fatalf("final revision = %d, want %d (no lost updates)", final.MetadataRevision, 1+n)
	}
}
