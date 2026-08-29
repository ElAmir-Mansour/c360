package handler

import (
	"encoding/json"
	"net/http"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/siem/service"
)

// MetaHandler returns build/uptime info for siem-service.
type MetaHandler struct {
	meta     *service.MetaService
	notReady func() bool
}

// NewMetaHandler constructs the handler. If notReady is non-nil and
// returns true at request time, the handler returns 503 — useful while
// migrations are running or dependencies are still recovering.
func NewMetaHandler(meta *service.MetaService, notReady func() bool) *MetaHandler {
	return &MetaHandler{meta: meta, notReady: notReady}
}

// ServeHTTP implements http.Handler.
func (h *MetaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.notReady != nil && h.notReady() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":  503,
			"code":    "NOT_READY",
			"message": "siem-service is not ready",
		})
		return
	}
	if h.meta == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"status":  500,
			"code":    "SERVER_ERROR",
			"message": "meta service not initialized",
		})
		return
	}
	tenantID := auth.TenantFromContext(r.Context())
	writeJSON(w, http.StatusOK, h.meta.MetaFor(tenantID))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
