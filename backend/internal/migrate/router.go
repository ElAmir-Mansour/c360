package migrate

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

type migrateService interface {
	Product(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductResponse, error)
	CreateProgram(ctx context.Context, tenantID uuid.UUID, in CreateProgramInput) (*Program, error)
	ListPrograms(ctx context.Context, tenantID uuid.UUID, actor Actor, status *ProgramStatus, limit, offset int) ([]Program, int, error)
	GetProgram(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*Program, error)
	UpsertWorkload(ctx context.Context, tenantID, programID uuid.UUID, in WorkloadInput, actor Actor) (*Workload, error)
	ImportWorkloadsCSV(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, r io.Reader) (*ImportResult, error)
	ListWorkloads(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, query string, status *WorkloadStatus, limit, offset int) ([]Workload, int, error)
	CreateMoveGroup(ctx context.Context, tenantID uuid.UUID, in CreateMoveGroupInput) (*MoveGroup, error)
	ListMoveGroups(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]MoveGroup, int, error)
	SuggestMoveGroup(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, seedAppKeys []string) ([]string, error)
	ValidateMoveGroupCompleteness(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, expectedVersion int) (*MoveGroup, error)
	SubmitMoveGroup(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, expectedVersion int) (*MoveGroup, error)
	DecideMoveGroup(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor, approved bool, rationale string, expectedVersion int, allowOverride bool) (*MoveGroup, error)
	RequestMoveGroupApproval(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor) (*ApprovalStatus, error)
	SyncMoveGroupApproval(ctx context.Context, tenantID, moveGroupID uuid.UUID, actor Actor) (*MoveGroup, error)
	ApplyApprovalCallback(ctx context.Context, tenantID uuid.UUID, instanceID string, actorHint *uuid.UUID) (*ApprovalBinding, error)
	ApprovalsConfigured() bool
	CreateWave(ctx context.Context, tenantID uuid.UUID, in CreateWaveInput) (*Wave, error)
	ListWaves(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]Wave, int, error)
	GetWave(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*Wave, error)
	CriticalPathForWave(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*CriticalPath, error)
	WaveDependencyGraph(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*DependencyGraph, error)
	GenerateWaveRunbook(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*WaveRunbook, error)
	GetWaveRunbook(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*WaveRunbook, error)
	StartWindowRun(ctx context.Context, tenantID, windowID uuid.UUID, mode string, actor Actor) (*WindowRun, error)
	ActOnWindowTask(ctx context.Context, tenantID, windowID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool, actor Actor) (*WindowRun, error)
	GetWindowRun(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*WindowRun, error)
	GenerateRollbackRunbook(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RunbookBinding, error)
	ExecuteRollback(ctx context.Context, tenantID, windowID uuid.UUID, reason, mode string, actor Actor) (*RollbackRun, error)
	GetRollbackRun(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RollbackRun, *DRRunLiveState, error)
	TransitionWorkload(ctx context.Context, tenantID, workloadID uuid.UUID, to WorkloadStatus, expectedVersion int, reason string, actor Actor) (*Workload, error)
	RollbackCutover(ctx context.Context, tenantID, windowID uuid.UUID, reason string, actor Actor) (*CutoverWindow, error)
	CreateWindow(ctx context.Context, tenantID uuid.UUID, in CreateWindowInput) (*CutoverWindow, []CutoverWindow, error)
	ListWindows(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, limit, offset int) ([]CutoverWindow, int, error)
	DecideGoNoGo(ctx context.Context, tenantID uuid.UUID, in DecisionInput) (*CutoverWindow, error)
	StartCutover(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*CutoverWindow, error)
	CompleteCutover(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*CutoverWindow, error)
	GetRollbackPlan(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RollbackPlan, error)
	UpsertRollbackPlan(ctx context.Context, tenantID uuid.UUID, plan RollbackPlan, actor Actor) (*RollbackPlan, error)
	DecideRollbackPlan(ctx context.Context, tenantID uuid.UUID, in DecisionInput) (*RollbackPlan, error)
	CreateGateCheck(ctx context.Context, tenantID uuid.UUID, check GateCheck, actor Actor) (*GateCheck, error)
	ListGateChecks(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor, kind *CheckKind) ([]GateCheck, error)
	RecordGateCheck(ctx context.Context, tenantID, checkID uuid.UUID, actor Actor, status CheckStatus, evidence, result string) (*GateCheck, error)
	CommandCenter(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*CommandCenter, error)
	ProgramStatusSummary(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*ProgramStatusSummary, error)
	SaveConnector(ctx context.Context, tenantID uuid.UUID, in SaveConnectorInput) (*ConnectorConfig, error)
	ListConnectors(ctx context.Context, tenantID uuid.UUID, actor Actor) ([]ConnectorConfig, error)
	InvokeConnector(ctx context.Context, tenantID uuid.UUID, in InvokeConnectorInput) (*ConnectorInvocation, error)
	InvokeConnectorFromRun(ctx context.Context, in RunConnectorInvocation) (*ConnectorInvocation, error)
	ExportEvidence(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, format string) (*EvidenceExport, error)
	EvidenceReport(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*EvidenceReport, error)
}

type Router struct {
	svc    migrateService
	logger zerolog.Logger
}

func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "migrate").Logger()}
}

func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateRead))
		r.Get("/product", h.product)
		r.Get("/programs", h.listPrograms)
		r.Get("/programs/{programID}", h.getProgram)
		r.Get("/programs/{programID}/workloads", h.listWorkloads)
		r.Get("/programs/{programID}/move-groups", h.listMoveGroups)
		r.Get("/programs/{programID}/waves", h.listWaves)
		r.Get("/programs/{programID}/windows", h.listWindows)
		r.Get("/programs/{programID}/command-center", h.commandCenter)
		r.Get("/programs/{programID}/status-summary", h.statusSummary)
		r.Get("/waves/{waveID}", h.getWave)
		r.Get("/waves/{waveID}/critical-path", h.criticalPath)
		r.Get("/waves/{waveID}/dependency-graph", h.dependencyGraph)
		r.Get("/waves/{waveID}/runbook", h.getWaveRunbook)
		r.Get("/windows/{windowID}/run", h.getWindowRun)
		r.Get("/windows/{windowID}/rollback/run", h.getRollbackRun)
		r.Get("/windows/{windowID}/rollback-plan", h.getRollbackPlan)
		r.Get("/windows/{windowID}/gate-checks", h.listGateChecks)
		r.Get("/connectors", h.listConnectors)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigratePlan))
		r.Post("/programs", h.createProgram)
		r.Post("/programs/{programID}/workloads", h.upsertWorkload)
		r.Post("/programs/{programID}/workloads/import", h.importWorkloads)
		r.Post("/programs/{programID}/move-groups", h.createMoveGroup)
		r.Post("/programs/{programID}/move-groups/suggestions", h.suggestMoveGroup)
		r.Post("/move-groups/{moveGroupID}/validate", h.validateMoveGroup)
		r.Post("/move-groups/{moveGroupID}/submit", h.submitMoveGroup)
		// H2: explicitly (re)open the shared-workflow-engine approval for a submitted
		// move group. Planning permission is enough to REQUEST an approval; the
		// decision itself requires migrate:approve and comes from the workflow.
		r.Post("/move-groups/{moveGroupID}/request-approval", h.requestMoveGroupApproval)
		r.Post("/programs/{programID}/waves", h.createWave)
		r.Post("/waves/{waveID}/generate-runbook", h.generateWaveRunbook)
		r.Post("/programs/{programID}/windows", h.createWindow)
		r.Post("/windows/{windowID}/rollback-plan", h.upsertRollbackPlan)
		r.Post("/windows/{windowID}/gate-checks", h.createGateCheck)
		r.Post("/workloads/{workloadID}/transition", h.transitionWorkload)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateApprove))
		// H2: the local decision is now the GUARDED manual-override break-glass path
		// (refused / admin-gated when the workflow engine is wired).
		r.Post("/move-groups/{moveGroupID}/decision", h.decideMoveGroup)
		// H2: pull the workflow's decision and apply it to the migrate FSM (the
		// primary, non-bypass approval path when the engine is configured).
		r.Post("/move-groups/{moveGroupID}/sync-approval", h.syncMoveGroupApproval)
		r.Post("/windows/{windowID}/go-no-go", h.decideGoNoGo)
		r.Post("/rollback-plans/{rollbackPlanID}/decision", h.decideRollbackPlan)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateCutover))
		r.Post("/windows/{windowID}/start", h.startCutover)
		r.Post("/windows/{windowID}/complete", h.completeCutover)
		r.Post("/windows/{windowID}/start-run", h.startWindowRun)
		// Verb-suffixed task action (mirrors the DR Studio contract):
		// POST /windows/{windowID}/tasks/{taskID}:complete|:skip|:fail
		r.Post("/windows/{windowID}/tasks/{taskAction}", h.actOnWindowTask)
		r.Post("/gate-checks/{checkID}/result", h.recordGateCheck)
		r.Post("/connectors/{connectorID}/invoke", h.invokeConnector)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateRollback))
		r.Post("/windows/{windowID}/rollback", h.rollbackCutover)
		r.Post("/windows/{windowID}/rollback/generate-runbook", h.generateRollbackRunbook)
		r.Post("/windows/{windowID}/rollback/execute", h.executeRollback)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateIntegrations))
		r.Post("/connectors", h.saveConnector)
	})
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermMigrateEvidenceExport))
		r.Get("/programs/{programID}/evidence", h.exportEvidence)
		// P10b: the STRUCTURED, regulator-ready evidence report (sectioned document,
		// not a flat audit-row dump). ?format=json (default) returns the machine-
		// readable document; ?format=pdf renders the same structured document as a
		// sectioned PDF (not a truncated 120-row table).
		r.Get("/programs/{programID}/evidence-report", h.evidenceReport)
	})
	return r
}

// InternalRoutes returns the service-token-guarded callback surface (H2). The
// workflow engine (or its notification consumer) POSTs here when an approval
// workflow instance completes; migrate re-reads the instance to confirm the
// decision and drives its own FSM. It is mounted separately (NOT behind the user
// JWT) under ServiceToken auth so a trusted backend — not an end user — invokes it.
func (h *Router) InternalRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/approve-callback", h.approveCallback)
	return r
}

// WebhookRoutes returns the connector-invocation webhook the DR Runbook Studio
// engine's Executor calls when a generated AUTOMATED connector task runs (Wave 6,
// P10a). It is mounted SEPARATELY from InternalRoutes because the DR Executor's
// HTTP action runner posts only a JSON body (no headers), so it CANNOT satisfy
// the X-Service-Token header middleware. The invocation is instead authenticated
// by the per-task webhook token carried in the request body params, which
// InvokeConnectorFromRun compares in constant time. The token is a shared secret
// stored only in dr_db behind that tenant's runbook, so it is not user-exposed.
func (h *Router) WebhookRoutes() chi.Router {
	r := chi.NewRouter()
	r.Post("/connectors/invoke", h.invokeConnectorFromRun)
	return r
}

// invokeConnectorFromRun is the DR-engine → migrate connector webhook. The DR
// Runbook Studio Executor POSTs the automated task context (tenant/run/task ids +
// the task params) here; migrate resolves the configured connector from the
// params and invokes it, persisting the outcome. A failure surfaces as a non-2xx
// so the DR engine fails the automated task (the connector is a real gate).
func (h *Router) invokeConnectorFromRun(w http.ResponseWriter, r *http.Request) {
	var req RunConnectorInvocation
	if !h.decode(w, r, &req) {
		return
	}
	inv, err := h.svc.InvokeConnectorFromRun(r.Context(), req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inv)
}

// approveCallback is the workflow-engine → migrate webhook. Body carries the
// workflow_instance_id and (optionally) the approver actor. The tenant travels in
// X-Tenant-ID. Migrate NEVER trusts a decision field in this body — it re-reads
// the instance from the engine — so a forged/replayed callback cannot flip an
// approval.
func (h *Router) approveCallback(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID           string `json:"tenant_id"`
		WorkflowInstanceID string `json:"workflow_instance_id"`
		DecidedBy          string `json:"decided_by,omitempty"`
	}
	if !h.decode(w, r, &req) {
		return
	}
	tenantRaw := strings.TrimSpace(req.TenantID)
	if tenantRaw == "" {
		tenantRaw = strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	}
	tenantID, err := uuid.Parse(tenantRaw)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "a valid tenant_id (body or X-Tenant-ID) is required", nil)
		return
	}
	if strings.TrimSpace(req.WorkflowInstanceID) == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "workflow_instance_id is required", nil)
		return
	}
	var actorHint *uuid.UUID
	if id, perr := uuid.Parse(strings.TrimSpace(req.DecidedBy)); perr == nil && id != uuid.Nil {
		actorHint = &id
	}
	binding, err := h.svc.ApplyApprovalCallback(r.Context(), tenantID, req.WorkflowInstanceID, actorHint)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, binding)
}

type createProgramRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Owner       string `json:"owner"`
}

func (h *Router) product(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	product, err := h.svc.Product(r.Context(), tenantID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, product)
}

func (h *Router) createProgram(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req createProgramRequest
	if !h.decode(w, r, &req) {
		return
	}
	program, err := h.svc.CreateProgram(r.Context(), tenantID, CreateProgramInput{Name: req.Name, Description: req.Description, Owner: req.Owner, Actor: h.actor(r)})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, program)
}

func (h *Router) listPrograms(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	var status *ProgramStatus
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		s := ProgramStatus(raw)
		status = &s
	}
	programs, total, err := h.svc.ListPrograms(r.Context(), tenantID, h.actor(r), status, perPage, (page-1)*perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, programs, page, perPage, total)
}

func (h *Router) getProgram(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	program, err := h.svc.GetProgram(r.Context(), tenantID, programID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, program)
}

func (h *Router) upsertWorkload(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	var req WorkloadInput
	if !h.decode(w, r, &req) {
		return
	}
	workload, err := h.svc.UpsertWorkload(r.Context(), tenantID, programID, req, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, workload)
}

func (h *Router) importWorkloads(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	result, err := h.svc.ImportWorkloadsCSV(r.Context(), tenantID, programID, h.actor(r), r.Body)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

func (h *Router) listWorkloads(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	var status *WorkloadStatus
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" {
		s := WorkloadStatus(raw)
		status = &s
	}
	items, total, err := h.svc.ListWorkloads(r.Context(), tenantID, programID, h.actor(r), strings.TrimSpace(r.URL.Query().Get("q")), status, perPage, (page-1)*perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

type moveGroupRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Constraints string   `json:"constraints"`
	AppKeys     []string `json:"app_keys"`
}

func (h *Router) createMoveGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	var req moveGroupRequest
	if !h.decode(w, r, &req) {
		return
	}
	group, err := h.svc.CreateMoveGroup(r.Context(), tenantID, CreateMoveGroupInput{ProgramID: programID, Name: req.Name, Description: req.Description, Constraints: req.Constraints, AppKeys: req.AppKeys, Actor: h.actor(r)})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, group)
}

func (h *Router) listMoveGroups(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.svc.ListMoveGroups(r.Context(), tenantID, programID, h.actor(r), perPage, (page-1)*perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *Router) suggestMoveGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	var req struct {
		AppKeys []string `json:"app_keys"`
	}
	if !h.decode(w, r, &req) {
		return
	}
	keys, err := h.svc.SuggestMoveGroup(r.Context(), tenantID, programID, h.actor(r), req.AppKeys)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"app_keys": keys})
}

func (h *Router) validateMoveGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, moveGroupID, ok := h.tenantAndUUID(w, r, "moveGroupID")
	if !ok {
		return
	}
	var req versionRequest
	if !h.decode(w, r, &req) {
		return
	}
	group, err := h.svc.ValidateMoveGroupCompleteness(r.Context(), tenantID, moveGroupID, h.actor(r), req.ExpectedVersion)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, group)
}

func (h *Router) submitMoveGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, moveGroupID, ok := h.tenantAndUUID(w, r, "moveGroupID")
	if !ok {
		return
	}
	var req versionRequest
	if !h.decode(w, r, &req) {
		return
	}
	group, err := h.svc.SubmitMoveGroup(r.Context(), tenantID, moveGroupID, h.actor(r), req.ExpectedVersion)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, group)
}

func (h *Router) decideMoveGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, moveGroupID, ok := h.tenantAndUUID(w, r, "moveGroupID")
	if !ok {
		return
	}
	var req struct {
		Approved        bool   `json:"approved"`
		Rationale       string `json:"rationale"`
		ExpectedVersion int    `json:"expected_version"`
		// AllowOverride is the explicit break-glass opt-in. It is ignored (a plain
		// decision) when no workflow engine is configured; when one IS configured it
		// is the ONLY way a local flip is permitted (and requires migrate:admin).
		AllowOverride bool `json:"allow_override"`
	}
	if !h.decode(w, r, &req) {
		return
	}
	group, err := h.svc.DecideMoveGroup(r.Context(), tenantID, moveGroupID, h.actor(r), req.Approved, req.Rationale, req.ExpectedVersion, req.AllowOverride)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, group)
}

// requestMoveGroupApproval (H2) opens the shared-workflow-engine approval for a
// submitted move group and returns the approval status (move group + binding).
func (h *Router) requestMoveGroupApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, moveGroupID, ok := h.tenantAndUUID(w, r, "moveGroupID")
	if !ok {
		return
	}
	status, err := h.svc.RequestMoveGroupApproval(r.Context(), tenantID, moveGroupID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, status)
}

// syncMoveGroupApproval (H2) pulls the bound workflow instance's decision and, if
// terminal, applies it to the migrate FSM. Returns 409 (approval_pending) while
// the workflow is still running.
func (h *Router) syncMoveGroupApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, moveGroupID, ok := h.tenantAndUUID(w, r, "moveGroupID")
	if !ok {
		return
	}
	group, err := h.svc.SyncMoveGroupApproval(r.Context(), tenantID, moveGroupID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, group)
}

type waveRequest struct {
	Name                   string      `json:"name"`
	Description            string      `json:"description"`
	Sequence               int         `json:"sequence"`
	ParentRunbookID        *uuid.UUID  `json:"parent_runbook_id"`
	PlannedDurationSeconds int         `json:"planned_duration_seconds"`
	MoveGroupIDs           []uuid.UUID `json:"move_group_ids"`
}

func (h *Router) createWave(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	var req waveRequest
	if !h.decode(w, r, &req) {
		return
	}
	wave, err := h.svc.CreateWave(r.Context(), tenantID, CreateWaveInput{ProgramID: programID, Name: req.Name, Description: req.Description, Sequence: req.Sequence, ParentRunbookID: req.ParentRunbookID, PlannedDurationSeconds: req.PlannedDurationSeconds, MoveGroupIDs: req.MoveGroupIDs, Actor: h.actor(r)})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, wave)
}

func (h *Router) listWaves(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.svc.ListWaves(r.Context(), tenantID, programID, h.actor(r), perPage, (page-1)*perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *Router) getWave(w http.ResponseWriter, r *http.Request) {
	tenantID, waveID, ok := h.tenantAndUUID(w, r, "waveID")
	if !ok {
		return
	}
	wave, err := h.svc.GetWave(r.Context(), tenantID, waveID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, wave)
}

func (h *Router) criticalPath(w http.ResponseWriter, r *http.Request) {
	tenantID, waveID, ok := h.tenantAndUUID(w, r, "waveID")
	if !ok {
		return
	}
	cp, err := h.svc.CriticalPathForWave(r.Context(), tenantID, waveID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cp)
}

// dependencyGraph returns the wave's move-group / workload dependency graph in a
// react-flow-renderable shape (nodes + edges + topo order), overlaying the DR
// topology for any DR-bound move group. Read-only, gated on migrate:read.
func (h *Router) dependencyGraph(w http.ResponseWriter, r *http.Request) {
	tenantID, waveID, ok := h.tenantAndUUID(w, r, "waveID")
	if !ok {
		return
	}
	graph, err := h.svc.WaveDependencyGraph(r.Context(), tenantID, waveID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, graph)
}

// generateWaveRunbook builds a real DR Runbook Studio runbook for the wave (a
// parent runbook + a child runbook per move group) and persists the binding.
func (h *Router) generateWaveRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, waveID, ok := h.tenantAndUUID(w, r, "waveID")
	if !ok {
		return
	}
	out, err := h.svc.GenerateWaveRunbook(r.Context(), tenantID, waveID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

// getWaveRunbook returns the generated runbook binding for a wave plus the live
// engine state so the UI can render the generated structure and run progress.
func (h *Router) getWaveRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, waveID, ok := h.tenantAndUUID(w, r, "waveID")
	if !ok {
		return
	}
	out, err := h.svc.GetWaveRunbook(r.Context(), tenantID, waveID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

type windowRequest struct {
	Name        string     `json:"name"`
	WindowType  WindowType `json:"window_type"`
	StartsAt    time.Time  `json:"starts_at"`
	EndsAt      time.Time  `json:"ends_at"`
	Constraints string     `json:"constraints"`
	WaveID      uuid.UUID  `json:"wave_id"`
}

func (h *Router) createWindow(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	var req windowRequest
	if !h.decode(w, r, &req) {
		return
	}
	window, conflicts, err := h.svc.CreateWindow(r.Context(), tenantID, CreateWindowInput{ProgramID: programID, WaveID: req.WaveID, Name: req.Name, WindowType: req.WindowType, StartsAt: req.StartsAt, EndsAt: req.EndsAt, Constraints: req.Constraints, Actor: h.actor(r)})
	if err != nil {
		if errors.Is(err, ErrWindowConflict) {
			suiteapi.WriteError(w, r, http.StatusConflict, "window_conflict", err.Error(), map[string]any{"conflicts": conflicts})
			return
		}
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, window)
}

func (h *Router) listWindows(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.svc.ListWindows(r.Context(), tenantID, programID, h.actor(r), perPage, (page-1)*perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *Router) decideGoNoGo(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var req decisionRequest
	if !h.decode(w, r, &req) {
		return
	}
	window, err := h.svc.DecideGoNoGo(r.Context(), tenantID, DecisionInput{ID: windowID, Decision: req.Decision, Rationale: req.Rationale, ExpectedVersion: req.ExpectedVersion, Actor: h.actor(r)})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, window)
}

func (h *Router) startCutover(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	window, err := h.svc.StartCutover(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, window)
}

func (h *Router) completeCutover(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	window, err := h.svc.CompleteCutover(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, window)
}

func (h *Router) transitionWorkload(w http.ResponseWriter, r *http.Request) {
	tenantID, workloadID, ok := h.tenantAndUUID(w, r, "workloadID")
	if !ok {
		return
	}
	var req struct {
		Status          WorkloadStatus `json:"status"`
		ExpectedVersion int            `json:"expected_version"`
		Reason          string         `json:"reason"`
	}
	if !h.decode(w, r, &req) {
		return
	}
	workload, err := h.svc.TransitionWorkload(r.Context(), tenantID, workloadID, req.Status, req.ExpectedVersion, req.Reason, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, workload)
}

func (h *Router) rollbackCutover(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	// Body is optional for rollback; tolerate an empty request body.
	if r.ContentLength != 0 {
		if !h.decode(w, r, &req) {
			return
		}
	}
	window, err := h.svc.RollbackCutover(r.Context(), tenantID, windowID, req.Reason, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, window)
}

// startWindowRun starts a live DR run of the wave's generated cutover runbook and
// persists the DR run id onto the window + binding.
func (h *Router) startWindowRun(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var req struct {
		Mode string `json:"mode"`
	}
	if r.ContentLength != 0 {
		if !h.decode(w, r, &req) {
			return
		}
	}
	out, err := h.svc.StartWindowRun(r.Context(), tenantID, windowID, strings.TrimSpace(req.Mode), h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

// actOnWindowTask proxies a complete/skip/fail action onto one task of the
// window's live cutover run. The verb is carried as a ':<action>' suffix on the
// task path segment (tasks/{taskID}:complete|skip|fail), matching the DR Studio
// contract; chi treats the ':' as part of the path segment so we split it here.
func (h *Router) actOnWindowTask(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	raw := chi.URLParam(r, "taskAction")
	idStr, verb, found := strings.Cut(raw, ":")
	if !found {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "task action must be of the form {taskID}:complete|skip|fail", nil)
		return
	}
	taskID, err := uuid.Parse(idStr)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid task id", nil)
		return
	}
	action := DRTaskAction(verb)
	if !action.Valid() {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "action must be complete, skip, or fail", nil)
		return
	}
	var req struct {
		Note    string `json:"note"`
		FailRun bool   `json:"fail_run"`
	}
	if r.ContentLength != 0 {
		if !h.decode(w, r, &req) {
			return
		}
	}
	out, err := h.svc.ActOnWindowTask(r.Context(), tenantID, windowID, taskID, action, req.Note, req.FailRun, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// getWindowRun returns the live cutover run state for a window plus its binding.
func (h *Router) getWindowRun(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	out, err := h.svc.GetWindowRun(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// generateRollbackRunbook authors an isolated rollback runbook in the DR engine.
func (h *Router) generateRollbackRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	binding, err := h.svc.GenerateRollbackRunbook(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, binding)
}

// executeRollback records the trigger provenance and starts the rollback run.
func (h *Router) executeRollback(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
		Mode   string `json:"mode"`
	}
	if r.ContentLength != 0 {
		if !h.decode(w, r, &req) {
			return
		}
	}
	run, err := h.svc.ExecuteRollback(r.Context(), tenantID, windowID, req.Reason, strings.TrimSpace(req.Mode), h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, run)
}

// getRollbackRun returns the rollback-run provenance + its live DR run state.
func (h *Router) getRollbackRun(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	run, live, err := h.svc.GetRollbackRun(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"rollback_run": run, "live_state": live})
}

func (h *Router) getRollbackPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	plan, err := h.svc.GetRollbackPlan(r.Context(), tenantID, windowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *Router) upsertRollbackPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var plan RollbackPlan
	if !h.decode(w, r, &plan) {
		return
	}
	plan.WindowID = windowID
	out, err := h.svc.UpsertRollbackPlan(r.Context(), tenantID, plan, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) decideRollbackPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, planID, ok := h.tenantAndUUID(w, r, "rollbackPlanID")
	if !ok {
		return
	}
	var req decisionRequest
	if !h.decode(w, r, &req) {
		return
	}
	plan, err := h.svc.DecideRollbackPlan(r.Context(), tenantID, DecisionInput{ID: planID, Decision: req.Decision, Rationale: req.Rationale, ExpectedVersion: req.ExpectedVersion, Actor: h.actor(r)})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *Router) createGateCheck(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var check GateCheck
	if !h.decode(w, r, &check) {
		return
	}
	check.WindowID = windowID
	out, err := h.svc.CreateGateCheck(r.Context(), tenantID, check, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

func (h *Router) listGateChecks(w http.ResponseWriter, r *http.Request) {
	tenantID, windowID, ok := h.tenantAndUUID(w, r, "windowID")
	if !ok {
		return
	}
	var kind *CheckKind
	if value := strings.TrimSpace(r.URL.Query().Get("kind")); value != "" {
		parsed := CheckKind(value)
		if !parsed.Valid() {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "invalid_check_kind", "check kind is not supported", nil)
			return
		}
		kind = &parsed
	}
	checks, err := h.svc.ListGateChecks(r.Context(), tenantID, windowID, h.actor(r), kind)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, checks)
}

func (h *Router) recordGateCheck(w http.ResponseWriter, r *http.Request) {
	tenantID, checkID, ok := h.tenantAndUUID(w, r, "checkID")
	if !ok {
		return
	}
	var req struct {
		Status   CheckStatus `json:"status"`
		Evidence string      `json:"evidence"`
		Result   string      `json:"result"`
	}
	if !h.decode(w, r, &req) {
		return
	}
	check, err := h.svc.RecordGateCheck(r.Context(), tenantID, checkID, h.actor(r), req.Status, req.Evidence, req.Result)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, check)
}

func (h *Router) commandCenter(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	cc, err := h.svc.CommandCenter(r.Context(), tenantID, programID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cc)
}

// statusSummary returns a concise program-level executive status view (waves with
// %complete + run status, blockers, current run, variance) for stakeholders.
// Read-only, gated on migrate:read.
func (h *Router) statusSummary(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	summary, err := h.svc.ProgramStatusSummary(r.Context(), tenantID, programID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, summary)
}

func (h *Router) saveConnector(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req SaveConnectorInput
	if !h.decode(w, r, &req) {
		return
	}
	req.Actor = h.actor(r)
	cfg, err := h.svc.SaveConnector(r.Context(), tenantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, cfg)
}

func (h *Router) listConnectors(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	connectors, err := h.svc.ListConnectors(r.Context(), tenantID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, connectors)
}

func (h *Router) invokeConnector(w http.ResponseWriter, r *http.Request) {
	tenantID, connectorID, ok := h.tenantAndUUID(w, r, "connectorID")
	if !ok {
		return
	}
	var req InvokeConnectorInput
	if !h.decode(w, r, &req) {
		return
	}
	req.ConnectorID = connectorID
	req.Actor = h.actor(r)
	inv, err := h.svc.InvokeConnector(r.Context(), tenantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, inv)
}

func (h *Router) exportEvidence(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "csv"
	}
	export, err := h.svc.ExportEvidence(r.Context(), tenantID, programID, h.actor(r), format)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", export.ContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+export.Filename+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(export.Body)
}

// evidenceReport serves the STRUCTURED, regulator-ready evidence report for a
// program (P10b). ?format=json (default) returns the machine-readable document;
// ?format=pdf renders the same sectioned document as a downloadable PDF.
func (h *Router) evidenceReport(w http.ResponseWriter, r *http.Request) {
	tenantID, programID, ok := h.tenantAndUUID(w, r, "programID")
	if !ok {
		return
	}
	report, err := h.svc.EvidenceReport(r.Context(), tenantID, programID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "pdf" {
		export, perr := buildStructuredPDFReport(report)
		if perr != nil {
			h.writeError(w, r, perr)
			return
		}
		w.Header().Set("Content-Type", export.ContentType)
		w.Header().Set("Content-Disposition", `attachment; filename="`+export.Filename+`"`)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(export.Body)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

type versionRequest struct {
	ExpectedVersion int `json:"expected_version"`
}

type decisionRequest struct {
	Decision        Decision `json:"decision"`
	Rationale       string   `json:"rationale"`
	ExpectedVersion int      `json:"expected_version"`
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) tenantAndUUID(w http.ResponseWriter, r *http.Request, param string) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	id, err := suiteapi.UUIDParam(r, param)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, id, true
}

func (h *Router) actor(r *http.Request) Actor {
	userID, _ := suiteapi.UserID(r)
	if userID == nil {
		return Actor{}
	}
	user := auth.UserFromContext(r.Context())
	perms := []string{
		PermMigrateRead,
		PermMigratePlan,
		PermMigrateApprove,
		PermMigrateCutover,
		PermMigrateRollback,
		PermMigrateIntegrations,
		PermMigrateEvidenceExport,
		PermMigrateAdmin,
	}
	granted := make([]string, 0, len(perms))
	for _, perm := range perms {
		if user != nil && auth.HasPermission(user.Roles, perm) {
			granted = append(granted, perm)
		}
	}
	return Actor{UserID: *userID, Permission: granted}
}

func (h *Router) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := suiteapi.DecodeJSON(r, dst); err != nil {
		var syntax *json.SyntaxError
		if errors.As(err, &syntax) {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_json", "request body contains invalid JSON", nil)
			return false
		}
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return false
	}
	return true
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnauthorized):
		suiteapi.WriteError(w, r, http.StatusForbidden, "forbidden", err.Error(), nil)
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable", "unable to verify license entitlement", nil)
	case errors.Is(err, ErrVersionConflict):
		suiteapi.WriteError(w, r, http.StatusConflict, "version_conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalidTransition):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_transition", err.Error(), nil)
	case errors.Is(err, ErrWindowConflict):
		suiteapi.WriteError(w, r, http.StatusConflict, "window_conflict", err.Error(), nil)
	case errors.Is(err, ErrCompletenessBlocked), errors.Is(err, ErrApprovalRequired), errors.Is(err, ErrGoNoGoRequired), errors.Is(err, ErrReadinessBlocked), errors.Is(err, ErrValidationBlocked), errors.Is(err, ErrRollbackPlanRequired):
		suiteapi.WriteError(w, r, http.StatusConflict, "gate_blocked", err.Error(), nil)
	case errors.Is(err, ErrValidation), errors.Is(err, ErrInvalidStatus):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrConnectorNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "connector_not_configured", err.Error(), nil)
	case errors.Is(err, ErrConnectorRequestFailed):
		suiteapi.WriteError(w, r, http.StatusBadGateway, "connector_request_failed", err.Error(), nil)
	case errors.Is(err, ErrDRBridgeUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "dr_engine_unavailable", "DR runbook engine is unavailable", nil)
	case errors.Is(err, ErrDRBridgeRejected):
		suiteapi.WriteError(w, r, http.StatusBadGateway, "dr_engine_rejected", err.Error(), nil)
	case errors.Is(err, ErrWorkflowEngineUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "workflow_engine_unavailable", "approval workflow engine is unavailable", nil)
	case errors.Is(err, ErrWorkflowEngineRejected):
		suiteapi.WriteError(w, r, http.StatusBadGateway, "workflow_engine_rejected", err.Error(), nil)
	case errors.Is(err, ErrApprovalNotStarted):
		suiteapi.WriteError(w, r, http.StatusNotFound, "approval_not_started", err.Error(), nil)
	case errors.Is(err, ErrApprovalNotDecided):
		suiteapi.WriteError(w, r, http.StatusConflict, "approval_pending", err.Error(), nil)
	case errors.Is(err, ErrApprovalWorkflowRequired), errors.Is(err, ErrManualOverrideNotAllowed):
		suiteapi.WriteError(w, r, http.StatusForbidden, "approval_workflow_required", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("migrate request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ migrateService = (*Service)(nil)
