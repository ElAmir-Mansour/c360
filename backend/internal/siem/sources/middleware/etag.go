package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type ctxKey string

const ifMatchKey ctxKey = "siem_if_match"

// IfMatchRequired wraps the handler with parsing of the If-Match
// header. Mutations on /sources MUST send If-Match: <version>; the
// version is exposed via IfMatchFromContext for the handler.
//
// On missing header, returns 400; on malformed, returns 400.
//
// The actual stale-version detection happens at the service/repo
// layer (single round-trip) — this middleware just parses and
// validates the format.
func IfMatchRequired(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := r.Header.Get("If-Match")
		if raw == "" {
			writeError(w, http.StatusBadRequest, "missing_if_match", "If-Match header is required")
			return
		}
		v, ok := parseVersion(raw)
		if !ok {
			writeError(w, http.StatusBadRequest, "bad_if_match", "If-Match must be an integer version (got "+raw+")")
			return
		}
		ctx := context.WithValue(r.Context(), ifMatchKey, v)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// IfMatchFromContext returns the parsed If-Match value or (0, false).
func IfMatchFromContext(ctx context.Context) (int64, bool) {
	v, ok := ctx.Value(ifMatchKey).(int64)
	return v, ok
}

// parseVersion strips quotes and any W/ weak-prefix, then parses as int.
func parseVersion(raw string) (int64, bool) {
	v := strings.TrimSpace(raw)
	v = strings.TrimPrefix(v, "W/")
	v = strings.Trim(v, `"`)
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  status,
		"code":    code,
		"message": message,
	})
}
