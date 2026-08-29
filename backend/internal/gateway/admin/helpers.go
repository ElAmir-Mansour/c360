package admin

import (
	"encoding/json"
	"net/http"

	"github.com/clario360/platform/internal/auth"
)

// writeJSON encodes v as JSON with the given status. It mirrors the gateway's
// response convention used elsewhere in the gateway package.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError emits the gateway error envelope ({"error":{code,message,request_id}})
// matching internal/gateway/middleware/proxy_auth.go's writeGWError shape so the
// admin API returns identical error bodies to the rest of the gateway surface.
func writeError(w http.ResponseWriter, status int, code, message, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":       code,
			"message":    message,
			"request_id": requestID,
		},
	})
}

// actorID returns the authenticated user's ID for audit logging of admin control
// actions, or "" when no user is present in the request context.
func actorID(r *http.Request) string {
	if u := auth.UserFromContext(r.Context()); u != nil {
		return u.ID
	}
	return ""
}
