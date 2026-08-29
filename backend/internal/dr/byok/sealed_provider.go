package byok

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// RootKeyBytes is the byte length of the operator ROOT key (the master key that
// seals every tenant KEK): 32 bytes = AES-256.
const RootKeyBytes = 32

// SealedProviderFactory is a fully-real, PERSISTENT, SEALED software keystore. It
// is the production-grade replacement for MemoryProviderFactory: where the memory
// factory keeps minted KEKs in a process-local map that a restart empties (which
// ORPHANS every wrapped DEK), this factory envelope-encrypts each freshly minted
// 32-byte tenant KEK under an operator-supplied ROOT key (AES-256-GCM) and
// PERSISTS the sealed blob to dr_sealed_kek. On restart a new factory instance
// over the same root key and the same persisted rows recovers every KEK, so no
// wrapped DEK is ever orphaned.
//
// The ROOT key is held only in the operator's custody (env DR_BYOK_ROOT_KEY, a
// base64 32-byte value; or, via a RootKeyResolver, a remote KMS reference). The
// tenant KEK plaintext exists only transiently in memory while sealing/unsealing;
// at rest only the sealed ciphertext lives in the database, and that ciphertext is
// useless to anyone without the root key. This is the sovereignty property: the
// database operator cannot read tenant DEKs from the dr_sealed_kek rows alone.
//
// It satisfies the same ProviderFactory interface as MemoryProviderFactory, so the
// BYOK Service composes it identically. It is safe for concurrent use (its state is
// the root key + a store that serializes its own access).
type SealedProviderFactory struct {
	root  RootKey
	store SealedKEKStore
	now   func() time.Time
}

// RootKey is the operator master key that seals tenant KEKs. ID is an opaque,
// non-secret label persisted alongside each sealed blob (dr_sealed_kek.root_key_id)
// so an operator can identify WHICH root key sealed a given KEK — e.g. after a root
// rotation, rows sealed under the retired root are still identifiable. Key is the
// 32-byte AES-256 root key material; it is never persisted or logged.
type RootKey struct {
	ID  string
	Key []byte
}

// Validate checks the root key is a real 32-byte AES-256 key with a non-empty ID.
func (r RootKey) Validate() error {
	if r.ID == "" {
		return fmt.Errorf("%w: root key ID is required", ErrValidation)
	}
	if len(r.Key) != RootKeyBytes {
		return fmt.Errorf("%w: root key must be %d bytes (AES-256), got %d", ErrValidation, RootKeyBytes, len(r.Key))
	}
	return nil
}

// SealedKEK is one persisted, envelope-encrypted tenant KEK. reference is the
// opaque handle stored in dr_tenant_kek.reference; the Service passes it back on a
// later unwrap so the factory can load and unseal this exact row. SealedKEK carries
// the ciphertext+tag and the GCM nonce used to seal the KEK under the root key.
type SealedKEK struct {
	Reference string
	TenantID  uuid.UUID
	// SealedKEK is nonce||ciphertext||tag: the AES-256-GCM sealing of the 32-byte
	// tenant KEK under the root key. The nonce is prepended so a single column
	// round-trips the whole sealed blob.
	SealedKEK []byte
	RootKeyID string
	CreatedAt time.Time
}

// SealedKEKStore persists and loads sealed tenant KEK blobs. It is the narrow
// persistence boundary the SealedProviderFactory drives; PGSealedKEKStore backs it
// with the RLS-tenant-scoped dr_sealed_kek table, and tests substitute an in-memory
// implementation to prove restart recovery without a live database. Implementations
// MUST enforce tenant isolation (a load for tenant A must never return tenant B's
// sealed blob).
type SealedKEKStore interface {
	// SaveSealedKEK persists a sealed KEK blob. A duplicate reference is a conflict.
	SaveSealedKEK(ctx context.Context, k *SealedKEK) error
	// LoadSealedKEK loads the sealed blob for (tenantID, reference), or ErrNotFound
	// when no such row exists for that tenant.
	LoadSealedKEK(ctx context.Context, tenantID uuid.UUID, reference string) (*SealedKEK, error)
}

// RootKeyResolver resolves an operator ROOT key. The default resolver returns a
// key supplied directly (from env DR_BYOK_ROOT_KEY); a KMS-backed resolver can
// fetch/unwrap the root key from a remote KMS reference at process start. Resolving
// once at construction keeps the root key out of every wrap/unwrap call path.
type RootKeyResolver interface {
	ResolveRootKey(ctx context.Context) (RootKey, error)
}

// StaticRootKey is a RootKeyResolver that returns a fixed root key. It is the
// env-supplied path (DR_BYOK_ROOT_KEY): the integrator base64-decodes the env value
// into Key and gives it a stable ID (e.g. "env" or a key fingerprint).
type StaticRootKey RootKey

// ResolveRootKey implements RootKeyResolver.
func (s StaticRootKey) ResolveRootKey(_ context.Context) (RootKey, error) {
	rk := RootKey(s)
	if err := rk.Validate(); err != nil {
		return RootKey{}, err
	}
	return rk, nil
}

var _ RootKeyResolver = StaticRootKey{}

// NewSealedProviderFactory constructs a sealed keystore over an operator root key
// and a persistence store. It validates the root key up front (fail closed: a
// missing/short root key is a construction error, never a silent fallback to an
// unsealed keystore).
func NewSealedProviderFactory(root RootKey, store SealedKEKStore) (*SealedProviderFactory, error) {
	if err := root.Validate(); err != nil {
		return nil, err
	}
	if store == nil {
		return nil, fmt.Errorf("%w: sealed keystore store is required", ErrValidation)
	}
	return &SealedProviderFactory{
		root:  root,
		store: store,
		now:   func() time.Time { return time.Now().UTC() },
	}, nil
}

// NewSealedProviderFactoryFromResolver resolves the root key (from env or a KMS
// reference) and constructs the factory. The root key is resolved exactly once,
// here, so it never has to be re-fetched on a wrap/unwrap.
func NewSealedProviderFactoryFromResolver(ctx context.Context, resolver RootKeyResolver, store SealedKEKStore) (*SealedProviderFactory, error) {
	if resolver == nil {
		return nil, fmt.Errorf("%w: root key resolver is required", ErrValidation)
	}
	root, err := resolver.ResolveRootKey(ctx)
	if err != nil {
		return nil, fmt.Errorf("byok: resolving root key: %w", err)
	}
	return NewSealedProviderFactory(root, store)
}

// Provider implements ProviderFactory.
//
// For provider=software: when newKEK is true it MINTS a fresh random 32-byte KEK,
// SEALS it under the root key, PERSISTS the sealed blob under a new reference and
// returns a SoftwareKeyProvider over the plaintext KEK plus that reference (which
// the Service persists to dr_tenant_kek.reference). When newKEK is false it LOADS
// the sealed blob for ref, UNSEALS it under the root key and returns a
// SoftwareKeyProvider — this is the restart-recovery path.
//
// For hsm/kms it returns an error: this factory is the software sealed keystore; a
// deployment wiring HSM/KMS supplies a remote factory that returns a
// RemoteKeyProvider. Keeping this factory software-only keeps the sealed-custody
// surface fully real.
func (f *SealedProviderFactory) Provider(ctx context.Context, tenantID uuid.UUID, provider, ref string, version int, newKEK bool) (KeyProvider, string, error) {
	if provider != ProviderSoftware {
		return nil, "", fmt.Errorf("%w: SealedProviderFactory custodies software KEKs only, got %q", ErrValidation, provider)
	}

	if newKEK {
		kp, kek, err := NewSoftwareKeyProviderRandom(version)
		if err != nil {
			return nil, "", err
		}
		sealed, err := f.seal(kek)
		if err != nil {
			return nil, "", err
		}
		newRef := fmt.Sprintf("sealed:%s:v%d:%s", tenantID, version, uuid.NewString())
		row := &SealedKEK{
			Reference: newRef,
			TenantID:  tenantID,
			SealedKEK: sealed,
			RootKeyID: f.root.ID,
			CreatedAt: f.now(),
		}
		if serr := f.store.SaveSealedKEK(ctx, row); serr != nil {
			return nil, "", fmt.Errorf("byok: persisting sealed KEK: %w", serr)
		}
		return kp, newRef, nil
	}

	row, err := f.store.LoadSealedKEK(ctx, tenantID, ref)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, "", fmt.Errorf("%w: no sealed KEK for reference %q", ErrNotFound, ref)
		}
		return nil, "", fmt.Errorf("byok: loading sealed KEK: %w", err)
	}
	kek, err := f.unseal(row.SealedKEK)
	if err != nil {
		return nil, "", err
	}
	kp, err := NewSoftwareKeyProvider(version, kek)
	if err != nil {
		return nil, "", err
	}
	return kp, ref, nil
}

// seal envelope-encrypts a 32-byte tenant KEK under the root key with a fresh
// random 96-bit nonce, returning nonce||ciphertext||tag. The root key ID is bound
// as GCM additional-authenticated-data so a blob sealed under one root cannot be
// silently re-attributed to another root ID at rest.
func (f *SealedProviderFactory) seal(kek []byte) ([]byte, error) {
	if len(kek) != KEKBytes {
		return nil, fmt.Errorf("%w: KEK to seal must be %d bytes, got %d", ErrValidation, KEKBytes, len(kek))
	}
	gcm, err := f.gcm()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, rerr := io.ReadFull(rand.Reader, nonce); rerr != nil {
		return nil, fmt.Errorf("byok: generating seal nonce: %w", rerr)
	}
	// Prepend the nonce; bind the root key ID as AAD.
	sealed := gcm.Seal(nonce, nonce, kek, []byte(f.root.ID))
	return sealed, nil
}

// unseal reverses seal: it splits nonce||ciphertext, GCM-opens under the root key
// (with the root ID as AAD) and returns the 32-byte tenant KEK. A wrong root key,
// a tampered blob, or a mismatched root ID fails the GCM authentication and returns
// ErrUnwrap — the restart-with-wrong-root-key case fails closed here.
func (f *SealedProviderFactory) unseal(sealed []byte) ([]byte, error) {
	gcm, err := f.gcm()
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(sealed) < ns+1 {
		return nil, fmt.Errorf("%w: sealed KEK blob too short (%d bytes)", ErrUnwrap, len(sealed))
	}
	nonce, ct := sealed[:ns], sealed[ns:]
	kek, oerr := gcm.Open(nil, nonce, ct, []byte(f.root.ID))
	if oerr != nil {
		// Wrong root key, tampered blob, or wrong root ID.
		return nil, fmt.Errorf("%w: unsealing KEK under root key: %v", ErrUnwrap, oerr)
	}
	if len(kek) != KEKBytes {
		return nil, fmt.Errorf("%w: unsealed KEK is %d bytes, want %d", ErrUnwrap, len(kek), KEKBytes)
	}
	return kek, nil
}

// gcm builds the AES-256-GCM AEAD over the root key. A defensive length check keeps
// a mis-sized root key from reaching aes.NewCipher with a confusing error.
func (f *SealedProviderFactory) gcm() (cipher.AEAD, error) {
	if len(f.root.Key) != RootKeyBytes {
		return nil, fmt.Errorf("%w: root key must be %d bytes", ErrValidation, RootKeyBytes)
	}
	block, err := aes.NewCipher(f.root.Key)
	if err != nil {
		return nil, fmt.Errorf("byok: constructing root AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("byok: constructing root GCM: %w", err)
	}
	return gcm, nil
}

// rootKeyEquals is a constant-time comparison used by tests/operators to confirm
// two root keys match without leaking timing. Not on any hot path.
func rootKeyEquals(a, b RootKey) bool {
	if len(a.Key) != len(b.Key) {
		return false
	}
	return subtle.ConstantTimeCompare(a.Key, b.Key) == 1
}

var _ ProviderFactory = (*SealedProviderFactory)(nil)

// --- Postgres-backed sealed keystore -----------------------------------------

// PGSealedKEKStore persists sealed KEK blobs to the RLS-tenant-scoped dr_sealed_kek
// table. It runs every query under the tenant's transaction (SET LOCAL
// app.current_tenant_id, RLS active) via a TenantRunner — the same discipline the
// byok Store and the rest of dr_db use — so a save/load can only ever touch the
// caller tenant's rows, with RLS as the backstop.
type PGSealedKEKStore struct {
	runner TenantRunner
}

// NewPGSealedKEKStore constructs the Postgres sealed keystore over the DR service's
// tenant runner (the same PGXTenantRunner the byok Service uses).
func NewPGSealedKEKStore(runner TenantRunner) (*PGSealedKEKStore, error) {
	if runner == nil {
		return nil, fmt.Errorf("%w: sealed keystore tenant runner is required", ErrValidation)
	}
	return &PGSealedKEKStore{runner: runner}, nil
}

const insertSealedKEKSQL = `
INSERT INTO dr_sealed_kek (reference, tenant_id, sealed_kek, root_key_id)
VALUES ($1, $2, $3, $4)`

// SaveSealedKEK persists a sealed KEK blob inside the tenant's RLS-scoped
// transaction. A duplicate reference (PK conflict) surfaces as ErrInvalidState.
func (s *PGSealedKEKStore) SaveSealedKEK(ctx context.Context, k *SealedKEK) error {
	if k == nil {
		return fmt.Errorf("%w: sealed KEK is nil", ErrValidation)
	}
	if k.Reference == "" || len(k.SealedKEK) == 0 || k.RootKeyID == "" {
		return fmt.Errorf("%w: sealed KEK reference, blob and root key ID are required", ErrValidation)
	}
	return s.runner.RunWithTenant(ctx, k.TenantID, func(db repository.DBTX) error {
		_, err := db.Exec(ctx, insertSealedKEKSQL, k.Reference, k.TenantID, k.SealedKEK, k.RootKeyID)
		if err != nil {
			if isUniqueViolation(err) {
				return fmt.Errorf("sealed KEK reference %q: %w", k.Reference, ErrInvalidState)
			}
			return fmt.Errorf("byok: inserting sealed KEK: %w", err)
		}
		return nil
	})
}

const selectSealedKEKSQL = `
SELECT reference, tenant_id, sealed_kek, root_key_id, created_at
FROM dr_sealed_kek
WHERE tenant_id = $1 AND reference = $2`

// LoadSealedKEK loads the sealed blob for (tenantID, reference) inside the tenant's
// RLS-scoped read transaction. Returns ErrNotFound when the row does not exist for
// that tenant.
func (s *PGSealedKEKStore) LoadSealedKEK(ctx context.Context, tenantID uuid.UUID, reference string) (*SealedKEK, error) {
	var out *SealedKEK
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var k SealedKEK
		serr := db.QueryRow(ctx, selectSealedKEKSQL, tenantID, reference).Scan(
			&k.Reference, &k.TenantID, &k.SealedKEK, &k.RootKeyID, &k.CreatedAt,
		)
		if serr != nil {
			if errors.Is(serr, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("byok: loading sealed KEK: %w", serr)
		}
		out = &k
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

var _ SealedKEKStore = (*PGSealedKEKStore)(nil)
