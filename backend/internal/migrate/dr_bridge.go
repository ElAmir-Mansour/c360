package migrate

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ErrDRBridgeUnavailable is returned when the DR runbook engine cannot be reached
// (the bridge is not configured, or dr-service is down / returned a transport
// error). Per the hardening design §10 the router maps it to 503 — Migrate
// planning still works, but generating/executing a cutover runbook fails closed.
var ErrDRBridgeUnavailable = errors.New("migrate dr runbook engine is unavailable")

// ErrDRBridgeRejected is returned when dr-service rejected the request with a
// 4xx (e.g. an authoring cycle, 409). The router maps it to 502/the underlying
// status is surfaced in the message so the operator sees the real cause.
var ErrDRBridgeRejected = errors.New("migrate dr runbook engine rejected the request")

// DRRunbook is the Migrate-side projection of a DR Studio runbook returned by the
// bridge. Only the fields Migrate persists/renders are carried; the DR engine
// remains the system of record for the full runbook.
type DRRunbook struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Source      string    `json:"source"`
	Tasks       []DRTask  `json:"tasks"`
}

// DRTask is the Migrate-side projection of a DR Studio task.
type DRTask struct {
	ID                     uuid.UUID `json:"id"`
	TaskKey                string    `json:"task_key"`
	Name                   string    `json:"name"`
	TaskType               string    `json:"task_type"`
	Required               bool      `json:"required"`
	Owner                  string    `json:"owner"`
	Team                   string    `json:"team"`
	PlannedDurationSeconds int       `json:"planned_duration_seconds"`
	Predecessors           []string  `json:"predecessors"`
}

// DR Studio run statuses (mirror runbookstudio.RunStatus*). The bridge carries
// the engine's own status strings so Migrate ties its gates to the REAL run
// lifecycle (the DR engine sets "completed" only when every required task is
// done — see runbookstudio.Service.decideRunOutcome).
const (
	DRRunStatusPending   = "pending"
	DRRunStatusRunning   = "running"
	DRRunStatusCompleted = "completed"
	DRRunStatusFailed    = "failed"
	DRRunStatusAborted   = "aborted"
)

// DR Studio per-task run statuses (mirror runbookstudio.TaskRun*). A required
// task is satisfied only when its status is "complete" (skip is
// frontier-equivalent but does NOT satisfy a required completion).
const (
	DRTaskRunComplete = "complete"
	DRTaskRunSkipped  = "skipped"
	DRTaskRunFailed   = "failed"
)

// DRTaskAction is the verb proxied to the DR Studio task-action endpoint
// (tasks/{taskID}:complete|skip|fail).
type DRTaskAction string

const (
	DRActionComplete DRTaskAction = "complete"
	DRActionSkip     DRTaskAction = "skip"
	DRActionFail     DRTaskAction = "fail"
)

// Valid reports whether a is a recognised task action.
func (a DRTaskAction) Valid() bool {
	return a == DRActionComplete || a == DRActionSkip || a == DRActionFail
}

// DRRunLiveState is the Migrate-side projection of a DR Studio run's live state.
type DRRunLiveState struct {
	RunID                      uuid.UUID       `json:"run_id"`
	RunbookID                  uuid.UUID       `json:"runbook_id"`
	Status                     string          `json:"status"`
	Mode                       string          `json:"mode"`
	PlannedCriticalPathSeconds int             `json:"planned_critical_path_seconds"`
	Frontier                   []string        `json:"frontier"`
	Projection                 DRRunProjection `json:"projection"`
	Tasks                      []DRTask        `json:"tasks"`
	// TaskRuns is the per-task execution state of the run. It is load-bearing for
	// the cutover/rollback validation gate: the gate asserts that every REQUIRED
	// task actually completed, rather than trusting a canned string.
	TaskRuns []DRTaskRun `json:"task_runs"`
}

// DRTaskRun is the Migrate-side projection of a DR Studio per-task run row.
type DRTaskRun struct {
	TaskID                string `json:"task_id"`
	Status                string `json:"status"`
	ActualDurationSeconds *int   `json:"actual_duration_seconds,omitempty"`
}

// Terminal reports whether the run has reached a terminal status (no further
// task actions are possible).
func (s *DRRunLiveState) Terminal() bool {
	if s == nil {
		return false
	}
	return s.Status == DRRunStatusCompleted || s.Status == DRRunStatusFailed || s.Status == DRRunStatusAborted
}

// Succeeded reports whether the run completed successfully. This is the DR
// engine's authoritative "all required work done" signal.
func (s *DRRunLiveState) Succeeded() bool {
	return s != nil && s.Status == DRRunStatusCompleted
}

// Failed reports whether the run terminated in a failed/aborted state.
func (s *DRRunLiveState) Failed() bool {
	if s == nil {
		return false
	}
	return s.Status == DRRunStatusFailed || s.Status == DRRunStatusAborted
}

// RequiredTasksCompleted reports whether every REQUIRED task of the run reached
// the "complete" status (the strict cutover go-criteria: a skipped or failed
// required task does NOT satisfy it). It is computed from the real per-task run
// state the DR engine reports — never a canned answer. Returns false when the
// run carries no task detail (we cannot prove completion).
func (s *DRRunLiveState) RequiredTasksCompleted() bool {
	if s == nil || len(s.Tasks) == 0 {
		return false
	}
	statusByTask := make(map[string]string, len(s.TaskRuns))
	for _, tr := range s.TaskRuns {
		statusByTask[tr.TaskID] = tr.Status
	}
	requiredSeen := false
	for _, t := range s.Tasks {
		if !t.Required {
			continue
		}
		requiredSeen = true
		if statusByTask[t.ID.String()] != DRTaskRunComplete {
			return false
		}
	}
	return requiredSeen
}

// DRRunProjection mirrors the studio run projection (elapsed-vs-planned + ETA).
type DRRunProjection struct {
	PlannedCriticalPathSeconds   int  `json:"planned_critical_path_seconds"`
	ElapsedSeconds               int  `json:"elapsed_seconds"`
	CompletedTasks               int  `json:"completed_tasks"`
	TotalTasks                   int  `json:"total_tasks"`
	RemainingCriticalPathSeconds int  `json:"remaining_critical_path_seconds"`
	ProjectedFinishSeconds       int  `json:"projected_finish_seconds"`
	OnTrack                      bool `json:"on_track"`
	VarianceSeconds              int  `json:"variance_seconds"`
}

// DRImportStep is one task in a runbook the bridge generates. It mirrors the DR
// Studio import-step contract (a registry-shaped editable task). The ordered list
// is chained into a linear predecessor DAG by the DR engine, preserving order.
type DRImportStep struct {
	Key                    string         `json:"key"`
	Name                   string         `json:"name"`
	TaskType               string         `json:"task_type,omitempty"`
	Required               bool           `json:"required"`
	Owner                  string         `json:"owner,omitempty"`
	Team                   string         `json:"team,omitempty"`
	Instructions           string         `json:"instructions,omitempty"`
	PlannedDurationSeconds int            `json:"planned_duration_seconds,omitempty"`
	AutomationAction       string         `json:"automation_action,omitempty"`
	Params                 map[string]any `json:"params,omitempty"`
}

// CreateDRRunbookRequest is the bridge request to author a runbook from a wave's
// generated task structure. GroupID optionally binds the runbook to a DR
// consistency group (the wave's dr_topology_group_id).
type CreateDRRunbookRequest struct {
	Name        string
	Description string
	GroupID     string
	ImportSteps []DRImportStep
}

// DRBridge is the LOAD-BEARING integration boundary between migrate-service and
// the existing DR Runbook Studio + Topology engines. Migrate REUSES the DR engine
// through this seam — it never builds a second runbook engine. Production wires
// HTTPDRBridge (cross-service HTTP, separate process + database); tests substitute
// a fake or an httptest-backed HTTPDRBridge that asserts the real request shape.
type DRBridge interface {
	// CreateRunbook authors a runbook in the DR engine from generated steps and
	// returns the persisted runbook + its tasks (with the DR-assigned IDs).
	CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error)
	// GetRunbook fetches a runbook + tasks by its DR id.
	GetRunbook(ctx context.Context, tenantID, runbookID uuid.UUID) (*DRRunbook, error)
	// StartRun begins a live run of a runbook and returns its initial live state.
	StartRun(ctx context.Context, tenantID, runbookID uuid.UUID, mode string) (*DRRunLiveState, error)
	// GetRun fetches a run's live state (frontier/projection/ETA).
	GetRun(ctx context.Context, tenantID, runID uuid.UUID) (*DRRunLiveState, error)
	// ActOnTask completes/skips/fails one task of a live run and returns the
	// recomputed live state. note is an optional operator annotation; failRun
	// forces the whole run to fail when failing a non-required task.
	ActOnTask(ctx context.Context, tenantID, runID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool) (*DRRunLiveState, error)
	// GetTopology fetches a DR consistency group's dependency graph + topo order.
	GetTopology(ctx context.Context, tenantID, groupID uuid.UUID) (*DRTopology, error)
}

// DRTopology is the Migrate-side projection of a DR topology graph.
type DRTopology struct {
	GroupID   string   `json:"group_id"`
	Nodes     []DRNode `json:"nodes"`
	Edges     []DREdge `json:"edges"`
	TopoOrder []string `json:"topo_order"`
}

// DRNode / DREdge mirror the topology graph vertices/edges Migrate renders.
type DRNode struct {
	ID     string `json:"id"`
	SiteID string `json:"site_id"`
	Role   string `json:"role"`
}

type DREdge struct {
	ID         string `json:"id"`
	FromNodeID string `json:"from_node_id"`
	ToNodeID   string `json:"to_node_id"`
	Mode       string `json:"mode"`
	Health     string `json:"health"`
}

// HTTPDRBridge calls the DR Runbook Studio + Topology HTTP APIs on clario-dr-service
// over an internal base URL with a service-token JWT. It is the production DRBridge.
//
// Cross-service is mandated (hardening design §7): migrate-service (:8100) and
// clario-dr-service (:8080) are separate pm2 processes over separate Postgres
// databases — there is no in-process seam, so the binding MUST be HTTP. The DR
// studio/topology routes require dr:read/dr:write/dr:failover, which the service
// token carries; the tenant is propagated so DR scopes its tenant transaction.
type HTTPDRBridge struct {
	baseURL string
	token   string
	client  *http.Client
}

// NewHTTPDRBridge constructs the production HTTP bridge. baseURL is the internal
// dr-service URL (MIGRATE_DR_SERVICE_URL); token is the service-token JWT
// (MIGRATE_INTERNAL_TOKEN) that authorises the dr:* scoped studio/topology calls.
func NewHTTPDRBridge(baseURL, token string, timeout time.Duration) *HTTPDRBridge {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &HTTPDRBridge{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:   strings.TrimSpace(token),
		client:  &http.Client{Timeout: timeout},
	}
}

// Configured reports whether the bridge has an endpoint to call. When false the
// service surfaces ErrDRBridgeUnavailable rather than dialing an empty URL.
func (b *HTTPDRBridge) Configured() bool {
	return b != nil && b.baseURL != ""
}

// dataEnvelope matches suiteapi.WriteData's {"data": ...} response wrapper used
// by every DR studio/topology handler.
type dataEnvelope struct {
	Data json.RawMessage `json:"data"`
}

// errorEnvelope matches suiteapi.WriteError's error body so a 4xx surfaces its
// real DR reason (e.g. an authoring cycle) instead of an opaque status.
type errorEnvelope struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// createRunbookResponse is the data payload of POST /studio/runbooks:
// {"runbook": Runbook, "tasks": [Task]}.
type createRunbookResponse struct {
	Runbook drRunbookWire `json:"runbook"`
	Tasks   []drTaskWire  `json:"tasks"`
}

// planResponse is the data payload of GET /studio/runbooks/{id}: a Plan
// {"runbook": Runbook, "tasks": [Task]}.
type planResponse struct {
	Runbook drRunbookWire `json:"runbook"`
	Tasks   []drTaskWire  `json:"tasks"`
}

// liveStateResponse is the data payload of POST .../runs, GET /studio/runs/{id},
// and the task-action endpoints (all return the same LiveState).
type liveStateResponse struct {
	Run        drRunWire       `json:"run"`
	Tasks      []drTaskWire    `json:"tasks"`
	TaskRuns   []drTaskRunWire `json:"task_runs"`
	Frontier   []string        `json:"frontier"`
	Projection DRRunProjection `json:"projection"`
}

// topologyResponse is the data payload of GET /groups/{id}/topology.
type topologyResponse struct {
	GroupID   string       `json:"group_id"`
	Nodes     []drNodeWire `json:"nodes"`
	Edges     []drEdgeWire `json:"edges"`
	TopoOrder []string     `json:"topo_order"`
}

// The DR engine serializes its own IDs as string UUIDs (its model uses string
// IDs); the wire structs decode those then we parse into uuid.UUID for Migrate.
type drRunbookWire struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Source      string `json:"source"`
}

type drTaskWire struct {
	ID                     string   `json:"id"`
	TaskKey                string   `json:"task_key"`
	Name                   string   `json:"name"`
	TaskType               string   `json:"task_type"`
	Required               bool     `json:"required"`
	Owner                  string   `json:"owner"`
	Team                   string   `json:"team"`
	PlannedDurationSeconds int      `json:"planned_duration_seconds"`
	Predecessors           []string `json:"predecessors"`
}

// drTaskRunWire decodes the per-task execution rows from a run's LiveState.
type drTaskRunWire struct {
	TaskID                string `json:"task_id"`
	Status                string `json:"status"`
	ActualDurationSeconds *int   `json:"actual_duration_seconds"`
}

type drRunWire struct {
	ID                         string `json:"id"`
	RunbookID                  string `json:"runbook_id"`
	Mode                       string `json:"mode"`
	Status                     string `json:"status"`
	PlannedCriticalPathSeconds int    `json:"planned_critical_path_seconds"`
}

type drNodeWire struct {
	ID     string `json:"id"`
	SiteID string `json:"site_id"`
	Role   string `json:"role"`
}

type drEdgeWire struct {
	ID         string `json:"id"`
	FromNodeID string `json:"from_node_id"`
	ToNodeID   string `json:"to_node_id"`
	Mode       string `json:"mode"`
	Health     string `json:"health"`
}

func (b *HTTPDRBridge) CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error) {
	body := map[string]any{
		"name":         in.Name,
		"description":  in.Description,
		"import_steps": in.ImportSteps,
	}
	if strings.TrimSpace(in.GroupID) != "" {
		body["group_id"] = in.GroupID
	}
	var out createRunbookResponse
	if err := b.do(ctx, tenantID, http.MethodPost, "/api/v1/dr/studio/runbooks", body, &out); err != nil {
		return nil, err
	}
	rb, err := decodeRunbook(out.Runbook, out.Tasks)
	if err != nil {
		return nil, err
	}
	return rb, nil
}

func (b *HTTPDRBridge) GetRunbook(ctx context.Context, tenantID, runbookID uuid.UUID) (*DRRunbook, error) {
	var out planResponse
	if err := b.do(ctx, tenantID, http.MethodGet, "/api/v1/dr/studio/runbooks/"+runbookID.String(), nil, &out); err != nil {
		return nil, err
	}
	return decodeRunbook(out.Runbook, out.Tasks)
}

func (b *HTTPDRBridge) StartRun(ctx context.Context, tenantID, runbookID uuid.UUID, mode string) (*DRRunLiveState, error) {
	body := map[string]any{}
	if strings.TrimSpace(mode) != "" {
		body["mode"] = mode
	}
	var out liveStateResponse
	if err := b.do(ctx, tenantID, http.MethodPost, "/api/v1/dr/studio/runbooks/"+runbookID.String()+"/runs", body, &out); err != nil {
		return nil, err
	}
	return decodeLiveState(out)
}

func (b *HTTPDRBridge) GetRun(ctx context.Context, tenantID, runID uuid.UUID) (*DRRunLiveState, error) {
	var out liveStateResponse
	if err := b.do(ctx, tenantID, http.MethodGet, "/api/v1/dr/studio/runs/"+runID.String(), nil, &out); err != nil {
		return nil, err
	}
	return decodeLiveState(out)
}

func (b *HTTPDRBridge) ActOnTask(ctx context.Context, tenantID, runID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool) (*DRRunLiveState, error) {
	if !action.Valid() {
		return nil, fmt.Errorf("%w: invalid task action %q", ErrValidation, action)
	}
	body := map[string]any{}
	if strings.TrimSpace(note) != "" {
		body["note"] = note
	}
	if failRun {
		body["fail_run"] = true
	}
	// The DR Studio action endpoint carries the verb as a ':<action>' suffix on
	// the task path segment (tasks/{taskID}:complete|skip|fail).
	path := "/api/v1/dr/studio/runs/" + runID.String() + "/tasks/" + taskID.String() + ":" + string(action)
	var out liveStateResponse
	if err := b.do(ctx, tenantID, http.MethodPost, path, body, &out); err != nil {
		return nil, err
	}
	return decodeLiveState(out)
}

func (b *HTTPDRBridge) GetTopology(ctx context.Context, tenantID, groupID uuid.UUID) (*DRTopology, error) {
	var out topologyResponse
	if err := b.do(ctx, tenantID, http.MethodGet, "/api/v1/dr/groups/"+groupID.String()+"/topology", nil, &out); err != nil {
		return nil, err
	}
	t := &DRTopology{GroupID: out.GroupID, TopoOrder: out.TopoOrder}
	for _, n := range out.Nodes {
		t.Nodes = append(t.Nodes, DRNode{ID: n.ID, SiteID: n.SiteID, Role: n.Role})
	}
	for _, e := range out.Edges {
		t.Edges = append(t.Edges, DREdge{ID: e.ID, FromNodeID: e.FromNodeID, ToNodeID: e.ToNodeID, Mode: e.Mode, Health: e.Health})
	}
	return t, nil
}

// do performs a tenant-propagated, service-token-authenticated request to the DR
// engine and unmarshals the {"data": ...} envelope into out. A transport error or
// 5xx is ErrDRBridgeUnavailable (fail closed, retriable); a 4xx is
// ErrDRBridgeRejected carrying the DR engine's own error message.
func (b *HTTPDRBridge) do(ctx context.Context, tenantID uuid.UUID, method, path string, body any, out any) error {
	if !b.Configured() {
		return ErrDRBridgeUnavailable
	}
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("migrate dr bridge: encoding request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, b.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("%w: building request: %v", ErrDRBridgeUnavailable, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if b.token != "" {
		req.Header.Set("Authorization", "Bearer "+b.token)
	}
	// Propagate the tenant so dr-service scopes its tenant transaction to the same
	// tenant. The gateway/middleware honours X-Tenant-ID; the service token's tenant
	// claim is overridden by this explicit header for the per-request tenant.
	req.Header.Set("X-Tenant-ID", tenantID.String())

	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDRBridgeUnavailable, err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if readErr != nil {
		return fmt.Errorf("%w: reading response: %v", ErrDRBridgeUnavailable, readErr)
	}
	if resp.StatusCode >= 500 || resp.StatusCode == http.StatusServiceUnavailable {
		return fmt.Errorf("%w: dr-service status %d", ErrDRBridgeUnavailable, resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var ee errorEnvelope
		_ = json.Unmarshal(raw, &ee)
		msg := strings.TrimSpace(ee.Message)
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return fmt.Errorf("%w (status %d): %s", ErrDRBridgeRejected, resp.StatusCode, msg)
	}
	if out == nil {
		return nil
	}
	var env dataEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return fmt.Errorf("%w: decoding envelope: %v", ErrDRBridgeUnavailable, err)
	}
	if len(env.Data) == 0 {
		return fmt.Errorf("%w: empty response data", ErrDRBridgeUnavailable)
	}
	if err := json.Unmarshal(env.Data, out); err != nil {
		return fmt.Errorf("%w: decoding data: %v", ErrDRBridgeUnavailable, err)
	}
	return nil
}

func decodeRunbook(rb drRunbookWire, tasks []drTaskWire) (*DRRunbook, error) {
	id, err := uuid.Parse(rb.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid runbook id %q: %v", ErrDRBridgeUnavailable, rb.ID, err)
	}
	out := &DRRunbook{
		ID:          id,
		Name:        rb.Name,
		Description: rb.Description,
		Status:      rb.Status,
		Source:      rb.Source,
	}
	for _, t := range tasks {
		dt, derr := decodeTask(t)
		if derr != nil {
			return nil, derr
		}
		out.Tasks = append(out.Tasks, dt)
	}
	return out, nil
}

func decodeTask(t drTaskWire) (DRTask, error) {
	id, err := uuid.Parse(t.ID)
	if err != nil {
		return DRTask{}, fmt.Errorf("%w: invalid task id %q: %v", ErrDRBridgeUnavailable, t.ID, err)
	}
	return DRTask{
		ID:                     id,
		TaskKey:                t.TaskKey,
		Name:                   t.Name,
		TaskType:               t.TaskType,
		Required:               t.Required,
		Owner:                  t.Owner,
		Team:                   t.Team,
		PlannedDurationSeconds: t.PlannedDurationSeconds,
		Predecessors:           t.Predecessors,
	}, nil
}

func decodeLiveState(in liveStateResponse) (*DRRunLiveState, error) {
	runID, err := uuid.Parse(in.Run.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid run id %q: %v", ErrDRBridgeUnavailable, in.Run.ID, err)
	}
	runbookID, err := uuid.Parse(in.Run.RunbookID)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid runbook id %q: %v", ErrDRBridgeUnavailable, in.Run.RunbookID, err)
	}
	out := &DRRunLiveState{
		RunID:                      runID,
		RunbookID:                  runbookID,
		Status:                     in.Run.Status,
		Mode:                       in.Run.Mode,
		PlannedCriticalPathSeconds: in.Run.PlannedCriticalPathSeconds,
		Frontier:                   in.Frontier,
		Projection:                 in.Projection,
	}
	for _, t := range in.Tasks {
		dt, derr := decodeTask(t)
		if derr != nil {
			return nil, derr
		}
		out.Tasks = append(out.Tasks, dt)
	}
	for _, tr := range in.TaskRuns {
		out.TaskRuns = append(out.TaskRuns, DRTaskRun{
			TaskID:                tr.TaskID,
			Status:                tr.Status,
			ActualDurationSeconds: tr.ActualDurationSeconds,
		})
	}
	return out, nil
}

var _ DRBridge = (*HTTPDRBridge)(nil)
