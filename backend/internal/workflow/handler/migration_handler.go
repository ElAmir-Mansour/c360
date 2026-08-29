package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/service"
)

// migrationService is the engine surface the migration handler drives (the
// concrete *service.InstanceMigrationService satisfies it). It migrates an
// in-flight instance from its pinned definition version to a target version, and
// supports a bulk migration by source definition + status.
type migrationService interface {
	MigrateInstance(ctx context.Context, tenantID, instanceID string, spec service.MigrationSpec) (*service.MigrationResult, error)
	MigrateBulk(ctx context.Context, tenantID, fromDefinitionID string, statuses []string, spec service.MigrationSpec) (*service.BulkMigrationResult, error)
}

// MigrationHandler exposes in-flight instance version migration. Every route is a
// POST gated on workflow:admin (see migrationRBAC in cmd/workflow-engine/rbac.go),
// because re-pinning running work across definition versions is a governance
// action, not routine instance control.
type MigrationHandler struct {
	svc    migrationService
	logger zerolog.Logger
}

// NewMigrationHandler creates a new MigrationHandler.
func NewMigrationHandler(svc migrationService, logger zerolog.Logger) *MigrationHandler {
	return &MigrationHandler{
		svc:    svc,
		logger: logger.With().Str("handler", "workflow_migration").Logger(),
	}
}

// Routes mounts the migration routes.
//
//	POST /instances/{id}   -> migrate a single in-flight instance to a target version
//	POST /bulk             -> migrate every migratable instance of a source definition
func (h *MigrationHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/instances/{id}", h.MigrateInstance)
	r.Post("/bulk", h.MigrateBulk)
	return r
}

// migrateRequestBody is the shared migration spec transport shape.
type migrateRequestBody struct {
	TargetDefinitionID  string            `json:"target_definition_id"`
	TargetDefinitionKey string            `json:"target_definition_key"`
	StepRemap           map[string]string `json:"step_remap"`
	VariableRemap       map[string]string `json:"variable_remap"`
	Reason              string            `json:"reason"`
}

func (b migrateRequestBody) toSpec() service.MigrationSpec {
	return service.MigrationSpec{
		TargetDefinitionID:  b.TargetDefinitionID,
		TargetDefinitionKey: b.TargetDefinitionKey,
		StepRemap:           b.StepRemap,
		VariableRemap:       b.VariableRemap,
		Reason:              b.Reason,
	}
}

// MigrateInstance handles POST /instances/{id} — migrate one running/suspended/
// incident instance to a target definition version, with an optional step +
// variable remap. Incompatible or terminal migrations are rejected fail-closed.
func (h *MigrationHandler) MigrateInstance(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "instance id is required")
		return
	}

	var body migrateRequestBody
	if err := parseBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if body.TargetDefinitionID == "" && body.TargetDefinitionKey == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "target_definition_id or target_definition_key is required")
		return
	}

	res, err := h.svc.MigrateInstance(r.Context(), user.TenantID, id, body.toSpec())
	if err != nil {
		h.logger.Warn().Err(err).
			Str("tenant_id", user.TenantID).
			Str("instance_id", id).
			Msg("failed to migrate workflow instance")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("instance_id", id).
		Str("user_id", user.ID).
		Str("to_definition_id", res.ToDefID).
		Int("to_version", res.ToVersion).
		Msg("workflow instance migrated")

	writeJSON(w, http.StatusOK, res)
}

// MigrateBulk handles POST /bulk — migrate every migratable instance currently
// pinned to from_definition_id (optionally restricted to a status subset) to the
// target version. Best-effort: per-instance failures are recorded in the result.
func (h *MigrationHandler) MigrateBulk(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	var body struct {
		FromDefinitionID string   `json:"from_definition_id"`
		Statuses         []string `json:"statuses"`
		migrateRequestBody
	}
	if err := parseBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if body.FromDefinitionID == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "from_definition_id is required")
		return
	}
	if body.TargetDefinitionID == "" && body.TargetDefinitionKey == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "target_definition_id or target_definition_key is required")
		return
	}

	res, err := h.svc.MigrateBulk(r.Context(), user.TenantID, body.FromDefinitionID, body.Statuses, body.migrateRequestBody.toSpec())
	if err != nil {
		h.logger.Warn().Err(err).
			Str("tenant_id", user.TenantID).
			Str("from_definition_id", body.FromDefinitionID).
			Msg("failed bulk workflow instance migration")
		handleServiceError(w, err)
		return
	}

	h.logger.Info().
		Str("tenant_id", user.TenantID).
		Str("from_definition_id", body.FromDefinitionID).
		Str("user_id", user.ID).
		Int("selected", res.Selected).
		Int("migrated", res.Migrated).
		Int("failed", res.Failed).
		Msg("bulk workflow instance migration completed")

	writeJSON(w, http.StatusOK, res)
}
