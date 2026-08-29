package vault

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	vaultapi "github.com/hashicorp/vault/api"
)

// TestClassifyError covers the various ResponseError → sentinel mappings.
func TestClassifyError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		in        error
		wantIs    error
		wantPass  bool // if true, the input should be returned untouched (or wrapped) without a sentinel match
		wantNoErr bool
	}{
		{
			name:      "nil",
			in:        nil,
			wantNoErr: true,
		},
		{
			name:   "404 → ErrKeyNotFound",
			in:     &vaultapi.ResponseError{StatusCode: http.StatusNotFound, Errors: []string{"not found"}},
			wantIs: ErrKeyNotFound,
		},
		{
			name:   "503 with sealed body",
			in:     &vaultapi.ResponseError{StatusCode: http.StatusServiceUnavailable, Errors: []string{"Vault is sealed"}},
			wantIs: ErrVaultSealed,
		},
		{
			name:     "503 generic overload",
			in:       &vaultapi.ResponseError{StatusCode: http.StatusServiceUnavailable, Errors: []string{"too busy"}},
			wantPass: true,
		},
		{
			name:   "403 → ErrTransitDenied",
			in:     &vaultapi.ResponseError{StatusCode: http.StatusForbidden, Errors: []string{"forbidden"}},
			wantIs: ErrTransitDenied,
		},
		{
			name:   "400 → ErrTransitDenied",
			in:     &vaultapi.ResponseError{StatusCode: http.StatusBadRequest, Errors: []string{"bad request"}},
			wantIs: ErrTransitDenied,
		},
		{
			name:     "501 untouched",
			in:       &vaultapi.ResponseError{StatusCode: http.StatusNotImplemented},
			wantPass: true,
		},
		{
			name:     "plain error untouched",
			in:       fmt.Errorf("network: connection reset"),
			wantPass: true,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := classifyError(tc.in)
			if tc.wantNoErr {
				if got != nil {
					t.Fatalf("expected nil, got %v", got)
				}
				return
			}
			if tc.wantIs != nil {
				if !errors.Is(got, tc.wantIs) {
					t.Fatalf("expected errors.Is(%v) on %v", tc.wantIs, got)
				}
				return
			}
			if tc.wantPass {
				if got == nil {
					t.Fatal("expected non-nil pass-through")
				}
			}
		})
	}
}

// TestIsRetryable covers every branch.
func TestIsRetryable(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   error
		want bool
	}{
		{"nil", nil, false},
		{"sealed not retryable", ErrVaultSealed, false},
		{"wrapped sealed not retryable", fmt.Errorf("x: %w", ErrVaultSealed), false},
		{"503 retryable", &vaultapi.ResponseError{StatusCode: 503}, true},
		{"404 not retryable", &vaultapi.ResponseError{StatusCode: 404}, false},
		{"403 not retryable", &vaultapi.ResponseError{StatusCode: 403}, false},
		{"network error retryable", errors.New("connection refused"), true},
	}
	for _, tc := range cases {
		got := isRetryable(tc.in)
		if got != tc.want {
			t.Errorf("%s: want %v got %v", tc.name, tc.want, got)
		}
	}
}

func TestSentinelsAreDistinct(t *testing.T) {
	t.Parallel()
	all := []error{
		ErrVaultSealed, ErrStandby, ErrAuthFailed,
		ErrKeyNotFound, ErrTransitDenied, ErrEnvelopeInvalid,
	}
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			if errors.Is(all[i], all[j]) {
				t.Errorf("sentinels %d and %d alias", i, j)
			}
		}
	}
}
