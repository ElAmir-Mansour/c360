package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/iam/model"
)

type SessionRepository interface {
	Create(ctx context.Context, session *model.Session) error
	GetByTokenHash(ctx context.Context, tokenHash string) (*model.Session, error)
	GetByUserID(ctx context.Context, tenantID, userID string) ([]model.Session, error)
	UpdateLastActive(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
	DeleteByUserID(ctx context.Context, userID string) error
	DeleteExpired(ctx context.Context) (int64, error)
}

type sessionRepo struct {
	pool *pgxpool.Pool
}

func NewSessionRepository(pool *pgxpool.Pool) SessionRepository {
	return &sessionRepo{pool: pool}
}

func (r *sessionRepo) Create(ctx context.Context, session *model.Session) error {
	var query string
	var args []any

	if session.ID != "" {
		// Caller pre-generated the UUID so it can be embedded in the JWT before DB insert.
		query = `
			INSERT INTO sessions (id, user_id, tenant_id, refresh_token_hash, ip_address, user_agent, expires_at)
			VALUES ($1, $2, $3, $4, $5::inet, $6, $7)
			RETURNING created_at`
		args = []any{session.ID, session.UserID, session.TenantID, session.RefreshTokenHash,
			session.IPAddress, session.UserAgent, session.ExpiresAt}
		return r.pool.QueryRow(ctx, query, args...).Scan(&session.CreatedAt)
	}

	// Let the database generate the ID (legacy path, no session_id in JWT).
	query = `
		INSERT INTO sessions (user_id, tenant_id, refresh_token_hash, ip_address, user_agent, expires_at)
		VALUES ($1, $2, $3, $4::inet, $5, $6)
		RETURNING id, created_at`
	args = []any{session.UserID, session.TenantID, session.RefreshTokenHash,
		session.IPAddress, session.UserAgent, session.ExpiresAt}
	return r.pool.QueryRow(ctx, query, args...).Scan(&session.ID, &session.CreatedAt)
}

func (r *sessionRepo) GetByTokenHash(ctx context.Context, tokenHash string) (*model.Session, error) {
	query := `
		SELECT id, user_id, tenant_id, refresh_token_hash, host(ip_address), user_agent, expires_at, created_at, last_active_at
		FROM sessions
		WHERE refresh_token_hash = $1 AND expires_at > NOW()`

	s := &model.Session{}
	err := r.pool.QueryRow(ctx, query, tokenHash).Scan(
		&s.ID, &s.UserID, &s.TenantID, &s.RefreshTokenHash,
		&s.IPAddress, &s.UserAgent, &s.ExpiresAt, &s.CreatedAt, &s.LastActiveAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("session: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("querying session: %w", err)
	}
	return s, nil
}

func (r *sessionRepo) GetByUserID(ctx context.Context, tenantID, userID string) ([]model.Session, error) {
	tenantUUID, err := uuid.Parse(tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing sessions: invalid tenant id: %w", err)
	}

	query := `
		SELECT id, user_id, tenant_id, refresh_token_hash, host(ip_address), user_agent, expires_at, created_at, last_active_at
		FROM sessions
		WHERE tenant_id = $1 AND user_id = $2 AND expires_at > NOW()
		ORDER BY last_active_at DESC`

	var sessions []model.Session
	err = database.RunReadWithTenant(ctx, r.pool, tenantUUID, func(tx pgx.Tx) error {
		rows, queryErr := tx.Query(ctx, query, tenantID, userID)
		if queryErr != nil {
			return fmt.Errorf("querying sessions: %w", queryErr)
		}
		defer rows.Close()

		for rows.Next() {
			var s model.Session
			if scanErr := rows.Scan(
				&s.ID, &s.UserID, &s.TenantID, &s.RefreshTokenHash,
				&s.IPAddress, &s.UserAgent, &s.ExpiresAt, &s.CreatedAt, &s.LastActiveAt,
			); scanErr != nil {
				return fmt.Errorf("scanning session: %w", scanErr)
			}
			sessions = append(sessions, s)
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return fmt.Errorf("iterating sessions: %w", rowsErr)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("listing sessions: %w", err)
	}
	return sessions, nil
}

func (r *sessionRepo) UpdateLastActive(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, "UPDATE sessions SET last_active_at = NOW() WHERE id = $1", id)
	return err
}

func (r *sessionRepo) Delete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, "DELETE FROM sessions WHERE id = $1", id)
	return err
}

func (r *sessionRepo) DeleteByUserID(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID)
	return err
}

func (r *sessionRepo) DeleteExpired(ctx context.Context) (int64, error) {
	ct, err := r.pool.Exec(ctx, "DELETE FROM sessions WHERE expires_at <= NOW()")
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
