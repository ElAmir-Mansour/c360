package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/iam/model"
)

// TrustedDeviceRepository persists device-trust records keyed by
// (tenant_id, user_id, device_fingerprint).
type TrustedDeviceRepository interface {
	// Upsert inserts a new trusted-device row or, on a conflicting
	// (tenant_id, user_id, device_fingerprint), refreshes the existing row.
	// The supplied device's fields are populated with the persisted values.
	Upsert(ctx context.Context, device *model.TrustedDevice) error
	// ListByUser returns all non-revoked devices for a user, newest first.
	ListByUser(ctx context.Context, tenantID, userID string) ([]model.TrustedDevice, error)
}

type trustedDeviceRepo struct {
	pool *pgxpool.Pool
}

func NewTrustedDeviceRepository(pool *pgxpool.Pool) TrustedDeviceRepository {
	return &trustedDeviceRepo{pool: pool}
}

func (r *trustedDeviceRepo) Upsert(ctx context.Context, device *model.TrustedDevice) error {
	query := `
		INSERT INTO trusted_devices
			(tenant_id, user_id, device_fingerprint, device_name, device_type, ip_address, user_agent, trusted, last_trusted_at)
		VALUES ($1, $2, $3, $4, $5, $6::inet, $7, $8, NOW())
		ON CONFLICT (tenant_id, user_id, device_fingerprint) DO UPDATE SET
			device_name     = EXCLUDED.device_name,
			device_type     = EXCLUDED.device_type,
			ip_address      = EXCLUDED.ip_address,
			user_agent      = EXCLUDED.user_agent,
			trusted         = EXCLUDED.trusted,
			last_trusted_at = NOW(),
			revoked_at      = NULL
		RETURNING id, device_name, device_type, trusted, last_trusted_at, created_at`

	return r.pool.QueryRow(ctx, query,
		device.TenantID, device.UserID, device.DeviceFingerprint,
		device.DeviceName, device.DeviceType, device.IPAddress, device.UserAgent, device.Trusted,
	).Scan(
		&device.ID, &device.DeviceName, &device.DeviceType,
		&device.Trusted, &device.LastTrustedAt, &device.CreatedAt,
	)
}

func (r *trustedDeviceRepo) ListByUser(ctx context.Context, tenantID, userID string) ([]model.TrustedDevice, error) {
	query := `
		SELECT id, tenant_id, user_id, device_fingerprint, device_name, device_type,
		       host(ip_address), user_agent, trusted, last_trusted_at, revoked_at, created_at
		FROM trusted_devices
		WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL
		ORDER BY last_trusted_at DESC`

	rows, err := r.pool.Query(ctx, query, tenantID, userID)
	if err != nil {
		return nil, fmt.Errorf("listing trusted devices: %w", err)
	}
	defer rows.Close()

	devices := []model.TrustedDevice{}
	for rows.Next() {
		var d model.TrustedDevice
		if err := rows.Scan(
			&d.ID, &d.TenantID, &d.UserID, &d.DeviceFingerprint, &d.DeviceName, &d.DeviceType,
			&d.IPAddress, &d.UserAgent, &d.Trusted, &d.LastTrustedAt, &d.RevokedAt, &d.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning trusted device: %w", err)
		}
		devices = append(devices, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating trusted devices: %w", err)
	}
	return devices, nil
}
