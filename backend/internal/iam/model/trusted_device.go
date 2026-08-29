package model

import "time"

// TrustedDevice represents a device a user has registered for device-trust /
// step-up correlation. Identity is the tuple (tenant_id, user_id,
// device_fingerprint); the fingerprint is the opaque device id supplied by the
// client (X-Device-Id header or request body).
type TrustedDevice struct {
	ID                string
	TenantID          string
	UserID            string
	DeviceFingerprint string
	DeviceName        string
	DeviceType        string
	IPAddress         *string
	UserAgent         *string
	Trusted           bool
	LastTrustedAt     time.Time
	RevokedAt         *time.Time
	CreatedAt         time.Time
}
