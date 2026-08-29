//go:build integration

package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/license/model"
	"github.com/clario360/platform/internal/license/repository"
)

const tenantA = "aaaaaaaa-0000-0000-0000-000000000001"

func startLicenseDB(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("license_it"),
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

func newIntegrationService(t *testing.T, pool *pgxpool.Pool) *Service {
	t.Helper()
	return New(pool, repository.New(), zerolog.Nop())
}

// outboxEventTypes returns the staged event types for a tenant, in order.
func outboxEventTypes(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID string) []string {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT event_type FROM event_outbox WHERE tenant_id = $1 ORDER BY created_at, event_type`, tenantID)
	if err != nil {
		t.Fatalf("querying outbox: %v", err)
	}
	defer rows.Close()
	var types []string
	for rows.Next() {
		var et string
		if err := rows.Scan(&et); err != nil {
			t.Fatalf("scanning outbox row: %v", err)
		}
		types = append(types, et)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading outbox rows: %v", err)
	}
	return types
}

func containsEvent(types []string, want string) bool {
	for _, et := range types {
		if et == want {
			return true
		}
	}
	return false
}

func containsPlan(plans []*model.Plan, key string) bool {
	for _, plan := range plans {
		if plan.Key == key {
			return true
		}
	}
	return false
}

type entitlementChangeRecord struct {
	tenantID string
	data     EntitlementsChangedEvent
}

func entitlementChangeEvents(t *testing.T, ctx context.Context, pool *pgxpool.Pool) []entitlementChangeRecord {
	t.Helper()
	rows, err := pool.Query(ctx, `
SELECT tenant_id::text, payload
FROM event_outbox
WHERE event_type = 'com.clario360.license.entitlements_changed'
ORDER BY tenant_id`)
	if err != nil {
		t.Fatalf("querying entitlement change events: %v", err)
	}
	defer rows.Close()

	serializer := events.NewSerializer()
	var records []entitlementChangeRecord
	for rows.Next() {
		var tenantID string
		var payload []byte
		if err := rows.Scan(&tenantID, &payload); err != nil {
			t.Fatalf("scanning entitlement change event: %v", err)
		}
		event, err := serializer.Deserialize(payload)
		if err != nil {
			t.Fatalf("entitlement change payload is not a valid event: %v", err)
		}
		var data EntitlementsChangedEvent
		if err := json.Unmarshal(event.Data, &data); err != nil {
			t.Fatalf("decode entitlement change data: %v", err)
		}
		records = append(records, entitlementChangeRecord{tenantID: tenantID, data: data})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading entitlement change events: %v", err)
	}
	return records
}

// businessPlusPlan creates the catalog plan used across the lifecycle tests.
func businessPlusPlan(t *testing.T, ctx context.Context, svc *Service) *model.Plan {
	t.Helper()
	apiLimit, seatLimit, revoked := int64(100), int64(50), int64(0)
	plan, err := svc.CreatePlan(ctx, &model.Plan{
		Key:         "business-plus",
		Name:        "Business+ Suite",
		Description: "Watheeq, MahamaTech and metered API calls",
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},                    // granted, unlimited
			{Key: "app.mahamatech"},                 // granted, unlimited
			{Key: "api.calls", Limit: &apiLimit},    // metered quota
			{Key: SeatsKey, Limit: &seatLimit},      // plan default, overridden by license seats
			{Key: "app.clariodwh", Limit: &revoked}, // explicitly revoked in this plan
		},
	})
	if err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}
	return plan
}

func TestIntegration_PlanCatalogLifecycle(t *testing.T) {
	ctx, pool := startLicenseDB(t)
	svc := newIntegrationService(t, pool)

	plan, err := svc.CreatePlan(ctx, &model.Plan{
		Key:         "lifecycle-pro",
		Name:        "Lifecycle Pro",
		Description: "Original catalog description",
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},
		},
	})
	if err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}
	if plan.Status != model.PlanStatusActive {
		t.Fatalf("created status = %s, want active", plan.Status)
	}

	updated, err := svc.UpdatePlan(ctx, UpdatePlanInput{
		Key:         "lifecycle-pro",
		Name:        "Lifecycle Pro Updated",
		Description: "Updated catalog description",
	})
	if err != nil {
		t.Fatalf("UpdatePlan() error = %v", err)
	}
	if updated.Name != "Lifecycle Pro Updated" || updated.Description != "Updated catalog description" {
		t.Fatalf("updated plan = %+v, want revised metadata", updated)
	}
	if len(updated.Entitlements) != 1 || updated.Entitlements[0].Key != "app.watheeq" {
		t.Fatalf("updated entitlements = %+v, want unchanged entitlement set", updated.Entitlements)
	}

	if _, err := svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  tenantA,
		PlanKey:   "lifecycle-pro",
		Seats:     5,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
		GraceDays: 14,
	}); err != nil {
		t.Fatalf("AssignLicense(active plan) error = %v", err)
	}

	retired, err := svc.RetirePlan(ctx, "lifecycle-pro")
	if err != nil {
		t.Fatalf("RetirePlan() error = %v", err)
	}
	if retired.Status != model.PlanStatusRetired {
		t.Fatalf("retired status = %s, want retired", retired.Status)
	}

	plans, err := svc.ListPlans(ctx)
	if err != nil {
		t.Fatalf("ListPlans() error = %v", err)
	}
	if containsPlan(plans, "lifecycle-pro") {
		t.Fatalf("ListPlans() included retired plan: %+v", plans)
	}

	_, err = svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  "bbbbbbbb-0000-0000-0000-000000000002",
		PlanKey:   "lifecycle-pro",
		Seats:     1,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
		GraceDays: 14,
	})
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("AssignLicense(retired plan) error = %v, want ErrNotFound", err)
	}

	decision, err := svc.Check(ctx, tenantA, "app.watheeq")
	if err != nil {
		t.Fatalf("Check(existing tenant) error = %v", err)
	}
	if !decision.Allowed || decision.PlanKey != "lifecycle-pro" {
		t.Fatalf("existing tenant decision = %+v, want still allowed on retired plan", decision)
	}

	reactivated, err := svc.ReactivatePlan(ctx, "lifecycle-pro")
	if err != nil {
		t.Fatalf("ReactivatePlan() error = %v", err)
	}
	if reactivated.Status != model.PlanStatusActive {
		t.Fatalf("reactivated status = %s, want active", reactivated.Status)
	}

	plans, err = svc.ListPlans(ctx)
	if err != nil {
		t.Fatalf("ListPlans() after reactivation error = %v", err)
	}
	if !containsPlan(plans, "lifecycle-pro") {
		t.Fatalf("ListPlans() after reactivation = %+v, want lifecycle-pro", plans)
	}

	if _, err := svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  "bbbbbbbb-0000-0000-0000-000000000002",
		PlanKey:   "lifecycle-pro",
		Seats:     1,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
		GraceDays: 14,
	}); err != nil {
		t.Fatalf("AssignLicense(reactivated plan) error = %v", err)
	}
}

func TestIntegration_PlanEntitlementUpdateStagesTenantCacheInvalidation(t *testing.T) {
	ctx, pool := startLicenseDB(t)
	svc := newIntegrationService(t, pool)

	limit := int64(100)
	if _, err := svc.CreatePlan(ctx, &model.Plan{
		Key:         "cache-plan",
		Name:        "Cache Plan",
		Description: "Used to prove plan update invalidation fan-out",
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},
		},
	}); err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}
	for _, tenantID := range []string{
		"bbbbbbbb-0000-0000-0000-000000000002",
		"cccccccc-0000-0000-0000-000000000003",
	} {
		if _, err := svc.AssignLicense(ctx, AssignLicenseInput{
			TenantID:  tenantID,
			PlanKey:   "cache-plan",
			Seats:     5,
			ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
			GraceDays: 14,
		}); err != nil {
			t.Fatalf("AssignLicense(%s) error = %v", tenantID, err)
		}
	}
	if _, err := pool.Exec(ctx, `DELETE FROM event_outbox`); err != nil {
		t.Fatalf("clear outbox before plan update: %v", err)
	}

	updated, err := svc.UpdatePlanEntitlements(ctx, "cache-plan", []model.Entitlement{
		{Key: "app.watheeq"},
		{Key: "api.calls", Limit: &limit},
	})
	if err != nil {
		t.Fatalf("UpdatePlanEntitlements() error = %v", err)
	}
	if len(updated.Entitlements) != 2 {
		t.Fatalf("updated entitlements = %+v, want two entries", updated.Entitlements)
	}

	records := entitlementChangeEvents(t, ctx, pool)
	if len(records) != 2 {
		t.Fatalf("entitlement change events = %+v, want one per assigned tenant", records)
	}
	for _, record := range records {
		if record.data.Reason != entitlementsChangePlanEntitlements ||
			record.data.PlanKey != "cache-plan" ||
			!record.data.InvalidateAll ||
			record.data.EntitlementKey != "" {
			t.Fatalf("entitlement change event = %+v, want plan-wide invalidation", record)
		}
	}
}

func TestIntegration_LicenseLifecycleAndEnforcement(t *testing.T) {
	ctx, pool := startLicenseDB(t)
	svc := newIntegrationService(t, pool)
	businessPlusPlan(t, ctx, svc)

	// --- Assignment stages license.assigned atomically. ---
	lic, err := svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  tenantA,
		PlanKey:   "business-plus",
		Seats:     2,
		ExpiresAt: time.Now().UTC().Add(30 * 24 * time.Hour),
		GraceDays: 14,
	})
	if err != nil {
		t.Fatalf("AssignLicense() error = %v", err)
	}
	if lic.PlanKey != "business-plus" || lic.Status != model.LicenseStatusActive {
		t.Fatalf("license = %+v, want active business-plus", lic)
	}
	types := outboxEventTypes(t, ctx, pool, tenantA)
	if !containsEvent(types, "com.clario360.license.assigned") {
		t.Fatalf("outbox = %v, want license.assigned staged", types)
	}
	if !containsEvent(types, "com.clario360.license.entitlements_changed") {
		t.Fatalf("outbox = %v, want entitlements_changed staged after assignment", types)
	}

	// --- Boolean entitlements. ---
	d, err := svc.Check(ctx, tenantA, "app.watheeq")
	if err != nil {
		t.Fatalf("Check(watheeq) error = %v", err)
	}
	if !d.Allowed || d.Limit != nil || d.PlanKey != "business-plus" {
		t.Fatalf("watheeq decision = %+v, want allowed unlimited", d)
	}

	d, _ = svc.Check(ctx, tenantA, "app.unknown")
	if d.Allowed || d.Reason != "not included in plan" {
		t.Fatalf("unknown-key decision = %+v, want denied not-in-plan", d)
	}

	d, _ = svc.Check(ctx, tenantA, "app.clariodwh")
	if d.Allowed || d.Reason != "entitlement revoked" {
		t.Fatalf("revoked-key decision = %+v, want denied revoked", d)
	}

	// --- Seat precedence: license seats (2) beat the plan default (50). ---
	d, _ = svc.Check(ctx, tenantA, SeatsKey)
	if !d.Allowed || d.Limit == nil || *d.Limit != 2 {
		t.Fatalf("seats decision = %+v, want limit 2 from license seats", d)
	}

	// --- Metered quota: consume to the limit, then over it. ---
	d, err = svc.Consume(ctx, tenantA, "api.calls", 99, true)
	if err != nil || !d.Allowed || d.Used != 99 || *d.Remaining != 1 {
		t.Fatalf("Consume(99) = %+v, %v; want allowed used=99 remaining=1", d, err)
	}
	d, err = svc.Consume(ctx, tenantA, "api.calls", 1, true)
	if err != nil || !d.Allowed || d.Used != 100 || *d.Remaining != 0 {
		t.Fatalf("Consume(1) = %+v, %v; want allowed used=100 remaining=0", d, err)
	}
	if types := outboxEventTypes(t, ctx, pool, tenantA); !containsEvent(types, "com.clario360.license.entitlement.limit_reached") {
		t.Fatalf("outbox = %v, want limit_reached staged on crossing the quota", types)
	}

	d, err = svc.Consume(ctx, tenantA, "api.calls", 1, true)
	if !errors.Is(err, model.ErrLimitExceeded) {
		t.Fatalf("Consume over limit error = %v, want ErrLimitExceeded", err)
	}
	if d == nil || d.Allowed || d.Used != 100 {
		t.Fatalf("over-limit decision = %+v, want denied at used=100", d)
	}
	// The rejected consumption must not have moved the counter.
	d, _ = svc.Check(ctx, tenantA, "api.calls")
	if d.Used != 100 {
		t.Fatalf("counter after rejected consume = %d, want 100", d.Used)
	}

	// --- Overrides raise the quota and are removable. ---
	raised := int64(200)
	if err := svc.SetOverride(ctx, &model.Override{TenantID: tenantA, Key: "api.calls", Limit: &raised, Reason: "pilot extension"}); err != nil {
		t.Fatalf("SetOverride() error = %v", err)
	}
	d, _ = svc.Check(ctx, tenantA, "api.calls")
	if !d.Allowed || *d.Limit != 200 || *d.Remaining != 100 {
		t.Fatalf("post-override decision = %+v, want limit 200 remaining 100", d)
	}
	if err := svc.RemoveOverride(ctx, tenantA, "api.calls"); err != nil {
		t.Fatalf("RemoveOverride() error = %v", err)
	}
	d, _ = svc.Check(ctx, tenantA, "api.calls")
	if d.Allowed {
		t.Fatalf("post-override-removal decision = %+v, want denied at plan limit", d)
	}

	// --- Suspension blocks everything; resumption restores. ---
	if err := svc.SuspendLicense(ctx, tenantA); err != nil {
		t.Fatalf("SuspendLicense() error = %v", err)
	}
	d, _ = svc.Check(ctx, tenantA, "app.watheeq")
	if d.Allowed || d.Reason != "license suspended" {
		t.Fatalf("suspended decision = %+v, want denied suspended", d)
	}
	if err := svc.ResumeLicense(ctx, tenantA); err != nil {
		t.Fatalf("ResumeLicense() error = %v", err)
	}
	d, _ = svc.Check(ctx, tenantA, "app.watheeq")
	if !d.Allowed {
		t.Fatalf("resumed decision = %+v, want allowed", d)
	}

	// --- Expiry: grace window allows, then denies. ---
	expires := lic.ExpiresAt
	svc.now = func() time.Time { return expires.Add(24 * time.Hour) } // day 1 of 14 grace days
	d, _ = svc.Check(ctx, tenantA, "app.watheeq")
	if !d.Allowed || d.LicenseState != model.StateInGrace {
		t.Fatalf("grace decision = %+v, want allowed in_grace", d)
	}
	svc.now = func() time.Time { return expires.Add(15 * 24 * time.Hour) } // past grace
	d, _ = svc.Check(ctx, tenantA, "app.watheeq")
	if d.Allowed || d.Reason != "license expired" {
		t.Fatalf("expired decision = %+v, want denied expired", d)
	}

	// --- No license at all is a denial, not an error. ---
	d, err = svc.Check(ctx, "bbbbbbbb-0000-0000-0000-000000000002", "app.watheeq")
	if err != nil || d.Allowed || d.Reason != "no license assigned" {
		t.Fatalf("unlicensed decision = %+v, %v; want denied no-license", d, err)
	}
}

func TestIntegration_OfflineLicenseIssueAndActivate(t *testing.T) {
	ctx, pool := startLicenseDB(t)
	svc := newIntegrationService(t, pool)
	businessPlusPlan(t, ctx, svc)

	if _, err := svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  tenantA,
		PlanKey:   "business-plus",
		Seats:     25,
		ExpiresAt: time.Now().UTC().Add(365 * 24 * time.Hour),
		GraceDays: 30,
	}); err != nil {
		t.Fatalf("AssignLicense() error = %v", err)
	}

	privatePEM, publicPEM := testKeyPair(t)
	signer, err := NewOfflineSigner(privatePEM)
	if err != nil {
		t.Fatalf("NewOfflineSigner() error = %v", err)
	}
	verifier, err := NewOfflineVerifier(publicPEM)
	if err != nil {
		t.Fatalf("NewOfflineVerifier() error = %v", err)
	}

	// Vendor side: issue the signed file from the live license.
	licenseFile, err := svc.IssueOfflineLicense(ctx, signer, tenantA)
	if err != nil {
		t.Fatalf("IssueOfflineLicense() error = %v", err)
	}

	// Customer side: activate. The embedded plan snapshot is imported and
	// enforcement works from it alone.
	activated, err := svc.ActivateOfflineLicense(ctx, verifier, licenseFile)
	if err != nil {
		t.Fatalf("ActivateOfflineLicense() error = %v", err)
	}
	if activated.OfflineLicenseID == nil {
		t.Fatal("activated license missing offline_license_id")
	}
	if activated.Seats != 25 {
		t.Fatalf("activated seats = %d, want 25", activated.Seats)
	}

	d, err := svc.Check(ctx, tenantA, "app.watheeq")
	if err != nil || !d.Allowed {
		t.Fatalf("post-activation Check = %+v, %v; want allowed", d, err)
	}
	d, _ = svc.Check(ctx, tenantA, SeatsKey)
	if d.Limit == nil || *d.Limit != 25 {
		t.Fatalf("post-activation seats = %+v, want limit 25 from the signed file", d)
	}

	// Re-activating the same file is idempotent.
	again, err := svc.ActivateOfflineLicense(ctx, verifier, licenseFile)
	if err != nil {
		t.Fatalf("re-activation error = %v, want idempotent success", err)
	}
	if *again.OfflineLicenseID != *activated.OfflineLicenseID {
		t.Fatalf("re-activation license ID changed: %s -> %s", *activated.OfflineLicenseID, *again.OfflineLicenseID)
	}

	if types := outboxEventTypes(t, ctx, pool, tenantA); !containsEvent(types, "com.clario360.license.offline_activated") {
		t.Fatalf("outbox = %v, want license.offline_activated staged", types)
	}

	// A tampered file never activates.
	if _, err := svc.ActivateOfflineLicense(ctx, verifier, licenseFile+"x"); err == nil {
		t.Fatal("expected tampered license file to be rejected")
	}
}

func TestIntegration_StagedEventsAreRelayDeliverable(t *testing.T) {
	ctx, pool := startLicenseDB(t)
	svc := newIntegrationService(t, pool)
	businessPlusPlan(t, ctx, svc)

	if _, err := svc.AssignLicense(ctx, AssignLicenseInput{
		TenantID:  tenantA,
		PlanKey:   "business-plus",
		Seats:     5,
		ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
		GraceDays: 7,
	}); err != nil {
		t.Fatalf("AssignLicense() error = %v", err)
	}
	if err := svc.SuspendLicense(ctx, tenantA); err != nil {
		t.Fatalf("SuspendLicense() error = %v", err)
	}

	// The staged rows are valid CloudEvents on the license topic — exactly
	// what the relay claims and publishes.
	rows, err := pool.Query(ctx, `SELECT topic, payload FROM event_outbox WHERE tenant_id = $1`, tenantA)
	if err != nil {
		t.Fatalf("querying outbox: %v", err)
	}
	defer rows.Close()

	serializer := events.NewSerializer()
	count := 0
	for rows.Next() {
		var topic string
		var payload []byte
		if err := rows.Scan(&topic, &payload); err != nil {
			t.Fatalf("scanning outbox row: %v", err)
		}
		if topic != events.Topics.LicenseEvents {
			t.Fatalf("staged topic = %s, want %s", topic, events.Topics.LicenseEvents)
		}
		event, err := serializer.Deserialize(payload)
		if err != nil {
			t.Fatalf("staged payload is not a valid CloudEvent: %v", err)
		}
		if event.TenantID != tenantA || event.Source != "clario360/license-service" {
			t.Fatalf("staged event envelope = %+v, want tenant %s from license-service", event, tenantA)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading outbox rows: %v", err)
	}
	if count != 4 {
		t.Fatalf("staged events = %d, want 4 (assigned/suspended + invalidation events)", count)
	}
}
