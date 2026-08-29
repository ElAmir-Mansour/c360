package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractInsightsHandler serves the compute-on-read portfolio insight feed
// (#13 PORTFOLIO INSIGHTS): ranked bilingual cards for missing mandatory
// clauses, closing auto-renew opt-out windows, value outliers, counterparty
// concentration, and stale drafts. Read-only; gated on lex:contract:view.
type ContractInsightsHandler struct {
	baseHandler
	service *service.ContractInsightsService
}

func NewContractInsightsHandler(service *service.ContractInsightsService, logger zerolog.Logger) *ContractInsightsHandler {
	return &ContractInsightsHandler{
		baseHandler: baseHandler{logger: logger},
		service:     service,
	}
}

// Insights handles GET /contracts/insights. Optional query knobs:
// window_days (renewal opt-out horizon, default 30) and stale_days
// (draft-inactivity threshold, default 30); the service clamps both to 1..365.
func (h *ContractInsightsHandler) Insights(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	window, err := parseOptionalInt(r.URL.Query().Get("window_days"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid window_days", nil)
		return
	}
	stale, err := parseOptionalInt(r.URL.Query().Get("stale_days"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid stale_days", nil)
		return
	}
	opts := service.ContractInsightsOptions{}
	if window != nil {
		opts.WindowDays = *window
	}
	if stale != nil {
		opts.StaleDraftDays = *stale
	}
	report, err := h.service.PortfolioInsights(r.Context(), tenantID, opts)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}
