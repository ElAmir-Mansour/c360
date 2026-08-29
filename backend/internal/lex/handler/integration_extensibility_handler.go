package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// IntegrationExtensibilityHandler serves the integration EXTENSIBILITY surfaces that
// are NOT already covered by the config-driven CRUD path:
//
//   - #18 no-code custom connector : created/edited via the existing POST /integrations
//     (kind=custom) + GET /integrations/schema/custom + tested via /integrations/{id}/test
//     — no bespoke handler needed; the CustomConnector adapter does the work.
//   - #19 transform/filter rules   : edited as the sync_rules config field via the same
//     CRUD path; applied during sync by the connector — no bespoke handler needed.
//   - #20 conflict queue           : THIS handler. List an endpoint's conflicts and
//     resolve one (merge|override|ignore). The mass-change guard is enforced inside
//     SyncNow (the existing /sync route honours ?force=true) — no extra route.
//
// It mirrors IntegrationHandler's shape (baseHandler + the registry service) and uses
// the same suiteapi response helpers + RBAC tiers (read for list, manage for resolve).
type IntegrationExtensibilityHandler struct {
	baseHandler
	service *service.IntegrationRegistryService
}

// NewIntegrationExtensibilityHandler builds the handler over the registry service.
func NewIntegrationExtensibilityHandler(svc *service.IntegrationRegistryService, logger zerolog.Logger) *IntegrationExtensibilityHandler {
	return &IntegrationExtensibilityHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// Conflicts lists an endpoint's conflict queue
// (GET /integrations/{id}/conflicts?status=&limit=). status filters open|resolved;
// an empty status returns all. Read tier.
func (h *IntegrationExtensibilityHandler) Conflicts(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	status := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("status")))
	limit := 100
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			limit = n
		}
	}
	conflicts, err := h.service.ListConflicts(r.Context(), tenantID, id, status, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, conflicts)
}

// ResolveConflict applies an operator's resolution to one conflict
// (POST /integrations/conflicts/{conflictId}/resolve) with body {resolution}. The
// resolution is one of merge|override|ignore. Manage tier.
func (h *IntegrationExtensibilityHandler) ResolveConflict(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	conflictID, err := suiteapi.UUIDParam(r, "conflictId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req struct {
		Resolution string `json:"resolution"`
	}
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	resolved, err := h.service.ResolveConflict(r.Context(), tenantID, userID, conflictID, strings.TrimSpace(req.Resolution))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, resolved)
}

// isTruthyParam reports whether a query-string flag value means "true". Shared by the
// /sync ?force= flag (extensibility #20) and any other boolean query param.
func isTruthyParam(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on", "force":
		return true
	default:
		return false
	}
}
