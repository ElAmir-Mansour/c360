package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// MatterAuditHandler is the transport shell over MatterAuditService. It exposes
// the chronological governance trail for a single matter and mirrors the
// SettlementHandler / ConsultationHandler ListAudit conventions (tenant resolved
// from context, {id} URL param, WriteData envelope). Route wiring (permission
// tier, path) is owned by the integrator in handler/routes.go.
type MatterAuditHandler struct {
	baseHandler
	service *service.MatterAuditService
}

func NewMatterAuditHandler(svc *service.MatterAuditService, logger zerolog.Logger) *MatterAuditHandler {
	return &MatterAuditHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// ListAudit GET /matters/{id}/audit. Returns the matter's append-only audit
// entries in chronological order.
func (h *MatterAuditHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	entries, err := h.service.ListAudit(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, entries)
}
