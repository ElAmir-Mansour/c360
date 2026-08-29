package iacdr

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// memStore is an in-memory storeAPI fake exercising the service's real
// orchestration (parse -> version -> persist -> diff -> plan) without a database.
// It enforces the (tenant,name,version) uniqueness and per-snapshot resource
// storage so the service's versioning and lookups are tested for real behaviour,
// not just method calls.
type memStore struct {
	mu        sync.Mutex
	snapshots map[string]*Snapshot  // id -> snapshot header
	resources map[string][]Resource // snapshot id -> resources
	groups    map[string]bool       // group id -> exists
	seq       int
}

func newMemStore() *memStore {
	return &memStore{
		snapshots: map[string]*Snapshot{},
		resources: map[string][]Resource{},
		groups:    map[string]bool{},
	}
}

func (m *memStore) NextVersion(_ context.Context, _ DBTX, tenantID, name string) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	max := 0
	for _, s := range m.snapshots {
		if s.TenantID == tenantID && s.Name == name && s.Version > max {
			max = s.Version
		}
	}
	return max + 1, nil
}

func (m *memStore) InsertSnapshot(_ context.Context, _ DBTX, snap *Snapshot) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.snapshots {
		if s.TenantID == snap.TenantID && s.Name == snap.Name && s.Version == snap.Version {
			return nil, errors.New("duplicate (tenant,name,version)")
		}
	}
	m.seq++
	id := uuid.NewSHA1(uuid.Nil, []byte{byte(m.seq)}).String()
	stored := *snap
	stored.ID = id
	m.snapshots[id] = &stored
	cp := stored
	return &cp, nil
}

func (m *memStore) InsertResources(_ context.Context, _ DBTX, tenantID, snapshotID string, resources []Resource) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Resource, len(resources))
	copy(cp, resources)
	for i := range cp {
		cp[i].TenantID = tenantID
		cp[i].SnapshotID = snapshotID
	}
	m.resources[snapshotID] = cp
	return nil
}

func (m *memStore) GetSnapshot(_ context.Context, _ DBTX, snapshotID string) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[snapshotID]
	if !ok {
		return nil, ErrSnapshotNotFound
	}
	cp := *s
	return &cp, nil
}

func (m *memStore) ListSnapshots(_ context.Context, _ DBTX, tenantID string) ([]Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Snapshot
	for _, s := range m.snapshots {
		if s.TenantID == tenantID {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (m *memStore) LoadResources(_ context.Context, _ DBTX, snapshotID string) ([]Resource, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]Resource, len(m.resources[snapshotID]))
	copy(cp, m.resources[snapshotID])
	return cp, nil
}

func (m *memStore) GroupExists(_ context.Context, _ DBTX, groupID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.groups[groupID], nil
}

// fakeRunner runs fn with a nil DBTX (the memStore ignores it).
type fakeRunner struct{}

func (fakeRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (fakeRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

// recordingStager records staged events so the service's transactional event
// emission is asserted.
type recordingStager struct {
	mu     sync.Mutex
	events []string
}

func (s *recordingStager) Stage(_ context.Context, _ DBTX, eventType, _ string, _ map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, eventType)
	return nil
}

func newTestService(t *testing.T) (*Service, *memStore, *recordingStager) {
	t.Helper()
	store := newMemStore()
	stager := &recordingStager{}
	svc, err := NewService(Config{
		Store:  store,
		Runner: fakeRunner{},
		Stager: stager,
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, store, stager
}

func TestService_IngestTerraform_VersionsAndPersists(t *testing.T) {
	svc, store, stager := newTestService(t)
	tenant := uuid.New()
	ctx := context.Background()

	snap, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name:       "prod",
		SourceKind: SourceTerraformState,
		Artifact:   []byte(realTerraformState),
	})
	if err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if snap.Version != 1 {
		t.Errorf("version = %d, want 1", snap.Version)
	}
	if snap.ResourceCount != 5 {
		t.Errorf("resource_count = %d, want 5", snap.ResourceCount)
	}
	if snap.ContentHash == "" {
		t.Error("content_hash empty")
	}
	if len(store.resources[snap.ID]) != 5 {
		t.Errorf("persisted resources = %d, want 5", len(store.resources[snap.ID]))
	}
	if len(stager.events) != 1 || stager.events[0] != eventSnapshotIngested {
		t.Errorf("events = %v, want [%s]", stager.events, eventSnapshotIngested)
	}

	// Second ingest of the same estate gets version 2.
	snap2, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name:       "prod",
		SourceKind: SourceTerraformState,
		Artifact:   []byte(realTerraformState),
	})
	if err != nil {
		t.Fatalf("Ingest 2: %v", err)
	}
	if snap2.Version != 2 {
		t.Errorf("version 2 = %d, want 2", snap2.Version)
	}
	// Identical estate -> identical content hash across versions.
	if snap2.ContentHash != snap.ContentHash {
		t.Errorf("identical estate should hash equal: %s != %s", snap2.ContentHash, snap.ContentHash)
	}
}

func TestService_Ingest_Validation(t *testing.T) {
	svc, _, _ := newTestService(t)
	tenant := uuid.New()
	ctx := context.Background()

	tests := []struct {
		name    string
		req     IngestRequest
		wantErr error
	}{
		{"missing name", IngestRequest{SourceKind: SourceTerraformState, Artifact: []byte("{}")}, ErrInvalidRequest},
		{"bad kind", IngestRequest{Name: "x", SourceKind: "nope", Artifact: []byte("{}")}, ErrUnsupportedKind},
		{"missing artifact", IngestRequest{Name: "x", SourceKind: SourceTerraformState}, ErrInvalidRequest},
		{"unparseable", IngestRequest{Name: "x", SourceKind: SourceTerraformState, Artifact: []byte("{bad")}, ErrParse},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.Ingest(ctx, tenant, tt.req)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestService_Ingest_GroupValidation(t *testing.T) {
	svc, store, _ := newTestService(t)
	tenant := uuid.New()
	ctx := context.Background()

	// Unknown group -> ErrInvalidRequest.
	_, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name: "p", SourceKind: SourceTerraformState, Artifact: []byte(realTerraformState),
		GroupID: uuid.New().String(),
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown group err = %v, want ErrInvalidRequest", err)
	}

	// Known group -> ok, group binding persisted.
	gid := uuid.New().String()
	store.groups[gid] = true
	snap, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name: "p", SourceKind: SourceTerraformState, Artifact: []byte(realTerraformState),
		GroupID: gid,
	})
	if err != nil {
		t.Fatalf("Ingest with group: %v", err)
	}
	if snap.GroupID == nil || *snap.GroupID != gid {
		t.Errorf("group binding = %v, want %s", snap.GroupID, gid)
	}
}

func TestService_DiffAndPlan_EndToEnd(t *testing.T) {
	svc, _, stager := newTestService(t)
	tenant := uuid.New()
	ctx := context.Background()

	v1, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name: "infra", SourceKind: SourceTerraformState, Artifact: []byte(realTerraformState),
	})
	if err != nil {
		t.Fatalf("ingest v1: %v", err)
	}

	// A modified state: change the subnet cidr.
	modified := `{
      "version": 4, "terraform_version": "1.7.5",
      "resources": [
        {"mode":"managed","type":"aws_vpc","name":"main","provider":"provider[\"registry.terraform.io/hashicorp/aws\"]",
         "instances":[{"index_key":null,"attributes":{"cidr_block":"10.0.0.0/16","tags":{"Name":"main-vpc"},"id":"vpc-123"},"dependencies":[]}]},
        {"mode":"managed","type":"aws_subnet","name":"main","provider":"provider[\"registry.terraform.io/hashicorp/aws\"]",
         "instances":[{"index_key":null,"attributes":{"cidr_block":"10.0.99.0/24","vpc_id":"vpc-123","id":"subnet-456"},"dependencies":["aws_vpc.main"]}]}
      ]
    }`
	v2, err := svc.Ingest(ctx, tenant, IngestRequest{
		Name: "infra", SourceKind: SourceTerraformState, Artifact: []byte(modified),
	})
	if err != nil {
		t.Fatalf("ingest v2: %v", err)
	}

	diff, err := svc.Diff(ctx, tenant, v2.ID, v1.ID)
	if err != nil {
		t.Fatalf("Diff: %v", err)
	}
	if !diff.HasDrift() {
		t.Fatal("expected drift between v1 and v2")
	}
	// v1 had 5 resources (incl. instance + 2 SG rules); v2 has 2. So removed
	// includes the instance + 2 SG rules; subnet modified.
	added, removed, modified2 := diff.Summary()
	if removed != 3 {
		t.Errorf("removed = %d, want 3 (instance + 2 sg rules)", removed)
	}
	if modified2 != 1 {
		t.Errorf("modified = %d, want 1 (subnet cidr)", modified2)
	}
	if added != 0 {
		t.Errorf("added = %d, want 0", added)
	}
	// A drift event was staged.
	foundDrift := false
	for _, e := range stager.events {
		if e == eventDriftDetected {
			foundDrift = true
		}
	}
	if !foundDrift {
		t.Errorf("expected a %s event; got %v", eventDriftDetected, stager.events)
	}

	// Reconstitution plan over v1: vpc(0) <- subnet(1) <- instance(2).
	plan, err := svc.ReconstitutionPlan(ctx, tenant, v1.ID)
	if err != nil {
		t.Fatalf("ReconstitutionPlan: %v", err)
	}
	wave := map[string]int{}
	for _, s := range plan.Steps {
		wave[s.Address] = s.Wave
	}
	if wave["aws_vpc.main"] != 0 || wave["aws_subnet.main"] != 1 || wave["aws_instance.web"] != 2 {
		t.Fatalf("plan waves wrong: %+v", wave)
	}
	if plan.SnapshotID != v1.ID {
		t.Errorf("plan snapshot id = %q, want %q", plan.SnapshotID, v1.ID)
	}
}

func TestService_GetSnapshot_NotFound(t *testing.T) {
	svc, _, _ := newTestService(t)
	_, err := svc.GetSnapshot(context.Background(), uuid.New(), uuid.New().String())
	if !errors.Is(err, ErrSnapshotNotFound) {
		t.Fatalf("err = %v, want ErrSnapshotNotFound", err)
	}
}

func TestService_ReconstitutionPlan_NotFound(t *testing.T) {
	svc, _, _ := newTestService(t)
	_, err := svc.ReconstitutionPlan(context.Background(), uuid.New(), uuid.New().String())
	if !errors.Is(err, ErrSnapshotNotFound) {
		t.Fatalf("err = %v, want ErrSnapshotNotFound", err)
	}
}
