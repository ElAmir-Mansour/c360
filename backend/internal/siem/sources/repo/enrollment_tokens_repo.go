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

// EnrollmentTokensRepo is the durable backstop for the Redis JTI
// claim. The Redis lookup is primary; this table survives Redis
// flushes so the system remains coherent across restarts.
type EnrollmentTokensRepo struct {
	db Querier
}

// NewEnrollmentTokensRepo constructs the repo.
func NewEnrollmentTokensRepo(db Querier) *EnrollmentTokensRepo {
	return &EnrollmentTokensRepo{db: db}
}

// Insert persists a freshly minted token.
func (r *EnrollmentTokensRepo) Insert(ctx context.Context, t sources.EnrollmentTokenRecord) error {
	if r == nil || r.db == nil {
		return errors.New("enroll_tokens_repo: nil db")
	}
	const q = `
INSERT INTO siem.enrollment_tokens
  (jti, source_id, tenant_id, purpose, expires_at, issued_by)
VALUES ($1,$2,$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, t.JTI, t.SourceID, t.TenantID, string(t.Purpose), t.ExpiresAt, t.IssuedBy)
	if err != nil {
		return fmt.Errorf("enroll token insert: %w", err)
	}
	return nil
}

// MarkConsumed flips consumed_at + consumed_from_ip atomically iff
// the row is still unconsumed. Returns the post-update record.
func (r *EnrollmentTokensRepo) MarkConsumed(ctx context.Context, jti uuid.UUID, ip string, now time.Time) (*sources.EnrollmentTokenRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("enroll_tokens_repo: nil db")
	}
	const q = `
UPDATE siem.enrollment_tokens
SET consumed_at = $2, consumed_from_ip = $3::inet
WHERE jti = $1 AND consumed_at IS NULL
RETURNING jti, source_id, tenant_id, purpose, issued_at, expires_at, consumed_at, consumed_from_ip, issued_by`
	row := r.db.QueryRow(ctx, q, jti, now, nullableString(ip))
	t, err := scanToken(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: jti %s", sources.ErrTokenConsumed, jti)
	}
	return t, err
}

// Get returns a single token regardless of consumed state.
func (r *EnrollmentTokensRepo) Get(ctx context.Context, jti uuid.UUID) (*sources.EnrollmentTokenRecord, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("enroll_tokens_repo: nil db")
	}
	const q = `
SELECT jti, source_id, tenant_id, purpose, issued_at, expires_at, consumed_at, consumed_from_ip, issued_by
FROM siem.enrollment_tokens
WHERE jti = $1`
	row := r.db.QueryRow(ctx, q, jti)
	t, err := scanToken(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: %s", sources.ErrNotFound, jti)
	}
	return t, err
}

func scanToken(rs rowScanner) (*sources.EnrollmentTokenRecord, error) {
	var (
		t        sources.EnrollmentTokenRecord
		purpose  string
		consumed *time.Time
		ip       *string
	)
	err := rs.Scan(&t.JTI, &t.SourceID, &t.TenantID, &purpose, &t.IssuedAt, &t.ExpiresAt, &consumed, &ip, &t.IssuedBy)
	if err != nil {
		return nil, err
	}
	t.Purpose = sources.Purpose(purpose)
	t.ConsumedAt = consumed
	if ip != nil {
		t.ConsumedFromIP = *ip
	}
	return &t, nil
}
