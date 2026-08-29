package handler

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/bpmn"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// maxBPMNImportBytes bounds the size of an uploaded BPMN document to protect the
// parser from an oversized payload (fail-closed on abuse). 5 MiB is far larger
// than any real workflow diagram.
const maxBPMNImportBytes = 5 << 20

// definitionService defines the operations available for workflow definitions.
type definitionService interface {
	Create(ctx context.Context, tenantID, userID string, req dto.CreateDefinitionRequest) (*model.WorkflowDefinition, error)
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error)
	List(ctx context.Context, tenantID, status, nameFilter, category, sortBy, sortOrder string, page, pageSize int) ([]*model.WorkflowDefinition, int, error)
	Update(ctx context.Context, tenantID, id, userID string, req dto.UpdateDefinitionRequest) (*model.WorkflowDefinition, error)
	Activate(ctx context.Context, tenantID, id string) error
	Archive(ctx context.Context, tenantID, id string) error
	Clone(ctx context.Context, tenantID, id, userID string) (*model.WorkflowDefinition, error)
	Delete(ctx context.Context, tenantID, id string) error
	ListVersions(ctx context.Context, tenantID, id string) ([]*model.WorkflowDefinition, error)
}

// definitionTemplateService is an optional service for creating definitions from templates.
type definitionTemplateService interface {
	InstantiateTemplate(ctx context.Context, tenantID, userID, templateID, name, description string) (*model.WorkflowDefinition, error)
}

// definitionPromotionService is the optional WP-4 promotion service: it advances
// a definition along the dev→staging→prod FSM and lists a definition's lineage.
// The concrete *service.PromotionService satisfies this contract; it is injected
// via SetPromotionService so the handler does not import the service package's
// concrete types.
type definitionPromotionService interface {
	PromoteDefinition(ctx context.Context, tenantID, defID, toStage string) (any, error)
	GetLineage(ctx context.Context, tenantID, definitionKey string) (any, error)
}

// definitionPromotionApprover is the OPTIONAL governed-promotion capability: it
// records the acting user and, for a staging→prod move, a distinct approver
// (GAP B/C). When the injected promotion service also satisfies this interface
// (the production adapter does) the handler routes promotions through it so the
// real actor is stamped on the row + audit event and the prod-approval gate can
// fire; otherwise it falls back to the legacy PromoteDefinition (unchanged).
type definitionPromotionApprover interface {
	PromoteDefinitionWithApproval(ctx context.Context, tenantID, defID, toStage, promotedBy, approvedBy, reason string) (any, error)
}

// definitionSimulator is the optional WP-6 sandbox: it runs a side-effect-free
// dry run of a definition with caller-supplied trigger data, variable overrides,
// and mock human/approval decisions, returning the simulated path + projections.
// The concrete adapter over *engine.SimulationOrchestrator satisfies this; it is
// injected via SetSimulator.
type definitionSimulator interface {
	Simulate(ctx context.Context, def *model.WorkflowDefinition, req SimulateRequest) (any, error)
}

// SimulateRequest is the decoded POST /{id}/simulate body (WP-6).
type SimulateRequest struct {
	TriggerData   map[string]interface{}          `json:"trigger_data,omitempty"`
	Variables     map[string]interface{}          `json:"variables,omitempty"`
	MockDecisions map[string]SimulateMockDecision `json:"mock_decisions,omitempty"`
	MaxSteps      int                             `json:"max_steps,omitempty"`
	AdvanceOnSLA  bool                            `json:"advance_clock_on_sla,omitempty"`
}

// SimulateMockDecision drives a human_task / approval_chain branch in a dry run.
type SimulateMockDecision struct {
	Approved bool                   `json:"approved"`
	Output   map[string]interface{} `json:"output,omitempty"`
}

// DefinitionHandler handles HTTP requests for workflow definition CRUD operations.
type DefinitionHandler struct {
	service   definitionService
	tmplSvc   definitionTemplateService
	promoSvc  definitionPromotionService
	simulator definitionSimulator
	logger    zerolog.Logger
}

// NewDefinitionHandler creates a new DefinitionHandler with the given service and logger.
func NewDefinitionHandler(service definitionService, logger zerolog.Logger) *DefinitionHandler {
	return &DefinitionHandler{
		service: service,
		logger:  logger.With().Str("handler", "workflow_definition").Logger(),
	}
}

// SetTemplateService sets the optional template service for from-template creation.
func (h *DefinitionHandler) SetTemplateService(svc definitionTemplateService) {
	h.tmplSvc = svc
}

// SetPromotionService sets the optional WP-4 promotion service powering the
// /promote and /lineage routes.
func (h *DefinitionHandler) SetPromotionService(svc definitionPromotionService) {
	h.promoSvc = svc
}

// SetSimulator sets the optional WP-6 sandbox simulator powering /simulate.
func (h *DefinitionHandler) SetSimulator(sim definitionSimulator) {
	h.simulator = sim
}

// Routes returns a chi.Router with all definition routes mounted.
func (h *DefinitionHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Post("/", h.Create)
	r.Get("/", h.List)
	r.Post("/from-template", h.CreateFromTemplate)
	r.Post("/import", h.ImportBPMN)          // BPMN 2.0: import XML -> draft definition (workflow:write)
	r.Get("/{id}/export.bpmn", h.ExportBPMN) // BPMN 2.0: export a definition as BPMN XML (authenticated read)
	r.Get("/{id}", h.GetByID)
	r.Put("/{id}", h.Update)
	r.Delete("/{id}", h.Delete)
	r.Post("/{id}/activate", h.Activate)
	r.Post("/{id}/publish", h.Activate) // alias: frontend uses "publish"
	r.Post("/{id}/archive", h.Archive)
	r.Post("/{id}/clone", h.Clone)
	r.Post("/{id}/promote", h.Promote)   // WP-4: advance dev→staging→prod (workflow:admin)
	r.Post("/{id}/simulate", h.Simulate) // WP-6: side-effect-free dry run (workflow:write)
	r.Get("/{id}/versions", h.ListVersions)
	r.Get("/{id}/lineage", h.Lineage) // WP-4: list all versions sharing a lineage key

	return r
}

// Create handles POST / — creates a new workflow definition.
func (h *DefinitionHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	var req dto.CreateDefinitionRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	// Run domain-level validation.
	if validationErrs := req.Validate(); len(validationErrs) > 0 {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"status":  http.StatusBadRequest,
			"code":    "VALIDATION_ERROR",
			"message": "definition validation failed",
			"errors":  validationErrs,
		})
		return
	}

	def, err := h.service.Create(r.Context(), user.TenantID, user.ID, req)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to create workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", def.ID).
		Str("user_id", user.ID).
		Msg("workflow definition created")

	writeJSON(w, http.StatusCreated, dto.DefinitionToResponse(def))
}

// List handles GET / — lists workflow definitions with filtering and pagination.
func (h *DefinitionHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	status := r.URL.Query().Get("status")
	if status != "" {
		// Validate each comma-separated status value.
		for _, s := range strings.Split(status, ",") {
			s = strings.TrimSpace(s)
			if s != "" && !model.ValidDefinitionStatuses[s] {
				writeError(w, http.StatusBadRequest, "INVALID_STATUS", "status must be one of: draft, active, deprecated, archived")
				return
			}
		}
	}

	nameFilter := r.URL.Query().Get("name")
	if nameFilter == "" {
		nameFilter = r.URL.Query().Get("search")
	}
	category := r.URL.Query().Get("category")
	if category != "" {
		// Validate each comma-separated category value.
		for _, c := range strings.Split(category, ",") {
			c = strings.TrimSpace(c)
			if c != "" && !model.ValidCategories[c] {
				writeError(w, http.StatusBadRequest, "INVALID_CATEGORY",
					"category must be one of: approval, onboarding, review, escalation, notification, data_pipeline, compliance, custom")
				return
			}
		}
	}
	sortBy := r.URL.Query().Get("sort")
	sortOrder := r.URL.Query().Get("order")
	page, pageSize := parsePagination(r)

	defs, total, err := h.service.List(r.Context(), user.TenantID, status, nameFilter, category, sortBy, sortOrder, page, pageSize)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to list workflow definitions")
		handleServiceError(w, err)
		return
	}

	items := make([]dto.DefinitionResponse, 0, len(defs))
	for _, d := range defs {
		items = append(items, dto.DefinitionToResponse(d))
	}

	writeJSON(w, http.StatusOK, dto.ListDefinitionsResponse{
		Data: items,
		Meta: dto.NewPaginationMeta(page, pageSize, total),
	})
}

// GetByID handles GET /{id} — retrieves a single workflow definition.
func (h *DefinitionHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	def, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("definition_id", id).Msg("failed to get workflow definition")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, dto.DefinitionToResponse(def))
}

// Update handles PUT /{id} — updates a workflow definition (creates a new version).
func (h *DefinitionHandler) Update(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	var req dto.UpdateDefinitionRequest
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}

	def, err := h.service.Update(r.Context(), user.TenantID, id, user.ID, req)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to update workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", def.ID).
		Int("version", def.Version).
		Str("user_id", user.ID).
		Msg("workflow definition updated")

	writeJSON(w, http.StatusOK, dto.DefinitionToResponse(def))
}

// Delete handles DELETE /{id} — soft-deletes a workflow definition.
func (h *DefinitionHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	// Fetch before deleting so we can return the definition in the response.
	def, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	if err := h.service.Delete(r.Context(), user.TenantID, id); err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to delete workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", id).
		Str("user_id", user.ID).
		Msg("workflow definition deleted")

	writeJSON(w, http.StatusOK, dto.DefinitionToResponse(def))
}

// Activate handles POST /{id}/activate — activates a draft workflow definition.
func (h *DefinitionHandler) Activate(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	if err := h.service.Activate(r.Context(), user.TenantID, id); err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to activate workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", id).
		Str("user_id", user.ID).
		Msg("workflow definition activated")

	// Return the updated definition so the frontend can update its cache.
	updated, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dto.DefinitionToResponse(updated))
}

// ListVersions handles GET /{id}/versions — lists all versions of a workflow definition.
func (h *DefinitionHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	versions, err := h.service.ListVersions(r.Context(), user.TenantID, id)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to list workflow definition versions")
		handleServiceError(w, err)
		return
	}

	items := make([]dto.DefinitionResponse, len(versions))
	for i, v := range versions {
		items[i] = dto.DefinitionToResponse(v)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"versions": items,
	})
}

// Archive handles POST /{id}/archive — archives an active workflow definition.
func (h *DefinitionHandler) Archive(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	if err := h.service.Archive(r.Context(), user.TenantID, id); err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to archive workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", id).
		Str("user_id", user.ID).
		Msg("workflow definition archived")

	// Return the updated definition so the frontend can update its cache.
	updated, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dto.DefinitionToResponse(updated))
}

// Promote handles POST /{id}/promote — advances a definition one step along the
// dev→staging→prod promotion FSM (WP-4). Body: {"to_stage": "staging"|"prod"}.
// Gated to workflow:admin by definitionRBAC. Returns the updated promotion
// record; an illegal/immutable promotion surfaces as 409 Conflict via the
// promotion service's ErrConflict (wrapping model.ErrConflict).
func (h *DefinitionHandler) Promote(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if h.promoSvc == nil {
		writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "promotion service not configured")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	var req struct {
		ToStage    string `json:"to_stage"`
		ApprovedBy string `json:"approved_by"`
		Reason     string `json:"reason"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.ToStage == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "to_stage is required")
		return
	}

	// Prefer the governed path when the service supports it: it stamps the real
	// acting user (fixing the empty promoted_by) and enforces the staging→prod
	// distinct-approver gate. Fall back to the legacy path otherwise.
	var (
		rec any
		err error
	)
	if approver, ok := h.promoSvc.(definitionPromotionApprover); ok {
		rec, err = approver.PromoteDefinitionWithApproval(r.Context(), user.TenantID, id, req.ToStage, user.ID, req.ApprovedBy, req.Reason)
	} else {
		rec, err = h.promoSvc.PromoteDefinition(r.Context(), user.TenantID, id, req.ToStage)
	}
	if err != nil {
		h.logger.Warn().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Str("to_stage", req.ToStage).
			Msg("failed to promote workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", id).
		Str("to_stage", req.ToStage).
		Str("user_id", user.ID).
		Msg("workflow definition promoted")

	writeJSON(w, http.StatusOK, rec)
}

// Lineage handles GET /{key}/lineage — lists every live version of a logical
// definition sharing a lineage key, newest first, each with its stage and
// immutability (WP-4). Gated to authenticated reads by definitionRBAC.
func (h *DefinitionHandler) Lineage(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if h.promoSvc == nil {
		writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "promotion service not configured")
		return
	}

	key := urlParam(r, "id")
	if key == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition key is required")
		return
	}

	records, err := h.promoSvc.GetLineage(r.Context(), user.TenantID, key)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_key", key).
			Msg("failed to list workflow definition lineage")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"lineage": records,
	})
}

// Simulate handles POST /{id}/simulate — runs a side-effect-free dry run of a
// definition (WP-6). It loads the definition, then delegates to the injected
// SimulationOrchestrator with the request's trigger data, variable overrides, and
// mock decisions. Gated to workflow:write by definitionRBAC. Nothing touches
// Redis/Kafka/HTTP/DB beyond the read of the definition itself.
func (h *DefinitionHandler) Simulate(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	if h.simulator == nil {
		writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "simulation service not configured")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	// An empty body is valid (simulate with defaults); only reject malformed JSON.
	var req SimulateRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := parseBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
			return
		}
	}

	def, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to load definition for simulation")
		handleServiceError(w, err)
		return
	}

	result, err := h.simulator.Simulate(r.Context(), def, req)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("simulation failed")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", id).
		Str("user_id", user.ID).
		Msg("workflow definition simulated")

	writeJSON(w, http.StatusOK, result)
}

// Clone handles POST /{id}/clone — creates a copy of a workflow definition in draft status.
func (h *DefinitionHandler) Clone(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	def, err := h.service.Clone(r.Context(), user.TenantID, id, user.ID)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("definition_id", id).
			Msg("failed to clone workflow definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", def.ID).
		Str("user_id", user.ID).
		Msg("workflow definition cloned")

	writeJSON(w, http.StatusCreated, dto.DefinitionToResponse(def))
}

// CreateFromTemplate handles POST /from-template — creates a new definition from a template.
// Expects JSON body: { "template_id": "...", "name": "...", "description": "..." }
func (h *DefinitionHandler) CreateFromTemplate(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	if h.tmplSvc == nil {
		writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "template service not configured")
		return
	}

	var req struct {
		TemplateID  string `json:"template_id"`
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if req.TemplateID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "template_id is required")
		return
	}

	def, err := h.tmplSvc.InstantiateTemplate(r.Context(), user.TenantID, user.ID, req.TemplateID, req.Name, req.Description)
	if err != nil {
		h.logger.Error().Err(err).
			Str("tenant_id", user.TenantID).
			Str("template_id", req.TemplateID).
			Msg("failed to create definition from template")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("template_id", req.TemplateID).
		Str("definition_id", def.ID).
		Str("user_id", user.ID).
		Msg("workflow definition created from template")

	writeJSON(w, http.StatusCreated, dto.DefinitionToResponse(def))
}

// ExportBPMN handles GET /{id}/export.bpmn — serializes a workflow definition to
// a BPMN 2.0 XML document (authenticated read). The response is downloadable BPMN XML
// (Content-Type application/xml; Content-Disposition attachment). Read-only: it
// loads the definition and translates it — no state change.
func (h *DefinitionHandler) ExportBPMN(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition id is required")
		return
	}

	def, err := h.service.GetByID(r.Context(), user.TenantID, id)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("definition_id", id).Msg("failed to load definition for BPMN export")
		handleServiceError(w, err)
		return
	}

	xmlBytes, err := bpmn.Export(def)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("definition_id", id).Msg("BPMN export failed")
		// An unsupported step type is a client-visible condition on the definition,
		// not a server fault — surface it as a 422 with the codec's message.
		writeError(w, http.StatusUnprocessableEntity, "BPMN_EXPORT_UNSUPPORTED", err.Error())
		return
	}

	h.logger.Info().Str("tenant_id", user.TenantID).Str("definition_id", id).Str("user_id", user.ID).Msg("workflow definition exported as BPMN")

	filename := bpmnFilename(def)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(xmlBytes)
}

// ImportBPMN handles POST /import — parses a BPMN 2.0 XML body and creates a new
// DRAFT workflow definition from it (workflow:write). The request body is the
// raw BPMN XML (Content-Type application/xml or text/xml). Fail-closed: malformed
// XML, an unsupported BPMN construct, or a graph referencing unknown steps is
// reported as a 400/422 — never a partial/silent import. On success it returns
// the created draft (201) with any fidelity warnings echoed under "warnings".
func (h *DefinitionHandler) ImportBPMN(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "BPMN XML body is required")
		return
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBPMNImportBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "failed to read request body")
		return
	}
	if len(body) > maxBPMNImportBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "BPMN document exceeds the maximum allowed size")
		return
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", "BPMN XML body is required")
		return
	}

	result, err := bpmn.Import(body)
	if err != nil {
		// Codec errors are client faults (bad/unsupported document), reported
		// clearly rather than silently dropped.
		h.logger.Warn().Err(err).Str("tenant_id", user.TenantID).Msg("BPMN import rejected")
		writeError(w, http.StatusBadRequest, "BPMN_IMPORT_INVALID", err.Error())
		return
	}

	imported := result.Definition
	// Build a create request from the reconstructed definition and reuse the
	// SAME domain validation + service path as any hand-authored definition, so
	// an imported draft is held to the identical invariants (step types, end
	// step, transition targets, variable types).
	createReq := dto.CreateDefinitionRequest{
		Name:          imported.Name,
		Description:   imported.Description,
		Category:      imported.Category,
		TriggerConfig: imported.TriggerConfig,
		Variables:     imported.Variables,
		Steps:         imported.Steps,
	}
	if validationErrs := createReq.Validate(); len(validationErrs) > 0 {
		writeValidationError(w, "imported BPMN definition failed validation", validationErrs)
		return
	}

	def, err := h.service.Create(r.Context(), user.TenantID, user.ID, createReq)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to persist imported BPMN definition")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("definition_id", def.ID).
		Str("user_id", user.ID).
		Int("warnings", len(result.Warnings)).
		Msg("workflow definition imported from BPMN")

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"definition": dto.DefinitionToResponse(def),
		"warnings":   result.Warnings,
	})
}

// bpmnFilename builds a stable, safe download filename for an exported diagram.
func bpmnFilename(def *model.WorkflowDefinition) string {
	base := def.DefinitionKey
	if strings.TrimSpace(base) == "" {
		base = def.ID
	}
	if strings.TrimSpace(base) == "" {
		base = "workflow"
	}
	var b strings.Builder
	for _, ru := range base {
		switch {
		case ru >= 'a' && ru <= 'z', ru >= 'A' && ru <= 'Z', ru >= '0' && ru <= '9', ru == '_', ru == '-':
			b.WriteRune(ru)
		default:
			b.WriteRune('_')
		}
	}
	return b.String() + ".bpmn"
}
