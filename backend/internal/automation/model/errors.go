package model

import "fmt"

// ErrInvalidConfig is the base error for all structural validation failures on
// trigger/action/runbook configuration. Validation helpers wrap it via
// errInvalid so callers can branch with errors.Is(err, ErrInvalidConfig) while
// still surfacing a specific message.
var ErrInvalidConfig = fmt.Errorf("invalid configuration")

// errInvalid formats a validation message and wraps ErrInvalidConfig.
func errInvalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidConfig, fmt.Sprintf(format, args...))
}
