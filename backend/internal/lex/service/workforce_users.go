package service

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
)

type UserRef struct {
	ID        uuid.UUID `json:"id"`
	FirstName string    `json:"first_name"`
	LastName  string    `json:"last_name"`
	Status    string    `json:"status"`
	AvatarURL string    `json:"avatar_url,omitempty"`
}

type WorkforceUserDirectory interface {
	ResolveUsers(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]UserRef, error)
}

type PlatformCoreWorkforceUserDirectory struct {
	db *pgxpool.Pool
}

func NewPlatformCoreWorkforceUserDirectory(db *pgxpool.Pool) *PlatformCoreWorkforceUserDirectory {
	return &PlatformCoreWorkforceUserDirectory{db: db}
}

// ResolveUsers performs one tenant-scoped platform_core round trip. A qualifying
// measurement of 15 real, non-empty avatars is not available in the current
// environment. Pending that measurement, the SQL enforces A6's 200 KiB response
// ceiling for every SaaS tenant: if the projected batch exceeds it, every avatar
// is omitted and monograms render.
func (d *PlatformCoreWorkforceUserDirectory) ResolveUsers(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]UserRef, error) {
	if d == nil || d.db == nil {
		return nil, errors.New("platform IAM database is not configured")
	}
	out := make(map[uuid.UUID]UserRef, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	err := database.RunReadWithTenant(ctx, d.db, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			WITH resolved AS (
				SELECT id, first_name, last_name, status::text AS status,
				       COALESCE(avatar_url, '') AS avatar_url
				FROM users
				WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
			), measured AS (
				SELECT resolved.*,
				       SUM(octet_length(jsonb_build_object(
				           'id', id, 'first_name', first_name, 'last_name', last_name,
				           'status', status, 'avatar_url', avatar_url
				       )::text) + 50) OVER () AS batch_bytes
				FROM resolved
			)
			SELECT id, first_name, last_name, status,
			       CASE WHEN batch_bytes <= 204800 THEN avatar_url ELSE '' END
			FROM measured
			ORDER BY id`, tenantID, ids)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var user UserRef
			if err := rows.Scan(&user.ID, &user.FirstName, &user.LastName, &user.Status, &user.AvatarURL); err != nil {
				return err
			}
			out[user.ID] = user
		}
		return rows.Err()
	})
	return out, err
}
