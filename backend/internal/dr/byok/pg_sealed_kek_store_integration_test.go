//go:build integration

package byok

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// appTenantRunner adapts internal/database.RunWithTenant / RunReadWithTenant (which
// SET LOCAL app.current_tenant_id, RLS active) to the byok.TenantRunner interface the
// PGSealedKEKStore drives. It runs over the NON-SUPERUSER dr_app pool so RLS is truly
// enforced (a superuser silently bypasses RLS even under FORCE ROW LEVEL SECURITY, so
// testing as superuser would make the isolation assertion meaningless).
type appTenantRunner struct{ pool *pgxpool.Pool }

func (r appTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r appTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

var _ TenantRunner = appTenantRunner{}

// startPGForSealedKEK spins up an EPHEMERAL postgres testcontainer, applies the full
// dr_db migration chain (so dr_sealed_kek and its RLS policies from 000044 exist),
// and returns BOTH a superuser pool (for RLS-bypass system-path assertions and role
// setup) and a NON-SUPERUSER dr_app pool (for the request-path RLS assertions). The
// container is torn down in-test via t.Cleanup — never a shared/prod database.
func startPGForSealedKEK(t *testing.T) (context.Context, *pgxpool.Pool, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_sealed_kek_it"),
		postgresmod.WithUsername("dr"),
		postgresmod.WithPassword("dr"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")

	superPool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open superuser pool: %v", err)
	}
	t.Cleanup(superPool.Close)

	// Apply the full dr_db migration chain (the same *.up.sql the service migrator
	// runs), so dr_sealed_kek + its tenant RLS policies (000044) are present.
	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "dr_db")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob dr_db migrations: %v", err)
	}
	sort.Strings(migs)
	for _, m := range migs {
		b, rerr := os.ReadFile(m)
		if rerr != nil {
			t.Fatalf("read migration %s: %v", m, rerr)
		}
		if _, eerr := superPool.Exec(ctx, string(b)); eerr != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(m), eerr)
		}
	}

	// A NON-SUPERUSER login role: the request path runs as dr_app so RLS actually
	// applies (postgres superusers bypass RLS unconditionally).
	if _, err := superPool.Exec(ctx, `
CREATE ROLE dr_app LOGIN PASSWORD 'dr_app';
GRANT USAGE ON SCHEMA public TO dr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dr_app;
`); err != nil {
		t.Fatalf("create app role: %v", err)
	}

	appURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse postgres dsn: %v", err)
	}
	appURL.User = url.UserPassword("dr_app", "dr_app")
	appPool, err := pgxpool.New(ctx, appURL.String())
	if err != nil {
		t.Fatalf("open app pool: %v", err)
	}
	t.Cleanup(appPool.Close)

	return ctx, superPool, appPool
}

// TestPGSealedKEKStore_SealPersistUnsealRoundTrip proves the money property against a
// LIVE Postgres: a KEK sealed under the operator root key, persisted to dr_sealed_kek,
// then loaded and unsealed recovers the EXACT original key material — and the row at
// rest never contains the plaintext KEK (sovereignty).
func TestPGSealedKEKStore_SealPersistUnsealRoundTrip(t *testing.T) {
	ctx, _, appPool := startPGForSealedKEK(t)

	store, err := NewPGSealedKEKStore(appTenantRunner{pool: appPool})
	if err != nil {
		t.Fatalf("new pg sealed store: %v", err)
	}
	root := mustRootKey(t, "root-it-1")
	f, err := NewSealedProviderFactory(root, store)
	if err != nil {
		t.Fatalf("new sealed factory: %v", err)
	}
	tenant := uuid.New()

	// Mint + seal + PERSIST to dr_sealed_kek.
	kp, ref, err := f.Provider(ctx, tenant, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint+persist KEK: %v", err)
	}
	rawKEK := kp.(*SoftwareKeyProvider).KEK()

	// The persisted blob must be sealed: the raw KEK bytes must NOT appear in the row.
	var sealedBlob []byte
	if lerr := database.RunReadWithTenant(ctx, appPool, tenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT sealed_kek FROM dr_sealed_kek WHERE reference=$1`, ref).Scan(&sealedBlob)
	}); lerr != nil {
		t.Fatalf("read persisted blob: %v", lerr)
	}
	if bytes.Contains(sealedBlob, rawKEK) {
		t.Fatalf("persisted dr_sealed_kek.sealed_kek contains the plaintext KEK — not sealed")
	}

	// Load + unseal via a FRESH factory over the same store recovers the exact KEK.
	f2, err := NewSealedProviderFactory(RootKey{ID: root.ID, Key: append([]byte(nil), root.Key...)}, store)
	if err != nil {
		t.Fatalf("factory #2: %v", err)
	}
	kp2, gotRef, err := f2.Provider(ctx, tenant, ProviderSoftware, ref, 1, false)
	if err != nil {
		t.Fatalf("load+unseal KEK: %v", err)
	}
	if gotRef != ref {
		t.Fatalf("recovered ref = %q, want %q", gotRef, ref)
	}
	if !bytes.Equal(rawKEK, kp2.(*SoftwareKeyProvider).KEK()) {
		t.Fatalf("unsealed KEK differs from the original — round-trip lost the key")
	}

	// And a DEK wrapped under the original still unwraps under the recovered KEK.
	dek := mustDEK(t, 32)
	wrapped, nonce, werr := kp.WrapDEK(ctx, dek)
	if werr != nil {
		t.Fatalf("wrap: %v", werr)
	}
	got, uerr := kp2.UnwrapDEK(ctx, wrapped, nonce)
	if uerr != nil || !bytes.Equal(got, dek) {
		t.Fatalf("post-recover unwrap mismatch: err=%v", uerr)
	}
}

// TestPGSealedKEKStore_RLSTenantIsolationAndSystemBypass proves the isolation
// contract against LIVE RLS on dr_sealed_kek:
//
//	(a) a tenant-scoped tx (dr_app, RLS active) for tenant B CANNOT read tenant A's
//	    sealed KEK row — the store returns ErrNotFound and the raw row is invisible;
//	(b) the SYSTEM (RLS-bypass) path used by the rotation loop CAN enumerate the
//	    sealed rows ACROSS tenants (both A's and B's rows are visible).
func TestPGSealedKEKStore_RLSTenantIsolationAndSystemBypass(t *testing.T) {
	ctx, _, appPool := startPGForSealedKEK(t)

	store, err := NewPGSealedKEKStore(appTenantRunner{pool: appPool})
	if err != nil {
		t.Fatalf("new pg sealed store: %v", err)
	}
	root := mustRootKey(t, "root-it-iso")
	f, err := NewSealedProviderFactory(root, store)
	if err != nil {
		t.Fatalf("new sealed factory: %v", err)
	}

	tenantA, tenantB := uuid.New(), uuid.New()
	_, refA, err := f.Provider(ctx, tenantA, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint for A: %v", err)
	}
	_, refB, err := f.Provider(ctx, tenantB, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint for B: %v", err)
	}

	// (a) RLS ISOLATION — tenant B's scoped store load of A's reference must miss.
	if _, lerr := store.LoadSealedKEK(ctx, tenantB, refA); lerr == nil || lerr != ErrNotFound {
		t.Fatalf("tenant B loading tenant A's sealed KEK must be ErrNotFound, got %v", lerr)
	}
	// And the raw row is invisible to tenant B's RLS-scoped session entirely.
	if verr := database.RunReadWithTenant(ctx, appPool, tenantB, func(tx pgx.Tx) error {
		var n int
		if serr := tx.QueryRow(ctx, `SELECT count(*) FROM dr_sealed_kek WHERE reference=$1`, refA).Scan(&n); serr != nil {
			return serr
		}
		if n != 0 {
			t.Fatalf("tenant B RLS session sees %d rows of tenant A's sealed KEK, want 0", n)
		}
		// B still sees its OWN row (RLS is scoping, not blanket-denying).
		if serr := tx.QueryRow(ctx, `SELECT count(*) FROM dr_sealed_kek WHERE reference=$1`, refB).Scan(&n); serr != nil {
			return serr
		}
		if n != 1 {
			t.Fatalf("tenant B RLS session sees %d rows of its OWN sealed KEK, want 1", n)
		}
		return nil
	}); verr != nil {
		t.Fatalf("tenant B RLS read: %v", verr)
	}
	// Positive control: tenant A CAN load its own row.
	if _, lerr := store.LoadSealedKEK(ctx, tenantA, refA); lerr != nil {
		t.Fatalf("tenant A loading its own sealed KEK must succeed, got %v", lerr)
	}

	// (b) SYSTEM (RLS-bypass) path — the rotation loop enumerates ACROSS tenants.
	seen := map[string]uuid.UUID{}
	if serr := database.RunSystemRead(ctx, appPool, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(ctx, `SELECT reference, tenant_id FROM dr_sealed_kek ORDER BY created_at ASC`)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		for rows.Next() {
			var ref string
			var tid uuid.UUID
			if scerr := rows.Scan(&ref, &tid); scerr != nil {
				return scerr
			}
			seen[ref] = tid
		}
		return rows.Err()
	}); serr != nil {
		t.Fatalf("system-path enumeration: %v", serr)
	}
	if len(seen) < 2 {
		t.Fatalf("system (RLS-bypass) path enumerated %d sealed KEKs, want both tenants' rows visible", len(seen))
	}
	if seen[refA] != tenantA {
		t.Fatalf("system path did not see tenant A's row (%s -> %v)", refA, seen[refA])
	}
	if seen[refB] != tenantB {
		t.Fatalf("system path did not see tenant B's row (%s -> %v)", refB, seen[refB])
	}
}

// TestPGSealedKEKStore_RestartSafety proves restart-safety against a LIVE DB: a
// BRAND-NEW store + factory instance over the SAME database (a simulated process
// restart, discarding the previous in-memory KEK) recovers the persisted sealed KEKs
// for MULTIPLE tenants, so DEKs wrapped before the restart still unwrap after it — the
// exact orphaning gap the volatile memory keystore could not close.
func TestPGSealedKEKStore_RestartSafety(t *testing.T) {
	ctx, _, appPool := startPGForSealedKEK(t)
	root := mustRootKey(t, "root-it-restart")

	type enrolled struct {
		tenant  uuid.UUID
		ref     string
		kek     []byte
		dek     []byte
		wrapped []byte
		nonce   []byte
	}

	// --- process lifetime #1: a store + factory that enroll two tenants ---
	store1, err := NewPGSealedKEKStore(appTenantRunner{pool: appPool})
	if err != nil {
		t.Fatalf("store #1: %v", err)
	}
	f1, err := NewSealedProviderFactory(root, store1)
	if err != nil {
		t.Fatalf("factory #1: %v", err)
	}

	var recs []enrolled
	for i := 0; i < 2; i++ {
		tenant := uuid.New()
		kp, ref, perr := f1.Provider(ctx, tenant, ProviderSoftware, "", 1, true)
		if perr != nil {
			t.Fatalf("mint tenant %d: %v", i, perr)
		}
		dek := mustDEK(t, 32)
		wrapped, nonce, werr := kp.WrapDEK(ctx, dek)
		if werr != nil {
			t.Fatalf("wrap tenant %d: %v", i, werr)
		}
		recs = append(recs, enrolled{
			tenant:  tenant,
			ref:     ref,
			kek:     append([]byte(nil), kp.(*SoftwareKeyProvider).KEK()...),
			dek:     dek,
			wrapped: wrapped,
			nonce:   nonce,
		})
	}

	// --- SIMULATED RESTART: brand-new store + factory instances over the SAME DB and
	// the SAME root key; f1/store1 and their in-memory KEKs are discarded. ---
	store2, err := NewPGSealedKEKStore(appTenantRunner{pool: appPool})
	if err != nil {
		t.Fatalf("store #2 (restart): %v", err)
	}
	f2, err := NewSealedProviderFactory(RootKey{ID: root.ID, Key: append([]byte(nil), root.Key...)}, store2)
	if err != nil {
		t.Fatalf("factory #2 (restart): %v", err)
	}

	for i, rec := range recs {
		kp, gotRef, rerr := f2.Provider(ctx, rec.tenant, ProviderSoftware, rec.ref, 1, false)
		if rerr != nil {
			t.Fatalf("recover tenant %d after restart: %v", i, rerr)
		}
		if gotRef != rec.ref {
			t.Fatalf("tenant %d recovered ref = %q, want %q", i, gotRef, rec.ref)
		}
		if !bytes.Equal(kp.(*SoftwareKeyProvider).KEK(), rec.kek) {
			t.Fatalf("tenant %d recovered KEK differs — restart did not recover the key", i)
		}
		got, uerr := kp.UnwrapDEK(ctx, rec.wrapped, rec.nonce)
		if uerr != nil {
			t.Fatalf("tenant %d unwrap after restart failed — DEK orphaned: %v", i, uerr)
		}
		if !bytes.Equal(got, rec.dek) {
			t.Fatalf("tenant %d post-restart unwrap mismatch", i)
		}
	}

	// A restart with the WRONG root key must FAIL CLOSED — the sealed rows are
	// useless without the operator's exact root key (sovereignty).
	wrong := mustRootKey(t, root.ID) // same ID label, different material
	f3, err := NewSealedProviderFactory(wrong, store2)
	if err != nil {
		t.Fatalf("factory #3 (wrong root): %v", err)
	}
	if _, _, werr := f3.Provider(ctx, recs[0].tenant, ProviderSoftware, recs[0].ref, 1, false); werr == nil {
		t.Fatalf("restart with the WRONG root key must fail to unseal, but it recovered a KEK")
	}
}
