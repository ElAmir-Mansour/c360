package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"

	llmprovider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/drafting"
)

func TestDraftingErrorMapping(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "provider timeout",
			err:        fmt.Errorf("llm complete: %w", context.DeadlineExceeded),
			wantStatus: http.StatusGatewayTimeout,
			wantCode:   "DRAFTING_TIMEOUT",
		},
		{
			name:       "provider is not configured",
			err:        fmt.Errorf("resolve llm provider: %w", llmprovider.ErrNotConfigured),
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "DRAFTING_UNAVAILABLE",
		},
		{
			name:       "model returned no structured output",
			err:        drafting.ErrNoToolCall,
			wantStatus: http.StatusBadGateway,
			wantCode:   "DRAFTING_NO_OUTPUT",
		},
		{
			name:       "upstream provider failure",
			err:        errors.New("provider connection reset"),
			wantStatus: http.StatusBadGateway,
			wantCode:   "DRAFTING_PROVIDER_ERROR",
		},
	}

	mappers := []struct {
		name string
		fn   func(error) error
	}{
		{name: "shared drafting service", fn: (&DraftingService{}).mapDraftErr},
		{name: "litigation drafting", fn: mapDraftingError},
	}

	for _, mapper := range mappers {
		mapper := mapper
		t.Run(mapper.name, func(t *testing.T) {
			t.Parallel()
			for _, tt := range tests {
				tt := tt
				t.Run(tt.name, func(t *testing.T) {
					t.Parallel()
					err := mapper.fn(tt.err)
					var appErr *apperrors.AppError
					if !errors.As(err, &appErr) {
						t.Fatalf("error type = %T, want *errors.AppError", err)
					}
					if appErr.Status != tt.wantStatus {
						t.Errorf("status = %d, want %d", appErr.Status, tt.wantStatus)
					}
					if appErr.Code != tt.wantCode {
						t.Errorf("code = %q, want %q", appErr.Code, tt.wantCode)
					}
					if got := appErr.Localize("en"); got == "" {
						t.Error("English localized message is empty")
					}
					if got := appErr.Localize("ar"); got == "" {
						t.Error("Arabic localized message is empty")
					}
				})
			}
		})
	}
}
