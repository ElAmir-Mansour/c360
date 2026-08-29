package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// SignatureSummaryHandler serves the batched per-contract e-signature rollup
// consumed by the contracts list workspace.
type SignatureSummaryHandler struct {
	baseHandler
	service *service.SignatureSummaryService
}

func NewSignatureSummaryHandler(service *service.SignatureSummaryService, logger zerolog.Logger) *SignatureSummaryHandler {
	return &SignatureSummaryHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// Summary handles GET /signatures/summary?contract_ids=a,b,c — one entry per
// distinct requested contract id (envelope_status "none" for contracts with
// no envelopes), computed in a single query. Same read tier as
// GET /signatures (lex:read).
func (h *SignatureSummaryHandler) Summary(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractIDs, err := parseContractIDsParam(r.URL.Query().Get("contract_ids"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.Summary(r.Context(), tenantID, contractIDs)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// parseContractIDsParam parses the comma-separated contract_ids query
// parameter. Empty segments are skipped; any malformed uuid rejects the whole
// request (fail-closed rather than silently dropping ids). Emptiness and the
// batch-size cap are enforced by the service.
func parseContractIDsParam(raw string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := uuid.Parse(part)
		if err != nil {
			return nil, errors.New("invalid contract_ids: " + part + " is not a valid uuid")
		}
		ids = append(ids, id)
	}
	return ids, nil
}
