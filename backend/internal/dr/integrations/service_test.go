package integrations

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// directRunner runs the supplied fn immediately with a nil DBTX: the fake store
// ignores the DBTX, so the service's transaction-wrapping logic is exercised
// without a database.
type directRunner struct {
	writeErr error
	readErr  error
}

func (d directRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	if d.writeErr != nil {
		return d.writeErr
	}
	return fn(nil)
}

func (d directRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	if d.readErr != nil {
		return d.readErr
	}
	return fn(nil)
}

// memStore is an in-memory catalogStore keyed by id. It preserves the sealed
// credential bundle verbatim so the service's encrypt-on-write / decrypt-on-test
// path is genuinely exercised.
type memStore struct {
	byID      map[uuid.UUID]*record
	createErr error
}

func newMemStore() *memStore { return &memStore{byID: map[uuid.UUID]*record{}} }

func (s *memStore) Create(_ context.Context, _ repository.DBTX, rec *record) error {
	if s.createErr != nil {
		return s.createErr
	}
	if rec.ID == uuid.Nil {
		rec.ID = uuid.New()
	}
	rec.CreatedAt = time.Now()
	rec.UpdatedAt = rec.CreatedAt
	cp := *rec
	s.byID[rec.ID] = &cp
	return nil
}

func (s *memStore) Get(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID) (*record, error) {
	rec, ok := s.byID[id]
	if !ok || rec.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *rec
	return &cp, nil
}

func (s *memStore) List(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) ([]*record, error) {
	var out []*record
	for _, rec := range s.byID {
		if rec.TenantID == tenantID {
			cp := *rec
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (s *memStore) ResolveActive(_ context.Context, _ repository.DBTX, tenantID uuid.UUID, vendor string) (*record, error) {
	for _, rec := range s.byID {
		if rec.TenantID == tenantID && rec.Vendor == vendor && rec.Enabled && rec.Status == StatusActive {
			cp := *rec
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (s *memStore) Update(_ context.Context, _ repository.DBTX, rec *record) error {
	existing, ok := s.byID[rec.ID]
	if !ok || existing.TenantID != rec.TenantID {
		return ErrNotFound
	}
	rec.CreatedAt = existing.CreatedAt
	rec.UpdatedAt = time.Now()
	cp := *rec
	s.byID[rec.ID] = &cp
	return nil
}

func (s *memStore) Delete(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID) error {
	rec, ok := s.byID[id]
	if !ok || rec.TenantID != tenantID {
		return ErrNotFound
	}
	delete(s.byID, id)
	return nil
}

func (s *memStore) UpdateTestResult(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID, status, testErr string, testedAt time.Time) (*record, error) {
	rec, ok := s.byID[id]
	if !ok || rec.TenantID != tenantID {
		return nil, ErrNotFound
	}
	rec.Status = status
	rec.LastTestError = testErr
	t := testedAt
	rec.LastTestedAt = &t
	cp := *rec
	return &cp, nil
}

func newTestService(t *testing.T, store catalogStore, runner TenantRunner) *Service {
	t.Helper()
	cipher, err := NewAESCipher(testKey(t))
	if err != nil {
		t.Fatalf("NewAESCipher: %v", err)
	}
	svc, err := NewService(ServiceConfig{
		Runner:  runner,
		Store:   NewStore(),
		Cipher:  cipher,
		Metrics: NewMetrics(nil),
		Logger:  zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	// Swap in the in-memory store for the unit tests (the real *Store needs a DB).
	svc.store = store
	return svc
}

func TestNewService_RequiresDeps(t *testing.T) {
	t.Parallel()
	cipher, _ := NewAESCipher(testKey(t))
	cases := []ServiceConfig{
		{Store: NewStore(), Cipher: cipher},         // no runner
		{Runner: directRunner{}, Cipher: cipher},    // no store
		{Runner: directRunner{}, Store: NewStore()}, // no cipher
	}
	for i, cfg := range cases {
		if _, err := NewService(cfg); err == nil {
			t.Fatalf("case %d: expected error for missing dependency", i)
		}
	}
}

func TestService_Create_Validation(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, newMemStore(), directRunner{})
	tenantID := uuid.New()

	cases := []struct {
		name string
		in   CreateInput
	}{
		{"empty name", CreateInput{Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "x"}},
		{"bad kind", CreateInput{Name: "n", Kind: "bogus", Vendor: "netapp_ontap", Endpoint: "x"}},
		{"empty vendor", CreateInput{Name: "n", Kind: KindStorageArray, Endpoint: "x"}},
		{"unknown vendor", CreateInput{Name: "n", Kind: KindStorageArray, Vendor: "acme_array", Endpoint: "x"}},
		{"kind/vendor mismatch", CreateInput{Name: "n", Kind: KindKubernetes, Vendor: "netapp_ontap", Endpoint: "x"}},
		{"missing endpoint for endpoint vendor", CreateInput{Name: "n", Kind: KindStorageArray, Vendor: "netapp_ontap"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := svc.Create(context.Background(), tenantID, tc.in); !errors.Is(err, ErrValidation) {
				t.Fatalf("err = %v, want ErrValidation", err)
			}
		})
	}
}

func TestService_Create_NormalizesVendor(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	out, err := svc.Create(context.Background(), uuid.New(), CreateInput{
		Name: "n", Kind: KindStorageArray, Vendor: "  NetApp_ONTAP  ", Endpoint: "https://array",
	})
	if err != nil {
		t.Fatalf("Create with mixed-case vendor: %v", err)
	}
	if out.Vendor != "netapp_ontap" {
		t.Fatalf("vendor not normalised: got %q, want %q", out.Vendor, "netapp_ontap")
	}
}

// recordingAuditSink captures every credential-access event for assertions.
type recordingAuditSink struct {
	events []CredentialAccessEvent
}

func (r *recordingAuditSink) CredentialAccessed(_ context.Context, ev CredentialAccessEvent) {
	r.events = append(r.events, ev)
}

// TestService_CredentialAccess_Audited proves a decryption never happens silently:
// both ResolveActive and TestConnection emit a secret-free audit event naming the
// tenant, integration, vendor, kind, and reason.
func TestService_CredentialAccess_Audited(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	audit := &recordingAuditSink{}
	svc.audit = audit
	svc.RegisterConnector(StaticConnector{VendorName: "netapp_ontap"}) // nil TestFunc => reachable
	tenantID := uuid.New()

	created, err := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "a", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array", Enabled: true,
		Credentials: Credentials{Username: "admin", Token: "s3cr3t"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// TestConnection decrypts -> one audit event with reason test_connection.
	if _, err := svc.TestConnection(context.Background(), tenantID, created.ID); err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	// ResolveActive decrypts -> one audit event with reason resolve_active.
	if _, _, err := svc.ResolveActive(context.Background(), tenantID, "netapp_ontap"); err != nil {
		t.Fatalf("ResolveActive: %v", err)
	}

	if len(audit.events) != 2 {
		t.Fatalf("want 2 credential-access events, got %d: %+v", len(audit.events), audit.events)
	}
	reasons := map[CredentialAccessReason]bool{}
	for _, ev := range audit.events {
		reasons[ev.Reason] = true
		if ev.TenantID != tenantID || ev.IntegrationID != created.ID || ev.Vendor != "netapp_ontap" || ev.Kind != KindStorageArray {
			t.Fatalf("audit event missing identity fields: %+v", ev)
		}
	}
	if !reasons[CredentialAccessTest] || !reasons[CredentialAccessResolve] {
		t.Fatalf("expected both test_connection and resolve_active reasons, got %+v", reasons)
	}
}

func TestService_Create_EndpointOptionalForLocalVendor(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, newMemStore(), directRunner{})
	in := CreateInput{Name: "local-nfs", Kind: KindStorageArray, Vendor: "nfs", Enabled: true}
	if _, err := svc.Create(context.Background(), uuid.New(), in); err != nil {
		t.Fatalf("nfs without endpoint should be allowed: %v", err)
	}
}

func TestService_Create_EncryptsCredentials(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()

	out, err := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "primary", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array",
		Enabled: true, Credentials: Credentials{Username: "svc", Token: "s3cr3t"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if out.Status != StatusConfigured {
		t.Fatalf("status = %q, want configured", out.Status)
	}
	rec := store.byID[out.ID]
	if rec == nil {
		t.Fatalf("record not persisted")
	}
	if len(rec.EncryptedCredentials) == 0 {
		t.Fatalf("credentials were not sealed")
	}
	if contains(rec.EncryptedCredentials, "s3cr3t") {
		t.Fatalf("sealed bundle leaks the plaintext token")
	}
}

func TestService_TestConnection_Success(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()

	created, err := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "vc", Kind: KindHypervisor, Vendor: "vmware_vsphere", Endpoint: "https://vc",
		Enabled: true, Credentials: Credentials{Username: "u", Token: "p"},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	var gotCfg Config
	svc.RegisterConnector(StaticConnector{VendorName: "vmware_vsphere", TestFunc: func(_ context.Context, cfg Config) error {
		gotCfg = cfg
		return nil
	}})

	out, err := svc.TestConnection(context.Background(), tenantID, created.ID)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if out.Status != StatusActive || out.LastTestedAt == nil {
		t.Fatalf("expected active + tested timestamp, got %+v", out)
	}
	if gotCfg.Token != "p" || gotCfg.Endpoint != "https://vc" {
		t.Fatalf("connector received wrong decrypted config: %+v", gotCfg)
	}
}

func TestService_TestConnection_Failure(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()

	created, _ := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "vc", Kind: KindHypervisor, Vendor: "vmware_vsphere", Endpoint: "https://vc",
		Enabled: true, Credentials: Credentials{Token: "p"},
	})
	svc.RegisterConnector(StaticConnector{VendorName: "vmware_vsphere", TestFunc: func(_ context.Context, _ Config) error {
		return errors.New("dial tcp: connection refused")
	}})

	out, err := svc.TestConnection(context.Background(), tenantID, created.ID)
	if err != nil {
		t.Fatalf("TestConnection returned a transport error, want recorded failure: %v", err)
	}
	if out.Status != StatusError || out.LastTestError == "" {
		t.Fatalf("expected error status + message, got %+v", out)
	}
}

func TestService_TestConnection_ConnectorMissing(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()
	created, _ := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "x", Kind: KindKubernetes, Vendor: "kubernetes", Endpoint: "https://api", Enabled: true,
	})
	if _, err := svc.TestConnection(context.Background(), tenantID, created.ID); !errors.Is(err, ErrConnectorMissing) {
		t.Fatalf("err = %v, want ErrConnectorMissing", err)
	}
}

func TestService_TestConnection_NotFound(t *testing.T) {
	t.Parallel()
	svc := newTestService(t, newMemStore(), directRunner{})
	if _, err := svc.TestConnection(context.Background(), uuid.New(), uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestService_ResolveActive(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()

	created, _ := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "vault", Kind: KindCloudVault, Vendor: "aws_backup", Endpoint: "https://backup",
		Enabled: true, Credentials: Credentials{Token: "key", Extra: map[string]string{"region": "me-central-1"}},
	})

	// Not active yet: ResolveActive must not find it.
	if _, _, err := svc.ResolveActive(context.Background(), tenantID, "aws_backup"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound before test passes", err)
	}

	svc.RegisterConnector(StaticConnector{VendorName: "aws_backup"})
	if _, err := svc.TestConnection(context.Background(), tenantID, created.ID); err != nil {
		t.Fatalf("TestConnection: %v", err)
	}

	in, cfg, err := svc.ResolveActive(context.Background(), tenantID, "aws_backup")
	if err != nil {
		t.Fatalf("ResolveActive: %v", err)
	}
	if in.ID != created.ID {
		t.Fatalf("resolved wrong integration: %s", in.ID)
	}
	if cfg.Token != "key" || cfg.Extra["region"] != "me-central-1" {
		t.Fatalf("decrypted config wrong: %+v", cfg)
	}
}

func TestService_Update_ResetsStatus(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()
	created, _ := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "a", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array", Enabled: true,
	})
	store.byID[created.ID].Status = StatusActive

	out, err := svc.Update(context.Background(), tenantID, created.ID, UpdateInput{
		Name: "a", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array2",
		Enabled: false, Credentials: Credentials{Token: "rotated"},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if out.Status != StatusConfigured {
		t.Fatalf("update must reset status to configured, got %q", out.Status)
	}
	if out.Endpoint != "https://array2" || out.Enabled {
		t.Fatalf("update did not apply fields: %+v", out)
	}
}

// TestService_Update_PreservesCredentialsAndStatus guards the metadata-only edit
// path: omitting credentials on Update must NOT wipe the stored secret, and a
// pure rename/toggle (no secret or target change) must keep the prior test
// status so an already-active integration is not silently dropped from
// ResolveActive.
func TestService_Update_PreservesCredentialsAndStatus(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()
	created, err := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "a", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array", Enabled: true,
		Credentials: Credentials{Username: "admin", Token: "s3cr3t", Extra: map[string]string{"svm": "vs1"}},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	// Mark it tested/active, as TestConnection would.
	store.byID[created.ID].Status = StatusActive
	sealedBefore := append([]byte(nil), store.byID[created.ID].EncryptedCredentials...)

	// Metadata-only edit: rename, no credentials, same endpoint/vendor.
	out, err := svc.Update(context.Background(), tenantID, created.ID, UpdateInput{
		Name: "a-renamed", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array", Enabled: true,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if out.Name != "a-renamed" {
		t.Fatalf("rename not applied: %+v", out)
	}
	if out.Status != StatusActive {
		t.Fatalf("metadata-only edit must keep status active, got %q", out.Status)
	}
	if !bytes.Equal(store.byID[created.ID].EncryptedCredentials, sealedBefore) {
		t.Fatalf("metadata-only edit wiped the stored credential bundle")
	}

	// The preserved secret must still decrypt to the original token via the
	// internal resolve path.
	store.byID[created.ID].Status = StatusActive
	_, cfg, err := svc.ResolveActive(context.Background(), tenantID, "netapp_ontap")
	if err != nil {
		t.Fatalf("ResolveActive after metadata edit: %v", err)
	}
	if cfg.Token != "s3cr3t" || cfg.Username != "admin" || cfg.Extra["svm"] != "vs1" {
		t.Fatalf("preserved credentials did not round-trip: %+v", cfg)
	}

	// Changing the endpoint must force a re-test (status back to configured).
	out, err = svc.Update(context.Background(), tenantID, created.ID, UpdateInput{
		Name: "a-renamed", Kind: KindStorageArray, Vendor: "netapp_ontap", Endpoint: "https://array-new", Enabled: true,
	})
	if err != nil {
		t.Fatalf("Update (endpoint change): %v", err)
	}
	if out.Status != StatusConfigured {
		t.Fatalf("endpoint change must reset status to configured, got %q", out.Status)
	}
}

func TestService_Delete(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc := newTestService(t, store, directRunner{})
	tenantID := uuid.New()
	created, _ := svc.Create(context.Background(), tenantID, CreateInput{
		Name: "a", Kind: KindKubernetes, Vendor: "kubernetes", Endpoint: "https://api", Enabled: true,
	})
	if err := svc.Delete(context.Background(), tenantID, created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := svc.Get(context.Background(), tenantID, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
}

func contains(b []byte, sub string) bool {
	return len(sub) > 0 && len(b) >= len(sub) && indexOf(b, sub) >= 0
}

func indexOf(b []byte, sub string) int {
	s := []byte(sub)
outer:
	for i := 0; i+len(s) <= len(b); i++ {
		for j := range s {
			if b[i+j] != s[j] {
				continue outer
			}
		}
		return i
	}
	return -1
}
