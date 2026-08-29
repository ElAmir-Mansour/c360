package handler

import (
	"net/http"

	"github.com/clario360/platform/internal/suiteapi"
)

// EntityRollup serves GET /contracts/entity-rollup: per-org-entity contract
// aggregates (count + total_value per currency) over the SAME query-string
// filter surface as the contract list (search/status/type/owner_user_id/
// risk_level/department/tag/org_entity_id/expiring_in_days), so the workspace
// can roll up exactly what the table is currently showing. Registered on the
// contractView tier (lex:contract:view) — read-only, no mutation surface.
func (h *ContractHandler) EntityRollup(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseContractListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.EntityRollup(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}
