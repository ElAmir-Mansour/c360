package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

type WorkforceHandler struct {
	baseHandler
	service *service.WorkforceService
}

func NewWorkforceHandler(workforce *service.WorkforceService, logger zerolog.Logger) *WorkforceHandler {
	return &WorkforceHandler{baseHandler: baseHandler{logger: logger}, service: workforce}
}

func (h *WorkforceHandler) Report(w http.ResponseWriter, r *http.Request) {
	tenantID, callerID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	query, err := parseWorkforceQuery(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	user := auth.UserFromContext(r.Context())
	roles := []string{}
	if user != nil {
		roles = user.Roles
	}
	query.HasWorkforceAccess = auth.HasPermissionCtx(r.Context(), roles, auth.PermLexWorkforceRead)
	query.HasExecutiveRole = hasWorkforceExecutiveRole(roles)
	query.ForbiddenDomains = workforceForbiddenDomains(r, roles)
	report, err := h.service.Report(r.Context(), tenantID, callerID, query)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func parseWorkforceQuery(r *http.Request) (service.WorkforceReportQuery, error) {
	query := service.WorkforceReportQuery{
		Scope: model.ScopeMode(strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))),
		Sort:  strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sort"))),
	}
	var err error
	query.From, err = parseWorkforceDate(r.URL.Query().Get("from"))
	if err != nil {
		return query, fmt.Errorf("from must be an ISO date")
	}
	query.To, err = parseWorkforceDate(r.URL.Query().Get("to"))
	if err != nil {
		return query, fmt.Errorf("to must be an ISO date")
	}
	query.EntityID, err = parseOptionalUUID(r.URL.Query().Get("entity_id"))
	if err != nil {
		return query, fmt.Errorf("entity_id must be a UUID")
	}
	query.Domains = repeatedWorkforceValues(r, "domain")
	query.Rels = repeatedWorkforceValues(r, "rel")
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		query.Limit, err = strconv.Atoi(raw)
		if err != nil {
			return query, fmt.Errorf("limit must be an integer")
		}
	}
	return query, nil
}

func parseWorkforceDate(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func repeatedWorkforceValues(r *http.Request, key string) []string {
	values := make([]string, 0)
	for _, raw := range r.URL.Query()[key] {
		for _, value := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				values = append(values, trimmed)
			}
		}
	}
	return values
}

func hasWorkforceExecutiveRole(roles []string) bool {
	for _, role := range roles {
		switch strings.ReplaceAll(strings.ToLower(strings.TrimSpace(role)), "_", "-") {
		case "legal-director", "legal-ceo", "legal-bu-ceo":
			return true
		}
	}
	return false
}

func workforceForbiddenDomains(r *http.Request, roles []string) map[string]bool {
	ctx := r.Context()
	return map[string]bool{
		"contracts":        !auth.HasPermissionCtx(ctx, roles, auth.PermLexContractView),
		"contract_intakes": !auth.HasPermissionCtx(ctx, roles, auth.PermLexContractView),
		"consultations":    !auth.HasPermissionCtx(ctx, roles, auth.PermLexConsultationView),
		"cases":            !auth.HasPermissionCtx(ctx, roles, auth.PermLexCaseView),
		"requests":         !auth.HasPermissionCtx(ctx, roles, auth.PermLexRequestView),
		"support":          !auth.HasPermissionCtx(ctx, roles, auth.PermLexSupportView),
	}
}
