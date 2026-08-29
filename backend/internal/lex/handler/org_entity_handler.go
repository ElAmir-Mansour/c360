package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var orgEntitySortColumns = map[string]string{
	"code":        "e.code",
	"entity_type": "e.entity_type",
	"active":      "e.active",
	"updated_at":  "e.updated_at",
	"created_at":  "e.created_at",
}

var orgImportTemplateHeaders = []string{
	"code", "parent_code", "entity_type", "name_en", "name_ar", "active",
	"platform_org_unit_id", "manager_user_id", "roles_json", "metadata_json",
	"employees_json",
}

// The filled sample is intentionally presentation-friendly. Advanced identity,
// role, metadata and employee columns remain available in the blank production
// template, but are not required to demonstrate hierarchy onboarding.
var orgImportSampleHeaders = []string{
	"code", "parent_code", "entity_type", "name_en", "name_ar", "active",
	"role_key", "role_holder_user_id",
}

var orgImportSampleRows = [][]string{
	{"ACME", "", "company", "Acme Holding Company", "شركة أكمي القابضة", "true", "", ""},
	{"CORP", "ACME", "business_unit", "Corporate Services", "الخدمات المؤسسية", "true", "general_counsel", "11111111-1111-4111-8111-111111111111"},
	{"LEGAL", "CORP", "department", "Legal Affairs", "الإدارة القانونية", "true", "legal_director", "22222222-2222-4222-8222-222222222222"},
	{"CONTRACTS", "LEGAL", "section", "Contracts", "العقود", "true", "contracts_manager", "33333333-3333-4333-8333-333333333333"},
	{"SHARED", "CORP", "shared_services_unit", "Shared Services", "الخدمات المشتركة", "true", "shared_services_manager", "44444444-4444-4444-8444-444444444444"},
}

var orgImportSampleJSON = []byte(`[
  {"code":"ACME","parent_code":"","entity_type":"company","name":{"en":"Acme Holding Company","ar":"شركة أكمي القابضة"},"active":true},
  {"code":"CORP","parent_code":"ACME","entity_type":"business_unit","name":{"en":"Corporate Services","ar":"الخدمات المؤسسية"},"active":true,"roles":[{"role_key":"general_counsel","user_id":"11111111-1111-4111-8111-111111111111"}]},
  {"code":"LEGAL","parent_code":"CORP","entity_type":"department","name":{"en":"Legal Affairs","ar":"الإدارة القانونية"},"active":true,"roles":[{"role_key":"legal_director","user_id":"22222222-2222-4222-8222-222222222222"}]},
  {"code":"CONTRACTS","parent_code":"LEGAL","entity_type":"section","name":{"en":"Contracts","ar":"العقود"},"active":true,"roles":[{"role_key":"contracts_manager","user_id":"33333333-3333-4333-8333-333333333333"}]},
  {"code":"SHARED","parent_code":"CORP","entity_type":"shared_services_unit","name":{"en":"Shared Services","ar":"الخدمات المشتركة"},"active":true,"roles":[{"role_key":"shared_services_manager","user_id":"44444444-4444-4444-8444-444444444444"}]}
]`)

type OrgEntityHandler struct {
	baseHandler
	service *service.OrgEntityService
}

func NewOrgEntityHandler(service *service.OrgEntityService, logger zerolog.Logger) *OrgEntityHandler {
	return &OrgEntityHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *OrgEntityHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateOrgEntityRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *OrgEntityHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseOrgEntityListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *OrgEntityHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *OrgEntityHandler) GetByCode(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "code is required", nil)
		return
	}
	item, err := h.service.GetByCode(r.Context(), tenantID, code)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListMemberships GET /org-entities/{id}/memberships returns active employee
// mappings for assignment pickers. User profile hydration stays in IAM; this
// endpoint intentionally returns the tenant-scoped membership facts only.
func (h *OrgEntityHandler) ListMemberships(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListActiveMemberships(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *OrgEntityHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateOrgEntityRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *OrgEntityHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *OrgEntityHandler) AssignRole(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.OrgRoleRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.AssignRole(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *OrgEntityHandler) RemoveRole(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	roleKey := strings.TrimSpace(chi.URLParam(r, "roleKey"))
	if roleKey == "" {
		roleKey = strings.TrimSpace(r.URL.Query().Get("role_key"))
	}
	if roleKey == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "role_key is required", nil)
		return
	}
	if err := h.service.RemoveRole(r.Context(), tenantID, userID, id, model.OrgRoleKey(roleKey)); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *OrgEntityHandler) Escalation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	ladder, err := h.service.ResolveEscalationRecipients(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, ladder)
}

// EntityAudit GET /org-entities/{id}/audit. Returns the activity timeline for a
// single org entity, newest-first. Events are synthesized from the entity's row
// metadata (the registry has no dedicated audit table).
func (h *OrgEntityHandler) EntityAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	events, err := h.service.ListEntityAudit(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, events)
}

// Audit GET /org-entities/audit. Returns the tenant-wide org-entity activity
// timeline, newest-first and paginated.
func (h *OrgEntityHandler) Audit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.OrgEntityAuditFilters{Page: page, PerPage: perPage}
	events, total, err := h.service.ListAudit(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, events, page, perPage, total)
}

// PlatformUnits GET /org-entities/platform-units. Returns the platform_core
// org-units this tenant's registry references, for reconciliation. See
// OrgEntityService.ListPlatformUnits for the cross-service-access limitation.
func (h *OrgEntityHandler) PlatformUnits(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	units, err := h.service.ListPlatformUnits(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, units)
}

// ImportTemplate serves equivalent XLSX, CSV and JSON templates. The client can
// parse all three into OrgStructureImportRequest; parent_code is deliberately
// stable across environments and replaces the legacy parent UUID contract.
func (h *OrgEntityHandler) ImportTemplate(w http.ResponseWriter, r *http.Request) {
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	sample, err := strconv.ParseBool(strings.TrimSpace(r.URL.Query().Get("sample")))
	if err != nil && strings.TrimSpace(r.URL.Query().Get("sample")) != "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "sample must be true or false", nil)
		return
	}
	rows := [][]string{}
	suffix := "template"
	if sample {
		rows = orgImportSampleRows
		suffix = "filled-sample"
	}
	headers := orgImportTemplateHeaders
	if sample {
		headers = orgImportSampleHeaders
	}
	switch format {
	case "xlsx", "":
		writeSimpleXLSX(w, "watheeq-org-structure-"+suffix+".xlsx", "Org Structure", headers, rows)
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="watheeq-org-structure-`+suffix+`.csv"`)
		writer := csv.NewWriter(w)
		_ = writer.Write(headers)
		_ = writer.WriteAll(rows)
	case "json":
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="watheeq-org-structure-`+suffix+`.json"`)
		if sample {
			_, _ = w.Write(orgImportSampleJSON)
		} else {
			_, _ = w.Write([]byte(`[
  {"code":"","parent_code":"","entity_type":"department","name":{"en":"","ar":""},"active":true,"platform_org_unit_id":null,"manager_user_id":null,"roles":[],"employees":[],"metadata":{}}
]`))
		}
	default:
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "format must be xlsx, csv, or json", nil)
	}
}

func (h *OrgEntityHandler) ImportStructure(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.OrgStructureImportRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid import request", nil)
		return
	}
	job, err := h.service.ImportStructure(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, job)
}

func (h *OrgEntityHandler) ListImports(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	jobs, err := h.service.ListImportJobs(r.Context(), tenantID, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, jobs)
}

func (h *OrgEntityHandler) GetImport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "jobId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	job, err := h.service.GetImportJob(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, job)
}

func (h *OrgEntityHandler) ImportErrors(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "jobId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	job, err := h.service.GetImportJob(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "json") {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="org-import-errors.json"`)
		_ = json.NewEncoder(w).Encode(job.Errors)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="org-import-errors.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"row", "code", "field", "error_code", "message"})
	for _, issue := range job.Errors {
		_ = writer.Write([]string{strconv.Itoa(issue.Row), issue.Code, issue.Field, issue.CodeKey, issue.Message})
	}
	writer.Flush()
}

func parseOrgEntityListFilters(r *http.Request) (model.OrgEntityListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, orgEntitySortColumns, "updated_at", "desc")
	parentID, err := parseOptionalUUID(r.URL.Query().Get("parent_id"))
	if err != nil {
		return model.OrgEntityListFilters{}, fmt.Errorf("invalid parent_id")
	}
	filters := model.OrgEntityListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		ParentID:      parentID,
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if entityType := strings.TrimSpace(r.URL.Query().Get("entity_type")); entityType != "" {
		value := model.OrgEntityType(entityType)
		filters.EntityType = &value
	}
	if active := strings.TrimSpace(r.URL.Query().Get("active")); active != "" {
		parsed, parseErr := strconv.ParseBool(active)
		if parseErr != nil {
			return model.OrgEntityListFilters{}, fmt.Errorf("invalid active")
		}
		filters.Active = &parsed
	}
	return filters, nil
}
