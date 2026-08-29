package rehearsalproof

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// --- test fakes ---------------------------------------------------------------

// fakeRunner runs fn with a nil DBTX; the fake store ignores db so the sealer's
// flow is exercised without Postgres.
type fakeRunner struct{ writes, reads int }

func (r *fakeRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	r.writes++
	return fn(nil)
}

func (r *fakeRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	r.reads++
	return fn(nil)
}

// memStore is an in-memory proofStore that also enforces append-only semantics
// (it refuses to overwrite an existing (tenant, envelope_hash) row), mirroring
// the DB unique constraint + immutability trigger.
type memStore struct {
	rows map[string]*SealedProof // key: tenant|hash
}

func newMemStore() *memStore { return &memStore{rows: map[string]*SealedProof{}} }

func (m *memStore) key(tenantID uuid.UUID, hash string) string { return tenantID.String() + "|" + hash }

func (m *memStore) Insert(_ context.Context, _ repository.DBTX, p *SealedProof) error {
	k := m.key(p.TenantID, p.EnvelopeHash)
	if _, exists := m.rows[k]; exists {
		return ErrDuplicate
	}
	p.ID = uuid.New()
	p.CreatedAt = time.Now().UTC()
	cp := *p
	m.rows[k] = &cp
	return nil
}

type fakeWORM struct {
	calls   int
	lastKey string
	err     error
}

func (f *fakeWORM) SealProof(_ context.Context, _ uuid.UUID, key string, payload []byte) (string, string, error) {
	f.calls++
	f.lastKey = key
	if f.err != nil {
		return "", "", f.err
	}
	if len(payload) == 0 {
		return "", "", errors.New("empty payload sealed")
	}
	return "worm/" + key, "v1", nil
}

type fakeLedger struct {
	calls int
	last  AnchorInput
	seq   int64
	err   error
}

func (f *fakeLedger) AnchorProof(_ context.Context, in AnchorInput) (int64, string, error) {
	f.calls++
	f.last = in
	if f.err != nil {
		return 0, "", f.err
	}
	f.seq++
	return f.seq, "entryhash-" + in.EnvelopeHash, nil
}

// --- helpers ------------------------------------------------------------------

func rsaSignerPEM(t *testing.T) (*PEMSigner, *rsa.PublicKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	der := x509.MarshalPKCS1PrivateKey(key)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: der})
	signer, err := NewPEMSigner(pemBytes)
	if err != nil {
		t.Fatalf("new rsa signer: %v", err)
	}
	return signer, &key.PublicKey
}

func ecdsaSignerPEM(t *testing.T) (*PEMSigner, *ecdsa.PublicKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate ecdsa key: %v", err)
	}
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal ecdsa key: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: der})
	signer, err := NewPEMSigner(pemBytes)
	if err != nil {
		t.Fatalf("new ecdsa signer: %v", err)
	}
	return signer, &key.PublicKey
}

func sampleRecord(t *testing.T) *ProofRecord {
	t.Helper()
	a := New(func() time.Time { return time.Unix(1_700_000_000, 0).UTC() })
	rec, err := a.Build(BuildInput{
		TenantID: uuid.NewString(),
		Run:      RunRef{Type: RunTypeGameDay, ID: uuid.NewString(), Status: "passed"},
		Scope:    Scope{Name: "prod", Environment: "prod"},
		HealthChecks: []HealthCheck{
			{Name: "db up", Status: VerdictPassed, Passed: true, CheckedAt: time.Unix(1_700_000_000, 0).UTC()},
		},
		Provenance: Provenance{Source: SourceLiveRun, CapturedFrom: RunTypeGameDay},
	})
	if err != nil {
		t.Fatalf("build record: %v", err)
	}
	return rec
}

func newTestSealer(t *testing.T, signer Signer, worm WORMSealer, ledger LedgerAnchor, store proofStore, runner TenantRunner) *Sealer {
	t.Helper()
	s, err := NewSealer(SealerConfig{
		TX:     runner,
		Signer: signer,
		WORM:   worm,
		Ledger: ledger,
		store:  store,
		Now:    func() time.Time { return time.Unix(1_700_000_500, 0).UTC() },
	})
	if err != nil {
		t.Fatalf("new sealer: %v", err)
	}
	return s
}

// --- tests --------------------------------------------------------------------

func TestSeal_SignVerifyRoundTrip_RSA(t *testing.T) {
	signer, pub := rsaSignerPEM(t)
	worm := &fakeWORM{}
	ledger := &fakeLedger{}
	store := newMemStore()
	runner := &fakeRunner{}
	sealer := newTestSealer(t, signer, worm, ledger, store, runner)

	rec := sampleRecord(t)
	proof, err := sealer.Seal(context.Background(), SubjectKindGameDay, rec)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	if proof.Signature == "" || proof.SignatureAlg != SigAlgRSASHA256 {
		t.Fatalf("expected RSA signature, got alg=%q sig=%q", proof.SignatureAlg, proof.Signature)
	}
	// Signature verifies against the envelope hash.
	if err := VerifyEnvelopeSignature(pub, proof.SignatureAlg, proof.EnvelopeHash, proof.Signature); err != nil {
		t.Fatalf("signature did not verify: %v", err)
	}
	// A tampered hash must fail verification.
	if err := VerifyEnvelopeSignature(pub, proof.SignatureAlg, proof.EnvelopeHash+"x", proof.Signature); err == nil {
		t.Fatalf("expected verification failure for tampered hash")
	}
}

func TestSeal_SignVerifyRoundTrip_ECDSA(t *testing.T) {
	signer, pub := ecdsaSignerPEM(t)
	sealer := newTestSealer(t, signer, &fakeWORM{}, &fakeLedger{}, newMemStore(), &fakeRunner{})

	proof, err := sealer.Seal(context.Background(), SubjectKindGameDay, sampleRecord(t))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if proof.SignatureAlg != SigAlgECDSASHA256 {
		t.Fatalf("expected ECDSA alg, got %q", proof.SignatureAlg)
	}
	if err := VerifyEnvelopeSignature(pub, proof.SignatureAlg, proof.EnvelopeHash, proof.Signature); err != nil {
		t.Fatalf("ecdsa signature did not verify: %v", err)
	}
}

func TestSeal_WORMSealedAndLedgerAnchoredAndPersisted(t *testing.T) {
	signer, _ := rsaSignerPEM(t)
	worm := &fakeWORM{}
	ledger := &fakeLedger{}
	store := newMemStore()
	runner := &fakeRunner{}
	sealer := newTestSealer(t, signer, worm, ledger, store, runner)

	rec := sampleRecord(t)
	proof, err := sealer.Seal(context.Background(), SubjectKindGameDay, rec)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	if worm.calls != 1 {
		t.Fatalf("expected WORM.Seal called once, got %d", worm.calls)
	}
	if proof.WORMObjectKey == "" || proof.WORMObjectKey != "worm/"+worm.lastKey {
		t.Fatalf("proof not linked to sealed object: %q vs %q", proof.WORMObjectKey, worm.lastKey)
	}
	if ledger.calls != 1 {
		t.Fatalf("expected ledger anchored once, got %d", ledger.calls)
	}
	if proof.LedgerSeq != 1 || proof.LedgerEntryHash == "" {
		t.Fatalf("proof missing ledger inclusion ref: seq=%d hash=%q", proof.LedgerSeq, proof.LedgerEntryHash)
	}
	// The ledger anchor carried the signature + WORM key so the chain records the
	// sealed, signed evidence.
	if ledger.last.Signature != proof.Signature || ledger.last.WORMObjectKey != proof.WORMObjectKey {
		t.Fatalf("ledger anchor input did not carry sealed signature/worm key")
	}
	if runner.writes != 1 {
		t.Fatalf("expected one persist tx, got %d", runner.writes)
	}
	if _, ok := store.rows[store.key(proof.TenantID, proof.EnvelopeHash)]; !ok {
		t.Fatalf("proof was not persisted")
	}
	if proof.SignedAt.IsZero() {
		t.Fatalf("proof not timestamped")
	}
}

func TestSeal_FailsClosedOnWORMError(t *testing.T) {
	signer, _ := rsaSignerPEM(t)
	worm := &fakeWORM{err: errors.New("object store down")}
	ledger := &fakeLedger{}
	store := newMemStore()
	sealer := newTestSealer(t, signer, worm, ledger, store, &fakeRunner{})

	if _, err := sealer.Seal(context.Background(), SubjectKindGameDay, sampleRecord(t)); err == nil {
		t.Fatalf("expected seal to fail closed on WORM error")
	}
	if ledger.calls != 0 {
		t.Fatalf("ledger must not be anchored when WORM seal fails")
	}
	if len(store.rows) != 0 {
		t.Fatalf("no row must be persisted when WORM seal fails")
	}
}

func TestSeal_FailsClosedOnLedgerError(t *testing.T) {
	signer, _ := rsaSignerPEM(t)
	ledger := &fakeLedger{err: errors.New("ledger append failed")}
	store := newMemStore()
	sealer := newTestSealer(t, signer, &fakeWORM{}, ledger, store, &fakeRunner{})

	if _, err := sealer.Seal(context.Background(), SubjectKindGameDay, sampleRecord(t)); err == nil {
		t.Fatalf("expected seal to fail closed on ledger error")
	}
	if len(store.rows) != 0 {
		t.Fatalf("no row must be persisted when ledger anchoring fails")
	}
}

func TestSeal_ImmutableAppendOnly(t *testing.T) {
	signer, _ := rsaSignerPEM(t)
	store := newMemStore()
	sealer := newTestSealer(t, signer, &fakeWORM{}, &fakeLedger{}, store, &fakeRunner{})

	rec := sampleRecord(t)
	if _, err := sealer.Seal(context.Background(), SubjectKindGameDay, rec); err != nil {
		t.Fatalf("first seal: %v", err)
	}
	// Re-sealing the SAME envelope must be refused by the append-only store
	// (mirrors the unique constraint + immutability trigger): a persisted proof
	// can never be overwritten.
	_, err := sealer.Seal(context.Background(), SubjectKindGameDay, cloneForReseal(rec))
	if !errors.Is(err, ErrDuplicate) {
		t.Fatalf("expected ErrDuplicate on re-seal of identical envelope, got %v", err)
	}
	if len(store.rows) != 1 {
		t.Fatalf("append-only store must hold exactly one row, got %d", len(store.rows))
	}
}

// cloneForReseal returns a record with the same content (hence same envelope
// hash) as in, so re-sealing collides on the append-only key.
func cloneForReseal(in *ProofRecord) *ProofRecord {
	cp := *in
	cp.EnvelopeHash = "" // recomputed by Seal; content is identical → same hash
	return &cp
}

func TestNewSealer_FailsClosedWithoutProtections(t *testing.T) {
	signer, _ := rsaSignerPEM(t)
	cases := []struct {
		name string
		cfg  SealerConfig
	}{
		{"no tx", SealerConfig{Signer: signer, WORM: &fakeWORM{}, Ledger: &fakeLedger{}}},
		{"no signer", SealerConfig{TX: &fakeRunner{}, WORM: &fakeWORM{}, Ledger: &fakeLedger{}}},
		{"no worm", SealerConfig{TX: &fakeRunner{}, Signer: signer, Ledger: &fakeLedger{}}},
		{"no ledger", SealerConfig{TX: &fakeRunner{}, Signer: signer, WORM: &fakeWORM{}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewSealer(tc.cfg); err == nil {
				t.Fatalf("expected NewSealer to fail closed for %s", tc.name)
			}
		})
	}
}
