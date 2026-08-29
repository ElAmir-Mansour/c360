//go:build integration

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/license/model"
	"github.com/clario360/platform/internal/license/repository"
	licservice "github.com/clario360/platform/internal/license/service"
)

func startHandlerLicenseDB(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("license_handler_it"),
		postgresmod.WithUsername("license"),
		postgresmod.WithPassword("license"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	pool, err := pgxpool.New(ctx, container.MustConnectionString(ctx, "sslmode=disable"))
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migrationDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "license_db")
	for _, migrationName := range []string{
		"000001_init_schema.up.sql",
		"000003_plan_lifecycle.up.sql",
	} {
		migrationPath := filepath.Join(migrationDir, migrationName)
		migration, err := os.ReadFile(migrationPath)
		if err != nil {
			t.Fatalf("read migration %s: %v", migrationName, err)
		}
		if _, err := pool.Exec(ctx, string(migration)); err != nil {
			t.Fatalf("apply migration %s: %v", migrationName, err)
		}
	}

	return ctx, pool
}

func adminRequest(method, path string, body []byte) *http.Request {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "11111111-1111-1111-1111-111111111111",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    []string{"super_admin"},
	})
	return req.WithContext(ctx)
}

func tenantRequest(method, path string, body []byte, tenantID string) *http.Request {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "22222222-2222-2222-2222-222222222222",
		TenantID: tenantID,
		Roles:    []string{"tenant_user"},
	})
	ctx = auth.WithTenantID(ctx, tenantID)
	return req.WithContext(ctx)
}

type planEnvelope struct {
	Data model.Plan `json:"data"`
}

type planListEnvelope struct {
	Data []model.Plan `json:"data"`
}

type decisionEnvelope struct {
	Data model.Decision `json:"data"`
}

func decodePlanEnvelope(t *testing.T, rec *httptest.ResponseRecorder) model.Plan {
	t.Helper()
	var env planEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode plan envelope: %v; body=%s", err, rec.Body.String())
	}
	return env.Data
}

func planListContains(plans []model.Plan, key string) bool {
	for _, plan := range plans {
		if plan.Key == key {
			return true
		}
	}
	return false
}

func TestIntegration_AdminPlanLifecycleRoutes(t *testing.T) {
	ctx, pool := startHandlerLicenseDB(t)
	svc := licservice.New(pool, repository.New(), zerolog.Nop())
	router := New(svc, nil, nil, zerolog.Nop()).Routes()

	if _, err := svc.CreatePlan(ctx, &model.Plan{
		Key:         "route-plan",
		Name:        "Route Plan",
		Description: "Created for handler lifecycle route coverage",
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},
		},
	}); err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}

	updateBody := []byte(`{"name":"Route Plan Updated","description":"Updated through the route"}`)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, adminRequest(http.MethodPut, "/admin/plans/route-plan", updateBody))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT /admin/plans/route-plan status = %d body=%s", rec.Code, rec.Body.String())
	}
	updated := decodePlanEnvelope(t, rec)
	if updated.Name != "Route Plan Updated" || updated.Description != "Updated through the route" {
		t.Fatalf("updated plan = %+v, want route metadata", updated)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, adminRequest(http.MethodPost, "/admin/plans/route-plan/retire", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /admin/plans/route-plan/retire status = %d body=%s", rec.Code, rec.Body.String())
	}
	retired := decodePlanEnvelope(t, rec)
	if retired.Status != model.PlanStatusRetired {
		t.Fatalf("retired status = %s, want retired", retired.Status)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, adminRequest(http.MethodGet, "/admin/plans", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /admin/plans status = %d body=%s", rec.Code, rec.Body.String())
	}
	var list planListEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil {
		t.Fatalf("decode plan list: %v; body=%s", err, rec.Body.String())
	}
	if planListContains(list.Data, "route-plan") {
		t.Fatalf("GET /admin/plans included retired route-plan: %+v", list.Data)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, adminRequest(http.MethodPost, "/admin/plans/route-plan/reactivate", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /admin/plans/route-plan/reactivate status = %d body=%s", rec.Code, rec.Body.String())
	}
	reactivated := decodePlanEnvelope(t, rec)
	if reactivated.Status != model.PlanStatusActive {
		t.Fatalf("reactivated status = %s, want active", reactivated.Status)
	}
}

func TestIntegration_EnforcementRoutesReturnTenantScopedDecisions(t *testing.T) {
	ctx, pool := startHandlerLicenseDB(t)
	svc := licservice.New(pool, repository.New(), zerolog.Nop())
	router := New(svc, nil, nil, zerolog.Nop()).Routes()

	tenantID := "aaaaaaaa-0000-0000-0000-000000000001"
	apiLimit := int64(2)
	if _, err := svc.CreatePlan(ctx, &model.Plan{
		Key:         "route-enforcement",
		Name:        "Route Enforcement",
		Description: "Covers tenant enforcement route decisions",
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},
			{Key: "api.calls", Limit: &apiLimit},
		},
	}); err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}
	if _, err := svc.AssignLicense(ctx, licservice.AssignLicenseInput{
		TenantID:  tenantID,
		PlanKey:   "route-enforcement",
		Seats:     5,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
		GraceDays: 14,
	}); err != nil {
		t.Fatalf("AssignLicense() error = %v", err)
	}

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, tenantRequest(http.MethodGet, "/check?key=app.watheeq", nil, tenantID))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /check allowed status = %d body=%s", rec.Code, rec.Body.String())
	}
	var allowed decisionEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&allowed); err != nil {
		t.Fatalf("decode allowed decision: %v; body=%s", err, rec.Body.String())
	}
	if !allowed.Data.Allowed || allowed.Data.PlanKey != "route-enforcement" || allowed.Data.LicenseState != model.StateActive {
		t.Fatalf("allowed decision = %+v, want active route-enforcement grant", allowed.Data)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, tenantRequest(http.MethodGet, "/check?key=app.unknown", nil, tenantID))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /check denied status = %d body=%s", rec.Code, rec.Body.String())
	}
	var denied decisionEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&denied); err != nil {
		t.Fatalf("decode denied decision: %v; body=%s", err, rec.Body.String())
	}
	if denied.Data.Allowed || denied.Data.Reason != "not included in plan" || denied.Data.PlanKey != "route-enforcement" {
		t.Fatalf("denied decision = %+v, want tenant-scoped not-in-plan denial", denied.Data)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, tenantRequest(http.MethodPost, "/usage", []byte(`{"key":"api.calls","amount":2}`), tenantID))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /usage within limit status = %d body=%s", rec.Code, rec.Body.String())
	}
	var consumed decisionEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&consumed); err != nil {
		t.Fatalf("decode consumed decision: %v; body=%s", err, rec.Body.String())
	}
	if !consumed.Data.Allowed || consumed.Data.Used != 2 || consumed.Data.Remaining == nil || *consumed.Data.Remaining != 0 {
		t.Fatalf("consumed decision = %+v, want allowed used=2 remaining=0", consumed.Data)
	}

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, tenantRequest(http.MethodPost, "/usage", []byte(`{"key":"api.calls","amount":1}`), tenantID))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("POST /usage over limit status = %d body=%s", rec.Code, rec.Body.String())
	}
	var overLimit decisionEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&overLimit); err != nil {
		t.Fatalf("decode over-limit decision: %v; body=%s", err, rec.Body.String())
	}
	if overLimit.Data.Allowed || overLimit.Data.Reason != "entitlement limit exceeded" ||
		overLimit.Data.Used != 2 || overLimit.Data.Remaining == nil || *overLimit.Data.Remaining != 0 {
		t.Fatalf("over-limit decision = %+v, want 429 denial without counter advance", overLimit.Data)
	}
}
