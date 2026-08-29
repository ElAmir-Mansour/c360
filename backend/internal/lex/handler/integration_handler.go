package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/lex/service/integration"
	"github.com/clario360/platform/internal/suiteapi"
)

// IntegrationHandler exposes the lex integration registry (CAP-174..178): list,
// configure (create/update), get, delete, and health probes. Connection config
// is write-only (the service redacts it on read).
type IntegrationHandler struct {
	baseHandler
	service *service.IntegrationRegistryService
}

func NewIntegrationHandler(svc *service.IntegrationRegistryService, logger zerolog.Logger) *IntegrationHandler {
	return &IntegrationHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

func (h *IntegrationHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	items, err := h.service.List(
		r.Context(),
		tenantID,
		strings.TrimSpace(r.URL.Query().Get("kind")),
		strings.TrimSpace(r.URL.Query().Get("status")),
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *IntegrationHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateIntegrationEndpointRequest
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

func (h *IntegrationHandler) Get(w http.ResponseWriter, r *http.Request) {
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

func (h *IntegrationHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateIntegrationEndpointRequest
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

func (h *IntegrationHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

// Health probes a single endpoint (CAP-184..186).
func (h *IntegrationHandler) Health(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	health, err := h.service.Health(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, health)
}

// HealthAll probes every registered endpoint for the tenant; the suite readiness
// confirmation (CAP-184..186) consumes this.
func (h *IntegrationHandler) HealthAll(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	health, err := h.service.HealthAll(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, health)
}

// Schema returns the dynamic-form field specs for a kind
// (GET /integrations/schema/{kind}). The console renders DynamicConnectorForm
// from this, so it is the single source of truth for what fields exist, their
// labels, types, enums, required-ness, and which are secret/write-only.
func (h *IntegrationHandler) Schema(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenantID(w, r); !ok {
		return
	}
	kind := model.IntegrationKind(strings.ToLower(strings.TrimSpace(chi.URLParam(r, "kind"))))
	schema, ok := h.service.SchemaFor(kind)
	if !ok {
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", "unknown integration kind", nil)
		return
	}
	fields := make([]dto.IntegrationFieldSpecResponse, 0, len(schema))
	for _, f := range schema {
		fields = append(fields, dto.IntegrationFieldSpecResponse{
			Key:      f.Key,
			Label:    f.Label,
			Type:     string(f.Type),
			Secret:   f.IsSecret(),
			Required: f.Required,
			Enum:     f.Enum,
			Default:  f.Default,
			Help:     f.Help,
		})
	}
	suiteapi.WriteData(w, http.StatusOK, dto.IntegrationSchemaResponse{Kind: string(kind), Fields: fields})
}

// Test runs the connector's ConnectionTester (POST /integrations/{id}/test) and
// returns the sanitized outcome. Secrets are never echoed.
func (h *IntegrationHandler) Test(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.TestConnection(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, integrationTestResponse(id.String(), result))
}

// Sync triggers the connector's Syncer (POST /integrations/{id}/sync?mode=) and
// returns the sync report; a ledger row is written by the service.
func (h *IntegrationHandler) Sync(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	mode := integration.NormalizeSyncMode(strings.TrimSpace(r.URL.Query().Get("mode")))
	// Extensibility #20: ?force=true bypasses the mass-change guard so an operator can
	// override a blocked sync after reviewing the guard summary returned in the 409.
	force := isTruthyParam(r.URL.Query().Get("force"))
	report, err := h.service.SyncNow(r.Context(), tenantID, userID, id, mode, force)
	if err != nil {
		// A sync that ran but failed still returns its report alongside the error;
		// surface the structured error to the caller.
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// Invoke dispatches a connector's Invoker capability
// (POST /integrations/{id}/invoke) with {operation, payload} and returns the
// sanitized InvokeResult. Secrets are never echoed (the connector sanitizes its
// own Detail/Output). Gated lex:integration:manage.
func (h *IntegrationHandler) Invoke(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req struct {
		Operation string         `json:"operation"`
		Payload   map[string]any `json:"payload"`
	}
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.Invoke(r.Context(), tenantID, userID, id, strings.TrimSpace(req.Operation), req.Payload)
	if err != nil {
		// An invoke that ran but failed still returns its sanitized result alongside
		// the structured error; surface the structured error to the caller.
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// SyncRuns returns the sync-run ledger timeline for an endpoint
// (GET /integrations/{id}/sync-runs?limit=).
func (h *IntegrationHandler) SyncRuns(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	limit := 50
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			limit = n
		}
	}
	runs, err := h.service.ListSyncRuns(r.Context(), tenantID, id, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	out := make([]dto.IntegrationSyncRunResponse, 0, len(runs))
	for i := range runs {
		out = append(out, integrationSyncRunResponse(runs[i]))
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func integrationTestResponse(endpointID string, r *integration.TestResult) dto.IntegrationTestResponse {
	if r == nil {
		return dto.IntegrationTestResponse{EndpointID: endpointID}
	}
	checked := ""
	if !r.CheckedAt.IsZero() {
		checked = r.CheckedAt.UTC().Format(time.RFC3339)
	}
	// SynthesizeSteps guarantees a non-empty staged breakdown for the diagnostic UI
	// even when the connector only set the coarse Reachable/Detail fields.
	steps := integration.SynthesizeSteps(*r)
	out := make([]dto.IntegrationDiagnosticStepResponse, 0, len(steps))
	for _, st := range steps {
		out = append(out, dto.IntegrationDiagnosticStepResponse{
			Key:       st.Key,
			Label:     st.Label,
			Status:    st.Status,
			LatencyMs: st.LatencyMs,
			Detail:    st.Detail,
			Hint:      st.Hint,
		})
	}
	return dto.IntegrationTestResponse{
		EndpointID:    endpointID,
		Reachable:     r.Reachable,
		Detail:        r.Detail,
		SampleCount:   r.SampleCount,
		LatencyMillis: r.LatencyMillis,
		CheckedAt:     checked,
		Metadata:      r.Metadata,
		Steps:         out,
	}
}

// Reconcile (feature 3) runs a READ-ONLY source-vs-lex compare for an endpoint
// (POST /integrations/{id}/reconcile) and returns the gaps + conflicts. It never
// mutates lex data or any external system.
func (h *IntegrationHandler) Reconcile(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.Reconcile(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// RotateSecret (feature 5) re-encrypts ONE secret config field
// (POST /integrations/{id}/rotate-secret) with {field, value}. The new value is
// write-only; the response is the masked endpoint (secret shown as the sentinel).
func (h *IntegrationHandler) RotateSecret(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RotateIntegrationSecretRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	// The field key may be carried in the path (/secrets/{field}/rotate); the path
	// segment, when present, is authoritative over the body so the route is RESTful
	// and the secret value stays the only body member that matters.
	if pathField := strings.TrimSpace(chi.URLParam(r, "field")); pathField != "" {
		req.Field = pathField
	}
	if err := h.service.RotateSecret(r.Context(), tenantID, userID, id, req.Field, req.Value); err != nil {
		h.writeError(w, r, err)
		return
	}
	// Return the freshly-masked endpoint so the console sees the updated
	// last_rotated stamp without the secret value.
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// WebhookTest (feature 8/1) dispatches a SYNTHETIC inbound webhook event through
// the connector loop (POST /integrations/{id}/webhook-test) to prove wiring,
// without any external call. Returns the sanitized InvokeResult.
func (h *IntegrationHandler) WebhookTest(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	result, err := h.service.SendTestEvent(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// Sandbox (feature 9) runs a connector op in mock/sandbox mode
// (POST /integrations/{id}/sandbox) with {operation, payload}. It never hits a
// real upstream / gov system and never mutates real state.
func (h *IntegrationHandler) Sandbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SandboxInvokeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	result, err := h.service.SandboxInvoke(r.Context(), tenantID, userID, id, req.Operation, req.Payload)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// Activity (feature 1/8) returns the endpoint's recent activity trail
// (GET /integrations/{id}/activity?limit=), sourced from the sync-run ledger.
func (h *IntegrationHandler) Activity(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	limit := 50
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			limit = n
		}
	}
	runs, err := h.service.ListActivity(r.Context(), tenantID, id, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	out := make([]dto.IntegrationSyncRunResponse, 0, len(runs))
	for i := range runs {
		out = append(out, integrationSyncRunResponse(runs[i]))
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// Catalog (feature 7) returns the static connector catalog
// (GET /integrations/catalog) — maturity, prerequisite steps, callback templates,
// KSA tags, self-serve flag — for every known kind. Tenant-agnostic, secret-free.
func (h *IntegrationHandler) Catalog(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenantID(w, r); !ok {
		return
	}
	entries := h.service.Catalog()
	out := make([]dto.IntegrationCatalogEntryResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, dto.IntegrationCatalogEntryResponse{
			Kind:              string(e.Kind),
			Maturity:          e.Maturity,
			PrerequisiteSteps: e.PrerequisiteSteps,
			CallbackTemplates: e.CallbackTemplates,
			KsaTags:           e.KsaTags,
			SelfServe:         e.SelfServe,
		})
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// HealthHistory (feature 6) returns the endpoint's recent health-check records
// (GET /integrations/{id}/health-history?limit=) — grade + reachability over time
// for the console uptime sparkline. Records carry only sanitized, secret-free
// diagnostics. Returns an empty list when no health recorder is wired.
func (h *IntegrationHandler) HealthHistory(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	limit := 50
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			limit = n
		}
	}
	records, err := h.service.ListHealthHistory(r.Context(), tenantID, id, limit)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, records)
}

func integrationSyncRunResponse(run integration.SyncRun) dto.IntegrationSyncRunResponse {
	return dto.IntegrationSyncRunResponse{
		ID:         run.ID.String(),
		EndpointID: run.EndpointID.String(),
		Kind:       string(run.Kind),
		Mode:       string(run.Mode),
		Status:     string(run.Status),
		Processed:  run.Processed,
		Created:    run.Created,
		Updated:    run.Updated,
		Skipped:    run.Skipped,
		Failed:     run.Failed,
		Watermark:  run.Watermark,
		Detail:     run.Detail,
		Error:      run.Error,
		Metadata:   run.Metadata,
		StartedAt:  run.StartedAt.UTC().Format(time.RFC3339),
		FinishedAt: run.FinishedAt.UTC().Format(time.RFC3339),
	}
}
