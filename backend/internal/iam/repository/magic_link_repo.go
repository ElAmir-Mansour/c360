package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/iam/model"
)

// MagicLinkRepository persists single-use passwordless sign-in tokens.
type MagicLinkRepository interface {
	// Create inserts a new magic-link token row. The plaintext token is never
	// stored — the caller supplies only its SHA-256 hash in link.TokenHash.
	Create(ctx context.Context, link *model.MagicLink) error
	// ConsumeByTokenHash atomically marks a still-valid, unused token as used
	// and returns it. A token that does not exist, is already used, or has
	// expired yields model.ErrInvalidToken. This is safe against concurrent
	// double-redemption because the UPDATE ... WHERE used=false guard runs in a
	// single statement.
	ConsumeByTokenHash(ctx context.Context, tokenHash string) (*model.MagicLink, error)
}

type magicLinkRepo struct {
	pool *pgxpool.Pool
}

func NewMagicLinkRepository(pool *pgxpool.Pool) MagicLinkRepository {
	return &magicLinkRepo{pool: pool}
}

func (r *magicLinkRepo) Create(ctx context.Context, link *model.MagicLink) error {
	if link.ID != "" {
		query := `
			INSERT INTO magic_link_tokens (id, tenant_id, email, token_hash, expires_at)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING created_at`
		return r.pool.QueryRow(ctx, query,
			link.ID, link.TenantID, link.Email, link.TokenHash, link.ExpiresAt,
		).Scan(&link.CreatedAt)
	}

	query := `
		INSERT INTO magic_link_tokens (tenant_id, email, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id, created_at`
	return r.pool.QueryRow(ctx, query,
		link.TenantID, link.Email, link.TokenHash, link.ExpiresAt,
	).Scan(&link.ID, &link.CreatedAt)
}

func (r *magicLinkRepo) ConsumeByTokenHash(ctx context.Context, tokenHash string) (*model.MagicLink, error) {
	query := `
		UPDATE magic_link_tokens
		SET used = true, used_at = NOW()
		WHERE token_hash = $1 AND used = false AND expires_at > NOW()
		RETURNING id, tenant_id, email, token_hash, used, used_at, expires_at, created_at`

	ml := &model.MagicLink{}
	err := r.pool.QueryRow(ctx, query, tokenHash).Scan(
		&ml.ID, &ml.TenantID, &ml.Email, &ml.TokenHash,
		&ml.Used, &ml.UsedAt, &ml.ExpiresAt, &ml.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("magic link: %w", model.ErrInvalidToken)
		}
		return nil, fmt.Errorf("consuming magic link: %w", err)
	}
	return ml, nil
}
