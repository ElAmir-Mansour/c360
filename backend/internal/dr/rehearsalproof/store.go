package rehearsalproof

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrProofNotFound is returned when no persisted proof matches a query.
var ErrProofNotFound = errors.New("rehearsal proof: not found")

// SealedProof is one persisted, signed, WORM-sealed, ledger-anchored proof
// envelope — the row of dr_rehearsal_proof. It is the artifact handed to an
// auditor: the envelope JSON is the human-readable evidence, EnvelopeHash is its
// SHA-256 digest, Signature is the detached digital signature over that digest,
// WORMObjectKey witnesses the immutable object copy, and LedgerSeq is the
// attestation-ledger inclusion reference (the Merkle chain the proof was
// anchored into).
type SealedProof struct {
	ID              uuid.UUID    `json:"id"`
	TenantID        uuid.UUID    `json:"tenant_id"`
	SubjectKind     string       `json:"subject_kind"`
	SubjectRunID    string       `json:"subject_run_id"`
	Envelope        *ProofRecord `json:"envelope"`
	EnvelopeHash    string       `json:"envelope_hash"`
	Signature       string       `json:"signature"`
	SignatureAlg    string       `json:"signature_alg"`
	SignedAt        time.Time    `json:"signed_at"`
	WORMObjectKey   string       `json:"worm_object_key,omitempty"`
	LedgerSeq       int64        `json:"ledger_seq,omitempty"`
	LedgerEntryHash string       `json:"ledger_entry_hash,omitempty"`
	CreatedAt       time.Time    `json:"created_at"`
}

// Store persists dr_rehearsal_proof rows. It holds no state and takes a
// repository.DBTX on every method so the caller chooses the execution context
// (the sealer's tenant transaction for inserts, a read transaction for GETs),
// mirroring the attestledger.Store convention.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

const insertProofSQL = `
INSERT INTO dr_rehearsal_proof
    (tenant_id, subject_kind, subject_run_id, envelope_json, envelope_hash,
     signature, signature_alg, signed_at, worm_object_key, ledger_seq, ledger_entry_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, created_at`

// Insert persists a sealed proof. The envelope JSON, hash, signature, WORM key
// and ledger sequence must already be populated by the sealer; the DB assigns id
// and created_at. A unique-violation on (tenant_id, envelope_hash) surfaces as
// ErrDuplicate so re-generation of an identical envelope is idempotent.
var ErrDuplicate = errors.New("rehearsal proof: already sealed")

func (Store) Insert(ctx context.Context, db repository.DBTX, p *SealedProof) error {
	envelopeJSON, err := marshalEnvelope(p.Envelope)
	if err != nil {
		return err
	}
	err = db.QueryRow(ctx, insertProofSQL,
		p.TenantID, p.SubjectKind, p.SubjectRunID, envelopeJSON, p.EnvelopeHash,
		p.Signature, p.SignatureAlg, p.SignedAt.UTC(),
		nullable(p.WORMObjectKey), nullableSeq(p.LedgerSeq), nullable(p.LedgerEntryHash),
	).Scan(&p.ID, &p.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: tenant=%s hash=%s", ErrDuplicate, p.TenantID, p.EnvelopeHash)
		}
		return fmt.Errorf("rehearsal proof: inserting sealed proof: %w", err)
	}
	return nil
}

const proofColumns = `
id, tenant_id, subject_kind, subject_run_id, envelope_json, envelope_hash,
signature, signature_alg, signed_at, COALESCE(worm_object_key, ''),
COALESCE(ledger_seq, 0), COALESCE(ledger_entry_hash, ''), created_at`

func scanProof(row pgx.Row) (*SealedProof, error) {
	var (
		p        SealedProof
		envelope []byte
	)
	if err := row.Scan(
		&p.ID, &p.TenantID, &p.SubjectKind, &p.SubjectRunID, &envelope, &p.EnvelopeHash,
		&p.Signature, &p.SignatureAlg, &p.SignedAt, &p.WORMObjectKey,
		&p.LedgerSeq, &p.LedgerEntryHash, &p.CreatedAt,
	); err != nil {
		return nil, err
	}
	rec, err := unmarshalEnvelope(envelope)
	if err != nil {
		return nil, err
	}
	p.Envelope = rec
	return &p, nil
}

// GetLatestBySubject returns the most recent sealed proof for a subject
// (kind + run id), or ErrProofNotFound when none has been sealed yet. It is the
// read path behind the persisted GET so the backward-compat compute path can
// fall through to (re)generate when nothing is stored.
func (Store) GetLatestBySubject(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, kind, runID string) (*SealedProof, error) {
	const q = `SELECT ` + proofColumns + `
FROM dr_rehearsal_proof
WHERE tenant_id = $1 AND subject_kind = $2 AND subject_run_id = $3
ORDER BY created_at DESC, id DESC
LIMIT 1`
	p, err := scanProof(db.QueryRow(ctx, q, tenantID, kind, runID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%s/%s: %w", kind, runID, ErrProofNotFound)
		}
		return nil, fmt.Errorf("rehearsal proof: loading sealed proof: %w", err)
	}
	return p, nil
}

// GetByID returns a sealed proof by its row id.
func (Store) GetByID(ctx context.Context, db repository.DBTX, tenantID, id uuid.UUID) (*SealedProof, error) {
	const q = `SELECT ` + proofColumns + `
FROM dr_rehearsal_proof
WHERE tenant_id = $1 AND id = $2`
	p, err := scanProof(db.QueryRow(ctx, q, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("id %s: %w", id, ErrProofNotFound)
		}
		return nil, fmt.Errorf("rehearsal proof: loading sealed proof: %w", err)
	}
	return p, nil
}

// ListBySubject returns a subject's sealed proofs newest-first.
func (Store) ListBySubject(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, kind, runID string, limit int) ([]*SealedProof, error) {
	q := `SELECT ` + proofColumns + `
FROM dr_rehearsal_proof
WHERE tenant_id = $1 AND subject_kind = $2 AND subject_run_id = $3
ORDER BY created_at DESC, id DESC`
	args := []any{tenantID, kind, runID}
	if limit > 0 {
		args = append(args, limit)
		q += fmt.Sprintf(" LIMIT $%d", len(args))
	}
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: listing sealed proofs: %w", err)
	}
	defer rows.Close()
	var out []*SealedProof
	for rows.Next() {
		p, err := scanProof(rows)
		if err != nil {
			return nil, fmt.Errorf("rehearsal proof: scanning sealed proof: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rehearsal proof: reading sealed proofs: %w", err)
	}
	return out, nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableSeq(seq int64) any {
	if seq <= 0 {
		return nil
	}
	return seq
}
