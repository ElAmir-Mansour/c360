package model

import "time"

// MagicLink represents a single-use, time-limited passwordless sign-in token.
// The plaintext token is never persisted; only its SHA-256 hash is stored
// (column token_hash) so that a database leak cannot be replayed.
type MagicLink struct {
	ID        string
	TenantID  string
	Email     string
	TokenHash string
	Used      bool
	UsedAt    *time.Time
	ExpiresAt time.Time
	CreatedAt time.Time
}
