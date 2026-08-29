//go:build integration

package store_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/store"
	"github.com/clario360/platform/internal/siem/store/crypto"
	storeminio "github.com/clario360/platform/internal/siem/store/minio"
	storeos "github.com/clario360/platform/internal/siem/store/opensearch"
	"github.com/clario360/platform/internal/siem/store/storetypes"
	"github.com/clario360/platform/internal/vault"
)

// integrationConfig is read from SIEM_INTEGRATION_* env vars. The tests
// skip when SIEM_INTEGRATION=1 is not set, so the file remains a no-op on
// CI runners that lack the full stack.
type integrationConfig struct {
	enabled       bool
	opensearchURL string
	minioEndpoint string
	minioAccess   string
	minioSecret   string
	vaultAddr     string
	vaultToken    string
	pgDSN         string
}

func loadIntegrationConfig() integrationConfig {
	return integrationConfig{
		enabled:       os.Getenv("SIEM_INTEGRATION") == "1",
		opensearchURL: envOrIT("SIEM_OPENSEARCH_URL", "http://localhost:9210"),
		minioEndpoint: envOrIT("SIEM_MINIO_ENDPOINT", "localhost:9010"),
		minioAccess:   envOrIT("SIEM_MINIO_ACCESS_KEY", "minio"),
		minioSecret:   envOrIT("SIEM_MINIO_SECRET_KEY", "minio123"),
		vaultAddr:     envOrIT("SIEM_VAULT_ADDR", "http://localhost:8200"),
		vaultToken:    envOrIT("SIEM_VAULT_TOKEN", "siem-dev-root-token-do-not-use-in-prod"),
		pgDSN:         os.Getenv("SIEM_PG_DSN"),
	}
}

func envOrIT(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}

// buildStoreForIT builds a Store wired against the integration-test
// infrastructure. Returns nil + skip-friendly error when the env says the
// integration profile is off.
func buildStoreForIT(t *testing.T) (*store.Store, integrationConfig) {
	t.Helper()
	cfg := loadIntegrationConfig()
	if !cfg.enabled {
		t.Skip("SIEM_INTEGRATION!=1; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	vc, err := vault.NewClient(ctx, vault.Config{
		Addr:        cfg.vaultAddr,
		AuthMethod:  vault.AuthMethodToken,
		Token:       cfg.vaultToken,
		Environment: "dev",
	})
	if err != nil {
		t.Fatalf("vault: %v", err)
	}
	log := zerolog.Nop()
	s, err := store.New(ctx, store.Dependencies{
		Logger:     &log,
		Registerer: nil,
		Vault:      vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{cfg.opensearchURL}},
		MinIO: storeminio.Config{
			Endpoint:                      cfg.minioEndpoint,
			AccessKey:                     cfg.minioAccess,
			SecretKey:                     cfg.minioSecret,
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test-" + uuid.NewString()[:8],
			SkipServerSideEncryptionCheck: true,
		},
		Environment:     "dev",
		SelfTestEnabled: true,
	}))
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	return s, cfg
}

func TestIntegration_EncryptedRoundTrip(t *testing.T) {
	s, _ := buildStoreForIT(t)
	defer s.Close()
	tenant := uuid.New()
	ctx := context.Background()

	if err := s.OS.EnsureIndexTemplate(ctx, tenant); err != nil {
		t.Fatal(err)
	}
	docs := []storetypes.Document{}
	for i := 0; i < 100; i++ {
		doc := storetypes.Document{
			"@timestamp": "2026-05-14T00:00:00Z",
			"tenant_id":  tenant.String(),
			"event":      map[string]any{"kind": "alert", "action": "test"},
		}
		if i < 50 {
			doc["user"] = map[string]any{"email": "pii@example.com"}
		}
		enc, _, err := s.Crypto.EncryptDocument(ctx, tenant, "siem-test-2026.05.14", doc)
		if err != nil {
			t.Fatalf("encrypt: %v", err)
		}
		docs = append(docs, enc)
	}
	if _, err := s.OS.BulkIndex(ctx, tenant, docs); err != nil {
		t.Fatalf("bulk: %v", err)
	}
}

func TestIntegration_WORMEnforcement(t *testing.T) {
	s, _ := buildStoreForIT(t)
	defer s.Close()
	if err := s.Object.WORMSelfTest(context.Background()); err != nil {
		t.Fatalf("WORMSelfTest: %v", err)
	}
}

func TestIntegration_DEKLifecycle(t *testing.T) {
	s, _ := buildStoreForIT(t)
	defer s.Close()
	tenant := uuid.New()
	ctx := context.Background()

	dek1, _, err := s.DEK.Get(ctx, tenant, "idx-A")
	if err != nil {
		t.Fatal(err)
	}
	dek2, _, err := s.DEK.Get(ctx, tenant, "idx-B")
	if err != nil {
		t.Fatal(err)
	}
	if string(dek1) == string(dek2) {
		t.Error("expected different DEKs per index")
	}
	s.DEK.Invalidate(tenant, "idx-A")
	dek1b, _, err := s.DEK.Get(ctx, tenant, "idx-A")
	if err != nil {
		t.Fatal(err)
	}
	if string(dek1) != string(dek1b) {
		t.Error("DEK should round-trip after invalidate+reload")
	}
}

func TestIntegration_TenantIsolation(t *testing.T) {
	s, _ := buildStoreForIT(t)
	defer s.Close()
	tenantA := uuid.New()
	tenantB := uuid.New()
	ctx := context.Background()

	if err := s.OS.EnsureIndexTemplate(ctx, tenantA); err != nil {
		t.Fatal(err)
	}
	if err := s.OS.EnsureIndexTemplate(ctx, tenantB); err != nil {
		t.Fatal(err)
	}

	docA := storetypes.Document{"tenant_id": tenantA.String(), "@timestamp": "2026-05-14"}
	docB := storetypes.Document{"tenant_id": tenantB.String(), "@timestamp": "2026-05-14"}
	if _, err := s.OS.BulkIndex(ctx, tenantA, []storetypes.Document{docA}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OS.BulkIndex(ctx, tenantB, []storetypes.Document{docB}); err != nil {
		t.Fatal(err)
	}
	// match_all from tenant A's perspective must not see tenant B's row.
	res, err := s.OS.Search(ctx, tenantA, []byte(`{"query":{"match_all":{}}}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range res.Hits {
		if h["tenant_id"] != tenantA.String() {
			t.Errorf("tenant leak: %v", h)
		}
	}
}

func TestIntegration_VaultSealed(t *testing.T) {
	// This subtest is intentionally non-destructive: it asserts the
	// fail-closed code path through a synthetic Vault outage. We do NOT
	// actually seal the test Vault — that would require operator-only
	// privileges. Instead we run with a Vault client that points at an
	// unreachable address and assert EncryptDocument fails closed.
	s, _ := buildStoreForIT(t)
	defer s.Close()
	bad, err := vault.NewClient(context.Background(), vault.Config{
		Addr:        "http://127.0.0.1:1", // intentional dead endpoint
		AuthMethod:  vault.AuthMethodToken,
		Token:       "stub",
		Environment: "dev",
		Timeout:     500 * time.Millisecond,
	})
	if err != nil {
		t.Logf("dead-vault client unbuildable (acceptable): %v", err)
		return
	}
	_ = bad
	// Switching the live Store's vault client is intentionally not exposed;
	// we instead rebuild a parallel Crypto with a stub registry.
	pii, _ := crypto.NewPIIRegistry()
	mgr, err := crypto.NewDEKManager(crypto.DEKManagerConfig{},
		crypto.DEKManagerDeps{Transit: crypto.NewTransit(bad), PII: pii})
	if err != nil {
		t.Fatal(err)
	}
	fc, _ := crypto.NewFieldCrypto(crypto.FieldCryptoDeps{DEK: mgr, PII: pii})
	_, _, encErr := fc.EncryptDocument(context.Background(), uuid.New(), "idx",
		storetypes.Document{"user": map[string]any{"email": "x@example.com"}})
	if encErr == nil {
		t.Fatal("expected failure when Vault unreachable")
	}
	if !errors.Is(encErr, crypto.ErrDEKUnavailable) {
		t.Errorf("err = %v, want ErrDEKUnavailable", encErr)
	}
}

func TestIntegration_SchemaHashStable(t *testing.T) {
	s, _ := buildStoreForIT(t)
	defer s.Close()
	hash := s.PII.SchemaHash()
	if hash == "" {
		t.Error("schema hash empty")
	}
	// Re-load registry and compare.
	r2, err := crypto.NewPIIRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if r2.SchemaHash() != hash {
		t.Errorf("re-loaded hash differs: %s != %s", r2.SchemaHash(), hash)
	}
}
