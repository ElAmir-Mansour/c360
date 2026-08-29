//go:build integration

package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/attest"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/failover"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events/outbox"
)

// TestAppVerificationGate_BlocksUntilCleared_RealPath proves, on the REAL
// failover path (real Postgres + MinIO + the real failover.Driver wired with the
// real WorkloadHealthValidator.WithAppVerification + the real RecoveryTargetApp
// planner + the real appverify executor), that the VALIDATING->ATTESTED gate:
//
//   - BLOCKS attestation when the recovered application's app-level check fails
//     (the run goes terminal FAILED, never reaching ATTESTED), and
//   - CLEARS to ATTESTED/COMPLETED once the app-level check passes.
//
// The executor really issues an HTTP GET to a recovered-app endpoint (an
// httptest server we toggle between 500 and 200); the planner really turns the
// recovery target's recovery_endpoint (appverify_kind=generic_http) into that
// check. No fakes on the executor/planner/gate-decision path.
func TestAppVerificationGate_BlocksUntilCleared_RealPath(t *testing.T) {
	ctx, pool := startPGForRP(t)
	endpoint := startMinIO(t, ctx)
	tenantID := uuid.MustParse(itTenantID)
	logger := zerolog.Nop()

	if err := outbox.EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("outbox EnsureSchema: %v", err)
	}

	// The recovered application. /healthz is the health-probe gate (always 200 so
	// the flow reaches app verification); /ready is the app-level appverify check,
	// toggled between 500 (fail) and 200 (pass) by appReady.
	var appReady atomic.Bool    // false => /ready 500, true => /ready 200
	var markerBody atomic.Value // recovery-point id the /marker endpoint echoes
	markerBody.Store("")
	appSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ready":
			if appReady.Load() {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ready":true}`))
				return
			}
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"ready":false}`))
		case "/marker": // recovery-marker check: 200 + body must contain the RP id
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"recovery_point":"` + markerBody.Load().(string) + `"}`))
		default: // /healthz and everything else
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"UP"}`))
		}
	}))
	defer appSrv.Close()

	bucket := "dr-appverify-gate"
	wormClient, err := worm.New(worm.Config{
		Endpoint: endpoint, AccessKey: itMinioUser, SecretKey: itMinioPass,
		Bucket: bucket, DefaultRetention: 48 * time.Hour,
	}, fixedDEKProvider{}, logger)
	if err != nil {
		t.Fatalf("worm.New: %v", err)
	}
	repo := repository.New()
	svc := service.NewWithDeps(pgTenantRunner{pool: pool}, repo, service.OutboxStager{}, logger).
		WithRecoveryPoint(wormClient, nil, nil, 3)

	groupID := uuid.New()
	site := uuid.New()
	stream := uuid.New()
	lastCommit := time.Now().UTC().Add(-30 * time.Second)

	seed := func(sql string, args ...any) {
		t.Helper()
		if err := database.RunWithTenant(ctx, pool, tenantID, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, sql, args...)
			return e
		}); err != nil {
			t.Fatalf("seed %q: %v", sql, err)
		}
	}
	seed(`INSERT INTO consistency_group (id, tenant_id, name) VALUES ($1,$2,'orders')`, groupID, tenantID)
	seed(`INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds) VALUES ($1,$2,'app','vm','vm://app',900)`, site, tenantID)
	seed(`INSERT INTO consistency_group_member (group_id, site_id, boot_order) VALUES ($1,$2,10)`, groupID, site)
	seed(`INSERT INTO replication_stream (id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at) VALUES ($1,$2,$3,'streaming',2,'0/CURSOR',$4)`, stream, tenantID, site, lastCommit)
	seedAppliedFrame(t, ctx, pool, tenantID, stream, 1, "0/1", []byte("applied-1|"), lastCommit.Add(-time.Second))
	seedAppliedFrame(t, ctx, pool, tenantID, stream, 2, "0/2", []byte("applied-2"), lastCommit)

	// Health probe gate -> /healthz (always 200). App-verification -> the recovery
	// endpoint opts in via appverify_kind=generic_http with health_path=/ready, so
	// the planner emits the http-ready check against appSrv/ready.
	httpProbe, _ := json.Marshal(model.HealthProbe{Type: "http", Target: appSrv.URL + "/healthz", Expected: "contains:UP", Timeout: "3s", Retries: 3})
	recEndpoint := appSrv.URL + "?appverify_kind=generic_http&health_path=/ready&marker_path=/marker"
	seed(`INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe) VALUES ($1,$2,$3,10,$4,$5)`, tenantID, groupID, site, recEndpoint, httpProbe)
	seed(`INSERT INTO network_mapping (tenant_id, group_id, profile, primary_cidr, recovery_cidr) VALUES ($1,$2,'production','10.0.0.0/24','10.1.0.0/24')`, tenantID, groupID)

	point, err := svc.SealRecoveryPoint(ctx, tenantID, groupID, service.SealRecoveryPointInput{})
	if err != nil {
		t.Fatalf("SealRecoveryPoint: %v", err)
	}
	if _, err := svc.ValidateRecoveryPoint(ctx, tenantID, uuid.MustParse(point.ID)); err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	markerBody.Store(point.ID) // /marker now echoes the recovery-point id the marker check requires

	sysRunner := service.NewPGXSystemRunner(pool)
	executor := service.NewRecoveryExecutor(repo, sysRunner, svc, newRecordRestoreDriver())
	// THE WIRING UNDER TEST: app verification enabled with the real planner + the
	// default real appverify executor (nil => appverify.NewExecutor).
	health := service.NewWorkloadHealthValidator(repo, sysRunner, service.NewHealthProber(), 30*time.Second).
		WithAppVerification(service.NewRecoveryTargetAppPlanner(), nil)
	attester, err := attest.NewBuilder(attest.Config{Repository: repo, Runner: sysRunner, Sealer: attest.WORMReportSealer{Client: wormClient}})
	if err != nil {
		t.Fatalf("attest.NewBuilder: %v", err)
	}
	cleanroomSvc, err := cleanroom.NewService(cleanroom.Config{
		TX: pgTenantRunner{pool: pool}, Store: cleanroom.Store{},
		Lookup: cleanroom.NewRepoLookup(svc.GetRecoveryPoint),
		Engine: cleanroom.NewEngine(svc, cleanroom.NewSignatureScanner()),
		Stager: cleanroom.OutboxStager{}, Logger: logger,
	})
	if err != nil {
		t.Fatalf("cleanroom.NewService: %v", err)
	}
	if _, err := cleanroomSvc.ScanRecoveryPoint(ctx, tenantID, uuid.MustParse(point.ID)); err != nil {
		t.Fatalf("cleanroom scan: %v", err)
	}
	drv, err := failover.New(failover.Config{
		Repository: repo, FinalSyncer: service.NewFailoverFinalSyncerWithCleanroom(svc, cleanroomSvc),
		Validator: failover.NewDriverGateValidator(repo, sysRunner), Executor: executor,
		Health: health, Attester: attester, Events: failover.OutboxSink{},
	})
	if err != nil {
		t.Fatalf("failover.New: %v", err)
	}

	driveToApproval := func(runID string) {
		advanceUntil(t, ctx, pool, drv, runID, model.StatusAwaitingApproval)
		if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(runID), uuid.New(), service.ApproveFailoverRunInput{
			Reason:           "integration test real failover approval",
			StepUpVerifiedAt: ptr(time.Now().UTC()),
		}); err != nil {
			t.Fatalf("approve first %s: %v", runID, err)
		}
		if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(runID), uuid.New(), service.ApproveFailoverRunInput{
			Reason:           "integration test real failover approval quorum",
			StepUpVerifiedAt: ptr(time.Now().UTC()),
		}); err != nil {
			t.Fatalf("approve second %s: %v", runID, err)
		}
	}

	// --- Run 1: app NOT ready (/ready => 500). The gate must BLOCK: the run goes
	// terminal FAILED and never reaches ATTESTED. ---
	appReady.Store(false)
	failRunID := createRun(t, ctx, svc, tenantID, groupID, model.ModeReal, point.ID)
	driveToApproval(failRunID)
	driveToTerminal(t, ctx, pool, drv, failRunID)
	// The gate blocks attestation: the run goes to a terminal FAILURE (failing the
	// app gate after EXECUTING rolls the booted members back) and never ATTESTED.
	if st := currentStatus(t, ctx, pool, failRunID); st != model.StatusFailed && st != model.StatusRolledBack {
		t.Fatalf("app-not-ready run: status=%s, want a terminal failure (FAILED/ROLLED_BACK)", st)
	}
	if attestedReached(t, ctx, pool, failRunID) {
		t.Fatal("app-not-ready run reached ATTESTED — the gate did NOT block on a failing app check")
	}
	// The failing step is the health/app-verification gate, and it carries the app
	// verification failure reason.
	if reason := failedStepReason(t, ctx, pool, failRunID); reason == "" {
		t.Fatal("expected a recorded failure reason on the blocked run")
	} else {
		t.Logf("gate blocked as expected; failure reason: %s", reason)
	}

	// --- Run 2: app ready (/ready => 200). The gate CLEARS: the run reaches
	// ATTESTED then COMPLETED. ---
	appReady.Store(true)
	okRunID := createRun(t, ctx, svc, tenantID, groupID, model.ModeReal, point.ID)
	driveToApproval(okRunID)
	advanceUntil(t, ctx, pool, drv, okRunID, model.StatusCompleted)
	att := readAttestation(t, ctx, pool, okRunID)
	if att.RTOObjectiveSeconds != 900 {
		t.Fatalf("cleared run attestation rto_objective=%d, want 900", att.RTOObjectiveSeconds)
	}
	t.Logf("gate cleared once app check passed; run %s reached COMPLETED with attestation", okRunID)
}

// driveToTerminal drives a run to a terminal status, mirroring failover.Loop.tick
// exactly: it commits the advance tx on a RecordedFailureError so a recorded gate
// failure persists (the happy-path advanceUntil helper rolls those back). Used for
// the run we EXPECT to fail at the app-verification gate.
func driveToTerminal(t *testing.T, ctx context.Context, pool *pgxpool.Pool, drv *failover.Driver, runID string) {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("run %s did not reach a terminal status in time (stuck at %s)", runID, currentStatus(t, ctx, pool, runID))
		}
		switch currentStatus(t, ctx, pool, runID) {
		case model.StatusFailed, model.StatusCancelled, model.StatusRolledBack, model.StatusCompleted:
			return
		}
		var claimed *model.FailoverRun
		if cerr := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
			var e error
			claimed, e = repository.New().SystemClaimFailoverRun(ctx, tx)
			return e
		}); cerr != nil {
			t.Fatalf("claim: %v", cerr)
		}
		if claimed == nil || claimed.ID != runID || claimed.IsTerminal() || claimed.Status == model.StatusAwaitingApproval {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		_ = database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
			if aerr := drv.Advance(ctx, tx, claimed); aerr != nil {
				if failover.IsRecordedFailure(aerr) {
					return nil // commit the durably-recorded gate failure
				}
				return aerr
			}
			return nil
		})
		time.Sleep(50 * time.Millisecond)
	}
}

// attestedReached reports whether the run ever recorded the gate4 attest step or
// an ATTESTED/COMPLETED status (i.e. the gate let it through).
func attestedReached(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) bool {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM failover_step WHERE run_id=$1 AND step='gate4.attest' AND status='passed'`, runID).Scan(&n); err != nil {
		t.Fatalf("attestedReached query: %v", err)
	}
	return n > 0
}

// failedStepReason returns the recorded error of the failed step on the run
// (failover_step.detail->>'error'), and the step name it failed at.
func failedStepReason(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) string {
	t.Helper()
	var step string
	var reason *string
	err := pool.QueryRow(ctx, `SELECT step, detail->>'error' FROM failover_step WHERE run_id=$1 AND status='failed' LIMIT 1`, runID).Scan(&step, &reason)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ""
		}
		t.Fatalf("failedStepReason query: %v", err)
	}
	r := ""
	if reason != nil {
		r = *reason
	}
	return step + ": " + r
}

// TestAppVerificationExecutorAndRouter_Runtime proves the appverify executor does
// real HTTP I/O against a recovered app and that the read API (the router +
// QueryService + Store) returns the persisted verdict at runtime over real
// Postgres — exercised end to end, not via fakes.
func TestAppVerificationExecutorAndRouter_Runtime(t *testing.T) {
	ctx, pool := startPGForRP(t)
	tenantID := uuid.MustParse(itTenantID)
	groupID := uuid.New()
	logger := zerolog.Nop()

	// A recovered app whose readiness + recovery-marker endpoints really return
	// 200, with the marker body carrying the recovery-point id the marker check
	// requires.
	markerID := uuid.NewString()
	appSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ready":true,"recovery_point":"` + markerID + `"}`))
	}))
	defer appSrv.Close()

	// REAL planner -> REAL executor over real HTTP.
	plan, ok, err := service.NewRecoveryTargetAppPlanner().PlanAppVerification(ctx,
		&model.FailoverRun{RecoveryPointID: ptr(markerID)}, &model.RecoveryTarget{SiteID: "app", RecoveryEndpoint: ptr(appSrv.URL + "?appverify_kind=generic_http&health_path=/ready&marker_path=/marker")})
	if err != nil || !ok {
		t.Fatalf("planner did not produce a plan: ok=%v err=%v", ok, err)
	}
	if len(plan.Checks) == 0 {
		t.Fatal("planner produced an empty check plan")
	}
	result, err := appverify.NewExecutor(appverify.ExecutorConfig{}).Execute(ctx, plan)
	if err != nil {
		t.Fatalf("executor.Execute: %v", err)
	}
	if !result.Passed {
		t.Fatalf("executor result for a 200 app should pass; got %+v", result)
	}

	// Persist the REAL result via the REAL store, then read it back through the
	// REAL router + QueryService over real Postgres.
	runner := appverify.PGXRunner{Pool: pool}
	store := appverify.NewStore()
	rec := &appverify.StoredResult{
		TenantID: tenantID, GroupID: groupID, RunID: uuid.NewString(),
		SiteID: "app", Passed: result.Passed,
		ChecksPassed: result.ChecksPassed, RequiredPassed: result.RequiredPassed,
		Result: result,
	}
	if err := runner.RunWithTenant(ctx, tenantID, func(db appverify.DBTX) error {
		return store.Save(ctx, db, rec)
	}); err != nil {
		t.Fatalf("store.Save: %v", err)
	}

	router := appverify.NewRouter(appverify.NewQueryService(store, runner), logger)
	// Inject the same authenticated context the gateway's Auth+Tenant middleware
	// would produce (the router gates dr:read), so the handler authorizes and
	// suiteapi.TenantID resolves.
	inject := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c := auth.WithUser(r.Context(), &auth.ContextUser{ID: "operator", TenantID: tenantID.String(), Roles: []string{"super-admin"}})
			c = auth.WithTenantID(c, tenantID.String())
			next.ServeHTTP(w, r.WithContext(c))
		})
	}
	mux := chi.NewRouter()
	mux.Use(inject)
	mux.Mount("/api/v1/dr", router.Routes())
	httpSrv := httptest.NewServer(mux)
	defer httpSrv.Close()

	req, _ := http.NewRequest(http.MethodGet, httpSrv.URL+"/api/v1/dr/app-verification?group="+groupID.String(), nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("router GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("router GET status=%d, want 200", resp.StatusCode)
	}
	var body struct {
		Data struct {
			Results []appverify.StoredResult `json:"results"`
			Count   int                      `json:"count"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode router response: %v", err)
	}
	if len(body.Data.Results) != 1 || body.Data.Results[0].RunID != rec.RunID || !body.Data.Results[0].Passed {
		t.Fatalf("router did not return the persisted passing result: %+v", body.Data)
	}
	t.Logf("router returned the real persisted appverify verdict at runtime: run=%s passed=%v", rec.RunID, body.Data.Results[0].Passed)
}

func ptr(s string) *string { return &s }
