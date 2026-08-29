package forms

import "errors"

// Sentinel errors returned by the forms store. Callers map these to HTTP status
// codes (ErrNotFound -> 404, ErrConflict -> 409, ErrInvalid -> 400) without
// inspecting driver-specific error types.
var (
	// ErrNotFound is returned when a form definition does not exist (or is not
	// visible under the current tenant RLS context).
	ErrNotFound = errors.New("forms: form definition not found")

	// ErrConflict is returned on a unique-constraint violation, i.e. a form with
	// the same (tenant_id, name, version) already exists.
	ErrConflict = errors.New("forms: form definition already exists for (tenant, name, version)")

	// ErrInvalid is returned when a form definition fails structural validation
	// before it can be persisted.
	ErrInvalid = errors.New("forms: invalid form definition")
)
