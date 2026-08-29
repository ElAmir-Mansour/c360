package service_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/recoverytier"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/worm"
)

type fakeRunner struct {
	db           repository.DBTX
	writeTenants []uuid.UUID
	readTenants  []uuid.UUID
}

func (r *fakeRunner) RunWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.writeTenants = append(r.writeTenants, tenantID)
	return fn(r.db)
}

func (r *fakeRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.readTenants = append(r.readTenants, tenantID)
	return fn(r.db)
}

type stagedEvent struct {
	eventType string
	tenantID  string
	data      map[string]any
}

type fakeStager struct {
	events []stagedEvent
}

func (s *fakeStager) Stage(_ context.Context, _ repository.DBTX, eventType string, tenantID string, data map[string]any) error {
	s.events = append(s.events, stagedEvent{eventType: eventType, tenantID: tenantID, data: data})
	return nil
}

func newMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func newService(db repository.DBTX, stager *fakeStager) (*service.Service, *fakeRunner) {
	runner := &fakeRunner{db: db}
	return service.NewWithDeps(runner, repository.New(), stager, zerolog.Nop()), runner
}

type fakeWORM struct {
	ensureCalls int
	sealed      []worm.SealOptions
	holds       map[string]bool
	chunks      map[string][]byte
}

func (w *fakeWORM) EnsureBucket(context.Context) error {
	w.ensureCalls++
	return nil
}

func (w *fakeWORM) Seal(_ context.Context, source io.Reader, opts worm.SealOptions) (worm.SealResult, error) {
	data, err := io.ReadAll(source)
	if err != nil {
		return worm.SealResult{}, err
	}
	w.sealed = append(w.sealed, opts)
	key := "sealed/" + opts.StreamID
	if w.chunks == nil {
		w.chunks = map[string][]byte{}
	}
	w.chunks[key] = append([]byte(nil), data...)
	sum := sha256.Sum256(data)
	return worm.SealResult{
		Key:             key,
		PlaintextSHA256: hex.EncodeToString(sum[:]),
		CiphertextBytes: int64(len(data) + 12),
		KEKVersion:      1,
		RetainUntil:     opts.RetainUntil,
	}, nil
}

func (w *fakeWORM) Get(_ context.Context, _ uuid.UUID, _ string, key string) ([]byte, error) {
	if w.chunks != nil {
		return w.chunks[key], nil
	}
	return []byte("chunk"), nil
}

func (w *fakeWORM) SetLegalHold(_ context.Context, key string, hold bool) error {
	if w.holds == nil {
		w.holds = map[string]bool{}
	}
	w.holds[key] = hold
	return nil
}

type fakeValidator struct {
	ratio map[string]float64
}

func (v fakeValidator) Validate(_ context.Context, streamID string, _ core.RecoveryPointRef) (core.Validation, error) {
	return core.Validation{MatchRatio: v.ratio[streamID], Checks: 10}, nil
}

func testContentHash(objectKeys map[string]string, chunks map[string][]byte) string {
	streamIDs := make([]string, 0, len(objectKeys))
	for streamID := range objectKeys {
		streamIDs = append(streamIDs, streamID)
	}
	sort.Strings(streamIDs)
	h := sha256.New()
	for _, streamID := range streamIDs {
		sum := sha256.Sum256(chunks[objectKeys[streamID]])
		h.Write([]byte(hex.EncodeToString(sum[:])))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func assertRecoveryTier(t *testing.T, site *model.ProtectedSite, wantTier recoverytier.Tier, wantStrategy recoverytier.Strategy, wantRTOSeconds, wantRPOSeconds int) {
	t.Helper()

	rec := site.RecoveryTierRecommendation
	if rec == nil {
		t.Fatalf("site %s recovery tier recommendation = nil", site.Name)
	}
	if rec.Tier != string(wantTier) {
		t.Fatalf("site %s tier = %s, want %s", site.Name, rec.Tier, wantTier)
	}
	if rec.Strategy != string(wantStrategy) {
		t.Fatalf("site %s strategy = %s, want %s", site.Name, rec.Strategy, wantStrategy)
	}
	if rec.RTOObjectiveSeconds != wantRTOSeconds || rec.RPOObjectiveSeconds != wantRPOSeconds {
		t.Fatalf("site %s recommendation objectives = %d/%d, want %d/%d",
			site.Name, rec.RTOObjectiveSeconds, rec.RPOObjectiveSeconds, wantRTOSeconds, wantRPOSeconds)
	}
	if rec.ValidationCadenceSeconds <= 0 {
		t.Fatalf("site %s validation cadence = %d, want positive", site.Name, rec.ValidationCadenceSeconds)
	}
	if len(rec.Capabilities) == 0 || len(rec.Notes) == 0 {
		t.Fatalf("site %s recommendation capabilities/notes = %v/%v, want populated", site.Name, rec.Capabilities, rec.Notes)
	}

	profile, ok := recoverytier.Lookup(wantTier)
	if !ok {
		t.Fatalf("test tier %s not found", wantTier)
	}
	if rec.ValidationCadenceSeconds != int(profile.MinimumValidationCadence/time.Second) {
		t.Fatalf("site %s validation cadence = %d, want %d",
			site.Name, rec.ValidationCadenceSeconds, int(profile.MinimumValidationCadence/time.Second))
	}
	if rec.RequiresCyberVault != profile.RequiresCyberVault {
		t.Fatalf("site %s requires_cyber_vault = %v, want %v", site.Name, rec.RequiresCyberVault, profile.RequiresCyberVault)
	}
	if rec.RequiresCleanRoom != profile.RequiresCleanRoom {
		t.Fatalf("site %s requires_clean_room = %v, want %v", site.Name, rec.RequiresCleanRoom, profile.RequiresCleanRoom)
	}
}

func assertObjectiveFitWarning(t *testing.T, site *model.ProtectedSite, wantStatus string) {
	t.Helper()

	if site.RecoveryTierRecommendation != nil {
		t.Fatalf("site %s recovery tier recommendation = %+v, want nil", site.Name, site.RecoveryTierRecommendation)
	}
	if site.ObjectiveFit == nil {
		t.Fatalf("site %s objective fit = nil", site.Name)
	}
	if site.ObjectiveFit.Status != wantStatus {
		t.Fatalf("site %s objective fit status = %s, want %s", site.Name, site.ObjectiveFit.Status, wantStatus)
	}
	if site.ObjectiveFit.RTOObjectiveSeconds != site.RTOObjectiveSeconds || site.ObjectiveFit.RPOObjectiveSeconds != site.RPOObjectiveSeconds {
		t.Fatalf("site %s objective fit objectives = %d/%d, want %d/%d",
			site.Name,
			site.ObjectiveFit.RTOObjectiveSeconds,
			site.ObjectiveFit.RPOObjectiveSeconds,
			site.RTOObjectiveSeconds,
			site.RPOObjectiveSeconds)
	}
	if len(site.ObjectiveFit.Warnings) == 0 {
		t.Fatalf("site %s objective fit warnings = none, want warning", site.Name)
	}
}

func TestCreateSite_UsesTenantWriteAndStagesEvent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, runner := newService(mock, stager)

	mock.ExpectQuery(`INSERT INTO protected_site`).
		WithArgs(tenantID.String(), "prod-db", model.SiteKindDatabase, "pg://primary", 900, 300).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(uuid.NewString(), now, now))

	site, err := svc.CreateSite(context.Background(), tenantID, service.CreateSiteInput{
		Name:            "prod-db",
		Kind:            model.SiteKindDatabase,
		PrimaryEndpoint: "pg://primary",
	})
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	if site.TenantID != tenantID.String() {
		t.Fatalf("site tenant = %s, want %s", site.TenantID, tenantID)
	}
	if len(runner.writeTenants) != 1 || runner.writeTenants[0] != tenantID {
		t.Fatalf("write tenants = %v, want [%s]", runner.writeTenants, tenantID)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.site.created" {
		t.Fatalf("staged events = %+v, want dr.site.created", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateSite_AnnotatesRecoveryTierRecommendation(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`INSERT INTO protected_site`).
		WithArgs(tenantID.String(), "orders-db", model.SiteKindDatabase, "pg://orders", 3600, 900).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(uuid.NewString(), now, now))

	site, err := svc.CreateSite(context.Background(), tenantID, service.CreateSiteInput{
		Name:                "orders-db",
		Kind:                model.SiteKindDatabase,
		PrimaryEndpoint:     "pg://orders",
		RTOObjectiveSeconds: 3600,
		RPOObjectiveSeconds: 900,
	})
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	assertRecoveryTier(t, site, recoverytier.TierGold, recoverytier.StrategyWarmStandby, 3600, 900)
	if site.ObjectiveFit == nil || site.ObjectiveFit.Status != model.ObjectiveFitStatusSatisfied {
		t.Fatalf("objective fit = %+v, want satisfied", site.ObjectiveFit)
	}
	if len(site.ObjectiveFit.Warnings) != 0 {
		t.Fatalf("objective fit warnings = %v, want none", site.ObjectiveFit.Warnings)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateSite_RejectsUnsupportedIaCBeforeWrite(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(nil, stager)

	_, err := svc.CreateSite(context.Background(), tenantID, service.CreateSiteInput{
		Name:            "tf-state",
		Kind:            model.SiteKindIaC,
		PrimaryEndpoint: "git://infra",
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(runner.writeTenants) != 0 {
		t.Fatalf("write tenants = %v, want no transaction for unsupported kind", runner.writeTenants)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
}

func TestListSites_UsesTenantRead(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, runner := newService(mock, stager)

	mock.ExpectQuery(`FROM protected_site WHERE tenant_id = \$1 ORDER BY name`).
		WithArgs(tenantID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "kind", "primary_endpoint",
			"rto_objective_seconds", "rpo_objective_seconds", "created_at", "updated_at",
		}).AddRow(uuid.NewString(), tenantID.String(), "prod-db", model.SiteKindDatabase, "pg://primary", 900, 300, now, now))

	sites, err := svc.ListSites(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("ListSites: %v", err)
	}
	if len(sites) != 1 {
		t.Fatalf("sites len = %d, want 1", len(sites))
	}
	if len(runner.readTenants) != 1 || runner.readTenants[0] != tenantID {
		t.Fatalf("read tenants = %v, want [%s]", runner.readTenants, tenantID)
	}
	if len(runner.writeTenants) != 0 {
		t.Fatalf("write tenants = %v, want none", runner.writeTenants)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListSites_AnnotatesAllSitesWithRecoveryTierRecommendations(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM protected_site WHERE tenant_id = \$1 ORDER BY name`).
		WithArgs(tenantID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "kind", "primary_endpoint",
			"rto_objective_seconds", "rpo_objective_seconds", "created_at", "updated_at",
		}).
			AddRow(uuid.NewString(), tenantID.String(), "audit-archive", model.SiteKindFileset, "s3://archive", 86400, 86400, now, now).
			AddRow(uuid.NewString(), tenantID.String(), "payments-api", model.SiteKindVM, "https://payments", 300, 60, now, now))

	sites, err := svc.ListSites(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("ListSites: %v", err)
	}
	if len(sites) != 2 {
		t.Fatalf("sites len = %d, want 2", len(sites))
	}
	assertRecoveryTier(t, sites[0], recoverytier.TierBronze, recoverytier.StrategyBackupRestore, 86400, 86400)
	assertRecoveryTier(t, sites[1], recoverytier.TierPlatinum, recoverytier.StrategyActiveActive, 300, 60)
	for _, site := range sites {
		if site.ObjectiveFit == nil || site.ObjectiveFit.Status != model.ObjectiveFitStatusSatisfied {
			t.Fatalf("site %s objective fit = %+v, want satisfied", site.Name, site.ObjectiveFit)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSiteRecoveryTier_FlagsUnfitObjectivesWithoutFailingCreationOrListing(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)
	unsatisfiedID := uuid.NewString()
	invalidID := uuid.NewString()

	mock.ExpectQuery(`INSERT INTO protected_site`).
		WithArgs(tenantID.String(), "latency-critical", model.SiteKindDatabase, "pg://critical", 30, 30).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(unsatisfiedID, now, now))

	created, err := svc.CreateSite(context.Background(), tenantID, service.CreateSiteInput{
		Name:                "latency-critical",
		Kind:                model.SiteKindDatabase,
		PrimaryEndpoint:     "pg://critical",
		RTOObjectiveSeconds: 30,
		RPOObjectiveSeconds: 30,
	})
	if err != nil {
		t.Fatalf("CreateSite: %v", err)
	}
	assertObjectiveFitWarning(t, created, model.ObjectiveFitStatusOutsideCatalog)

	mock.ExpectQuery(`FROM protected_site WHERE tenant_id = \$1 ORDER BY name`).
		WithArgs(tenantID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "kind", "primary_endpoint",
			"rto_objective_seconds", "rpo_objective_seconds", "created_at", "updated_at",
		}).
			AddRow(unsatisfiedID, tenantID.String(), "latency-critical", model.SiteKindDatabase, "pg://critical", 30, 30, now, now).
			AddRow(invalidID, tenantID.String(), "legacy-zero", model.SiteKindVM, "ssh://legacy", 0, 300, now, now))

	sites, err := svc.ListSites(context.Background(), tenantID)
	if err != nil {
		t.Fatalf("ListSites: %v", err)
	}
	if len(sites) != 2 {
		t.Fatalf("sites len = %d, want 2", len(sites))
	}
	assertObjectiveFitWarning(t, sites[0], model.ObjectiveFitStatusOutsideCatalog)
	assertObjectiveFitWarning(t, sites[1], model.ObjectiveFitStatusInvalid)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateStream_RejectsCallerAssertedLiveStatusBeforeWrite(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	siteID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(nil, stager)

	_, err := svc.CreateStream(context.Background(), tenantID, service.CreateStreamInput{
		SiteID: siteID,
		Status: model.StreamStatusStreaming,
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(runner.writeTenants) != 0 {
		t.Fatalf("write tenants = %v, want no transaction for invalid stream status", runner.writeTenants)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
}

func TestSetStreamStatus_AllowsOnlyPauseOrResumeToPending(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	streamID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(nil, stager)

	for _, status := range []string{model.StreamStatusStreaming, model.StreamStatusDegraded, model.StreamStatusError, model.StreamStatusSeeding} {
		beforeWrites := len(runner.writeTenants)
		err := svc.SetStreamStatus(context.Background(), tenantID, streamID, status)
		if !service.IsValidation(err) {
			t.Fatalf("status %s err = %v, want validation error", status, err)
		}
		if len(runner.writeTenants) != beforeWrites {
			t.Fatalf("status %s write tenants = %v, want unchanged", status, runner.writeTenants)
		}
	}
}

func TestPauseTenantStreams_StagesBulkPauseEvent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(mock, stager)

	mock.ExpectExec(`UPDATE replication_stream\s+SET status = 'paused'`).
		WithArgs(tenantID.String(), "com.clario360.license.suspended").
		WillReturnResult(pgxmock.NewResult("UPDATE", 2))

	paused, err := svc.PauseTenantStreams(context.Background(), tenantID, "com.clario360.license.suspended")
	if err != nil {
		t.Fatalf("PauseTenantStreams: %v", err)
	}
	if paused != 2 {
		t.Fatalf("paused = %d, want 2", paused)
	}
	if len(runner.writeTenants) != 1 || runner.writeTenants[0] != tenantID {
		t.Fatalf("write tenants = %v, want [%s]", runner.writeTenants, tenantID)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.streams.paused" {
		t.Fatalf("staged events = %+v, want dr.streams.paused", stager.events)
	}
	if stager.events[0].data["paused_count"] != int64(2) {
		t.Fatalf("paused_count = %v, want 2", stager.events[0].data["paused_count"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPauseTenantStreams_NoRowsDoesNotStageEvent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectExec(`UPDATE replication_stream\s+SET status = 'paused'`).
		WithArgs(tenantID.String(), "paused by cross-suite control event").
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	paused, err := svc.PauseTenantStreams(context.Background(), tenantID, "")
	if err != nil {
		t.Fatalf("PauseTenantStreams: %v", err)
	}
	if paused != 0 {
		t.Fatalf("paused = %d, want 0", paused)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateAgent_RejectsCallerAssertedActiveStatusBeforeWrite(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(nil, stager)

	_, err := svc.CreateAgent(context.Background(), tenantID, service.CreateAgentInput{
		Status: model.AgentStatusActive,
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(runner.writeTenants) != 0 {
		t.Fatalf("write tenants = %v, want no transaction for invalid agent status", runner.writeTenants)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
}

func TestCreateRecoveryPoint_ValidatedPointReconcilesLegalHold(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	now := time.Now()
	ratio := 0.9995
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM consistency_group WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "created_at"}).
			AddRow(groupID.String(), tenantID.String(), "payments", now))
	mock.ExpectQuery(`INSERT INTO recovery_point`).
		WithArgs(tenantID.String(), groupID.String(), "0/16B6248", 12, pgxmock.AnyArg(), "deadbeef", &ratio, true, true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "sealed_at"}).AddRow(uuid.NewString(), now))
	mock.ExpectExec(`WITH ranked AS`).
		WithArgs(tenantID.String(), groupID.String(), 3).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 3"))

	point, err := svc.CreateRecoveryPoint(context.Background(), tenantID, groupID, service.CreateRecoveryPointInput{
		MarkerLSN:       "0/16B6248",
		RPOSeconds:      12,
		ObjectKeys:      map[string]string{"site-1": "dr-recovery-points/site-1/chunk-0"},
		ContentHash:     "deadbeef",
		ValidationRatio: &ratio,
		IsValidated:     true,
		RetentionUntil:  now.Add(7 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateRecoveryPoint: %v", err)
	}
	if !point.LegalHold {
		t.Fatal("validated recovery point legal hold = false, want true")
	}
	if len(stager.events) != 1 || stager.events[0].data["legal_hold"] != true {
		t.Fatalf("staged events = %+v, want legal_hold=true", stager.events)
	}
	if got := stager.events[0].data["group_id"]; got != groupID.String() {
		t.Fatalf("staged group_id = %v, want %s", got, groupID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSetRecoveryPointValidation_ReconcilesGroupLegalHolds(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), pointID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
			[]byte(`{"site-1":"dr-recovery-points/site-1/chunk-0"}`), "deadbeef", nil, false,
			false, now, now.Add(7*24*time.Hour)))
	mock.ExpectExec(`UPDATE recovery_point SET validation_ratio`).
		WithArgs(tenantID.String(), pointID.String(), 0.9995, true).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectExec(`WITH ranked AS`).
		WithArgs(tenantID.String(), groupID.String(), 3).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 3"))

	err := svc.SetRecoveryPointValidation(context.Background(), tenantID, pointID, 0.9995, true)
	if err != nil {
		t.Fatalf("SetRecoveryPointValidation: %v", err)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.recovery_point.validation_recorded" {
		t.Fatalf("staged events = %+v, want validation_recorded", stager.events)
	}
	if got := stager.events[0].data["group_id"]; got != groupID.String() {
		t.Fatalf("staged group_id = %v, want %s", got, groupID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSealRecoveryPoint_SealsMembersInBootOrderAndPersistsIndex(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteA := uuid.NewString()
	siteB := uuid.NewString()
	streamA := uuid.NewString()
	streamB := uuid.NewString()
	now := time.Now().UTC()
	retentionUntil := now.Add(7 * 24 * time.Hour)
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)
	svc.WithRecoveryPoint(wormStore, service.BytesChunkSource{
		Data: map[string][]byte{
			streamA: []byte("site-a-data"),
			streamB: []byte("site-b-data"),
		},
		Marker: map[string]string{
			streamA: "0/1",
			streamB: "0/2",
		},
		LastCommit: map[string]time.Time{
			streamA: now.Add(-10 * time.Second),
			streamB: now.Add(-5 * time.Second),
		},
	}, nil, 2)

	mock.ExpectQuery(`FROM consistency_group WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "created_at"}).
			AddRow(groupID.String(), tenantID.String(), "payments", now))
	mock.ExpectQuery(`FROM consistency_group_member WHERE group_id = \$1 ORDER BY boot_order, site_id`).
		WithArgs(groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"group_id", "site_id", "boot_order"}).
			AddRow(groupID.String(), siteA, 20).
			AddRow(groupID.String(), siteB, 10))
	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id = \$1 AND site_id = \$2`).
		WithArgs(tenantID.String(), siteA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "site_id", "status", "applied_seq",
			"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
		}).AddRow(streamA, tenantID.String(), siteA, model.StreamStatusStreaming, int64(10), "0/1", now.Add(-10*time.Second), nil, nil, now, now))
	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id = \$1 AND site_id = \$2`).
		WithArgs(tenantID.String(), siteB).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "site_id", "status", "applied_seq",
			"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
		}).AddRow(streamB, tenantID.String(), siteB, model.StreamStatusStreaming, int64(11), "0/2", now.Add(-5*time.Second), nil, nil, now, now))
	mock.ExpectQuery(`INSERT INTO recovery_point`).
		WithArgs(tenantID.String(), groupID.String(), "0/2", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), false, false, retentionUntil).
		WillReturnRows(pgxmock.NewRows([]string{"id", "sealed_at"}).AddRow(uuid.NewString(), now))

	point, err := svc.SealRecoveryPoint(context.Background(), tenantID, groupID, service.SealRecoveryPointInput{
		RetentionUntil: retentionUntil,
	})
	if err != nil {
		t.Fatalf("SealRecoveryPoint: %v", err)
	}
	if wormStore.ensureCalls != 1 {
		t.Fatalf("EnsureBucket calls = %d, want 1", wormStore.ensureCalls)
	}
	if len(wormStore.sealed) != 2 || wormStore.sealed[0].StreamID != streamB || wormStore.sealed[1].StreamID != streamA {
		t.Fatalf("sealed order = %+v, want streamB then streamA", wormStore.sealed)
	}
	if point.MarkerLSN != "0/2" || len(point.ObjectKeys) != 2 || point.ContentHash == "" {
		t.Fatalf("point = %+v, want marker/object keys/content hash", point)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.recovery_point.sealed" {
		t.Fatalf("staged events = %+v, want sealed", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSealRecoveryPoint_DefaultChunkSourceSealsDurableAppliedBytes(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteID := uuid.NewString()
	streamID := uuid.NewString()
	now := time.Now().UTC()
	appliedAt := now.Add(-12 * time.Second)
	retentionUntil := now.Add(7 * 24 * time.Hour)
	appliedOne := []byte("durable-applied-one|")
	appliedTwo := []byte("durable-applied-two")
	wantPlaintext := append(append([]byte(nil), appliedOne...), appliedTwo...)
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)
	svc.WithRecoveryPoint(wormStore, nil, nil, 2)

	mock.ExpectQuery(`FROM consistency_group WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "created_at"}).
			AddRow(groupID.String(), tenantID.String(), "payments", now))
	mock.ExpectQuery(`FROM consistency_group_member WHERE group_id = \$1 ORDER BY boot_order, site_id`).
		WithArgs(groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"group_id", "site_id", "boot_order"}).
			AddRow(groupID.String(), siteID, 10))
	mock.ExpectQuery(`FROM replication_stream WHERE tenant_id = \$1 AND site_id = \$2`).
		WithArgs(tenantID.String(), siteID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "site_id", "status", "applied_seq",
			"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
		}).AddRow(streamID, tenantID.String(), siteID, model.StreamStatusStreaming, int64(2), "0/CURSOR", appliedAt, nil, nil, now, now))
	mock.ExpectQuery(`WITH ordered AS`).
		WithArgs(tenantID.String(), streamID, int64(2)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "seq", "kind", "source_marker",
			"payload", "payload_sha256", "payload_bytes", "applied_at", "created_at",
		}).
			AddRow("frame-1", tenantID.String(), streamID, int64(1), core.FrameKindWAL.String(), "0/APPLIED1",
				appliedOne, sha256Hex(appliedOne), int64(len(appliedOne)), appliedAt.Add(-time.Second), now).
			AddRow("frame-2", tenantID.String(), streamID, int64(2), core.FrameKindWAL.String(), "0/APPLIED2",
				appliedTwo, sha256Hex(appliedTwo), int64(len(appliedTwo)), appliedAt, now))
	mock.ExpectQuery(`INSERT INTO recovery_point`).
		WithArgs(tenantID.String(), groupID.String(), "0/APPLIED2", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), false, false, retentionUntil).
		WillReturnRows(pgxmock.NewRows([]string{"id", "sealed_at"}).AddRow(uuid.NewString(), now))

	point, err := svc.SealRecoveryPoint(context.Background(), tenantID, groupID, service.SealRecoveryPointInput{
		RetentionUntil: retentionUntil,
	})
	if err != nil {
		t.Fatalf("SealRecoveryPoint: %v", err)
	}
	key := point.ObjectKeys[streamID]
	gotPlaintext := wormStore.chunks[key]
	if !bytes.Equal(gotPlaintext, wantPlaintext) {
		t.Fatalf("sealed plaintext = %q, want durable applied bytes %q", gotPlaintext, wantPlaintext)
	}
	if len(gotPlaintext) == 0 || bytes.Contains(gotPlaintext, []byte("clario-dr.checkpoint")) || bytes.Contains(gotPlaintext, []byte(streamID)) {
		t.Fatalf("sealed checkpoint coordinates instead of applied bytes: %q", gotPlaintext)
	}
	if point.MarkerLSN != "0/APPLIED2" || wormStore.sealed[0].MarkerLSN != "0/APPLIED2" {
		t.Fatalf("marker = point:%q seal:%q, want applied marker 0/APPLIED2", point.MarkerLSN, wormStore.sealed[0].MarkerLSN)
	}
	if point.ContentHash != testContentHash(point.ObjectKeys, wormStore.chunks) {
		t.Fatalf("content hash = %s, want hash chain over sealed applied bytes", point.ContentHash)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRecoveryPoint_ReconcilesAndSyncsWORMLegalHolds(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	olderID := uuid.New()
	streamA := uuid.NewString()
	streamB := uuid.NewString()
	now := time.Now().UTC()
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)
	svc.WithRecoveryPoint(wormStore, nil, fakeValidator{ratio: map[string]float64{
		streamA: 0.9998,
		streamB: 0.9992,
	}}, 2)

	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), pointID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
			[]byte(`{"`+streamA+`":"k-a","`+streamB+`":"k-b"}`), "deadbeef", 0.0, false,
			false, now, now.Add(7*24*time.Hour)))
	mock.ExpectExec(`UPDATE recovery_point SET validation_ratio`).
		WithArgs(tenantID.String(), pointID.String(), 0.9992, true).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectExec(`WITH ranked AS`).
		WithArgs(tenantID.String(), groupID.String(), 2).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 2"))
	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND group_id = \$2 ORDER BY sealed_at DESC`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).
			AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
				[]byte(`{"`+streamA+`":"k-a","`+streamB+`":"k-b"}`), "deadbeef", 0.9992, true,
				true, now, now.Add(7*24*time.Hour)).
			AddRow(olderID.String(), tenantID.String(), groupID.String(), "0/16B0000", 30,
				[]byte(`{"old-stream":"old-key"}`), "oldhash", 0.9999, true,
				false, now.Add(-time.Hour), now.Add(7*24*time.Hour)))

	point, err := svc.ValidateRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if !point.IsValidated || point.ValidationRatio == nil || *point.ValidationRatio != 0.9992 || !point.LegalHold {
		t.Fatalf("point = %+v, want validated ratio .9992 and legal hold", point)
	}
	if got := wormStore.holds["k-a"]; !got {
		t.Fatalf("legal hold k-a = %v, want true", got)
	}
	if got := wormStore.holds["k-b"]; !got {
		t.Fatalf("legal hold k-b = %v, want true", got)
	}
	if got := wormStore.holds["old-key"]; got {
		t.Fatalf("legal hold old-key = %v, want false", got)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.recovery_point.validated" {
		t.Fatalf("staged events = %+v, want validated", stager.events)
	}
	if got := stager.events[0].data["group_id"]; got != groupID.String() {
		t.Fatalf("staged group_id = %v, want %s", got, groupID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRecoveryPoint_DefaultValidatorChecksContentHashChain(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	streamA := uuid.NewString()
	streamB := uuid.NewString()
	now := time.Now().UTC()
	objectKeys := map[string]string{streamA: "k-a", streamB: "k-b"}
	chunks := map[string][]byte{"k-a": []byte("chunk-a"), "k-b": []byte("chunk-b")}
	contentHash := testContentHash(objectKeys, chunks)
	stager := &fakeStager{}
	wormStore := &fakeWORM{chunks: chunks}
	svc, _ := newService(mock, stager)
	svc.WithRecoveryPoint(wormStore, nil, nil, 2)

	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), pointID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
			[]byte(`{"`+streamA+`":"k-a","`+streamB+`":"k-b"}`), contentHash, 0.0, false,
			false, now, now.Add(7*24*time.Hour)))
	mock.ExpectExec(`UPDATE recovery_point SET validation_ratio`).
		WithArgs(tenantID.String(), pointID.String(), 1.0, true).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectExec(`WITH ranked AS`).
		WithArgs(tenantID.String(), groupID.String(), 2).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND group_id = \$2 ORDER BY sealed_at DESC`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
			[]byte(`{"`+streamA+`":"k-a","`+streamB+`":"k-b"}`), contentHash, 1.0, true,
			true, now, now.Add(7*24*time.Hour)))

	point, err := svc.ValidateRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if !point.IsValidated || point.ValidationRatio == nil || *point.ValidationRatio != 1.0 {
		t.Fatalf("point = %+v, want validated ratio 1.0", point)
	}
	if !wormStore.holds["k-a"] || !wormStore.holds["k-b"] {
		t.Fatalf("worm holds = %+v, want both chunks held", wormStore.holds)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAddGroupMember_VerifiesTenantOwnedGroupAndSite(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM consistency_group WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), groupID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "name", "created_at"}).
			AddRow(groupID.String(), tenantID.String(), "payments", now))
	mock.ExpectQuery(`FROM protected_site WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), siteID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "kind", "primary_endpoint",
			"rto_objective_seconds", "rpo_objective_seconds", "created_at", "updated_at",
		}).AddRow(siteID.String(), tenantID.String(), "prod-db", model.SiteKindDatabase, "pg://primary", 900, 300, now, now))
	mock.ExpectExec(`INSERT INTO consistency_group_member`).
		WithArgs(groupID.String(), siteID.String(), 10).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	member, err := svc.AddGroupMember(context.Background(), tenantID, groupID, service.AddGroupMemberInput{
		SiteID:    siteID,
		BootOrder: 10,
	})
	if err != nil {
		t.Fatalf("AddGroupMember: %v", err)
	}
	if member.GroupID != groupID.String() || member.SiteID != siteID.String() {
		t.Fatalf("member = %+v, want group/site ids", member)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.group.member_added" {
		t.Fatalf("staged events = %+v, want member_added", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTransitionFailoverRun_RejectsSkippedGateBeforeWrite(t *testing.T) {
	t.Parallel()

	tenantID := uuid.New()
	runID := uuid.New()
	stager := &fakeStager{}
	svc, runner := newService(nil, stager)

	_, err := svc.TransitionFailoverRun(context.Background(), tenantID, runID, service.TransitionFailoverRunInput{
		ExpectedStatus: model.StatusInitiated,
		NewStatus:      model.StatusExecuting,
	})
	if !errors.Is(err, model.ErrInvalidState) {
		t.Fatalf("err = %v, want ErrInvalidState", err)
	}
	if len(runner.writeTenants) != 0 {
		t.Fatalf("write tenants = %v, want no transaction for invalid transition", runner.writeTenants)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
}

func TestApproveFailoverRun_RealRequiresReason(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approver := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, approver)

	_, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver, service.ApproveFailoverRunInput{
		Decision:         "approve",
		StepUpVerifiedAt: ptr(now),
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_RealInitiatorCannotApprove(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, initiator)

	_, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, initiator, service.ApproveFailoverRunInput{
		Decision:         "approve",
		Reason:           "primary region unavailable",
		StepUpVerifiedAt: ptr(now),
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_RealRequiresFreshStepUp(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approver := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, approver)

	_, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver, service.ApproveFailoverRunInput{
		Decision: "approve",
		Reason:   "primary region unavailable",
	})
	if !service.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_RealRequiresTwoApprovers(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approver1 := uuid.New()
	approver2 := uuid.New()
	approval1 := uuid.New()
	approval2 := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, approver1)
	expectInsertFailoverApproval(mock, tenantID, runID, approver1, approval1, "primary region unavailable", now)
	expectApprovalCount(mock, tenantID, runID, 1)
	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)

	first, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver1, service.ApproveFailoverRunInput{
		Decision:         "approve",
		Reason:           "primary region unavailable",
		StepUpVerifiedAt: ptr(now),
	})
	if err != nil {
		t.Fatalf("first ApproveFailoverRun: %v", err)
	}
	if first.Status != model.StatusAwaitingApproval {
		t.Fatalf("first status = %s, want %s", first.Status, model.StatusAwaitingApproval)
	}

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, approver2)
	expectInsertFailoverApproval(mock, tenantID, runID, approver2, approval2, "incident commander approval", now)
	expectApprovalCount(mock, tenantID, runID, 2)
	mock.ExpectExec(`UPDATE failover_run SET approved_by`).
		WithArgs(tenantID.String(), runID.String(), approver2.String(), model.StatusApproved).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusApproved, initiator, ptr(approver2), now)

	second, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver2, service.ApproveFailoverRunInput{
		Decision:         "approve",
		Reason:           "incident commander approval",
		StepUpVerifiedAt: ptr(now),
	})
	if err != nil {
		t.Fatalf("second ApproveFailoverRun: %v", err)
	}
	if second.Status != model.StatusApproved {
		t.Fatalf("second status = %s, want %s", second.Status, model.StatusApproved)
	}
	if len(stager.events) != 2 {
		t.Fatalf("staged events = %+v, want two approval events", stager.events)
	}
	if stager.events[0].eventType != "dr.failover_run.approval_submitted" || stager.events[0].data["approval_count"] != 1 {
		t.Fatalf("first event = %+v", stager.events[0])
	}
	if stager.events[1].eventType != "dr.failover_run.approved" || stager.events[1].data["approval_count"] != 2 {
		t.Fatalf("second event = %+v", stager.events[1])
	}
	if stager.events[1].data["approval_quorum"] != 2 || stager.events[1].data["reason_present"] != true {
		t.Fatalf("approved event data = %+v", stager.events[1].data)
	}
	if _, ok := stager.events[1].data["approved_by"]; ok {
		t.Fatalf("approved event leaked approved_by: %+v", stager.events[1].data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_DuplicateApproverIsIdempotent(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approver := uuid.New()
	approvalID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectFailoverApproval(mock, tenantID, runID, approver, approvalID, "existing reason", now)
	expectApprovalCount(mock, tenantID, runID, 1)
	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)

	run, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver)
	if err != nil {
		t.Fatalf("ApproveFailoverRun duplicate: %v", err)
	}
	if run.Status != model.StatusAwaitingApproval {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusAwaitingApproval)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none for duplicate", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_DrillDefaultsToSingleApprover(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approvalID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeDrill, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeDrill)
	expectNoFailoverApproval(mock, tenantID, runID, initiator)
	expectInsertFailoverApproval(mock, tenantID, runID, initiator, approvalID, "", now)
	expectApprovalCount(mock, tenantID, runID, 1)
	mock.ExpectExec(`UPDATE failover_run SET approved_by`).
		WithArgs(tenantID.String(), runID.String(), initiator.String(), model.StatusApproved).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeDrill, model.StatusApproved, initiator, ptr(initiator), now)

	run, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, initiator)
	if err != nil {
		t.Fatalf("ApproveFailoverRun drill: %v", err)
	}
	if run.Status != model.StatusApproved {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusApproved)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.failover_run.approved" {
		t.Fatalf("staged events = %+v, want approved", stager.events)
	}
	if stager.events[0].data["approval_quorum"] != 1 || stager.events[0].data["reason_present"] != false {
		t.Fatalf("event data = %+v", stager.events[0].data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestApproveFailoverRun_BreakGlassWritesLedger(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	initiator := uuid.New()
	approver := uuid.New()
	approvalID := uuid.New()
	breakGlassID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)
	expectNoApprovalPolicy(mock, tenantID, model.ModeReal)
	expectNoFailoverApproval(mock, tenantID, runID, approver)
	expectInsertFailoverApprovalWithBreakGlass(mock, tenantID, runID, approver, approvalID, "emergency operations override", true, now)
	expectInsertBreakGlassEvent(mock, tenantID, runID, approvalID, approver, breakGlassID, now)
	expectApprovalCount(mock, tenantID, runID, 1)
	expectFailoverRunQuery(mock, tenantID, runID, groupID, model.ModeReal, model.StatusAwaitingApproval, initiator, nil, now)

	run, err := svc.ApproveFailoverRun(context.Background(), tenantID, runID, approver, service.ApproveFailoverRunInput{
		Decision:         model.ApprovalDecisionApprove,
		Reason:           "emergency operations override",
		BreakGlass:       true,
		StepUpVerifiedAt: ptr(now),
	})
	if err != nil {
		t.Fatalf("ApproveFailoverRun break glass: %v", err)
	}
	if run.Status != model.StatusAwaitingApproval {
		t.Fatalf("status = %s, want %s before quorum", run.Status, model.StatusAwaitingApproval)
	}
	if len(stager.events) != 1 {
		t.Fatalf("staged events = %+v, want one break-glass approval event", stager.events)
	}
	if stager.events[0].data["break_glass"] != true || stager.events[0].data["approval_quorum"] != 2 {
		t.Fatalf("event data = %+v", stager.events[0].data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTransitionFailoverRun_TerminalTransitionIsGuardedAndStaged(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	userID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), model.ModeDrill, model.StatusAttested,
				nil, 900, userID.String(), nil, now, nil, nil, nil, nil, now))
	mock.ExpectExec(`UPDATE failover_run`).
		WithArgs(tenantID.String(), runID.String(), model.StatusCompleted, pgxmock.AnyArg(), model.StatusAttested).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), model.ModeDrill, model.StatusCompleted,
				nil, 900, userID.String(), nil, now, now, 120, nil, nil, now))

	run, err := svc.TransitionFailoverRun(context.Background(), tenantID, runID, service.TransitionFailoverRunInput{
		ExpectedStatus: model.StatusAttested,
		NewStatus:      model.StatusCompleted,
	})
	if err != nil {
		t.Fatalf("TransitionFailoverRun: %v", err)
	}
	if run.Status != model.StatusCompleted {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusCompleted)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.failover_run.status_changed" {
		t.Fatalf("staged events = %+v, want status_changed", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelFailoverRun_PreExecutionIsGuardedAndStaged(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	userID := uuid.New()
	cancelledBy := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), model.ModeReal, model.StatusQuiescing,
				nil, 900, userID.String(), nil, now, nil, nil, nil, nil, now))
	mock.ExpectExec(`UPDATE failover_run`).
		WithArgs(tenantID.String(), runID.String(), model.StatusCancelled, pgxmock.AnyArg(), model.StatusQuiescing).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), model.ModeReal, model.StatusCancelled,
				nil, 900, userID.String(), nil, now, now, 45, nil, nil, now))

	run, err := svc.CancelFailoverRun(context.Background(), tenantID, runID, cancelledBy)
	if err != nil {
		t.Fatalf("CancelFailoverRun: %v", err)
	}
	if run.Status != model.StatusCancelled {
		t.Fatalf("status = %s, want %s", run.Status, model.StatusCancelled)
	}
	if len(stager.events) != 1 || stager.events[0].eventType != "dr.failover_run.cancelled" {
		t.Fatalf("staged events = %+v, want cancelled", stager.events)
	}
	if stager.events[0].data["cancelled_by"] != cancelledBy.String() {
		t.Fatalf("cancelled_by = %v, want %s", stager.events[0].data["cancelled_by"], cancelledBy)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelFailoverRun_RejectsExecutingBeforeTerminalWrite(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	userID := uuid.New()
	now := time.Now()
	stager := &fakeStager{}
	svc, _ := newService(mock, stager)

	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), model.ModeReal, model.StatusExecuting,
				nil, 900, userID.String(), nil, now, nil, nil, nil, nil, now))

	_, err := svc.CancelFailoverRun(context.Background(), tenantID, runID, uuid.New())
	if !errors.Is(err, model.ErrInvalidState) {
		t.Fatalf("err = %v, want ErrInvalidState", err)
	}
	if len(stager.events) != 0 {
		t.Fatalf("staged events = %+v, want none", stager.events)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func ptr[T any](v T) *T { return &v }

func expectFailoverRunQuery(mock pgxmock.PgxPoolIface, tenantID, runID, groupID uuid.UUID, mode, status string, initiatedBy uuid.UUID, approvedBy *uuid.UUID, now time.Time) {
	var approved any
	if approvedBy != nil {
		approved = approvedBy.String()
	}
	mock.ExpectQuery(`FROM failover_run WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), runID.String()).
		WillReturnRows(failoverRunRows().
			AddRow(runID.String(), tenantID.String(), groupID.String(), mode, status,
				nil, 900, initiatedBy.String(), approved, now, nil, nil, nil, nil, now))
}

func expectNoApprovalPolicy(mock pgxmock.PgxPoolIface, tenantID uuid.UUID, mode string) {
	mock.ExpectQuery(`FROM dr_approval_policy`).
		WithArgs(tenantID.String(), "failover", mode).
		WillReturnError(pgx.ErrNoRows)
}

func expectNoFailoverApproval(mock pgxmock.PgxPoolIface, tenantID, runID, approverID uuid.UUID) {
	mock.ExpectQuery(`FROM dr_failover_approval`).
		WithArgs(tenantID.String(), runID.String(), approverID.String()).
		WillReturnError(pgx.ErrNoRows)
}

func expectFailoverApproval(mock pgxmock.PgxPoolIface, tenantID, runID, approverID, approvalID uuid.UUID, reason string, now time.Time) {
	mock.ExpectQuery(`FROM dr_failover_approval`).
		WithArgs(tenantID.String(), runID.String(), approverID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "run_id", "approver_id", "decision", "reason", "break_glass", "step_up_verified_at", "decided_at",
		}).AddRow(approvalID.String(), tenantID.String(), runID.String(), approverID.String(), model.ApprovalDecisionApprove, reason, false, now, now))
}

func expectInsertFailoverApproval(mock pgxmock.PgxPoolIface, tenantID, runID, approverID, approvalID uuid.UUID, reason string, now time.Time) {
	expectInsertFailoverApprovalWithBreakGlass(mock, tenantID, runID, approverID, approvalID, reason, false, now)
}

func expectInsertFailoverApprovalWithBreakGlass(mock pgxmock.PgxPoolIface, tenantID, runID, approverID, approvalID uuid.UUID, reason string, breakGlass bool, now time.Time) {
	mock.ExpectQuery(`INSERT INTO dr_failover_approval`).
		WithArgs(tenantID.String(), runID.String(), approverID.String(), model.ApprovalDecisionApprove, reason, breakGlass, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "decided_at"}).AddRow(approvalID.String(), now))
}

func expectInsertBreakGlassEvent(mock pgxmock.PgxPoolIface, tenantID, runID, approvalID, approverID, eventID uuid.UUID, now time.Time) {
	mock.ExpectQuery(`INSERT INTO dr_break_glass_event`).
		WithArgs(tenantID.String(), runID.String(), approvalID.String(), approverID.String(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "recorded_at"}).AddRow(eventID.String(), now))
}

func expectApprovalCount(mock pgxmock.PgxPoolIface, tenantID, runID uuid.UUID, count int) {
	mock.ExpectQuery(`SELECT count\(\*\)\s+FROM dr_failover_approval`).
		WithArgs(tenantID.String(), runID.String(), model.ApprovalDecisionApprove).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(count))
}

func failoverRunRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "group_id", "mode", "status", "recovery_point_id",
		"rto_objective_seconds", "initiated_by", "approved_by", "initiated_at",
		"completed_at", "rto_actual_seconds", "last_error", "claimed_at", "updated_at",
	})
}
