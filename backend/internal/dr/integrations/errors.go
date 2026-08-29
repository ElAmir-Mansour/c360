package integrations

import "errors"

// Sentinel errors the router maps to HTTP statuses (see router.go writeError)
// and the bridge can match with errors.Is.
var (
	// ErrNotFound is returned when an integration does not exist in the tenant.
	ErrNotFound = errors.New("integrations: not found")
	// ErrValidation is returned for a malformed create/update request (bad kind,
	// empty vendor, missing endpoint for an endpoint-requiring vendor, ...).
	ErrValidation = errors.New("integrations: validation error")
	// ErrAlreadyExists is returned when (tenant_id, name) collides on insert.
	ErrAlreadyExists = errors.New("integrations: already exists")
	// ErrConnectorMissing is returned by TestConnection / ResolveActive when no
	// connector has been registered for the integration's vendor.
	ErrConnectorMissing = errors.New("integrations: no connector registered for vendor")
)
