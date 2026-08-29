package byok

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"io"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// memSealedStore is an in-memory SealedKEKStore that stands in for dr_sealed_kek.
// Crucially, its rows OUTLIVE any single SealedProviderFactory: constructing a new
// factory over the SAME memSealedStore simulates a process restart with the DB rows
// still present. It also enforces tenant isolation (a load for tenant A never
// returns tenant B's blob) so the test exercises the same RLS contract the
// PGSealedKEKStore enforces in production.
type memSealedStore struct {
	mu   sync.Mutex
	rows map[string]*SealedKEK // reference -> sealed blob
}

func newMemSealedStore() *memSealedStore {
	return &memSealedStore{rows: make(map[string]*SealedKEK)}
}

func (m *memSealedStore) SaveSealedKEK(_ context.Context, k *SealedKEK) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rows[k.Reference]; ok {
		return ErrInvalidState // duplicate reference
	}
	cp := *k
	cp.SealedKEK = append([]byte(nil), k.SealedKEK...)
	m.rows[k.Reference] = &cp
	return nil
}

func (m *memSealedStore) LoadSealedKEK(_ context.Context, tenantID uuid.UUID, reference string) (*SealedKEK, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[reference]
	if !ok || row.TenantID != tenantID { // tenant isolation, as RLS enforces
		return nil, ErrNotFound
	}
	cp := *row
	cp.SealedKEK = append([]byte(nil), row.SealedKEK...)
	return &cp, nil
}

func mustRootKey(t *testing.T, id string) RootKey {
	t.Helper()
	key := make([]byte, RootKeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		t.Fatalf("root key: %v", err)
	}
	return RootKey{ID: id, Key: key}
}

// TestSealedProvider_WrapUnwrapRoundTrip proves the sealed factory mints a KEK,
// persists a sealed blob, and that KEK still wraps/unwraps a DEK within one process.
func TestSealedProvider_WrapUnwrapRoundTrip(t *testing.T) {
	ctx := context.Background()
	store := newMemSealedStore()
	root := mustRootKey(t, "root-1")
	f, err := NewSealedProviderFactory(root, store)
	if err != nil {
		t.Fatalf("new sealed factory: %v", err)
	}
	tenant := uuid.New()

	// Enroll: mint + seal + persist.
	kp, ref, err := f.Provider(ctx, tenant, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint KEK: %v", err)
	}
	if ref == "" {
		t.Fatalf("mint returned empty reference")
	}
	if len(store.rows) != 1 {
		t.Fatalf("expected 1 persisted sealed KEK, got %d", len(store.rows))
	}
	// The persisted blob must NOT contain the raw KEK bytes (it is sealed).
	rawKEK := kp.(*SoftwareKeyProvider).KEK()
	if bytes.Contains(store.rows[ref].SealedKEK, rawKEK) {
		t.Fatalf("persisted blob contains the plaintext KEK — not sealed")
	}

	dek := mustDEK(t, 32)
	wrapped, nonce, werr := kp.WrapDEK(ctx, dek)
	if werr != nil {
		t.Fatalf("wrap: %v", werr)
	}
	got, uerr := kp.UnwrapDEK(ctx, wrapped, nonce)
	if uerr != nil || !bytes.Equal(got, dek) {
		t.Fatalf("round-trip mismatch: err=%v", uerr)
	}
}

// TestSealedProvider_SurvivesRestart is THE money test: after a "restart" (a brand
// new SealedProviderFactory instance over the SAME root key and the SAME persisted
// rows), loading the KEK by its reference recovers the identical key material, so a
// DEK wrapped before the restart still unwraps after it. This is exactly the gap the
// in-memory MemoryProviderFactory could not close.
func TestSealedProvider_SurvivesRestart(t *testing.T) {
	ctx := context.Background()
	store := newMemSealedStore()
	root := mustRootKey(t, "root-1")
	tenant := uuid.New()

	// --- process lifetime #1: enroll and wrap a DEK ---
	f1, err := NewSealedProviderFactory(root, store)
	if err != nil {
		t.Fatalf("factory #1: %v", err)
	}
	kp1, ref, err := f1.Provider(ctx, tenant, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint KEK: %v", err)
	}
	dek := mustDEK(t, 32)
	wrapped, nonce, werr := kp1.WrapDEK(ctx, dek)
	if werr != nil {
		t.Fatalf("wrap before restart: %v", werr)
	}

	// --- SIMULATED RESTART: a new factory, same root key, same persisted rows.
	// f1 and its in-memory KEK are discarded, exactly as a process restart would. ---
	f2, err := NewSealedProviderFactory(RootKey{ID: root.ID, Key: append([]byte(nil), root.Key...)}, store)
	if err != nil {
		t.Fatalf("factory #2 (restart): %v", err)
	}
	kp2, gotRef, err := f2.Provider(ctx, tenant, ProviderSoftware, ref, 1, false)
	if err != nil {
		t.Fatalf("recover KEK after restart: %v", err)
	}
	if gotRef != ref {
		t.Fatalf("recovered ref = %q, want %q", gotRef, ref)
	}

	// The recovered KEK must be byte-identical to the original.
	if !bytes.Equal(kp1.(*SoftwareKeyProvider).KEK(), kp2.(*SoftwareKeyProvider).KEK()) {
		t.Fatalf("recovered KEK differs from the original — restart did not recover the key")
	}

	// And the DEK wrapped BEFORE the restart still unwraps AFTER it (no orphan).
	got, uerr := kp2.UnwrapDEK(ctx, wrapped, nonce)
	if uerr != nil {
		t.Fatalf("unwrap after restart failed — DEK orphaned: %v", uerr)
	}
	if !bytes.Equal(got, dek) {
		t.Fatalf("post-restart unwrap mismatch: got %x want %x", got, dek)
	}
}

// TestSealedProvider_WrongRootKeyFails proves the sealed blob is useless without the
// exact root key: a "restart" with a DIFFERENT root key cannot recover the KEK. This
// is the sovereignty property — the database operator holding dr_sealed_kek rows but
// not the root key cannot read the tenant's DEKs.
func TestSealedProvider_WrongRootKeyFails(t *testing.T) {
	ctx := context.Background()
	store := newMemSealedStore()
	tenant := uuid.New()

	good := mustRootKey(t, "root-1")
	f1, _ := NewSealedProviderFactory(good, store)
	_, ref, err := f1.Provider(ctx, tenant, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	// A different root key (same ID label, different material) must fail to unseal.
	wrongSameID := mustRootKey(t, "root-1")
	f2, _ := NewSealedProviderFactory(wrongSameID, store)
	if _, _, err := f2.Provider(ctx, tenant, ProviderSoftware, ref, 1, false); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("wrong root key (same ID) must fail unseal with ErrUnwrap, got %v", err)
	}

	// A different root ID also fails (the ID is bound as GCM AAD).
	wrongID := RootKey{ID: "root-2", Key: append([]byte(nil), good.Key...)}
	f3, _ := NewSealedProviderFactory(wrongID, store)
	if _, _, err := f3.Provider(ctx, tenant, ProviderSoftware, ref, 1, false); !errors.Is(err, ErrUnwrap) {
		t.Fatalf("mismatched root ID must fail unseal with ErrUnwrap, got %v", err)
	}

	// Sanity: the correct root key still recovers.
	f4, _ := NewSealedProviderFactory(good, store)
	if _, _, err := f4.Provider(ctx, tenant, ProviderSoftware, ref, 1, false); err != nil {
		t.Fatalf("correct root key should recover, got %v", err)
	}
}

// TestSealedProvider_TenantIsolation proves a reference minted for tenant A cannot
// be loaded under tenant B (the store enforces the same tenant scoping RLS does).
func TestSealedProvider_TenantIsolation(t *testing.T) {
	ctx := context.Background()
	store := newMemSealedStore()
	root := mustRootKey(t, "root-1")
	f, _ := NewSealedProviderFactory(root, store)

	tenantA, tenantB := uuid.New(), uuid.New()
	_, ref, err := f.Provider(ctx, tenantA, ProviderSoftware, "", 1, true)
	if err != nil {
		t.Fatalf("mint for A: %v", err)
	}
	if _, _, err := f.Provider(ctx, tenantB, ProviderSoftware, ref, 1, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("tenant B loading tenant A's reference must be ErrNotFound, got %v", err)
	}
}

// TestSealedProvider_Validation proves the factory fails closed on a bad root key or
// a missing store, and rejects non-software providers.
func TestSealedProvider_Validation(t *testing.T) {
	store := newMemSealedStore()

	// Short root key.
	if _, err := NewSealedProviderFactory(RootKey{ID: "x", Key: make([]byte, 16)}, store); !errors.Is(err, ErrValidation) {
		t.Fatalf("short root key should be rejected, got %v", err)
	}
	// Empty root ID.
	if _, err := NewSealedProviderFactory(RootKey{ID: "", Key: make([]byte, RootKeyBytes)}, store); !errors.Is(err, ErrValidation) {
		t.Fatalf("empty root ID should be rejected, got %v", err)
	}
	// Nil store.
	if _, err := NewSealedProviderFactory(RootKey{ID: "x", Key: make([]byte, RootKeyBytes)}, nil); !errors.Is(err, ErrValidation) {
		t.Fatalf("nil store should be rejected, got %v", err)
	}

	// Non-software provider rejected at Provider().
	root := mustRootKey(t, "root-1")
	f, _ := NewSealedProviderFactory(root, store)
	if _, _, err := f.Provider(context.Background(), uuid.New(), ProviderKMS, "ref", 1, false); !errors.Is(err, ErrValidation) {
		t.Fatalf("non-software provider should be rejected with ErrValidation, got %v", err)
	}
}

// TestSealedProvider_MissingReference proves loading an unknown reference is
// ErrNotFound (a clean, non-panicking miss).
func TestSealedProvider_MissingReference(t *testing.T) {
	store := newMemSealedStore()
	root := mustRootKey(t, "root-1")
	f, _ := NewSealedProviderFactory(root, store)
	if _, _, err := f.Provider(context.Background(), uuid.New(), ProviderSoftware, "sealed:none", 1, false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing reference should be ErrNotFound, got %v", err)
	}
}

// TestStaticRootKey_Resolver proves the env-supplied resolver path validates and
// returns the root key, and NewSealedProviderFactoryFromResolver wires it.
func TestStaticRootKey_Resolver(t *testing.T) {
	ctx := context.Background()
	store := newMemSealedStore()
	root := mustRootKey(t, "env")

	f, err := NewSealedProviderFactoryFromResolver(ctx, StaticRootKey(root), store)
	if err != nil {
		t.Fatalf("from resolver: %v", err)
	}
	if _, _, err := f.Provider(ctx, uuid.New(), ProviderSoftware, "", 1, true); err != nil {
		t.Fatalf("mint via resolver-built factory: %v", err)
	}

	// A short root key must fail closed through the resolver too.
	if _, err := NewSealedProviderFactoryFromResolver(ctx, StaticRootKey{ID: "env", Key: make([]byte, 8)}, store); !errors.Is(err, ErrValidation) {
		t.Fatalf("resolver with short root key should fail, got %v", err)
	}
	if _, err := NewSealedProviderFactoryFromResolver(ctx, nil, store); !errors.Is(err, ErrValidation) {
		t.Fatalf("nil resolver should fail, got %v", err)
	}
}

// TestRootKeyEquals is a small guard on the constant-time helper.
func TestRootKeyEquals(t *testing.T) {
	a := mustRootKey(t, "a")
	b := RootKey{ID: "b", Key: append([]byte(nil), a.Key...)}
	if !rootKeyEquals(a, b) {
		t.Fatalf("identical key material should compare equal")
	}
	c := mustRootKey(t, "c")
	if rootKeyEquals(a, c) {
		t.Fatalf("different key material should not compare equal")
	}
}
