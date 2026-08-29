package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ResolutionRateHandler serves GET /reports/resolution-rates: tenant-scoped
// resolution rates across contracts/litigation/advisory/requests. It mirrors
// MatterHandler.Report minus filters/format.
type ResolutionRateHandler struct {
	baseHandler
	service *service.ResolutionRateService
}

func NewResolutionRateHandler(service *service.ResolutionRateService, logger zerolog.Logger) *ResolutionRateHandler {
	return &ResolutionRateHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *ResolutionRateHandler) Report(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	report, err := h.service.ResolutionRates(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}
