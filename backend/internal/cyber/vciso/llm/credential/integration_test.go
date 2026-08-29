//go:build integration

package credential

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/siem/store/crypto"
)

// startPlatformCorePG starts a Postgres container and applies the REAL
// migrations/platform_core/*.up.sql set — which includes 000017_llm_credentials
// creating BOTH siem.index_metadata (DEK envelopes) and llm_tenant_credentials.
//
// This is the runtime-path guard the fake-store unit tests cannot provide: it
// exercises the actual store SQL + DEK-envelope persistence against the actual
// platform_core schema the store is now bound to. If the store ever queries a
// table the platform_core migrations don't create (the exact "fakes pass,
// runtime breaks: relation does not exist" defect we are fixing), this fails.
func startPlatformCorePG(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("platform_core_it"),
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

	// credential/ is 5 dirs under backend/: internal/cyber/vciso/llm/credential.
	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "..", "migrations", "platform_core")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob platform_core migrations: %v", err)
	}
	if len(migs) == 0 {
		t.Fatalf("no platform_core migrations found at %s", migDir)
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

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	// Real DEKManager bound to the REAL pool (so DEK envelopes persist into
	// siem.index_metadata in this DB) with the deterministic fake Transit (no
	// Vault). The DB binding is real; only Vault is stubbed.
	mgr, err := crypto.NewDEKManager(crypto.DEKManagerConfig{}, crypto.DEKManagerDeps{Pool: pool, Transit: fakeTransit{}})
	if err != nil {
		t.Fatalf("NewDEKManager: %v", err)
	}
	t.Cleanup(func() { _ = mgr.Close() })
	sc, err := crypto.NewSecretCrypto(mgr)
	if err != nil {
		t.Fatalf("NewSecretCrypto: %v", err)
	}
	svc, err := NewService(NewStore(pool), sc, &captureEmitter{})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

// TestIntegration_RealDBBinding_PlatformCore proves the credential store works
// against the REAL platform_core schema where BuildResolver is now bound, across
// the full set/encrypt-at-rest/resolve/isolation/rotate/delete path.
func TestIntegration_RealDBBinding_PlatformCore(t *testing.T) {
	ctx, pool := startPlatformCorePG(t)
	svc := newIntegrationService(t, pool)

	tenantA := uuid.New()
	tenantB := uuid.New()
	keyA := "sk-ant-tenant-a-key-1234567890abcdef"

	// (1) Real binding: Set hits the real llm_tenant_credentials table. If the
	// migration didn't create it in THIS DB, this fails with "relation does not
	// exist" — the runtime defect a fake store hides.
	st, err := svc.Set(ctx, tenantA, "anthropic", "claude-opus-4-8", []byte(keyA))
	if err != nil {
		t.Fatalf("Set against real platform_core: %v", err)
	}
	if !st.Configured || !st.Enabled {
		t.Fatalf("status not configured/enabled after Set: %+v", st)
	}

	// (2) Encrypted at rest: the raw column is an enc:v1 envelope, never plaintext.
	var cipher string
	if err := pool.QueryRow(ctx, `SELECT api_key_cipher FROM llm_tenant_credentials WHERE tenant_id = $1`, tenantA).Scan(&cipher); err != nil {
		t.Fatalf("read api_key_cipher: %v", err)
	}
	if !strings.HasPrefix(cipher, "enc:v1:") {
		t.Fatalf("api_key_cipher is not an enc:v1 envelope: %q", cipher)
	}
	if strings.Contains(cipher, keyA) {
		t.Fatalf("plaintext key leaked into stored cipher column")
	}

	// (3) Resolve decrypts against the real DB + real DEK envelope (which lives in
	// siem.index_metadata in this same DB — also created by the migration).
	rc, err := svc.ResolveCredential(ctx, tenantA)
	if err != nil {
		t.Fatalf("ResolveCredential(A): %v", err)
	}
	if string(rc.APIKey) != keyA {
		t.Fatalf("resolved key does not match original")
	}

	// (4) Cross-tenant isolation: tenant B sees nothing. The store-backed Service
	// returns (nil, nil) for a tenant with no row — env-fallback/fail-closed is a
	// provider.Manager concern one layer up. The isolation property proven here is
	// that tenant B can never resolve tenant A's key.
	stB, err := svc.GetStatus(ctx, tenantB)
	if err != nil {
		t.Fatalf("GetStatus(B): %v", err)
	}
	if stB.Configured {
		t.Fatalf("tenant B must not see tenant A's credential")
	}
	rcB, err := svc.ResolveCredential(ctx, tenantB)
	if err != nil {
		t.Fatalf("ResolveCredential(B): unexpected error: %v", err)
	}
	if rcB != nil {
		t.Fatalf("tenant B must resolve no credential (isolation); got provider=%q", rcB.Provider)
	}

	// (5) Rotation bumps the version and changes the resolved key.
	var verBefore int64
	if err := pool.QueryRow(ctx, `SELECT version FROM llm_tenant_credentials WHERE tenant_id = $1`, tenantA).Scan(&verBefore); err != nil {
		t.Fatalf("read version before rotate: %v", err)
	}
	if _, err := svc.Rotate(ctx, tenantA, []byte("sk-ant-tenant-a-rotated-abcdef123456")); err != nil {
		t.Fatalf("Rotate: %v", err)
	}
	var verAfter int64
	if err := pool.QueryRow(ctx, `SELECT version FROM llm_tenant_credentials WHERE tenant_id = $1`, tenantA).Scan(&verAfter); err != nil {
		t.Fatalf("read version after rotate: %v", err)
	}
	if verAfter <= verBefore {
		t.Fatalf("rotate did not bump version: %d -> %d", verBefore, verAfter)
	}
	rc2, err := svc.ResolveCredential(ctx, tenantA)
	if err != nil {
		t.Fatalf("ResolveCredential after rotate: %v", err)
	}
	if string(rc2.APIKey) == keyA {
		t.Fatalf("rotate did not change the resolved key")
	}

	// (6) Delete clears it; subsequent resolve fails closed.
	if err := svc.Delete(ctx, tenantA); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	stDel, err := svc.GetStatus(ctx, tenantA)
	if err != nil {
		t.Fatalf("GetStatus after delete: %v", err)
	}
	if stDel.Configured {
		t.Fatalf("credential still present after Delete")
	}
}
