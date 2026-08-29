package sources

import "errors"

// Sentinel errors. All wrapping must use %w so callers can errors.Is them.
var (
	// ErrNotFound is returned when a source row is missing or invisible
	// from the requesting tenant.
	ErrNotFound = errors.New("sources: not found")

	// ErrConflict is returned on uniqueness or state-transition conflicts.
	ErrConflict = errors.New("sources: conflict")

	// ErrVersionMismatch is returned when the If-Match header carries a
	// stale version number.
	ErrVersionMismatch = errors.New("sources: version mismatch")

	// ErrTokenConsumed is returned by Claim when the JTI is already
	// consumed.
	ErrTokenConsumed = errors.New("sources: token already consumed")

	// ErrTokenInvalid is returned by Claim when the token fails parsing
	// or signature verification.
	ErrTokenInvalid = errors.New("sources: token invalid")

	// ErrCertMismatch is returned by mTLS when the leaf thumbprint does
	// not match a known active source.
	ErrCertMismatch = errors.New("sources: cert mismatch")

	// ErrTenantMismatch is returned when an enrollment token's tnt claim
	// does not match the source's tenant_id.
	ErrTenantMismatch = errors.New("sources: tenant mismatch")

	// ErrIdempotencyReplay is the sentinel for "this request was already
	// processed; here is the original response".
	ErrIdempotencyReplay = errors.New("sources: idempotency replay")

	// ErrValidation is the umbrella error for input-validation failures.
	// Specific field errors are carried in FieldErrors.
	ErrValidation = errors.New("sources: validation failed")

	// ErrInvalidState rejects illegal lifecycle transitions.
	ErrInvalidState = errors.New("sources: invalid state transition")

	// ErrRateLimited is returned when a per-source heartbeat rate cap
	// is exceeded.
	ErrRateLimited = errors.New("sources: rate limited")

	// ErrCertExpired indicates a presented certificate has expired.
	ErrCertExpired = errors.New("sources: cert expired")

	// ErrRevoked is returned when a thumbprint is in the local denylist.
	ErrRevoked = errors.New("sources: cert revoked")
)

// FieldError is a single validation failure suitable for the
// platform's standard error envelope.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// FieldErrors carries one or more validation failures. The umbrella
// sentinel error returned by validators wraps this slice via errors.As.
type FieldErrors struct {
	Errors []FieldError
}

// Error implements error.
func (f *FieldErrors) Error() string {
	if f == nil || len(f.Errors) == 0 {
		return "validation failed"
	}
	if len(f.Errors) == 1 {
		return f.Errors[0].Field + ": " + f.Errors[0].Message
	}
	return "validation failed: multiple field errors"
}

// Unwrap so errors.Is(err, ErrValidation) works.
func (f *FieldErrors) Unwrap() error { return ErrValidation }
