package sources

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFieldErrors_Empty(t *testing.T) {
	fe := &FieldErrors{}
	require.Equal(t, "validation failed", fe.Error())
}

func TestFieldErrors_Single(t *testing.T) {
	fe := &FieldErrors{Errors: []FieldError{{Field: "name", Message: "bad"}}}
	require.Equal(t, "name: bad", fe.Error())
}

func TestFieldErrors_Multiple(t *testing.T) {
	fe := &FieldErrors{Errors: []FieldError{{Field: "a"}, {Field: "b"}}}
	require.Equal(t, "validation failed: multiple field errors", fe.Error())
}

func TestFieldErrors_UnwrapsValidation(t *testing.T) {
	fe := &FieldErrors{Errors: []FieldError{{Field: "x"}}}
	require.True(t, errors.Is(fe, ErrValidation))
}

func TestAllTransports_NotEmpty(t *testing.T) {
	require.NotEmpty(t, AllTransports)
	require.GreaterOrEqual(t, len(AllTransports), 25)
}

func TestAllStatuses_NotEmpty(t *testing.T) {
	require.Equal(t, 6, len(AllStatuses))
}

func TestSentinels_Unique(t *testing.T) {
	sentinels := []error{
		ErrNotFound, ErrConflict, ErrVersionMismatch, ErrTokenConsumed,
		ErrTokenInvalid, ErrCertMismatch, ErrTenantMismatch, ErrIdempotencyReplay,
		ErrValidation, ErrInvalidState, ErrRateLimited, ErrCertExpired, ErrRevoked,
	}
	seen := map[string]bool{}
	for _, s := range sentinels {
		require.NotNil(t, s)
		require.False(t, seen[s.Error()], "duplicate sentinel: %s", s)
		seen[s.Error()] = true
	}
}
