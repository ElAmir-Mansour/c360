package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// writeJSON serializes v as JSON and writes it to the response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a structured JSON error response.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
		},
	})
}

// writeValidationError writes a 400 response whose error envelope carries the
// structured list of validation problems under "errors" (in addition to the
// summary message). The frontend reads this list to render each problem inline.
func writeValidationError(w http.ResponseWriter, message string, errs []dto.ValidationError) {
	if errs == nil {
		errs = []dto.ValidationError{}
	}
	writeJSON(w, http.StatusBadRequest, map[string]interface{}{
		"error": map[string]interface{}{
			"code":    "VALIDATION_ERROR",
			"message": message,
			"errors":  errs,
		},
	})
}

// parseBody decodes the JSON request body into dst.
func parseBody(r *http.Request, dst interface{}) error {
	if r.Body == nil {
		return fmt.Errorf("request body is required")
	}
	defer r.Body.Close()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}

// urlParam extracts a URL parameter by name from the chi route context.
func urlParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}

// parsePagination extracts page and page_size from query parameters with defaults.
func parsePagination(r *http.Request) (page, pageSize int) {
	page = 1
	pageSize = 20

	if p := r.URL.Query().Get("page"); p != "" {
		if v, err := strconv.Atoi(p); err == nil && v > 0 {
			page = v
		}
	}
	for _, key := range []string{"page_size", "per_page"} {
		if ps := r.URL.Query().Get(key); ps != "" {
			if v, err := strconv.Atoi(ps); err == nil && v > 0 && v <= 100 {
				pageSize = v
				break
			}
		}
	}
	return
}

// validationErrorsCarrier is satisfied by service errors that carry a
// structured list of validation problems (e.g. service.ValidationFailedError).
// The handler detects it via errors.As so the 400 response body can include the
// full list, letting the UI render the problems inline. Implemented in the
// service layer; matched structurally here to avoid a handler→service import.
type validationErrorsCarrier interface {
	ValidationErrors() []dto.ValidationError
}

// handleServiceError maps domain errors to appropriate HTTP responses.
func handleServiceError(w http.ResponseWriter, err error) {
	// Structured validation failure: emit a 400 with the full error list so the
	// frontend can show each problem inline rather than a single toast string.
	var vErr validationErrorsCarrier
	if errors.As(err, &vErr) {
		writeValidationError(w, err.Error(), vErr.ValidationErrors())
		return
	}

	switch {
	case errors.Is(err, model.ErrNotFound):
		writeError(w, http.StatusNotFound, "NOT_FOUND", err.Error())
	case errors.Is(err, model.ErrConflict):
		writeError(w, http.StatusConflict, "CONFLICT", err.Error())
	case errors.Is(err, model.ErrConcurrencyConfl):
		writeError(w, http.StatusConflict, "CONCURRENCY_CONFLICT", err.Error())
	case errors.Is(err, model.ErrTaskNotClaimable):
		writeError(w, http.StatusConflict, "TASK_NOT_CLAIMABLE", err.Error())
	case errors.Is(err, model.ErrTaskNotOwned):
		writeError(w, http.StatusForbidden, "TASK_NOT_OWNED", err.Error())
	case errors.Is(err, model.ErrNoOpenIncident):
		writeError(w, http.StatusConflict, "NO_OPEN_INCIDENT", err.Error())
	case errors.Is(err, model.ErrOverrideNotPending):
		writeError(w, http.StatusConflict, "OVERRIDE_NOT_PENDING", err.Error())
	case errors.Is(err, model.ErrSameActorOverride):
		// Fail-closed separation-of-duties violation on a sensitive override.
		writeError(w, http.StatusForbidden, "SOD_VIOLATION", err.Error())
	case errors.Is(err, model.ErrOverrideRequired):
		writeError(w, http.StatusForbidden, "OVERRIDE_REQUIRED", err.Error())
	default:
		msg := err.Error()
		if isValidationError(msg) {
			writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", msg)
		} else {
			writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error")
		}
	}
}

// isValidationError heuristically detects validation-style error messages.
func isValidationError(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "validation") ||
		strings.Contains(lower, "required") ||
		strings.Contains(lower, "invalid") ||
		strings.Contains(lower, "must be")
}

// UserNameLookup resolves user IDs to display names. Implementations may query
// IAM directly or through an internal HTTP call. Nil-safe — handlers check for nil.
type UserNameLookup interface {
	// LookupUserName returns the display name for the given user ID.
	// Returns empty string on lookup failure (best-effort).
	LookupUserName(ctx context.Context, userID string) string
}

// resolveUserName is a nil-safe helper that calls lookup.LookupUserName if non-nil.
func resolveUserName(ctx context.Context, lookup UserNameLookup, userID *string) *string {
	if lookup == nil || userID == nil || *userID == "" {
		return nil
	}
	name := lookup.LookupUserName(ctx, *userID)
	if name == "" {
		return nil
	}
	return &name
}
