package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/service"
)

// fakeMigrationService is a minimal migrationService double for the handler tests.
type fakeMigrationService struct {
	migrateErr  error
	lastSpec    service.MigrationSpec
	lastInstID  string
	lastFromDef string
}

func (f *fakeMigrationService) MigrateInstance(_ context.Context, _, instanceID string, spec service.MigrationSpec) (*service.MigrationResult, error) {
	f.lastInstID = instanceID
	f.lastSpec = spec
	if f.migrateErr != nil {
		return nil, f.migrateErr
	}
	return &service.MigrationResult{
		InstanceID: instanceID,
		ToDefID:    spec.TargetDefinitionID,
		ToVersion:  2,
		Migrated:   true,
	}, nil
}

func (f *fakeMigrationService) MigrateBulk(_ context.Context, _, fromDefinitionID string, _ []string, spec service.MigrationSpec) (*service.BulkMigrationResult, error) {
	f.lastFromDef = fromDefinitionID
	f.lastSpec = spec
	if f.migrateErr != nil {
		return nil, f.migrateErr
	}
	return &service.BulkMigrationResult{Selected: 2, Migrated: 2, Results: []*service.MigrationResult{}}, nil
}

func migReq(method, target, body string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, bytes.NewBufferString(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	return r.WithContext(auth.WithUser(r.Context(), &auth.ContextUser{ID: "admin-1", TenantID: "tenant-1"}))
}

// TestMigrationHandler_MigrateInstanceHappyPath proves the single-instance
// migrate route decodes the remap spec and returns 200 with the result.
func TestMigrationHandler_MigrateInstanceHappyPath(t *testing.T) {
	svc := &fakeMigrationService{}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	body := `{"target_definition_id":"new-v2","step_remap":{"review":"review_v2"},"variable_remap":{"amount":"total"},"reason":"hotfix"}`
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/instances/inst-1", body))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "inst-1", svc.lastInstID)
	require.Equal(t, "new-v2", svc.lastSpec.TargetDefinitionID)
	require.Equal(t, "review_v2", svc.lastSpec.StepRemap["review"])
	require.Equal(t, "total", svc.lastSpec.VariableRemap["amount"])
}

// TestMigrationHandler_MissingTargetRejected proves a missing target yields 400.
func TestMigrationHandler_MissingTargetRejected(t *testing.T) {
	svc := &fakeMigrationService{}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/instances/inst-1", `{"reason":"x"}`))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

// TestMigrationHandler_IncompatibleSurfacesAs409 proves a fail-closed
// ErrIncompatibleMigration (wrapping model.ErrConflict) maps to HTTP 409.
func TestMigrationHandler_IncompatibleSurfacesAs409(t *testing.T) {
	svc := &fakeMigrationService{migrateErr: service.ErrIncompatibleMigration}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/instances/inst-1", `{"target_definition_id":"new-v2"}`))
	require.Equal(t, http.StatusConflict, rec.Code)
}

// TestMigrationHandler_TerminalSurfacesAs409 proves a terminal-instance rejection
// maps to HTTP 409.
func TestMigrationHandler_TerminalSurfacesAs409(t *testing.T) {
	svc := &fakeMigrationService{migrateErr: service.ErrInstanceNotMigratable}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/instances/inst-1", `{"target_definition_id":"new-v2"}`))
	require.Equal(t, http.StatusConflict, rec.Code)
	require.Contains(t, rec.Body.String(), "CONFLICT")
	_ = model.ErrConflict // keep model import meaningful
}

// TestMigrationHandler_BulkHappyPath proves the bulk route decodes from + target
// and returns the aggregate result.
func TestMigrationHandler_BulkHappyPath(t *testing.T) {
	svc := &fakeMigrationService{}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	body := `{"from_definition_id":"old-v1","target_definition_id":"new-v2","statuses":["running","suspended"]}`
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/bulk", body))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "old-v1", svc.lastFromDef)
	require.Equal(t, "new-v2", svc.lastSpec.TargetDefinitionID)
}

// TestMigrationHandler_BulkMissingFromRejected proves a missing from_definition_id
// yields 400.
func TestMigrationHandler_BulkMissingFromRejected(t *testing.T) {
	svc := &fakeMigrationService{}
	h := NewMigrationHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, migReq(http.MethodPost, "/bulk", `{"target_definition_id":"new-v2"}`))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}
