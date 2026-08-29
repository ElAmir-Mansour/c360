package cybervault

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

type directCyberVaultRunner struct{}

func (directCyberVaultRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

func (directCyberVaultRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}

type memoryPostureStore struct {
	mu          sync.Mutex
	vaults      map[string]RegisteredVault
	assessments map[string]StoredPostureAssessment
	upserts     int
	updates     int
}

func newMemoryPostureStore() *memoryPostureStore {
	return &memoryPostureStore{
		vaults:      map[string]RegisteredVault{},
		assessments: map[string]StoredPostureAssessment{},
	}
}

func (m *memoryPostureStore) UpsertVault(_ context.Context, _ DBTX, v *RegisteredVault) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if v.ID == "" {
		for _, existing := range m.vaults {
			if existing.TenantID == v.TenantID &&
				existing.GroupID == v.GroupID &&
				existing.Provider == v.Provider &&
				existing.ExternalID == v.ExternalID {
				v.ID = existing.ID
				v.CreatedAt = existing.CreatedAt
				break
			}
		}
	}
	if v.ID == "" {
		v.ID = uuid.NewString()
		v.CreatedAt = refNow
	}
	v.UpdatedAt = refNow
	normaliseVaultRecord(v)
	m.vaults[vaultKey(v.TenantID, v.ID)] = cloneVault(*v)
	m.upserts++
	return nil
}

func (m *memoryPostureStore) UpdateVault(_ context.Context, _ DBTX, v *RegisteredVault) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := vaultKey(v.TenantID, v.ID)
	existing, ok := m.vaults[key]
	if !ok || existing.GroupID != v.GroupID {
		return ErrNotFound
	}
	v.CreatedAt = existing.CreatedAt
	v.UpdatedAt = refNow
	normaliseVaultRecord(v)
	m.vaults[key] = cloneVault(*v)
	m.updates++
	return nil
}

func (m *memoryPostureStore) GetVault(_ context.Context, _ DBTX, tenantID, vaultID string) (*RegisteredVault, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	v, ok := m.vaults[vaultKey(tenantID, vaultID)]
	if !ok {
		return nil, ErrNotFound
	}
	clone := cloneVault(v)
	return &clone, nil
}

func (m *memoryPostureStore) ListVaults(_ context.Context, _ DBTX, tenantID, groupID string) ([]RegisteredVault, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	out := []RegisteredVault{}
	for _, v := range m.vaults {
		if v.TenantID == tenantID && v.GroupID == groupID {
			out = append(out, cloneVault(v))
		}
	}
	return out, nil
}

func (m *memoryPostureStore) SaveAssessment(_ context.Context, _ DBTX, tenantID, groupID string, posture VaultPosture, assessment PostureAssessment) (*StoredPostureAssessment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if assessment.VaultID == "" {
		assessment.VaultID = posture.ID
	}
	if assessment.Provider == "" {
		assessment.Provider = posture.Provider
	}
	stored := StoredPostureAssessment{
		ID:          uuid.NewString(),
		TenantID:    tenantID,
		GroupID:     groupID,
		VaultID:     assessment.VaultID,
		Provider:    assessment.Provider,
		Posture:     clonePosture(posture),
		Assessment:  cloneAssessment(assessment),
		Score:       assessment.Score,
		Verdict:     assessment.Verdict,
		EvaluatedAt: assessment.EvaluatedAt,
		CreatedAt:   refNow,
	}
	m.assessments[assessmentKey(tenantID, assessment.VaultID)] = cloneStoredAssessment(stored)
	return &stored, nil
}

func (m *memoryPostureStore) ListLatestAssessments(_ context.Context, _ DBTX, tenantID, groupID string) ([]StoredPostureAssessment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	out := []StoredPostureAssessment{}
	for _, a := range m.assessments {
		if a.TenantID == tenantID && a.GroupID == groupID {
			out = append(out, cloneStoredAssessment(a))
		}
	}
	return out, nil
}

func (m *memoryPostureStore) GetLatestAssessment(_ context.Context, _ DBTX, tenantID, vaultID string) (*StoredPostureAssessment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	a, ok := m.assessments[assessmentKey(tenantID, vaultID)]
	if !ok {
		return nil, ErrNotFound
	}
	clone := cloneStoredAssessment(a)
	return &clone, nil
}

type staticPostureSource struct {
	posture VaultPosture
	err     error

	called     bool
	lastTenant uuid.UUID
	lastVault  uuid.UUID
}

func (s *staticPostureSource) GetVaultPosture(_ context.Context, tenantID, vaultID uuid.UUID) (VaultPosture, error) {
	s.called = true
	s.lastTenant = tenantID
	s.lastVault = vaultID
	if s.err != nil {
		return VaultPosture{}, s.err
	}
	return clonePosture(s.posture), nil
}

func newServiceForTest(t *testing.T, store PostureStore, source PostureSource) *Service {
	t.Helper()
	svc, err := NewService(Config{
		Store:  store,
		Runner: directCyberVaultRunner{},
		Source: source,
		Now:    func() time.Time { return refNow },
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestNewService_RequiresStoreAndRunner(t *testing.T) {
	t.Parallel()

	if _, err := NewService(Config{Runner: directCyberVaultRunner{}}); err == nil {
		t.Fatal("NewService without store succeeded, want error")
	}
	if _, err := NewService(Config{Store: newMemoryPostureStore()}); err == nil {
		t.Fatal("NewService without runner succeeded, want error")
	}
}

func TestService_UpsertVaultPosture_NormalizesAndPersists(t *testing.T) {
	t.Parallel()
	store := newMemoryPostureStore()
	svc := newServiceForTest(t, store, nil)
	tenantID := uuid.New()
	groupID := uuid.New()

	got, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, VaultPosture{
		Name:           "  prod vault  ",
		PrimaryRegion:  " us-east-1 ",
		ReplicaRegions: []string{"", " us-west-2 ", "  "},
	})
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	if _, err := uuid.Parse(got.ID); err != nil {
		t.Fatalf("stored id is not uuid: %q", got.ID)
	}
	if _, err := uuid.Parse(got.Posture.ID); err != nil {
		t.Fatalf("posture id is not uuid: %q", got.Posture.ID)
	}
	if got.Name != "prod vault" || got.Posture.Name != "prod vault" {
		t.Fatalf("name was not trimmed into record/posture: %+v", got)
	}
	if got.Provider != VaultProviderGeneric || got.Posture.Provider != VaultProviderGeneric {
		t.Fatalf("provider = %q/%q, want generic", got.Provider, got.Posture.Provider)
	}
	if len(got.Posture.ReplicaRegions) != 1 || got.Posture.ReplicaRegions[0] != "us-west-2" {
		t.Fatalf("replica regions = %#v, want [us-west-2]", got.Posture.ReplicaRegions)
	}

	listed, err := svc.ListVaultPostures(context.Background(), tenantID, groupID)
	if err != nil {
		t.Fatalf("ListVaultPostures: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != got.ID {
		t.Fatalf("listed vaults = %#v, want one stored vault", listed)
	}
}

func TestService_UpdateVaultPosture_UsesPersistedVaultID(t *testing.T) {
	t.Parallel()
	store := newMemoryPostureStore()
	svc := newServiceForTest(t, store, nil)
	tenantID := uuid.New()
	groupID := uuid.New()

	created, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, VaultPosture{
		ID:       uuid.NewString(),
		Name:     "prod vault",
		Provider: VaultProviderAWSBackup,
	})
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	vaultID := uuid.MustParse(created.ID)
	updated, err := svc.UpdateVaultPosture(context.Background(), tenantID, groupID, vaultID, VaultPosture{Name: "prod vault renamed"})
	if err != nil {
		t.Fatalf("UpdateVaultPosture: %v", err)
	}
	if updated.ID != created.ID {
		t.Fatalf("updated id = %s, want existing id %s", updated.ID, created.ID)
	}
	if updated.Name != "prod vault renamed" || updated.Posture.ID != created.Posture.ID {
		t.Fatalf("updated vault = %+v, want renamed while preserving posture id %s", updated, created.Posture.ID)
	}
	if store.updates != 1 || store.upserts != 1 {
		t.Fatalf("store calls upserts/updates = %d/%d, want 1/1", store.upserts, store.updates)
	}
}

func TestService_UpsertVaultPosture_ValidatesExplicitInput(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)

	tests := []struct {
		name    string
		tenant  uuid.UUID
		group   uuid.UUID
		posture VaultPosture
	}{
		{name: "missing tenant", tenant: uuid.Nil, group: uuid.New(), posture: VaultPosture{Name: "v"}},
		{name: "missing group", tenant: uuid.New(), group: uuid.Nil, posture: VaultPosture{Name: "v"}},
		{name: "bad id", tenant: uuid.New(), group: uuid.New(), posture: VaultPosture{ID: "bad", Name: "v"}},
		{name: "missing name", tenant: uuid.New(), group: uuid.New(), posture: VaultPosture{ID: uuid.NewString()}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := svc.UpsertVaultPosture(context.Background(), tt.tenant, tt.group, tt.posture)
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

func TestService_EvaluateVault_UsesStoredPostureAndRecordsAssessment(t *testing.T) {
	t.Parallel()
	store := newMemoryPostureStore()
	svc := newServiceForTest(t, store, nil)
	tenantID := uuid.New()
	groupID := uuid.New()
	posture := strongPosture()
	posture.ID = uuid.NewString()

	registered, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, posture)
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	vaultID := uuid.MustParse(registered.ID)
	assessment, err := svc.EvaluateVault(context.Background(), tenantID, groupID, vaultID)
	if err != nil {
		t.Fatalf("EvaluateVault: %v", err)
	}
	if assessment.VaultID != registered.ID || assessment.Assessment.VaultID != registered.ID {
		t.Fatalf("vault id = %q/%q, want %s", assessment.VaultID, assessment.Assessment.VaultID, registered.ID)
	}
	if assessment.Score != 100 || assessment.Verdict != VerdictSatisfied {
		t.Fatalf("assessment = score %.1f verdict %s, want 100 satisfied", assessment.Score, assessment.Verdict)
	}
	if !assessment.EvaluatedAt.Equal(refNow) {
		t.Fatalf("evaluated_at = %v, want %v", assessment.EvaluatedAt, refNow)
	}

	latest, err := svc.LatestAssessmentByVault(context.Background(), tenantID, vaultID)
	if err != nil {
		t.Fatalf("LatestAssessmentByVault: %v", err)
	}
	if latest.VaultID != registered.ID {
		t.Fatalf("latest vault id = %q, want %s", latest.VaultID, registered.ID)
	}
}

func TestService_EvaluateVault_RefreshesFromSourceBeforeScoring(t *testing.T) {
	t.Parallel()
	store := newMemoryPostureStore()
	tenantID := uuid.New()
	groupID := uuid.New()
	seed := strongPosture()
	seed.ID = uuid.NewString()
	seed.Name = "prod vault"
	sourcePosture := strongPosture()
	sourcePosture.ID = ""
	sourcePosture.Name = ""
	source := &staticPostureSource{posture: sourcePosture}
	svc := newServiceForTest(t, store, source)

	registered, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, seed)
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	vaultID := uuid.MustParse(registered.ID)
	assessment, err := svc.EvaluateVault(context.Background(), tenantID, groupID, vaultID)
	if err != nil {
		t.Fatalf("EvaluateVault: %v", err)
	}
	if !source.called || source.lastTenant != tenantID || source.lastVault != vaultID {
		t.Fatalf("source call tenant/vault = %s/%s, called=%v", source.lastTenant, source.lastVault, source.called)
	}
	if assessment.VaultID != registered.ID || assessment.Score != 100 {
		t.Fatalf("assessment = %+v, want sourced 100-point assessment for vault", assessment)
	}
	stored, err := store.GetVault(context.Background(), nil, tenantID.String(), registered.ID)
	if err != nil {
		t.Fatalf("sourced posture was not updated: %v", err)
	}
	if stored.Name != "prod vault" || stored.Posture.Name != "prod vault" {
		t.Fatalf("stored source posture name = %q/%q, want existing name", stored.Name, stored.Posture.Name)
	}
	if stored.Posture.ID != seed.ID {
		t.Fatalf("stored source posture id = %q, want preserved external id %q", stored.Posture.ID, seed.ID)
	}
}

func TestService_EvaluateVault_SourceError(t *testing.T) {
	t.Parallel()
	store := newMemoryPostureStore()
	tenantID := uuid.New()
	groupID := uuid.New()
	posture := strongPosture()
	posture.ID = uuid.NewString()
	svc := newServiceForTest(t, store, &staticPostureSource{err: ErrSourceUnavailable})

	registered, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, posture)
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	_, err = svc.EvaluateVault(context.Background(), tenantID, groupID, uuid.MustParse(registered.ID))
	if !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("err = %v, want ErrSourceUnavailable", err)
	}
}

func vaultKey(tenantID, vaultID string) string {
	return tenantID + "|" + vaultID
}

func assessmentKey(tenantID, vaultID string) string {
	return tenantID + "|" + vaultID
}

func cloneVault(v RegisteredVault) RegisteredVault {
	v.Posture = clonePosture(v.Posture)
	return v
}

func clonePosture(posture VaultPosture) VaultPosture {
	posture.ReplicaRegions = append([]string(nil), posture.ReplicaRegions...)
	return posture
}

func cloneAssessment(assessment PostureAssessment) PostureAssessment {
	assessment.Findings = append([]VaultFinding(nil), assessment.Findings...)
	return assessment
}

func cloneStoredAssessment(assessment StoredPostureAssessment) StoredPostureAssessment {
	assessment.Posture = clonePosture(assessment.Posture)
	assessment.Assessment = cloneAssessment(assessment.Assessment)
	return assessment
}
