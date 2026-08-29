package rehearsalproof

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/worm"
)

// SubjectKind identifies the DR run a proof attests. It is stored on the row so
// an auditor can filter persisted proofs by rehearsal type and matches the
// existing run-type vocabulary.
const (
	SubjectKindGameDay       = RunTypeGameDay
	SubjectKindRunbookStudio = RunTypeRunbookStudio
	SubjectKindFailoverDrill = RunTypeFailoverDrill
)

var (
	// ErrNoSealer is returned when WORM sealing is attempted without a client.
	ErrNoSealer = errors.New("rehearsal proof: no WORM sealer configured")
	// ErrNoLedger is returned when ledger anchoring is attempted without an
	// anchor wired.
	ErrNoLedger = errors.New("rehearsal proof: no attestation ledger configured")
)

// WORMSealer seals proof envelope bytes to GOVERNANCE object-lock storage and
// returns the immutable object key + version. It is the narrow seam over
// internal/dr/worm.Client (see WORMClientSealer) so this package stays
// unit-testable and does not import the heavy MinIO client transitively at the
// call site.
type WORMSealer interface {
	SealProof(ctx context.Context, tenantID uuid.UUID, key string, payload []byte) (objectKey, versionID string, err error)
}

// LedgerAnchor appends a proof-sealed record into the tamper-evident attestation
// ledger (internal/dr/attestledger) and returns the allocated monotonic seq and
// the chain entry hash — the inclusion reference persisted on the proof row so
// the sealed proof is provably part of the same Merkle-anchored chain as the
// underlying Gate-4 attestations. The integrator wires this to an adapter over
// attestledger.Recorder.Append.
type LedgerAnchor interface {
	AnchorProof(ctx context.Context, in AnchorInput) (seq int64, entryHash string, err error)
}

// AnchorInput is the ledger append payload for a sealed proof.
type AnchorInput struct {
	TenantID      uuid.UUID
	SubjectKind   string
	SubjectRunID  string
	EnvelopeHash  string
	Signature     string
	SignatureAlg  string
	WORMObjectKey string
}

// TenantRunner runs a function inside a tenant-scoped read/write transaction with
// RLS set (SET LOCAL app.current_tenant_id). *pgxpool.Pool is adapted by
// PGXRunner; tests supply an in-memory fake.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner using the shared tenant-context
// helpers (SET LOCAL app.current_tenant_id), mirroring attestledger.PGXRunner.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a tenant-scoped read-write transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("rehearsal proof: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("rehearsal proof: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// WORMClientSealer adapts internal/dr/worm.Client to WORMSealer, sealing the
// proof envelope as a GOVERNANCE-locked object under a per-tenant synthetic
// stream ("rehearsal-proof") so the worm client selects the tenant DEK and
// groups proofs together. The supplied key is recorded as the marker so the
// object key is deterministic and discoverable.
type WORMClientSealer struct {
	Client      *worm.Client
	RetainUntil time.Time
}

// NewWORMClientSealer constructs a sealer backed by a DR WORM client.
func NewWORMClientSealer(client *worm.Client, retainUntil time.Time) (*WORMClientSealer, error) {
	if client == nil {
		return nil, fmt.Errorf("%w: nil WORM client", ErrNoSealer)
	}
	return &WORMClientSealer{Client: client, RetainUntil: retainUntil}, nil
}

// SealProof writes payload to the WORM bucket under a GOVERNANCE object-lock.
func (s *WORMClientSealer) SealProof(ctx context.Context, tenantID uuid.UUID, key string, payload []byte) (string, string, error) {
	if s == nil || s.Client == nil {
		return "", "", ErrNoSealer
	}
	res, err := s.Client.Seal(ctx, bytes.NewReader(payload), worm.SealOptions{
		TenantID:    tenantID,
		StreamID:    "rehearsal-proof",
		MarkerLSN:   key,
		RetainUntil: s.RetainUntil,
	})
	if err != nil {
		return "", "", fmt.Errorf("rehearsal proof: WORM seal: %w", err)
	}
	return res.Key, res.VersionID, nil
}

// proofStore is the persistence seam the Sealer depends on. The concrete *Store
// (DB-backed) is the production implementation; unit tests inject an in-memory
// store so the sign/seal/anchor flow is exercised without Postgres.
type proofStore interface {
	Insert(ctx context.Context, db repository.DBTX, p *SealedProof) error
}

// Sealer signs, WORM-seals, ledger-anchors and persists rehearsal-proof
// envelopes. All three protections are fail-closed: a missing signer, a WORM
// seal error, or a ledger append error aborts the seal and NO row is persisted,
// so a stored proof is always signed, sealed and anchored.
type Sealer struct {
	tx     TenantRunner
	store  proofStore
	signer Signer
	worm   WORMSealer
	ledger LedgerAnchor
	now    func() time.Time
}

// SealerConfig wires a Sealer.
type SealerConfig struct {
	TX     TenantRunner
	Store  *Store
	Signer Signer
	WORM   WORMSealer
	Ledger LedgerAnchor
	Now    func() time.Time
	// store overrides the concrete Store for unit tests (in-memory persistence).
	store proofStore
}

// NewSealer constructs a Sealer. TX, Signer, WORM and Ledger are all required —
// government-readiness means every persisted proof is signed, sealed AND
// anchored, so the constructor fails closed if any protection is missing.
func NewSealer(cfg SealerConfig) (*Sealer, error) {
	if cfg.TX == nil {
		return nil, errors.New("rehearsal proof: tenant runner is required")
	}
	if cfg.Signer == nil {
		return nil, ErrNoSigner
	}
	if cfg.WORM == nil {
		return nil, ErrNoSealer
	}
	if cfg.Ledger == nil {
		return nil, ErrNoLedger
	}
	var store proofStore = cfg.Store
	if cfg.store != nil {
		store = cfg.store
	}
	if store == nil {
		store = NewStore()
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Sealer{
		tx:     cfg.TX,
		store:  store,
		signer: cfg.Signer,
		worm:   cfg.WORM,
		ledger: cfg.Ledger,
		now:    now,
	}, nil
}

// Seal turns a freshly-assembled ProofRecord into a persisted, signed, sealed,
// anchored SealedProof:
//
//  1. canonicalize + SHA-256 hash the envelope (recomputed here so the stored
//     hash is authoritative, never trusted from the caller),
//  2. digitally SIGN the hash with the configured signer,
//  3. WORM-seal the canonical envelope bytes (GOVERNANCE object-lock),
//  4. anchor a proof record into the attestation-ledger Merkle chain,
//  5. persist the row inside a tenant transaction.
//
// Steps 2–4 are fail-closed: any error aborts before persistence, so an
// unsigned/unsealed/unanchored proof is never stored.
func (s *Sealer) Seal(ctx context.Context, subjectKind string, record *ProofRecord) (*SealedProof, error) {
	if record == nil {
		return nil, errors.New("rehearsal proof: nil record to seal")
	}
	tenantID, err := uuid.Parse(record.TenantID)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: parse tenant id %q: %w", record.TenantID, err)
	}

	// Step 1: authoritative canonical bytes + hash (recomputed, not trusted).
	canonical, hash, err := canonicalEnvelope(record)
	if err != nil {
		return nil, err
	}
	record.EnvelopeHash = hash

	// Step 2: digitally sign the hash. Fail closed.
	signatureB64, alg, err := s.signer.SignEnvelopeHash(hash)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: signing envelope: %w", err)
	}

	signedAt := s.now().UTC()

	// Step 3: WORM-seal the canonical envelope bytes. Fail closed.
	key := proofObjectKey(tenantID, subjectKind, record.Run.ID, hash)
	objectKey, _, err := s.worm.SealProof(ctx, tenantID, key, canonical)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: sealing envelope to WORM: %w", err)
	}
	if objectKey == "" {
		return nil, errors.New("rehearsal proof: WORM sealer returned empty object key")
	}

	// Step 4: anchor into the attestation-ledger Merkle chain. Fail closed.
	seq, entryHash, err := s.ledger.AnchorProof(ctx, AnchorInput{
		TenantID:      tenantID,
		SubjectKind:   subjectKind,
		SubjectRunID:  record.Run.ID,
		EnvelopeHash:  hash,
		Signature:     signatureB64,
		SignatureAlg:  alg,
		WORMObjectKey: objectKey,
	})
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: anchoring to attestation ledger: %w", err)
	}

	proof := &SealedProof{
		TenantID:        tenantID,
		SubjectKind:     subjectKind,
		SubjectRunID:    record.Run.ID,
		Envelope:        record,
		EnvelopeHash:    hash,
		Signature:       signatureB64,
		SignatureAlg:    alg,
		SignedAt:        signedAt,
		WORMObjectKey:   objectKey,
		LedgerSeq:       seq,
		LedgerEntryHash: entryHash,
	}

	// Step 5: persist the row (tenant tx).
	if err := s.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.store.Insert(ctx, db, proof)
	}); err != nil {
		return nil, err
	}
	return proof, nil
}

// canonicalEnvelope produces the deterministic bytes sealed to WORM and their
// SHA-256 hash (matching EnvelopeHash's algorithm) so the sealed object, the
// stored hash, and the signature all bind to the same digest.
func canonicalEnvelope(record *ProofRecord) ([]byte, string, error) {
	hash, err := EnvelopeHash(record)
	if err != nil {
		return nil, "", err
	}
	cp := *record
	cp.EnvelopeHash = ""
	b, err := json.Marshal(cp)
	if err != nil {
		return nil, "", fmt.Errorf("rehearsal proof: marshal canonical envelope: %w", err)
	}
	return b, hash, nil
}

// proofObjectKey builds a deterministic WORM key for a sealed proof.
func proofObjectKey(tenantID uuid.UUID, kind, runID, hash string) string {
	shortHash := hash
	if len(shortHash) > 71 { // "sha256:" + 64 hex
		shortHash = shortHash[:71]
	}
	return fmt.Sprintf("%s/rehearsal-proofs/%s/%s-%s.json", tenantID.String(), kind, runID, shortHash)
}

func marshalEnvelope(record *ProofRecord) ([]byte, error) {
	b, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: marshal envelope json: %w", err)
	}
	return b, nil
}

func unmarshalEnvelope(b []byte) (*ProofRecord, error) {
	if len(b) == 0 {
		return nil, nil
	}
	var rec ProofRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		return nil, fmt.Errorf("rehearsal proof: unmarshal envelope json: %w", err)
	}
	return &rec, nil
}
