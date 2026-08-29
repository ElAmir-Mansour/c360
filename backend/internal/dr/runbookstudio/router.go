package runbookstudio

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// studioService is the surface the HTTP router needs. *Service satisfies it; an
// interface keeps the router unit-testable without a database.
type studioService interface {
	CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateRunbookInput) (*Runbook, []Task, error)
	GetRunbook(ctx context.Context, tenantID uuid.UUID, runbookID string) (Plan, error)
	UpdateRunbook(ctx context.Context, tenantID uuid.UUID, runbookID string, in UpdateRunbookInput) (*Runbook, error)
	AddTask(ctx context.Context, tenantID uuid.UUID, runbookID string, in AddTaskInput) (*Task, error)
	StartRun(ctx context.Context, tenantID uuid.UUID, runbookID string, in StartRunInput) (LiveState, error)
	GetRun(ctx context.Context, tenantID uuid.UUID, runID string) (LiveState, error)
	ActOnTask(ctx context.Context, tenantID uuid.UUID, runID, taskID string, in ActOnTaskInput) (LiveState, error)
}

// Router serves the Runbook Studio HTTP surface. It is mounted by the integration
// phase under /api/v1/dr (alongside the main DR handler) so the endpoints become:
//
//	POST /api/v1/dr/studio/runbooks                          (dr:write)
//	GET  /api/v1/dr/studio/runbooks/{id}                     (dr:read)
//	PUT  /api/v1/dr/studio/runbooks/{id}                     (dr:write)
//	POST /api/v1/dr/studio/runbooks/{id}/tasks               (dr:write) — 409 on cycle
//	POST /api/v1/dr/studio/runbooks/{id}/runs                (dr:failover) — start a run
//	GET  /api/v1/dr/studio/runs/{id}                         (dr:read) — live state + frontier + ETA
//	POST /api/v1/dr/studio/runs/{id}/tasks/{taskID}:complete (dr:failover)
//	POST /api/v1/dr/studio/runs/{id}/tasks/{taskID}:skip     (dr:failover)
//	POST /api/v1/dr/studio/runs/{id}/tasks/{taskID}:fail     (dr:failover)
type Router struct {
	svc    studioService
	logger zerolog.Logger
}

// NewRouter constructs the studio HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-runbook-studio").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc studioService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the studio endpoints, permission-gated to match
// the rest of the DR API: reads require dr:read, authoring requires dr:write, and
// the live-run actions (starting a run, completing/failing tasks) require
// dr:failover since they drive a recovery orchestration.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/studio/runbooks/{runbookID}", h.getRunbook)
		r.Get("/studio/runs/{runID}", h.getRun)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/studio/runbooks", h.createRunbook)
		r.Put("/studio/runbooks/{runbookID}", h.updateRunbook)
		r.Post("/studio/runbooks/{runbookID}/tasks", h.addTask)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/studio/runbooks/{runbookID}/runs", h.startRun)
		// The Cutover-style action endpoints use a verb suffix on the task path
		// (tasks/{taskID}:complete|skip|fail). chi treats the ':' as part of the
		// path segment, so we register one handler per verb and dispatch on it.
		r.Post("/studio/runs/{runID}/tasks/{taskAction}", h.actOnTask)
	})

	return r
}

// ---- request bodies --------------------------------------------------------

type createRunbookRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	GroupID     string `json:"group_id,omitempty"`
	// ImportSteps optionally materializes the runbook from a registry-generated
	// step list as an editable template.
	ImportSteps []importStepRequest `json:"import_steps,omitempty"`
}

type importStepRequest struct {
	Key              string         `json:"key"`
	Name             string         `json:"name"`
	TaskType         string         `json:"task_type,omitempty"`
	Required         bool           `json:"required"`
	Owner            string         `json:"owner,omitempty"`
	Team             string         `json:"team,omitempty"`
	Instructions     string         `json:"instructions,omitempty"`
	PlannedDuration  int            `json:"planned_duration_seconds,omitempty"`
	AutomationAction string         `json:"automation_action,omitempty"`
	Params           map[string]any `json:"params,omitempty"`
}

type updateRunbookRequest struct {
	Name        string `json:"name,omitempty"`
	Description string `json:"description,omitempty"`
	Status      string `json:"status,omitempty"`
}

type addTaskRequest struct {
	TaskKey          string         `json:"task_key"`
	Name             string         `json:"name"`
	TaskType         string         `json:"task_type,omitempty"`
	Required         *bool          `json:"required,omitempty"`
	Owner            string         `json:"owner,omitempty"`
	Team             string         `json:"team,omitempty"`
	Instructions     string         `json:"instructions,omitempty"`
	PlannedDuration  int            `json:"planned_duration_seconds,omitempty"`
	AutomationAction string         `json:"automation_action,omitempty"`
	Predecessors     []string       `json:"predecessors,omitempty"`
	Params           map[string]any `json:"params,omitempty"`
}

type startRunRequest struct {
	Mode string `json:"mode,omitempty"`
}

type actOnTaskRequest struct {
	Note    string `json:"note,omitempty"`
	FailRun bool   `json:"fail_run,omitempty"`
}

// ---- handlers --------------------------------------------------------------

func (h *Router) createRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req createRunbookRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "name is required", nil)
		return
	}
	in := CreateRunbookInput{
		Name:        req.Name,
		Description: req.Description,
		GroupID:     req.GroupID,
		CreatedBy:   userPtr(r),
	}
	for _, st := range req.ImportSteps {
		in.ImportSteps = append(in.ImportSteps, ImportStep{
			Key:              st.Key,
			Name:             st.Name,
			TaskType:         st.TaskType,
			Required:         st.Required,
			Owner:            st.Owner,
			Team:             st.Team,
			Instructions:     st.Instructions,
			PlannedDuration:  st.PlannedDuration,
			AutomationAction: st.AutomationAction,
			Params:           st.Params,
		})
	}
	rb, tasks, err := h.svc.CreateRunbook(r.Context(), tenantID, in)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, map[string]any{"runbook": rb, "tasks": tasks})
}

func (h *Router) getRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, runbookID, ok := h.params(w, r, "runbookID")
	if !ok {
		return
	}
	plan, err := h.svc.GetRunbook(r.Context(), tenantID, runbookID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *Router) updateRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, runbookID, ok := h.params(w, r, "runbookID")
	if !ok {
		return
	}
	var req updateRunbookRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	rb, err := h.svc.UpdateRunbook(r.Context(), tenantID, runbookID.String(), UpdateRunbookInput{
		Name: req.Name, Description: req.Description, Status: req.Status,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rb)
}

func (h *Router) addTask(w http.ResponseWriter, r *http.Request) {
	tenantID, runbookID, ok := h.params(w, r, "runbookID")
	if !ok {
		return
	}
	var req addTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if strings.TrimSpace(req.TaskKey) == "" || strings.TrimSpace(req.Name) == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "task_key and name are required", nil)
		return
	}
	task, err := h.svc.AddTask(r.Context(), tenantID, runbookID.String(), AddTaskInput{
		TaskKey:          req.TaskKey,
		Name:             req.Name,
		TaskType:         req.TaskType,
		Required:         req.Required,
		Owner:            req.Owner,
		Team:             req.Team,
		Instructions:     req.Instructions,
		PlannedDuration:  req.PlannedDuration,
		AutomationAction: req.AutomationAction,
		Predecessors:     req.Predecessors,
		Params:           req.Params,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, task)
}

func (h *Router) startRun(w http.ResponseWriter, r *http.Request) {
	tenantID, runbookID, ok := h.params(w, r, "runbookID")
	if !ok {
		return
	}
	var req startRunRequest
	// The run-start body is optional (mode defaults to live); an empty body (EOF)
	// is fine, only a malformed body is rejected.
	if err := suiteapi.DecodeJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	state, err := h.svc.StartRun(r.Context(), tenantID, runbookID.String(), StartRunInput{
		Mode:      req.Mode,
		StartedBy: userPtr(r),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, state)
}

func (h *Router) getRun(w http.ResponseWriter, r *http.Request) {
	tenantID, runID, ok := h.params(w, r, "runID")
	if !ok {
		return
	}
	state, err := h.svc.GetRun(r.Context(), tenantID, runID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// actOnTask dispatches the verb-suffixed action endpoint
// (tasks/{taskID}:complete|skip|fail). The path parameter "taskAction" carries
// the form "<taskUUID>:<action>"; we split it, validate the UUID and the verb,
// and call the service.
func (h *Router) actOnTask(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
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
	var action TaskAction
	switch verb {
	case "complete":
		action = ActionComplete
	case "skip":
		action = ActionSkip
	case "fail":
		action = ActionFail
	default:
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "action must be complete, skip, or fail", nil)
		return
	}

	var req actOnTaskRequest
	// The action body (note / fail_run) is optional; an empty body (EOF) is fine.
	if derr := suiteapi.DecodeJSON(r, &req); derr != nil && !errors.Is(derr, io.EOF) {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	state, err := h.svc.ActOnTask(r.Context(), tenantID, runID.String(), taskID.String(), ActOnTaskInput{
		Action:  action,
		ActedBy: userPtr(r),
		Note:    req.Note,
		FailRun: req.FailRun,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// ---- helpers ---------------------------------------------------------------

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) params(w http.ResponseWriter, r *http.Request, key string) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	id, err := suiteapi.UUIDParam(r, key)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, id, true
}

func userPtr(r *http.Request) *string {
	uid, err := suiteapi.UserID(r)
	if err != nil || uid == nil {
		return nil
	}
	s := uid.String()
	return &s
}

// writeError maps studio sentinel errors to HTTP statuses. A cycle is the
// load-bearing one (409 Conflict); a not-runnable task is 409 (the operator acted
// on a task whose predecessors are incomplete); not-found is 404; the validation
// errors are 400.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCycle):
		suiteapi.WriteError(w, r, http.StatusConflict, "cycle", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	case errors.Is(err, ErrTaskNotRunnable), errors.Is(err, ErrRunNotActive):
		suiteapi.WriteError(w, r, http.StatusConflict, "not_runnable", err.Error(), nil)
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrGroupNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrUnknownPredecessor), errors.Is(err, ErrInvalidTaskType),
		errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrEmptyRunbook),
		errors.Is(err, ErrApprovalRequired), errors.Is(err, ErrNoExecutor):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr runbook studio request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ studioService = (*Service)(nil)
