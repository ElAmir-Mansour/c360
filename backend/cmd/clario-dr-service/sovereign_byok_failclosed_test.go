package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/dr/byok"
	drconfig "github.com/clario360/platform/internal/dr/config"
)

// mustRandom returns n cryptographically-random bytes or fails the test.
func mustRandom(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	_, err := io.ReadFull(rand.Reader, b)
	require.NoError(t, err)
	return b
}

// zeroUUID returns a fresh random tenant UUID for provider-argument tests.
func zeroUUID() uuid.UUID { return uuid.New() }

// TestBYOKProductionFailsClosedWithoutOperatorRootKey proves that the DR service
// REFUSES TO START in production when no operator key custody is configured — the
// volatile in-memory keystore, which a restart would empty (orphaning every wrapped
// DEK), is FORBIDDEN in production. This is the config-side fail-closed gate: a
// misconfigured production deployment must never boot.
//
// It exercises the REAL drconfig.Load() production branch (env-driven, no DB), not a
// re-implementation, so a regression that silently drops the gate would fail here.
func TestBYOKProductionFailsClosedWithoutOperatorRootKey(t *testing.T) {
	t.Run("production + no root key + no KMS endpoint => Load refuses to boot", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		// Both custody sources are absent.
		t.Setenv("DR_BYOK_ROOT_KEY", "")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		_, err := drconfig.Load(&appconfig.Config{})
		require.Error(t, err, "production with no BYOK custody must fail Load()")
		require.Contains(t, err.Error(), "production requires")
		require.Contains(t, err.Error(), "in-memory keystore is forbidden in production",
			"the error must name the forbidden in-memory fallback")
	})

	t.Run("prod alias normalizes and also fails closed", func(t *testing.T) {
		// ENVIRONMENT=prod is normalized to production by Load; the gate must still fire.
		t.Setenv("ENVIRONMENT", "prod")
		t.Setenv("DR_BYOK_ROOT_KEY", "")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		_, err := drconfig.Load(&appconfig.Config{})
		require.Error(t, err)
		require.Contains(t, err.Error(), "production requires")
	})

	t.Run("production + valid sealed root key => Load permits boot", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("DR_BYOK_ROOT_KEY", base64.StdEncoding.EncodeToString(make([]byte, byok.RootKeyBytes)))
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		cfg, err := drconfig.Load(&appconfig.Config{})
		require.NoError(t, err, "production WITH a sealed root key must Load cleanly")
		require.NotEmpty(t, cfg.RootKeyB64)
	})

	t.Run("production + remote KMS endpoint (no sealed key) => Load permits boot", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "production")
		t.Setenv("DR_BYOK_ROOT_KEY", "")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "https://kms.internal/transit")

		_, err := drconfig.Load(&appconfig.Config{})
		require.NoError(t, err, "production with a remote KMS endpoint must Load cleanly")
	})

	t.Run("NON-production + no custody => Load permits boot (memory fallback allowed off-prod)", func(t *testing.T) {
		t.Setenv("ENVIRONMENT", "development")
		t.Setenv("DR_BYOK_ROOT_KEY", "")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		_, err := drconfig.Load(&appconfig.Config{})
		require.NoError(t, err, "outside production the gate must not fire — dev may use the memory keystore")
	})
}

// TestSovereignKeyProviderFactorySelectsSealedOnlyWithValidRootKey proves the
// custody-selection logic in newSovereignKeyProviderFactory fails closed on a
// malformed operator root key and only ever hands back a SEALED (persistent,
// restart-safe) keystore when a real 32-byte root key is present — and that the
// volatile MemoryProviderFactory is reachable ONLY when no root key is supplied
// (dev/non-prod; config.Load already forbids that combination in production).
//
// Construction touches no database: NewPGSealedKEKStore only requires a non-nil
// runner, and NewSealedProviderFactory validates the root key in-process, so a nil
// pool is sufficient for this pure selection/validation test.
func TestSovereignKeyProviderFactorySelectsSealedOnlyWithValidRootKey(t *testing.T) {
	runner := sovereignTenantRunner{pool: nil} // never dereferenced during construction
	log := zerolog.Nop()

	t.Run("wrong-length (non-32-byte) root key => construction fails closed", func(t *testing.T) {
		// 16 raw bytes, valid base64 but the WRONG length for AES-256.
		t.Setenv("DR_BYOK_ROOT_KEY", base64.StdEncoding.EncodeToString(make([]byte, 16)))
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		f, err := newSovereignKeyProviderFactory(runner, log)
		require.Error(t, err, "a short root key must be rejected — no silent fallback to memory")
		require.Nil(t, f)
		require.True(t,
			strings.Contains(err.Error(), "must be base64") || strings.Contains(err.Error(), "32"),
			"error should reference the required 32-byte length, got: %v", err)
	})

	t.Run("over-length root key => construction fails closed", func(t *testing.T) {
		t.Setenv("DR_BYOK_ROOT_KEY", base64.StdEncoding.EncodeToString(make([]byte, 48)))
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		f, err := newSovereignKeyProviderFactory(runner, log)
		require.Error(t, err, "an over-length root key must be rejected")
		require.Nil(t, f)
	})

	t.Run("non-base64 root key => construction fails closed", func(t *testing.T) {
		t.Setenv("DR_BYOK_ROOT_KEY", "!!!not-base64!!!")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		f, err := newSovereignKeyProviderFactory(runner, log)
		require.Error(t, err, "a non-base64 root key must be rejected")
		require.Nil(t, f)
	})

	t.Run("valid 32-byte base64 root key => SEALED (not memory) keystore", func(t *testing.T) {
		t.Setenv("DR_BYOK_ROOT_KEY", base64.StdEncoding.EncodeToString(mustRandom(t, byok.RootKeyBytes)))
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		f, err := newSovereignKeyProviderFactory(runner, log)
		require.NoError(t, err)
		require.NotNil(t, f)

		_, isSealed := f.software.(*byok.SealedProviderFactory)
		require.True(t, isSealed, "a valid root key must select the SEALED persistent keystore")

		_, isMemory := f.software.(*byok.MemoryProviderFactory)
		require.False(t, isMemory, "a valid root key must NEVER select the volatile memory keystore")
	})

	t.Run("NO root key => volatile memory keystore (only reachable off-prod)", func(t *testing.T) {
		t.Setenv("DR_BYOK_ROOT_KEY", "")
		t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

		f, err := newSovereignKeyProviderFactory(runner, log)
		require.NoError(t, err)
		require.NotNil(t, f)

		_, isMemory := f.software.(*byok.MemoryProviderFactory)
		require.True(t, isMemory, "with no root key the factory falls back to the memory keystore")

		_, isSealed := f.software.(*byok.SealedProviderFactory)
		require.False(t, isSealed, "no root key must not yield a sealed keystore")

		// Belt-and-braces: config.Load must FORBID this exact (no-root-key) state in
		// production, so the memory keystore built here can never be reached in prod.
		t.Setenv("ENVIRONMENT", "production")
		_, loadErr := drconfig.Load(&appconfig.Config{})
		require.Error(t, loadErr, "production Load must reject the no-root-key state that yields memory custody")
	})
}

// TestSovereignKeyProviderFactoryValidRootKeyIsUsableSealedFactory is a lightweight
// sanity check that the sealed factory selected for a valid root key is a real,
// non-degenerate byok.ProviderFactory (rejects non-software providers, as the sealed
// factory must), proving the selection returns a live object and not a nil interface
// that happens to type-assert.
func TestSovereignKeyProviderFactoryValidRootKeyIsUsableSealedFactory(t *testing.T) {
	t.Setenv("DR_BYOK_ROOT_KEY", base64.StdEncoding.EncodeToString(mustRandom(t, byok.RootKeyBytes)))
	t.Setenv("DR_BYOK_KMS_ENDPOINT", "")

	f, err := newSovereignKeyProviderFactory(sovereignTenantRunner{pool: nil}, zerolog.Nop())
	require.NoError(t, err)

	sealed, ok := f.software.(*byok.SealedProviderFactory)
	require.True(t, ok)

	// A non-software provider must be refused by the sealed factory (validation), and
	// crucially without touching a DB.
	_, _, provErr := sealed.Provider(t.Context(), zeroUUID(), byok.ProviderKMS, "ref", 1, false)
	require.Error(t, provErr)
	require.True(t, errors.Is(provErr, byok.ErrValidation),
		"sealed factory must reject non-software providers with ErrValidation, got: %v", provErr)
}
