package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/siem/sources"
)

// RevocationRepo is the data-access layer for siem.source_cert_revocations.
// The repo is the durable home of the mTLS thumbprint denylist; mTLS
// middleware refreshes its in-memory copy from here.
type RevocationRepo struct {
	db Querier
}

// NewRevocationRepo constructs the repo.
func NewRevocationRepo(db Querier) *RevocationRepo {
	return &RevocationRepo{db: db}
}

// Insert adds a denylist entry. If the thumbprint is already present
// (idempotent revoke), the row is upserted with the latest reason and
// timestamp.
func (r *RevocationRepo) Insert(ctx context.Context, rv sources.Revocation) error {
	if r == nil || r.db == nil {
		return errors.New("revocation_repo: nil db")
	}
	const q = `
INSERT INTO siem.source_cert_revocations (thumbprint, source_id, cert_serial, reason)
VALUES ($1,$2,$3,$4)
ON CONFLICT (thumbprint) DO UPDATE
  SET revoked_at = now(), reason = EXCLUDED.reason`
	_, err := r.db.Exec(ctx, q, rv.Thumbprint, rv.SourceID, rv.CertSerial, rv.Reason)
	if err != nil {
		return fmt.Errorf("revocation insert: %w", err)
	}
	return nil
}

// Get returns the revocation by thumbprint, or ErrNotFound.
func (r *RevocationRepo) Get(ctx context.Context, thumbprint string) (*sources.Revocation, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("revocation_repo: nil db")
	}
	const q = `
SELECT thumbprint, source_id, cert_serial, revoked_at, reason
FROM siem.source_cert_revocations
WHERE thumbprint = $1`
	row := r.db.QueryRow(ctx, q, thumbprint)
	var rv sources.Revocation
	err := row.Scan(&rv.Thumbprint, &rv.SourceID, &rv.CertSerial, &rv.RevokedAt, &rv.Reason)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", sources.ErrNotFound, thumbprint)
	}
	if err != nil {
		return nil, fmt.Errorf("revocation get: %w", err)
	}
	return &rv, nil
}

// ListSince returns all revocations newer than `since`. Used by the
// CRL refresh job to incrementally pull updates.
func (r *RevocationRepo) ListSince(ctx context.Context, since time.Time) ([]sources.Revocation, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("revocation_repo: nil db")
	}
	const q = `
SELECT thumbprint, source_id, cert_serial, revoked_at, reason
FROM siem.source_cert_revocations
WHERE revoked_at > $1
ORDER BY revoked_at ASC`
	rows, err := r.db.Query(ctx, q, since)
	if err != nil {
		return nil, fmt.Errorf("revocation list: %w", err)
	}
	defer rows.Close()
	out := []sources.Revocation{}
	for rows.Next() {
		var rv sources.Revocation
		if err := rows.Scan(&rv.Thumbprint, &rv.SourceID, &rv.CertSerial, &rv.RevokedAt, &rv.Reason); err != nil {
			return nil, fmt.Errorf("revocation scan: %w", err)
		}
		out = append(out, rv)
	}
	return out, rows.Err()
}

// All returns the complete denylist. Suitable for cold-start of an
// in-memory cache.
func (r *RevocationRepo) All(ctx context.Context) ([]sources.Revocation, error) {
	return r.ListSince(ctx, time.Unix(0, 0))
}

// CountForSource is a small helper used by service-layer assertions.
func (r *RevocationRepo) CountForSource(ctx context.Context, sourceID uuid.UUID) (int, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("revocation_repo: nil db")
	}
	const q = `SELECT count(*) FROM siem.source_cert_revocations WHERE source_id = $1`
	row := r.db.QueryRow(ctx, q, sourceID)
	var n int
	if err := row.Scan(&n); err != nil {
		return 0, fmt.Errorf("revocation count: %w", err)
	}
	return n, nil
}
