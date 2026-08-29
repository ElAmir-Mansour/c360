package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// contractSortColumns maps frontend sort keys to safe SQL column expressions.
var contractSortColumns = map[string]string{
	"title":       "c.title",
	"status":      "c.status",
	"type":        "c.type",
	"total_value": "c.total_value",
	"expiry_date": "c.expiry_date",
	"updated_at":  "c.updated_at",
	"created_at":  "c.created_at",
	"risk_score":  "c.risk_score",
}

type ContractHandler struct {
	baseHandler
	service         *service.ContractService
	workflowService *service.WorkflowService
}

func NewContractHandler(service *service.ContractService, workflowService *service.WorkflowService, logger zerolog.Logger) *ContractHandler {
	return &ContractHandler{
		baseHandler:     baseHandler{logger: logger},
		service:         service,
		workflowService: workflowService,
	}
}

func (h *ContractHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreateContract(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ContractHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseContractListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.ListContracts(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *ContractHandler) Search(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.SearchContracts(r.Context(), tenantID, strings.TrimSpace(r.URL.Query().Get("q")), page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *ContractHandler) Stats(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	stats, err := h.service.Stats(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, stats)
}

func (h *ContractHandler) Expiring(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	horizon, err := parseOptionalInt(r.URL.Query().Get("horizon_days"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid horizon_days", nil)
		return
	}
	value := 30
	if horizon != nil {
		value = *horizon
	}
	items, err := h.service.ListExpiring(r.Context(), tenantID, value)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractHandler) RenewalWarnings(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	horizon, err := parseOptionalInt(r.URL.Query().Get("horizon_days"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid horizon_days", nil)
		return
	}
	lead, err := parseOptionalInt(r.URL.Query().Get("lead_days"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid lead_days", nil)
		return
	}
	horizonDays := 60
	if horizon != nil {
		horizonDays = *horizon
	}
	leadDays := 30
	if lead != nil {
		leadDays = *lead
	}
	summary, err := h.service.RenewalWarnings(r.Context(), tenantID, horizonDays, leadDays)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, summary)
}

func (h *ContractHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetContract(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Brief(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetContractBrief(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Timeline(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Timeline(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateContract(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteContract(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ContractHandler) UploadDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UploadContractDocumentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	items, err := h.service.UploadDocument(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractHandler) Analyze(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.AnalyzeContract(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// Return only the flat ContractRiskAnalysis, not the full AnalysisResult wrapper.
	// The frontend expects shape { data: ContractRiskAnalysis }. Extracted clauses are
	// already embedded in the ContractDetail returned by GetContract.
	suiteapi.WriteData(w, http.StatusOK, result.Analysis)
}

func (h *ContractHandler) Classify(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ClassifyContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.ClassifyContract(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Analysis(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetAnalysis(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateContractStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateStatus(r.Context(), tenantID, userID, id, req.Status)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) Versions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListVersions(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractHandler) Redline(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	baseVersion, err := parseOptionalInt(r.URL.Query().Get("base_version"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid base_version", nil)
		return
	}
	targetVersion, err := parseOptionalInt(r.URL.Query().Get("target_version"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid target_version", nil)
		return
	}
	base := 0
	if baseVersion != nil {
		base = *baseVersion
	}
	target := 0
	if targetVersion != nil {
		target = *targetVersion
	}
	item, err := h.service.GetRedline(r.Context(), tenantID, id, base, target)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) ContractReport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseContractListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("per_page")) == "" {
		filters.PerPage = 1000
	}
	report, err := h.service.ContractReport(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// Verb-gated financial redaction (see contract_report_export.go): callers
	// without lex:contract:approve never receive contract values in ANY format.
	exportCtx := newContractReportExportContext(r, tenantID)
	if !exportCtx.ShowFinancials {
		redactContractReportFinancials(report)
	}
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))) {
	case "csv":
		writeContractReportCSVHardened(w, report, exportCtx)
		return
	case "xlsx":
		writeSimpleXLSX(w, "lex-contract-report.xlsx", "Contracts", contractReportHeaders(), contractReportRows(report))
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func (h *ContractHandler) Renew(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RenewContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RenewContract(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ContractHandler) StartReview(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	contextUser := auth.UserFromContext(r.Context())
	if contextUser == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required", nil)
		return
	}
	// An add-only requester may submit the draft they created, but cannot submit
	// somebody else's contract or re-submit a record that has left draft. Editors
	// retain the existing cross-record submission behaviour; approval decisions
	// remain separately protected by contractReview and distinct-actor checks.
	if !auth.HasAnyPermissionCtx(r.Context(), contextUser.Roles, auth.PermLexContractEdit, auth.PermLexWrite) {
		detail, loadErr := h.service.GetContract(r.Context(), tenantID, id)
		if loadErr != nil {
			h.writeError(w, r, loadErr)
			return
		}
		if !canStartContractReview(r.Context(), contextUser.Roles, userID, detail.Contract) {
			suiteapi.WriteError(
				w,
				r,
				http.StatusForbidden,
				"FORBIDDEN",
				"an add-only requester may submit only their own draft contract for review",
				nil,
			)
			return
		}
	}
	var req dto.ReviewContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	if req.SLAHours == 0 {
		req.SLAHours = 48
	}
	item, err := h.workflowService.StartContractReview(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, item)
}

func canStartContractReview(ctx context.Context, roles []string, actorID uuid.UUID, contract *model.Contract) bool {
	if auth.HasAnyPermissionCtx(ctx, roles, auth.PermLexContractEdit, auth.PermLexWrite) {
		return true
	}
	return auth.HasPermissionCtx(ctx, roles, auth.PermLexContractAdd) &&
		contract != nil &&
		contract.CreatedBy == actorID &&
		contract.Status == model.ContractStatusDraft
}

func (h *ContractHandler) ListWorkflows(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	var (
		items []model.LegalWorkflowSummary
		total int
		err   error
	)
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("mine")), "true") {
		userID, userOK := h.userID(w, r)
		if !userOK {
			return
		}
		contextUser := auth.UserFromContext(r.Context())
		roles := []string(nil)
		if contextUser != nil && contextUser.ID == userID.String() {
			roles = contextUser.Roles
		}
		items, total, err = h.workflowService.ListActiveForActor(r.Context(), tenantID, userID, roles, page, perPage)
	} else {
		items, total, err = h.workflowService.ListActive(r.Context(), tenantID, page, perPage)
	}
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *ContractHandler) DecideWorkflowTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	workflowInstanceID, err := suiteapi.UUIDParam(r, "workflowInstanceID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.WorkflowDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.DecideTask(r.Context(), tenantID, userID, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) BulkDecideWorkflowTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.WorkflowBulkDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.BulkDecideTasks(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) ListApprovalPolicies(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	if strings.TrimSpace(r.URL.Query().Get("per_page")) == "" {
		perPage = 200
	}
	items, _, err := h.workflowService.ListApprovalPolicies(r.Context(), tenantID, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *ContractHandler) CreateApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateApprovalPolicyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.CreateApprovalPolicy(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *ContractHandler) UpdateApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateApprovalPolicyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.workflowService.UpdateApprovalPolicy(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) DeleteApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.workflowService.ArchiveApprovalPolicy(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ContractHandler) RecommendApprovalPolicy(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	contractID, err := parseOptionalUUID(r.URL.Query().Get("contract_id"))
	if err != nil || contractID == nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "contract_id is required", nil)
		return
	}
	item, err := h.workflowService.RecommendApprovalPolicy(r.Context(), tenantID, *contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractHandler) ApprovalPolicyAnalytics(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	item, err := h.workflowService.ApprovalPolicyAnalytics(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func parseContractListFilters(r *http.Request) (model.ContractListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, contractSortColumns, "updated_at", "desc")
	ownerUserID, err := parseOptionalUUID(r.URL.Query().Get("owner_user_id"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid owner_user_id")
	}
	orgEntityID, err := parseOptionalUUID(r.URL.Query().Get("org_entity_id"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid org_entity_id")
	}
	expiringInDays, err := parseOptionalInt(r.URL.Query().Get("expiring_in_days"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid expiring_in_days")
	}
	expiryFrom, err := parseOptionalDate(r.URL.Query().Get("expiry_from"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid expiry_from")
	}
	expiryTo, err := parseOptionalDate(r.URL.Query().Get("expiry_to"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid expiry_to")
	}
	createdFrom, err := parseOptionalDate(r.URL.Query().Get("created_from"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid created_from")
	}
	createdTo, err := parseOptionalDate(r.URL.Query().Get("created_to"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid created_to")
	}
	statusFrom, err := parseOptionalDate(r.URL.Query().Get("status_changed_from"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid status_changed_from")
	}
	statusTo, err := parseOptionalDate(r.URL.Query().Get("status_changed_to"))
	if err != nil {
		return model.ContractListFilters{}, fmt.Errorf("invalid status_changed_to")
	}
	department := strings.TrimSpace(r.URL.Query().Get("department"))
	filters := model.ContractListFilters{
		Page:           page,
		PerPage:        perPage,
		Search:         strings.TrimSpace(r.URL.Query().Get("search")),
		OwnerUserID:    ownerUserID,
		Tag:            strings.TrimSpace(r.URL.Query().Get("tag")),
		OrgEntityID:    orgEntityID,
		ExpiringInDays: expiringInDays,
		ExpiryFrom:     expiryFrom,
		ExpiryTo:       expiryTo,
		CreatedFrom:    createdFrom,
		CreatedTo:      createdTo,
		StatusFrom:     statusFrom,
		StatusTo:       statusTo,
		SortColumn:     sortCol,
		SortDirection:  sortDir,
	}
	if parts := strings.Split(department, ","); len(parts) == 1 {
		filters.Department = department
	} else {
		for _, part := range parts {
			if value := strings.TrimSpace(part); value != "" {
				filters.Departments = append(filters.Departments, value)
			}
		}
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		parts := strings.Split(status, ",")
		if len(parts) == 1 {
			value := model.ContractStatus(status)
			filters.Status = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Statuses = append(filters.Statuses, model.ContractStatus(value))
				}
			}
		}
	}
	if contractType := strings.TrimSpace(r.URL.Query().Get("type")); contractType != "" {
		parts := strings.Split(contractType, ",")
		if len(parts) == 1 {
			value := model.ContractType(contractType)
			filters.Type = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Types = append(filters.Types, model.ContractType(value))
				}
			}
		}
	}
	if riskLevel := strings.TrimSpace(r.URL.Query().Get("risk_level")); riskLevel != "" {
		value := model.RiskLevel(riskLevel)
		filters.RiskLevel = &value
	}
	return filters, nil
}

// NOTE: the CSV branch of ContractReport is served by
// writeContractReportCSVHardened (contract_report_export.go) — BOM, watermark
// row and verb-gated financial redaction. contractReportHeaders/Rows below
// remain the legacy column set used by the xlsx branch.

func contractReportHeaders() []string {
	return []string{"id", "title", "type", "status", "party_b_name", "risk_level", "risk_score", "expiry_date", "current_version", "created_at"}
}

func contractReportRows(report *model.ContractReport) [][]string {
	rows := make([][]string, 0, len(report.Contracts))
	for _, item := range report.Contracts {
		riskScore := ""
		if item.RiskScore != nil {
			riskScore = fmt.Sprintf("%.2f", *item.RiskScore)
		}
		expiryDate := ""
		if item.ExpiryDate != nil {
			expiryDate = item.ExpiryDate.Format("2006-01-02")
		}
		rows = append(rows, []string{
			item.ID.String(),
			item.Title,
			string(item.Type),
			string(item.Status),
			item.PartyBName,
			string(item.RiskLevel),
			riskScore,
			expiryDate,
			fmt.Sprintf("%d", item.CurrentVersion),
			item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return rows
}
