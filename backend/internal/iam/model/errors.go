package model

import (
	"errors"
	"time"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrUnauthorized  = errors.New("invalid credentials")
	ErrForbidden     = errors.New("forbidden")
	ErrConflict      = errors.New("already exists")
	ErrValidation    = errors.New("validation failed")
	ErrAccountLocked = errors.New("account temporarily locked")
	ErrMFARequired   = errors.New("mfa verification required")
	ErrInvalidMFA    = errors.New("invalid mfa code")
	ErrInvalidToken  = errors.New("invalid or expired token")
	ErrSystemRole    = errors.New("cannot modify system role")
)

// LockedError wraps ErrAccountLocked with the remaining lockout window so
// handlers can surface a Retry-After header and machine-readable retry_after
// details without changing the (deliberately generic) error message.
type LockedError struct {
	// RetryAfter is the remaining lockout duration.
	RetryAfter time.Duration
}

// Error returns the same generic message as ErrAccountLocked — the lockout is
// keyed on IP+email and the message must not reveal account existence.
func (e *LockedError) Error() string { return ErrAccountLocked.Error() }

// Unwrap makes errors.Is(err, ErrAccountLocked) hold for LockedError values.
func (e *LockedError) Unwrap() error { return ErrAccountLocked }
