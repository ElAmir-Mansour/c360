package handler

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// RoleMatrixHandler exposes the tenant Role-Matrix Import surface
// (Lex_Role_Matrix_Import_Design.md §8): template export, dry-run/commit
// imports, version history and four-eyes activation. Route gating lives in
// routes.go (view tier reads, lex:role:manage writes, distinct-actor on
// activate/rollback).
type RoleMatrixHandler struct {
	baseHandler
	service *service.RoleMatrixService
}

func NewRoleMatrixHandler(svc *service.RoleMatrixService, logger zerolog.Logger) *RoleMatrixHandler {
	return &RoleMatrixHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// csvSafeCell neutralizes spreadsheet formula injection: a cell beginning with
// =, +, -, @ (or a control char) is prefixed with a single quote so Excel/
// Sheets render it as text instead of executing it. Applied to every
// user-derived cell in CSV exports.
func csvSafeCell(value string) string {
	if value == "" {
		return value
	}
	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	}
	return value
}

func csvSafeRow(cells []string) []string {
	out := make([]string, len(cells))
	for i, cell := range cells {
		out[i] = csvSafeCell(cell)
	}
	return out
}

// NewRoleMatrixVersionActorResolver adapts the version author lookup to the
// shared dynamic-SoD guard so RequireDistinctActor can block importer ==
// activator on /versions/{id}/activate and /rollback.
func NewRoleMatrixVersionActorResolver(svc *service.RoleMatrixService) lexmw.ActorRecordResolver {
	return func(ctx context.Context, tenantID, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		createdBy, found, err := svc.VersionActorRecord(ctx, tenantID, recordID)
		if err != nil || !found {
			return lexmw.ActorRecord{}, found, err
		}
		return lexmw.ActorRecord{CreatedBy: createdBy}, true, nil
	}
}

// ImportTemplate serves the grants grid as xlsx (default), csv or json.
// prefilled=true (default) marks the tenant's CURRENT matrix; prefilled=false
// serves a blank grid.
func (h *RoleMatrixHandler) ImportTemplate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	prefilled := true
	if raw := strings.TrimSpace(r.URL.Query().Get("prefilled")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "prefilled must be true or false", nil)
			return
		}
		prefilled = parsed
	}
	template, err := h.service.Template(r.Context(), tenantID, prefilled)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suffix := "current"
	if !prefilled {
		suffix = "blank"
	}
	switch format {
	case "xlsx", "":
		writeSimpleXLSX(w, "watheeq-role-matrix-"+suffix+".xlsx", "Grants", template.Headers, template.Rows)
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="watheeq-role-matrix-`+suffix+`.csv"`)
		writer := csv.NewWriter(w)
		_ = writer.Write(csvSafeRow(template.Headers))
		for _, row := range template.Rows {
			_ = writer.Write(csvSafeRow(row))
		}
		writer.Flush()
	case "json":
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="watheeq-role-matrix-`+suffix+`.json"`)
		_ = json.NewEncoder(w).Encode(template)
	default:
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "format must be xlsx, csv, or json", nil)
	}
}

// Import runs a dry-run validation or commits a draft version.
func (h *RoleMatrixHandler) Import(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.RoleMatrixImportRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid import request", nil)
		return
	}
	var importerRoles []string
	if user := auth.UserFromContext(r.Context()); user != nil {
		importerRoles = user.Roles
	}
	job, err := h.service.Import(r.Context(), tenantID, userID, importerRoles, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, job)
}

func (h *RoleMatrixHandler) ListImports(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	jobs, err := h.service.ListImports(r.Context(), tenantID, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, jobs)
}

func (h *RoleMatrixHandler) GetImport(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "jobId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	job, err := h.service.GetImport(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, job)
}

// ImportErrors streams a job's validation issues as CSV (default) or JSON.
func (h *RoleMatrixHandler) ImportErrors(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "jobId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	job, err := h.service.GetImport(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if strings.EqualFold(r.URL.Query().Get("format"), "json") {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="role-matrix-import-errors.json"`)
		_ = json.NewEncoder(w).Encode(map[string]any{"errors": job.Errors, "warnings": job.Warnings})
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="role-matrix-import-errors.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"severity", "role_slug", "permission", "field", "code", "message"})
	for _, issue := range job.Errors {
		_ = writer.Write(csvSafeRow([]string{"error", issue.RoleSlug, issue.Permission, issue.Field, issue.CodeKey, issue.Message}))
	}
	for _, issue := range job.Warnings {
		_ = writer.Write(csvSafeRow([]string{"warning", issue.RoleSlug, issue.Permission, issue.Field, issue.CodeKey, issue.Message}))
	}
	writer.Flush()
}

func (h *RoleMatrixHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	versions, err := h.service.ListVersions(r.Context(), tenantID, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, versions)
}

func (h *RoleMatrixHandler) GetVersion(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, err := h.service.GetVersion(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, version)
}

// Activate makes a version the tenant's enforced matrix. The route wraps this
// in RequireDistinctActor (importer ≠ activator); rollback re-activates a
// prior version through the same path.
func (h *RoleMatrixHandler) Activate(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	version, err := h.service.Activate(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, version)
}
