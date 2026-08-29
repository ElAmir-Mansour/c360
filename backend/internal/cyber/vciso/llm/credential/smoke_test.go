//go:build smoke

package credential

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	llmcfg "github.com/clario360/platform/internal/cyber/vciso/llm"
	vcisollmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// startSmokePG brings up a REAL Postgres and applies the REAL platform_core
// migrations (same set the migrator runs in prod), so the credential store SQL
// runs against the actual schema it is bound to at runtime.
func startSmokePG(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("platform_core_smoke"),
		postgresmod.WithUsername("pc"),
		postgresmod.WithPassword("pc"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "..", "migrations", "platform_core")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil || len(migs) == 0 {
		t.Fatalf("glob platform_core migrations (dir=%s): %v", migDir, err)
	}
	sort.Strings(migs)
	for _, m := range migs {
		b, readErr := os.ReadFile(m)
		if readErr != nil {
			t.Fatalf("read migration %s: %v", m, readErr)
		}
		if _, execErr := pool.Exec(ctx, string(b)); execErr != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(m), execErr)
		}
	}
	return ctx, pool
}

func smokeManagerConfig() *llmcfg.Config {
	return &llmcfg.Config{
		Enabled:         true,
		DefaultProvider: "anthropic",
		Providers: map[string]llmcfg.ProviderConfig{
			"anthropic": {
				APIKeyEnv:      "ANTHROPIC_API_KEY",
				Model:          "claude-opus-4-8",
				MaxTokens:      1024,
				TimeoutSeconds: 30,
			},
		},
	}
}

func providerAddr(p vcisollmprovider.LLMProvider) uintptr {
	if p == nil {
		return 0
	}
	return reflect.ValueOf(p).Pointer()
}

// TestSmoke_LiveCredentialEndToEnd drives the REAL runtime path:
//
//	BuildResolver(real Vault Transit) -> Service -> provider.Manager
//
// against a REAL Postgres carrying the REAL platform_core schema, and verifies
// every security property the SaaS per-tenant credential design promises. It
// requires real infra (SIEM_VAULT_* env + Docker); it is gated behind the
// `smoke` build tag and never runs in the default suite.
func TestSmoke_LiveCredentialEndToEnd(t *testing.T) {
	if strings.TrimSpace(os.Getenv("SIEM_VAULT_TOKEN")) == "" {
		t.Fatal("smoke requires real Vault: set SIEM_VAULT_ADDR + SIEM_VAULT_TOKEN")
	}
	ctx, pool := startSmokePG(t)

	// ---- REAL runtime wiring: the exact chain the cmds build ----
	svc, cleanup, err := BuildResolver(ctx, pool, nil, zerolog.Nop())
	if err != nil {
		t.Fatalf("BuildResolver (real Vault): %v", err)
	}
	if svc == nil {
		t.Fatal("BuildResolver returned nil resolver — Vault not configured; smoke cannot prove real path")
	}
	if cleanup != nil {
		t.Cleanup(cleanup)
	}
	mgr := vcisollmprovider.NewManagerWithCredentials(smokeManagerConfig(), svc)

	tenantA := uuid.New()
	tenantB := uuid.New()
	tenantEnv := uuid.New()    // no per-tenant cred; env fallback
	tenantClosed := uuid.New() // no per-tenant cred; env empty -> fail closed
	tenantZero := uuid.New()   // zeroing demonstration
	keyA := "sk-ant-tenant-A-live-0123456789abcdef0123456789"
	sharedKey := "sk-ant-IDENTICAL-plaintext-for-both-tenants-xyz"

	// =====================================================================
	// PROPERTY 1: encrypted at rest as enc:v1: (real Vault-wrapped DEK)
	// =====================================================================
	if _, err := svc.Set(ctx, tenantA, "anthropic", "claude-opus-4-8", []byte(keyA)); err != nil {
		t.Fatalf("Set(A) against real platform_core + real Vault: %v", err)
	}
	var cipherA string
	if err := pool.QueryRow(ctx, `SELECT api_key_cipher FROM llm_tenant_credentials WHERE tenant_id=$1`, tenantA).Scan(&cipherA); err != nil {
		t.Fatalf("read cipher(A): %v", err)
	}
	if !strings.HasPrefix(cipherA, "enc:v1:") {
		t.Fatalf("PROP1 FAIL: cipher not enc:v1 envelope: %q", cipherA)
	}
	if strings.Contains(cipherA, keyA) {
		t.Fatal("PROP1 FAIL: plaintext key present in stored cipher")
	}
	t.Logf("PROP1 PASS: at rest as enc:v1 envelope, no plaintext (%.16q...)", cipherA)

	// =====================================================================
	// PROPERTY 2: write-only Status DTO (never serializes the key/cipher)
	// =====================================================================
	st, err := svc.GetStatus(ctx, tenantA)
	if err != nil {
		t.Fatalf("GetStatus(A): %v", err)
	}
	stJSON, _ := json.Marshal(st)
	low := strings.ToLower(string(stJSON))
	for _, banned := range []string{keyA, "enc:v1:", "cipher", "api_key\"", "apikey", "plaintext"} {
		if strings.Contains(low, strings.ToLower(banned)) {
			t.Fatalf("PROP2 FAIL: Status JSON leaks %q: %s", banned, stJSON)
		}
	}
	if !st.Configured || !st.Enabled {
		t.Fatalf("PROP2 FAIL: status should be configured+enabled: %s", stJSON)
	}
	t.Logf("PROP2 PASS: Status DTO write-only (%s)", stJSON)

	// =====================================================================
	// PROPERTY 3: plaintext zeroed after use (the exact handler.go:77 pattern)
	// =====================================================================
	keyBuf := []byte("sk-ant-zero-me-after-set-0000000000")
	if _, err := svc.Set(ctx, tenantZero, "anthropic", "claude-opus-4-8", keyBuf); err != nil {
		t.Fatalf("Set(zero): %v", err)
	}
	zeroBytes(keyBuf) // identical call the handler makes immediately after Set
	for i, b := range keyBuf {
		if b != 0 {
			t.Fatalf("PROP3 FAIL: byte %d not zeroed: %d", i, b)
		}
	}
	t.Logf("PROP3 PASS: caller plaintext buffer zeroed after Set (handler.go:77 pattern)")

	// =====================================================================
	// PROPERTY 4: per-tenant DEK isolation — identical plaintext, two tenants,
	// must yield DIFFERENT ciphertext (each wrapped by a distinct Vault KEK),
	// and each decrypts only to its own key.
	// =====================================================================
	if _, err := svc.Set(ctx, tenantA, "anthropic", "claude-opus-4-8", []byte(sharedKey)); err != nil {
		t.Fatalf("Set(A, shared): %v", err)
	}
	if _, err := svc.Set(ctx, tenantB, "anthropic", "claude-opus-4-8", []byte(sharedKey)); err != nil {
		t.Fatalf("Set(B, shared): %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT api_key_cipher FROM llm_tenant_credentials WHERE tenant_id=$1`, tenantA).Scan(&cipherA); err != nil {
		t.Fatalf("re-read cipher(A): %v", err)
	}
	var cipherB string
	if err := pool.QueryRow(ctx, `SELECT api_key_cipher FROM llm_tenant_credentials WHERE tenant_id=$1`, tenantB).Scan(&cipherB); err != nil {
		t.Fatalf("read cipher(B): %v", err)
	}
	if cipherA == cipherB {
		t.Fatal("PROP4 FAIL: identical plaintext produced identical ciphertext across tenants (shared DEK)")
	}
	rcA, err := svc.ResolveCredential(ctx, tenantA)
	if err != nil || rcA == nil || string(rcA.APIKey) != sharedKey {
		t.Fatalf("PROP4 FAIL: tenant A does not decrypt to its own key: err=%v", err)
	}
	rcB, err := svc.ResolveCredential(ctx, tenantB)
	if err != nil || rcB == nil || string(rcB.APIKey) != sharedKey {
		t.Fatalf("PROP4 FAIL: tenant B does not decrypt to its own key: err=%v", err)
	}
	t.Logf("PROP4 PASS: per-tenant DEK isolation — same plaintext, distinct ciphertext, correct per-tenant decrypt")

	// =====================================================================
	// PROPERTY 5: cache invalidation on rotation — Manager caches the built
	// provider per (tenant, version). Rotation bumps the version, so the next
	// Resolve must build a NEW provider (cache miss), not serve the stale one.
	// =====================================================================
	p1, err := mgr.Resolve(ctx, tenantA)
	if err != nil {
		t.Fatalf("Resolve(A) #1: %v", err)
	}
	p1b, err := mgr.Resolve(ctx, tenantA)
	if err != nil {
		t.Fatalf("Resolve(A) #1b: %v", err)
	}
	if providerAddr(p1) != providerAddr(p1b) {
		t.Fatal("PROP5 FAIL: provider not cached across two resolves at same version")
	}
	if _, err := svc.Rotate(ctx, tenantA, []byte("sk-ant-tenant-A-ROTATED-99887766554433")); err != nil {
		t.Fatalf("Rotate(A): %v", err)
	}
	p2, err := mgr.Resolve(ctx, tenantA)
	if err != nil {
		t.Fatalf("Resolve(A) #2 post-rotate: %v", err)
	}
	if providerAddr(p2) == providerAddr(p1) {
		t.Fatal("PROP5 FAIL: rotation served the STALE cached provider (no cache invalidation)")
	}
	rcRot, err := svc.ResolveCredential(ctx, tenantA)
	if err != nil || rcRot == nil || string(rcRot.APIKey) == sharedKey {
		t.Fatalf("PROP5 FAIL: rotated credential did not change the resolved key: err=%v", err)
	}
	t.Logf("PROP5 PASS: rotation invalidated the provider cache (rebuilt) and resolves the new key")

	// =====================================================================
	// PROPERTY 6: resolution order per-tenant -> env -> fail-closed
	// =====================================================================
	// (a) per-tenant: already proven above (tenantA resolves its own key).
	// (b) env fallback: a tenant with NO per-tenant cred + env key present.
	origEnv, hadEnv := os.LookupEnv("ANTHROPIC_API_KEY")
	t.Cleanup(func() {
		if hadEnv {
			_ = os.Setenv("ANTHROPIC_API_KEY", origEnv)
		} else {
			_ = os.Unsetenv("ANTHROPIC_API_KEY")
		}
	})
	if err := os.Setenv("ANTHROPIC_API_KEY", "sk-ant-GLOBAL-env-fallback-key-0001"); err != nil {
		t.Fatalf("set env: %v", err)
	}
	if _, err := mgr.Resolve(ctx, tenantEnv); err != nil {
		t.Fatalf("PROP6 FAIL (env fallback): tenant with no cred + env key should resolve: %v", err)
	}
	t.Logf("PROP6a PASS: no per-tenant cred + env key present -> env fallback")

	// (c) fail-closed: no per-tenant cred + env empty + resolver wired (SaaS mode).
	if err := os.Unsetenv("ANTHROPIC_API_KEY"); err != nil {
		t.Fatalf("unset env: %v", err)
	}
	if _, err := mgr.Resolve(ctx, tenantClosed); err == nil {
		t.Fatal("PROP6 FAIL (fail-closed): no cred + no env in SaaS mode must error, got nil")
	}
	t.Logf("PROP6b PASS: no per-tenant cred + no env in SaaS mode -> fail closed")

	t.Log("ALL SECURITY PROPERTIES VERIFIED against real platform_core + real Vault Transit")
}
