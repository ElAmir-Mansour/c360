package handler

import (
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractBulkHandler serves the bulk-by-filter contract actions (feature #8):
//
//	POST /contracts/bulk-status  — one FSM transition across many contracts
//	POST /contracts/bulk-analyze — re-run risk analysis across many contracts
//
// Both accept EITHER an explicit {"contract_ids": [...]} list OR a
// {"filter": {...}} object carrying the SAME query params the contract list
// (GET /contracts) and the CSV report (GET /reports/contracts) already accept.
// A filter is resolved server-side to the FULL matching set — capped at
// service.MaxBulkContracts with a clear error — by round-tripping it through
// parseContractListFilters, the exact query-builder behind those routes.
// Responses are the per-item partial-failure envelope
// {total, succeeded: [id...], failed: [{id, reason}...]}.
//
// Route tiers mirror the single-item control points (see the wiring in
// routes.go): bulk-status sits on the contract :approve tier — per-item
// dynamic SoD (author != actor) is enforced in the service because the bulk
// route carries no {id} path param for lexmw.RequireDistinctActor — and
// bulk-analyze sits on the contract :edit tier, like POST /contracts/{id}/analyze.
type ContractBulkHandler struct {
	baseHandler
	service *service.ContractBulkService
}

func NewContractBulkHandler(service *service.ContractBulkService, logger zerolog.Logger) *ContractBulkHandler {
	return &ContractBulkHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

type bulkContractStatusRequest struct {
	ContractIDs []uuid.UUID          `json:"contract_ids,omitempty"`
	Filter      map[string]any       `json:"filter,omitempty"`
	Status      model.ContractStatus `json:"status"`
}

type bulkContractAnalyzeRequest struct {
	ContractIDs []uuid.UUID    `json:"contract_ids,omitempty"`
	Filter      map[string]any `json:"filter,omitempty"`
}

// BulkStatus POST /contracts/bulk-status.
func (h *ContractBulkHandler) BulkStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req bulkContractStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if strings.TrimSpace(string(req.Status)) == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "status is required", nil)
		return
	}
	ids, ok := h.resolveBulkTargets(w, r, tenantID, req.ContractIDs, req.Filter)
	if !ok {
		return
	}
	result, err := h.service.BulkUpdateStatus(r.Context(), tenantID, userID, ids, req.Status)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// BulkAnalyze POST /contracts/bulk-analyze.
func (h *ContractBulkHandler) BulkAnalyze(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req bulkContractAnalyzeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	ids, ok := h.resolveBulkTargets(w, r, tenantID, req.ContractIDs, req.Filter)
	if !ok {
		return
	}
	result, err := h.service.BulkAnalyze(r.Context(), tenantID, userID, ids)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// resolveBulkTargets normalizes the two addressing modes into one id set:
// exactly one of contract_ids / filter must be supplied. On any denial it has
// already written the error response and returns ok=false.
func (h *ContractBulkHandler) resolveBulkTargets(w http.ResponseWriter, r *http.Request, tenantID uuid.UUID, ids []uuid.UUID, filter map[string]any) ([]uuid.UUID, bool) {
	hasIDs := len(ids) > 0
	// An explicitly supplied empty filter object ({}) is a deliberate
	// "everything" selection (like an unfiltered CSV export) and stays subject
	// to the batch cap; an absent filter is nil.
	hasFilter := filter != nil
	if hasIDs && hasFilter {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "provide either contract_ids or filter, not both", nil)
		return nil, false
	}
	if !hasIDs && !hasFilter {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "either contract_ids or filter is required", nil)
		return nil, false
	}
	if hasIDs {
		return ids, true
	}
	filters, err := contractFiltersFromBulkFilter(filter)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return nil, false
	}
	resolved, err := h.service.ResolveFilter(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return nil, false
	}
	return resolved, true
}

// bulkFilterAllowedKeys are the membership-defining query params of the
// contract list (GET /contracts) and CSV report (GET /reports/contracts) — see
// parseContractListFilters.
var bulkFilterAllowedKeys = map[string]struct{}{
	"search":           {},
	"status":           {},
	"type":             {},
	"risk_level":       {},
	"owner_user_id":    {},
	"department":       {},
	"tag":              {},
	"expiring_in_days": {},
}

// bulkFilterIgnoredKeys are list params that change presentation, not set
// membership. They are accepted-and-dropped so the frontend can post its list
// query state wholesale (page/per_page must never shrink a mutation set).
var bulkFilterIgnoredKeys = map[string]struct{}{
	"page":     {},
	"per_page": {},
	"sort":     {},
	"order":    {},
}

// contractFiltersFromBulkFilter converts the JSON filter object of a bulk
// request into model.ContractListFilters by round-tripping it through a
// synthetic GET query and the EXISTING parseContractListFilters — the same
// query-builder the list and the CSV report use — so bulk-by-filter can never
// drift from what the list showed the user. Unknown keys are rejected: a typo
// must not silently widen a bulk mutation toward the whole tenant.
func contractFiltersFromBulkFilter(filter map[string]any) (model.ContractListFilters, error) {
	values := url.Values{}
	for key, raw := range filter {
		if _, skip := bulkFilterIgnoredKeys[key]; skip {
			continue
		}
		if _, ok := bulkFilterAllowedKeys[key]; !ok {
			return model.ContractListFilters{}, fmt.Errorf("unsupported filter key %q", key)
		}
		value, err := bulkFilterScalar(key, raw)
		if err != nil {
			return model.ContractListFilters{}, err
		}
		if value == "" {
			continue
		}
		values.Set(key, value)
	}
	synthetic, err := http.NewRequest(http.MethodGet, "/contracts?"+values.Encode(), nil)
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid filter")
	}
	return parseContractListFilters(synthetic)
}

// bulkFilterScalar renders one JSON filter value as the query-string scalar
// parseContractListFilters expects. JSON numbers arrive as float64; only
// integral values are meaningful (expiring_in_days). null/empty values mean
// "not filtered" and are dropped.
func bulkFilterScalar(key string, value any) (string, error) {
	switch v := value.(type) {
	case nil:
		return "", nil
	case string:
		return strings.TrimSpace(v), nil
	case float64:
		if v != math.Trunc(v) {
			return "", fmt.Errorf("filter key %q must be an integer", key)
		}
		return strconv.FormatInt(int64(v), 10), nil
	case bool:
		return strconv.FormatBool(v), nil
	default:
		return "", fmt.Errorf("filter key %q must be a scalar value", key)
	}
}
