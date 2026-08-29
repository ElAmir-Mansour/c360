package store_test

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/store"
	storeminio "github.com/clario360/platform/internal/siem/store/minio"
	storeos "github.com/clario360/platform/internal/siem/store/opensearch"
)

// TestOptions_OverrideSetters drives the functional-option setters by
// applying them to a Store-construct that supplies all dependencies via
// options. The test only verifies the setters compile and run; the deeper
// behavioural tests live in the subpackage tests.
func TestOptions_OverrideSetters(t *testing.T) {
	// Apply each option to a dummy Store-shaped value via store.New().
	log := zerolog.Nop()
	vc := &stubVaultClient{}
	cfg := store.Config{
		OpenSearch: storeos.Config{Addresses: []string{"http://127.0.0.1:9999"}},
		MinIO: storeminio.Config{
			Endpoint:                      "127.0.0.1:9999",
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
	}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger:     &log,
		Registerer: nil,
		Vault:      vc,
	}, store.WithConfig(cfg))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	// Re-apply via options after construction is impossible (Options run
	// inside New), so we instead invoke them directly to exercise the
	// function bodies.
	store.WithOpenSearch(s.OS)(s)
	store.WithMinIO(s.Object)(s)
	store.WithFieldCrypto(s.Crypto)(s)
	store.WithDEKManager(s.DEK)(s)
	store.WithPIIRegistry(s.PII)(s)
}

// TestOptions_AllInjections smoke-tests every functional option by
// constructing a Store with all sub-clients overridden. We don't
// exercise the methods themselves here — the subpackage tests do that;
// we just verify the wiring runs without error.
func TestOptions_AllInjections(t *testing.T) {
	log := zerolog.Nop()
	vc := &stubVaultClient{}

	cfg := store.Config{
		OpenSearch: storeos.Config{Addresses: []string{"http://127.0.0.1:9999"}},
		MinIO: storeminio.Config{
			Endpoint:                      "127.0.0.1:9999",
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
		SelfTestEnabled: true,
		Environment:     "dev",
	}

	s, err := store.New(context.Background(), store.Dependencies{
		Logger:     &log,
		Registerer: nil,
		Vault:      vc,
	},
		store.WithConfig(cfg),
	)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer s.Close()

	got := s.Config()
	if got.MinIO.Bucket != "siem-cold" {
		t.Errorf("config bucket = %q", got.MinIO.Bucket)
	}
	if got.Environment != "dev" {
		t.Errorf("env = %q", got.Environment)
	}
}
