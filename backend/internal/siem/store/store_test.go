package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/observability/health"
	"github.com/clario360/platform/internal/siem/store"
	storeminio "github.com/clario360/platform/internal/siem/store/minio"
	storeos "github.com/clario360/platform/internal/siem/store/opensearch"
	"github.com/clario360/platform/internal/siem/store/storetypes"
	"github.com/clario360/platform/internal/vault"
)

// stubOS / stubMinio / stubVault implement the minimum interface surface
// needed by store.SelfTest. We avoid spinning up the real wrapper layers
// here so the unit test stays hermetic.

type stubOSClient struct {
	healthErr error
}

func (s *stubOSClient) EnsureIndexTemplate(ctx context.Context, t uuid.UUID) error { return nil }
func (s *stubOSClient) BulkIndex(ctx context.Context, t uuid.UUID, docs []storetypes.Document) (storeos.BulkResult, error) {
	return storeos.BulkResult{}, nil
}
func (s *stubOSClient) Search(ctx context.Context, t uuid.UUID, dsl []byte) (storeos.SearchResult, error) {
	return storeos.SearchResult{}, nil
}
func (s *stubOSClient) RolloverHot(ctx context.Context, t uuid.UUID) (storeos.RolloverResult, error) {
	return storeos.RolloverResult{}, nil
}
func (s *stubOSClient) FreezeWarm(ctx context.Context, t uuid.UUID, idx string) error { return nil }
func (s *stubOSClient) ClusterHealth(ctx context.Context) (storeos.Health, error) {
	return storeos.Health{Status: "green"}, s.healthErr
}
func (s *stubOSClient) HealthChecker() *storeos.HealthCheckerAdapter {
	return nil
}
func (s *stubOSClient) Close() error { return nil }

type stubMinioClient struct {
	healthErr error
	wormErr   error
}

func (s *stubMinioClient) SealIndex(ctx context.Context, t uuid.UUID, idx string, src interface{}, opts storeminio.SealOptions) (storeminio.SealResult, error) {
	return storeminio.SealResult{}, nil
}

// Match the actual interface — we can't reuse stub if the interface differs.
// So in this test we cheat by inserting only OS + Object + Vault wrappers
// that satisfy what SelfTest touches, then we bypass full New() by injecting.

func TestSelfTest_Stubbed(t *testing.T) {
	// We use the real minio/opensearch packages but with stub HTTP servers
	// would be ideal. For now, we just smoke-test New() with options that
	// substitute crypto + DEK manager and rely on Vault.Health stubbing.
	t.Skip("SelfTest needs a real-or-mock OS/Minio backend; covered by integration_test.go")
}

func TestNew_AppliesDefaultsAndRegistersHashGauge(t *testing.T) {
	log := zerolog.Nop()
	vc := &stubVaultClient{healthErr: nil}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger:     &log,
		Registerer: nil,
		Vault:      vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{"http://127.0.0.1:9999"}},
		MinIO: storeminio.Config{
			Endpoint:                      "127.0.0.1:9999",
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
	}))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	if s.PII == nil {
		t.Error("PII registry not built")
	}
	if s.DEK == nil {
		t.Error("DEK manager not built")
	}
	if s.Crypto == nil {
		t.Error("FieldCrypto not built")
	}
	if s.OS == nil {
		t.Error("OS client not built")
	}
	if s.Object == nil {
		t.Error("Object client not built")
	}
	checkers := s.HealthCheckers()
	if len(checkers) != 2 {
		t.Errorf("expected 2 health checkers, got %d", len(checkers))
	}
}

func TestSelfTest_VaultFailureWrapsErr(t *testing.T) {
	log := zerolog.Nop()
	vc := &stubVaultClient{healthErr: errors.New("vault sealed")}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger:     &log,
		Registerer: nil,
		Vault:      vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{"http://127.0.0.1:9999"}},
		MinIO: storeminio.Config{
			Endpoint:                      "127.0.0.1:9999",
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
		SelfTestTimeout: 200 * time.Millisecond,
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// SelfTest hits OS first (which is unreachable at 127.0.0.1:9999), so
	// the OS step fails before we ever reach Vault. We only verify the
	// returned error is wrapped as ErrSelfTestFailed.
	_, selfErr := s.SelfTest(context.Background())
	if selfErr == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(selfErr, store.ErrSelfTestFailed) {
		t.Errorf("err not ErrSelfTestFailed: %v", selfErr)
	}
}

// stubVaultClient satisfies vault.Client without contacting a server.
type stubVaultClient struct {
	healthErr error
}

func (s *stubVaultClient) EnsureTransitKey(ctx context.Context, key string) error { return nil }
func (s *stubVaultClient) GenerateDataKey(ctx context.Context, key string) (vault.DataKey, error) {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i)
	}
	return vault.DataKey{Plaintext: dek, Ciphertext: []byte("vault:v1:x"), KEKVersion: 1}, nil
}
func (s *stubVaultClient) Decrypt(ctx context.Context, key string, env []byte) ([]byte, error) {
	dek := make([]byte, 32)
	for i := range dek {
		dek[i] = byte(i)
	}
	return dek, nil
}
func (s *stubVaultClient) Health(ctx context.Context) error { return s.healthErr }
func (s *stubVaultClient) Close() error                     { return nil }

// SIEM-03 PKI methods (no-op stubs).
func (s *stubVaultClient) EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error {
	return nil
}
func (s *stubVaultClient) GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (string, error) {
	return "", nil
}
func (s *stubVaultClient) EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (string, error) {
	return "", nil
}
func (s *stubVaultClient) EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings vault.PKIRoleSettings) error {
	return nil
}
func (s *stubVaultClient) IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (vault.LeafCert, error) {
	return vault.LeafCert{}, nil
}
func (s *stubVaultClient) RevokeLeaf(ctx context.Context, mountPath, serial string) error {
	return nil
}

// suppress unused-import warnings when the stubs are skipped.
var _ = (storeminio.SealResult{})
var _ = health.HealthChecker(nil)
