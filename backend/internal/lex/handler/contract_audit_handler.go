package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// contractAuditExportRows is the bulk slice pulled when format=csv is
// requested without an explicit per_page, mirroring ContractReport's
// export default.
const contractAuditExportRows = 1000

// utf8BOM is prepended to the CSV export so Excel (the dominant consumer of
// KSA legal exports) detects UTF-8 and renders Arabic titles/reasons
// correctly instead of mojibake.
var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

// ContractAuditHandler is the transport shell over ContractAuditService. It
// mirrors the MatterAuditHandler conventions (tenant resolved from context,
// WriteData/WritePaginated envelope, route wiring owned by the integrator in
// handler/routes.go) but serves the PORTFOLIO-wide feed: GET /contracts/audit
// accepts the same query params as the contracts list (status/type/
// risk_level/department/tag/search/owner_user_id) plus from/to, and supports
// ?format=csv for a UTF-8-with-BOM export.
type ContractAuditHandler struct {
	baseHandler
	service *service.ContractAuditService
}

func NewContractAuditHandler(svc *service.ContractAuditService, logger zerolog.Logger) *ContractAuditHandler {
	return &ContractAuditHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// ListPortfolioAudit GET /contracts/audit. Returns the tenant's append-only
// contract audit event feed, newest-first, scoped by the contract-list
// filters and an optional occurred_at window. ?format=csv streams the export.
func (h *ContractAuditHandler) ListPortfolioAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseContractAuditFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "csv") {
		if strings.TrimSpace(r.URL.Query().Get("per_page")) == "" {
			filters.PerPage = contractAuditExportRows
		}
		events, _, err := h.service.ListPortfolioAudit(r.Context(), tenantID, filters)
		if err != nil {
			h.writeError(w, r, err)
			return
		}
		writeContractAuditCSV(w, events)
		return
	}
	events, total, err := h.service.ListPortfolioAudit(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, events, filters.Page, filters.PerPage, total)
}

// parseContractAuditFilters reuses the contracts-list parser (so both
// endpoints accept identical params) and layers the audit-only additions on
// top: a `risk` alias for risk_level (the audit feed spec names it `risk`)
// and the from/to occurred_at window. `to` follows the reporting convention:
// a date-only bound is inclusive end-of-day.
func parseContractAuditFilters(r *http.Request) (model.ContractAuditFilters, error) {
	list, err := parseContractListFilters(r)
	if err != nil {
		return model.ContractAuditFilters{}, err
	}
	filters := model.ContractAuditFilters{ContractListFilters: list}
	if filters.RiskLevel == nil {
		if risk := strings.TrimSpace(r.URL.Query().Get("risk")); risk != "" {
			value := model.RiskLevel(risk)
			filters.RiskLevel = &value
		}
	}
	from, err := parseOptionalDate(r.URL.Query().Get("from"))
	if err != nil {
		return model.ContractAuditFilters{}, fmt.Errorf("invalid 'from' date")
	}
	filters.From = from
	to, err := parseOptionalDate(r.URL.Query().Get("to"))
	if err != nil {
		return model.ContractAuditFilters{}, fmt.Errorf("invalid 'to' date")
	}
	if to != nil {
		// The repo applies `occurred_at < to`: push a date-only bound to the
		// next midnight so the named day is fully included; an instant bound
		// gains a nanosecond so it stays effectively inclusive.
		var exclusive time.Time
		if to.Hour() == 0 && to.Minute() == 0 && to.Second() == 0 && to.Nanosecond() == 0 {
			exclusive = to.Add(24 * time.Hour)
		} else {
			exclusive = to.Add(time.Nanosecond)
		}
		filters.To = &exclusive
	}
	return filters, nil
}

func writeContractAuditCSV(w http.ResponseWriter, events []model.ContractAuditEvent) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-contract-audit.csv"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(utf8BOM)
	writer := csv.NewWriter(w)
	_ = writer.Write(contractAuditCSVHeaders())
	for _, event := range events {
		_ = writer.Write(contractAuditCSVRow(event))
	}
	writer.Flush()
}

func contractAuditCSVHeaders() []string {
	return []string{"occurred_at", "contract_id", "contract_title", "event_type", "field", "before", "after", "actor_user_id", "source", "detail"}
}

func contractAuditCSVRow(event model.ContractAuditEvent) []string {
	before := ""
	if event.Before != nil {
		before = *event.Before
	}
	after := ""
	if event.After != nil {
		after = *event.After
	}
	actor := ""
	if event.ActorUserID != nil {
		actor = event.ActorUserID.String()
	}
	detail := ""
	if len(event.Detail) > 0 {
		if raw, err := json.Marshal(event.Detail); err == nil {
			detail = string(raw)
		}
	}
	return []string{
		event.OccurredAt.UTC().Format(time.RFC3339),
		event.ContractID.String(),
		event.ContractTitle,
		event.EventType,
		event.Field,
		before,
		after,
		actor,
		event.Source,
		detail,
	}
}
