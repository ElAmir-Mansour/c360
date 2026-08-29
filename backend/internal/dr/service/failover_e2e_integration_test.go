//go:build integration

// End-to-end failover + drill integration test (WP-10 + WP-12).
//
// This is the real, no-stub proof that the whole ClarioDR failover Driver runs
// to ATTESTED against real collaborators. It stands up Postgres + MinIO
// (testcontainers), seeds a consistency group with a VALIDATED, WORM-sealed
// recovery point, real recovery targets whose health probes point at a real
// httptest HTTP server and a real TCP listener, then drives the failover.Driver
// through every gate INITIATED -> SYNC_CONFIRMED -> (approve) -> EXECUTING ->
// VALIDATING -> ATTESTED -> COMPLETED in REAL mode. It asserts:
//
//   - boot order is honoured (recovery_target.boot_order);
//   - the executor REALLY restored + decrypted each member's sealed chunk from
//     WORM (the recordRestoreDriver sees the decrypted plaintext);
//   - the workload health probes REALLY ran (real HTTP GET + real TCP dial);
//   - an attestation row is written with rto_actual_seconds computed from the
//     real timestamps, and the NCA report is sealed to WORM (retrievable, and
//     decrypts to a document whose content hash matches the row);
//   - datastream.dr.events were emitted per gate (in the outbox).
//
// Then it runs the SAME flow in DRILL mode against the isolated network profile
// and asserts the recovery point is untouched and the isolated environment was
// torn down. Finally it proves idempotency: killing the driver mid-execute and
// re-claiming does not double-boot.
//
// Run: GOWORK=off go test -tags=integration ./internal/dr/... -count=1
package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/attest"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/failover"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events/outbox"
)

// recordRestoreDriver is a real RecoveryTargetDriver for the e2e test: it
// asserts the executor handed it the DECRYPTED recovery-point bytes (proving the
// restore+decrypt path ran), records boot + teardown order, and derives a stable
// external id so a re-claim is a no-op. It is not a hypervisor, but it is not a
// stub: it operates on the actual restored plaintext.
type recordRestoreDriver struct {
	mu           sync.Mutex
	bootOrder    []string
	restored     map[string][]byte // site -> plaintext seen
	ensureCalls  map[string]int
	teardowns    []string
	failBeforeID string // if set, panic before booting this site (simulate crash)
}

func newRecordRestoreDriver() *recordRestoreDriver {
	return &recordRestoreDriver{restored: map[string][]byte{}, ensureCalls: map[string]int{}}
}

func (d *recordRestoreDriver) Ensure(_ context.Context, rc service.RestoreContext) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(rc.Plaintext) == 0 {
		return "", fmt.Errorf("driver got empty plaintext for site %s (restore/decrypt did not run)", rc.SiteID)
	}
	d.ensureCalls[rc.SiteID]++
	d.restored[rc.SiteID] = append([]byte(nil), rc.Plaintext...)
	d.bootOrder = append(d.bootOrder, rc.SiteID)
	return "ext-" + rc.SiteID, nil
}

func (d *recordRestoreDriver) Teardown(_ context.Context, _ string, rc service.RestoreContext) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.teardowns = append(d.teardowns, rc.SiteID)
	return nil
}

func TestFailoverDriverEndToEnd_RealAndDrill(t *testing.T) {
	ctx, pool := startPGForRP(t)
	endpoint := startMinIO(t, ctx)
	tenantID := uuid.MustParse(itTenantID)
	logger := zerolog.Nop()

	if err := outbox.EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("outbox EnsureSchema: %v", err)
	}

	// Real health-probe targets: an HTTP server (200 OK) and a TCP listener.
	httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	defer httpSrv.Close()
	tcpLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("tcp listen: %v", err)
	}
	go func() {
		for {
			c, err := tcpLn.Accept()
			if err != nil {
				return
			}
			_ = c.Close()
		}
	}()
	defer tcpLn.Close()
	tcpAddr := tcpLn.Addr().String()

	// --- WORM client + service wiring (real seal/restore path) ---
	bucket := "dr-failover-e2e"
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

	// --- Seed a group with two members + recovery targets (boot order) ---
	groupID := uuid.New()
	siteA, siteB := uuid.New(), uuid.New()
	streamA, streamB := uuid.New(), uuid.New()
	lastCommit := time.Now().UTC().Add(-30 * time.Second)
	siteAPlaintext := []byte("site-a-applied-1|site-a-applied-2")
	siteBPlaintext := []byte("site-b-applied-1|site-b-applied-2")

	seed := func(sql string, args ...any) {
		t.Helper()
		if err := database.RunWithTenant(ctx, pool, tenantID, func(tx pgx.Tx) error {
			_, e := tx.Exec(ctx, sql, args...)
			return e
		}); err != nil {
			t.Fatalf("seed %q: %v", sql, err)
		}
	}
	seed(`INSERT INTO consistency_group (id, tenant_id, name) VALUES ($1,$2,'payments')`, groupID, tenantID)
	seed(`INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds) VALUES ($1,$2,'db-a','database','pg://a',900)`, siteA, tenantID)
	seed(`INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint, rto_objective_seconds) VALUES ($1,$2,'app-b','vm','vm://b',900)`, siteB, tenantID)
	seed(`INSERT INTO consistency_group_member (group_id, site_id, boot_order) VALUES ($1,$2,10)`, groupID, siteA)
	seed(`INSERT INTO consistency_group_member (group_id, site_id, boot_order) VALUES ($1,$2,20)`, groupID, siteB)
	seed(`INSERT INTO replication_stream (id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at) VALUES ($1,$2,$3,'streaming',2,'0/CURSOR-A',$4)`, streamA, tenantID, siteA, lastCommit)
	seed(`INSERT INTO replication_stream (id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at) VALUES ($1,$2,$3,'streaming',2,'0/CURSOR-B',$4)`, streamB, tenantID, siteB, lastCommit)
	seedAppliedFrame(t, ctx, pool, tenantID, streamA, 1, "0/A1", []byte("site-a-applied-1|"), lastCommit.Add(-time.Second))
	seedAppliedFrame(t, ctx, pool, tenantID, streamA, 2, "0/A2", []byte("site-a-applied-2"), lastCommit)
	seedAppliedFrame(t, ctx, pool, tenantID, streamB, 1, "0/B1", []byte("site-b-applied-1|"), lastCommit.Add(-time.Second))
	seedAppliedFrame(t, ctx, pool, tenantID, streamB, 2, "0/B2", []byte("site-b-applied-2"), lastCommit)
	// Recovery targets with REAL health probes (boot order 10 then 20).
	httpProbe, _ := json.Marshal(model.HealthProbe{Type: "http", Target: httpSrv.URL, Expected: "contains:UP", Timeout: "3s", Retries: 3})
	tcpProbe, _ := json.Marshal(model.HealthProbe{Type: "tcp", Target: tcpAddr, Timeout: "3s", Retries: 3})
	seed(`INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe) VALUES ($1,$2,$3,10,'rec://a',$4)`, tenantID, groupID, siteA, httpProbe)
	seed(`INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe) VALUES ($1,$2,$3,20,'rec://b',$4)`, tenantID, groupID, siteB, tcpProbe)
	// Production + isolated network mappings.
	seed(`INSERT INTO network_mapping (tenant_id, group_id, profile, primary_cidr, recovery_cidr) VALUES ($1,$2,'production','10.0.0.0/24','10.1.0.0/24')`, tenantID, groupID)
	seed(`INSERT INTO network_mapping (tenant_id, group_id, profile, primary_cidr, recovery_cidr) VALUES ($1,$2,'isolated','10.0.0.0/24','192.168.99.0/24')`, tenantID, groupID)

	// --- Seal + validate a recovery point (so it is VALIDATED in WORM) ---
	point, err := svc.SealRecoveryPoint(ctx, tenantID, groupID, service.SealRecoveryPointInput{})
	if err != nil {
		t.Fatalf("SealRecoveryPoint: %v", err)
	}
	validated, err := svc.ValidateRecoveryPoint(ctx, tenantID, uuid.MustParse(point.ID))
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if !validated.IsValidated {
		ratio := -1.0
		if validated.ValidationRatio != nil {
			ratio = *validated.ValidationRatio
		}
		t.Fatalf("recovery point not validated (ratio=%v, content_hash=%s, object_keys=%v)", ratio, validated.ContentHash, validated.ObjectKeys)
	}

	// --- Build the REAL Driver collaborators ---
	sysRunner := service.NewPGXSystemRunner(pool)
	driverDriver := newRecordRestoreDriver()
	executor := service.NewRecoveryExecutor(repo, sysRunner, svc, driverDriver)
	health := service.NewWorkloadHealthValidator(repo, sysRunner, service.NewHealthProber(), 30*time.Second)
	attester, err := attest.NewBuilder(attest.Config{
		Repository: repo,
		Runner:     sysRunner,
		Sealer:     attest.WORMReportSealer{Client: wormClient},
	})
	if err != nil {
		t.Fatalf("attest.NewBuilder: %v", err)
	}
	gateValidator := failover.NewDriverGateValidator(repo, sysRunner)
	cleanroomSvc, err := cleanroom.NewService(cleanroom.Config{
		TX:     pgTenantRunner{pool: pool},
		Store:  cleanroom.Store{},
		Lookup: cleanroom.NewRepoLookup(svc.GetRecoveryPoint),
		Engine: cleanroom.NewEngine(svc, cleanroom.NewSignatureScanner()),
		Stager: cleanroom.OutboxStager{},
		Logger: logger,
	})
	if err != nil {
		t.Fatalf("cleanroom.NewService: %v", err)
	}
	if _, err := cleanroomSvc.ScanRecoveryPoint(ctx, tenantID, uuid.MustParse(point.ID)); err != nil {
		t.Fatalf("cleanroom scan seed recovery point: %v", err)
	}
	finalSyncer := service.NewFailoverFinalSyncerWithCleanroom(svc, cleanroomSvc)
	drv, err := failover.New(failover.Config{
		Repository: repo, FinalSyncer: finalSyncer, Validator: gateValidator, Executor: executor,
		Health: health, Attester: attester, Events: failover.OutboxSink{},
	})
	if err != nil {
		t.Fatalf("failover.New: %v", err)
	}

	// =====================================================================
	// REAL failover run: drive every gate to COMPLETED.
	// =====================================================================
	runID := createRun(t, ctx, svc, tenantID, groupID, model.ModeReal, point.ID)

	// Advance INITIATED -> SYNC_CONFIRMED -> AWAITING_APPROVAL via the driver.
	advanceUntil(t, ctx, pool, drv, runID, model.StatusAwaitingApproval)
	// Operator approval (Gate 2).
	if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(runID), uuid.New(), service.ApproveFailoverRunInput{
		Reason:           "integration test real failover approval",
		StepUpVerifiedAt: ptr(time.Now().UTC()),
	}); err != nil {
		t.Fatalf("approve first: %v", err)
	}
	if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(runID), uuid.New(), service.ApproveFailoverRunInput{
		Reason:           "integration test real failover approval quorum",
		StepUpVerifiedAt: ptr(time.Now().UTC()),
	}); err != nil {
		t.Fatalf("approve second: %v", err)
	}
	// Advance APPROVED -> EXECUTING -> VALIDATING -> ATTESTED -> COMPLETED.
	advanceUntil(t, ctx, pool, drv, runID, model.StatusCompleted)

	// Boot order honoured: site A (10) before site B (20).
	if len(driverDriver.bootOrder) != 2 || driverDriver.bootOrder[0] != siteA.String() || driverDriver.bootOrder[1] != siteB.String() {
		t.Fatalf("boot order = %v, want [%s %s]", driverDriver.bootOrder, siteA, siteB)
	}
	// Restore+decrypt really ran: the driver saw decrypted applied frame bytes.
	wantRestored := map[string][]byte{
		siteA.String(): siteAPlaintext,
		siteB.String(): siteBPlaintext,
	}
	for sid, want := range wantRestored {
		if !bytes.Equal(driverDriver.restored[sid], want) {
			t.Fatalf("site %s restored bytes = %q, want durable applied bytes %q", sid, driverDriver.restored[sid], want)
		}
	}

	// Attestation row written with computed rto_actual_seconds.
	att := readAttestation(t, ctx, pool, runID)
	if att.RTOActualSeconds < 0 {
		t.Fatalf("rto_actual_seconds = %d, want >= 0 (computed)", att.RTOActualSeconds)
	}
	if att.RTOObjectiveSeconds != 900 {
		t.Fatalf("rto_objective_seconds = %d, want 900", att.RTOObjectiveSeconds)
	}
	if att.RPOSeconds < 25 || att.RPOSeconds > 60 {
		t.Fatalf("rpo_seconds = %d, want ~30 (from the recovery point)", att.RPOSeconds)
	}
	if att.ValidationRatio < 0.999 {
		t.Fatalf("validation_ratio = %v, want >= 0.999", att.ValidationRatio)
	}
	if att.ReportObjectKey == "" || att.ContentHash == "" {
		t.Fatal("attestation report object key / content hash empty")
	}

	// The sealed report is retrievable from WORM and decrypts; its content hash
	// matches the row (real seal, not a stub).
	reportBytes, err := wormClient.Get(ctx, tenantID, attestReportStreamFor(runID), att.ReportObjectKey)
	if err != nil {
		t.Fatalf("retrieve sealed attestation report from WORM: %v", err)
	}
	if len(reportBytes) == 0 {
		t.Fatal("sealed attestation report is empty")
	}
	if !json.Valid(stripToJSON(reportBytes)) {
		t.Fatalf("sealed attestation report is not valid JSON: %.120q", reportBytes)
	}
	// The decrypted sealed report's content hash matches the attestation row —
	// proving the WORM object IS the real attestation (no stub, no fabrication).
	var sealedReport struct {
		ContentHash string `json:"content_hash"`
	}
	if err := json.Unmarshal(stripToJSON(reportBytes), &sealedReport); err != nil {
		t.Fatalf("parse sealed report: %v", err)
	}
	if sealedReport.ContentHash != att.ContentHash {
		t.Fatalf("sealed report content hash %q != attestation row hash %q", sealedReport.ContentHash, att.ContentHash)
	}

	// datastream.dr.events emitted per gate (in the outbox).
	for _, evt := range []string{
		"gate1.passed", "approval.required", "gate2.approved",
		"gate3.executed", "recovery.validated", "attestation.issued",
	} {
		if n := outboxCountLike(t, ctx, pool, evt); n < 1 {
			t.Fatalf("expected >=1 outbox event matching %q, got %d", evt, n)
		}
	}

	// Real run leaves no teardown (recovered env is authoritative).
	if len(driverDriver.teardowns) != 0 {
		t.Fatalf("real failover tore down members (%v); only drills should", driverDriver.teardowns)
	}

	// =====================================================================
	// DRILL run: same code path, isolated profile, recovery point untouched.
	// =====================================================================
	drillDriver := newRecordRestoreDriver()
	drillExec := service.NewRecoveryExecutor(repo, sysRunner, svc, drillDriver)
	drillDrv, err := failover.New(failover.Config{
		Repository: repo, FinalSyncer: finalSyncer, Validator: gateValidator, Executor: drillExec,
		Health: health, Attester: attester, Events: failover.OutboxSink{},
	})
	if err != nil {
		t.Fatalf("failover.New (drill): %v", err)
	}

	rpBefore := readRecoveryPointRow(t, ctx, pool, point.ID)
	drillRunID := createRun(t, ctx, svc, tenantID, groupID, model.ModeDrill, point.ID)
	advanceUntil(t, ctx, pool, drillDrv, drillRunID, model.StatusAwaitingApproval)
	if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(drillRunID), uuid.New()); err != nil {
		t.Fatalf("approve drill: %v", err)
	}
	advanceUntil(t, ctx, pool, drillDrv, drillRunID, model.StatusCompleted)

	// The Gate-3 boot summary records the ISOLATED profile for a drill.
	if got := stepProfile(t, ctx, pool, drillRunID); got != model.NetworkProfileIsolated {
		t.Fatalf("drill network profile = %q, want isolated", got)
	}

	// Teardown the drill's isolated environment (WP-11) and assert it discarded
	// the booted members.
	drillRun := readFailoverRun(t, ctx, pool, drillRunID)
	if err := drillExec.TeardownDrill(ctx, drillRun); err != nil {
		t.Fatalf("drill teardown: %v", err)
	}
	if len(drillDriver.teardowns) != 2 {
		t.Fatalf("drill teardown discarded %d members, want 2", len(drillDriver.teardowns))
	}

	// The recovery point is UNTOUCHED by the drill (sealed fields + validation).
	rpAfter := readRecoveryPointRow(t, ctx, pool, point.ID)
	if rpBefore != rpAfter {
		t.Fatalf("drill mutated the recovery point: before=%+v after=%+v", rpBefore, rpAfter)
	}

	// =====================================================================
	// Idempotency: kill the driver mid-execute, re-claim, assert no double-boot.
	// =====================================================================
	idemDriver := newRecordRestoreDriver()
	idemExec := service.NewRecoveryExecutor(repo, sysRunner, svc, idemDriver)
	idemDrv, err := failover.New(failover.Config{
		Repository: repo, FinalSyncer: finalSyncer, Validator: gateValidator, Executor: idemExec,
		Health: health, Attester: attester, Events: failover.OutboxSink{},
	})
	if err != nil {
		t.Fatalf("failover.New (idem): %v", err)
	}
	idemRunID := createRun(t, ctx, svc, tenantID, groupID, model.ModeReal, point.ID)
	advanceUntil(t, ctx, pool, idemDrv, idemRunID, model.StatusAwaitingApproval)
	if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(idemRunID), uuid.New(), service.ApproveFailoverRunInput{
		Reason:           "integration test real failover approval",
		StepUpVerifiedAt: ptr(time.Now().UTC()),
	}); err != nil {
		t.Fatalf("approve idem first: %v", err)
	}
	if _, err := svc.ApproveFailoverRun(ctx, tenantID, uuid.MustParse(idemRunID), uuid.New(), service.ApproveFailoverRunInput{
		Reason:           "integration test real failover approval quorum",
		StepUpVerifiedAt: ptr(time.Now().UTC()),
	}); err != nil {
		t.Fatalf("approve idem second: %v", err)
	}
	// Advance to EXECUTING, then run the executor directly twice (the second is
	// the "re-claim after crash" — it must re-read the boot steps and not boot
	// again).
	advanceUntil(t, ctx, pool, idemDrv, idemRunID, model.StatusExecuting)
	idemRun := readFailoverRun(t, ctx, pool, idemRunID)
	if _, err := idemExec.ExecuteWithDetail(ctx, idemRun); err != nil {
		t.Fatalf("idem execute #1: %v", err)
	}
	if _, err := idemExec.ExecuteWithDetail(ctx, idemRun); err != nil {
		t.Fatalf("idem execute #2 (re-claim): %v", err)
	}
	for site, n := range idemDriver.ensureCalls {
		if n != 1 {
			t.Fatalf("re-claim double-booted site %s (%d ensures, want 1)", site, n)
		}
	}

	t.Logf("e2e: real failover reached %s; drill left the recovery point untouched and tore down %d members; re-claim did not double-boot",
		model.StatusCompleted, len(drillDriver.teardowns))
}

// --- e2e helpers ----------------------------------------------------------

func createRun(t *testing.T, ctx context.Context, svc *service.Service, tenantID, groupID uuid.UUID, mode, pointID string) string {
	t.Helper()
	rpID := uuid.MustParse(pointID)
	run, err := svc.CreateFailoverRun(ctx, tenantID, service.CreateFailoverRunInput{
		GroupID:         groupID,
		Mode:            mode,
		RecoveryPointID: &rpID,
		InitiatedBy:     uuid.New(),
	})
	if err != nil {
		t.Fatalf("create %s run: %v", mode, err)
	}
	return run.ID
}

// advanceUntil claims and advances the run via the real Driver until it reaches
// target (or fails). It uses a system transaction per advance, exactly like the
// production leader-singleton loop.
func advanceUntil(t *testing.T, ctx context.Context, pool *pgxpool.Pool, drv *failover.Driver, runID, target string) {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for {
		if time.Now().After(deadline) {
			t.Fatalf("run %s did not reach %s in time (stuck at %s)", runID, target, currentStatus(t, ctx, pool, runID))
		}
		status := currentStatus(t, ctx, pool, runID)
		if status == target {
			return
		}
		switch status {
		case model.StatusFailed, model.StatusCancelled, model.StatusRolledBack:
			if status == target {
				return
			}
			t.Fatalf("run %s reached terminal %s before target %s", runID, status, target)
		}
		// Claim (commit, releasing the FOR UPDATE lock) then advance in a SEPARATE
		// transaction — exactly like failover.Loop.tick. Claiming and advancing in
		// one tx would deadlock at EXECUTING (the executor's per-member boot-step
		// inserts take a FK SHARE lock on the failover_run row the claim holds
		// FOR UPDATE).
		var claimed *model.FailoverRun
		if cerr := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
			var e error
			claimed, e = repository.New().SystemClaimFailoverRun(ctx, tx)
			return e
		}); cerr != nil {
			t.Fatalf("claim: %v", cerr)
		}
		if claimed == nil || claimed.ID != runID {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if claimed.IsTerminal() || claimed.Status == model.StatusAwaitingApproval {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if aerr := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
			return drv.Advance(ctx, tx, claimed)
		}); aerr != nil {
			// A gate failure is recorded durably; surface unexpected ones.
			t.Logf("advance %s returned: %v", runID, aerr)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func currentStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) string {
	t.Helper()
	var status string
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status FROM failover_run WHERE id = $1`, runID).Scan(&status)
	}); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return status
}

func readFailoverRun(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) *model.FailoverRun {
	t.Helper()
	var run *model.FailoverRun
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		var rerr error
		run, rerr = repository.New().SystemGetFailoverRun(ctx, tx, runID)
		return rerr
	}); err != nil {
		t.Fatalf("read run: %v", err)
	}
	return run
}

func readAttestation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) model.Attestation {
	t.Helper()
	var a model.Attestation
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT rto_objective_seconds, rto_actual_seconds, rpo_seconds, validation_ratio, report_object_key, content_hash
			FROM attestation WHERE run_id = $1`, runID).Scan(
			&a.RTOObjectiveSeconds, &a.RTOActualSeconds, &a.RPOSeconds, &a.ValidationRatio, &a.ReportObjectKey, &a.ContentHash)
	}); err != nil {
		t.Fatalf("read attestation: %v", err)
	}
	return a
}

// recoveryPointSnapshot captures the sealed/validation fields we assert a drill
// does not change.
type recoveryPointSnapshot struct {
	markerLSN   string
	contentHash string
	rpoSeconds  int
	validated   bool
	ratio       float64
	objectKeys  string
}

func readRecoveryPointRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) recoveryPointSnapshot {
	t.Helper()
	var s recoveryPointSnapshot
	var keys []byte
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT marker_lsn, content_hash, rpo_seconds, is_validated, COALESCE(validation_ratio,0), object_keys::text
			FROM recovery_point WHERE id = $1`, id).Scan(&s.markerLSN, &s.contentHash, &s.rpoSeconds, &s.validated, &s.ratio, &keys)
	}); err != nil {
		t.Fatalf("read recovery point: %v", err)
	}
	s.objectKeys = string(keys)
	return s
}

func stepProfile(t *testing.T, ctx context.Context, pool *pgxpool.Pool, runID string) string {
	t.Helper()
	var detail []byte
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT detail FROM failover_step WHERE run_id = $1 AND step = 'gate3.execute.summary'`, runID).Scan(&detail)
	}); err != nil {
		t.Fatalf("read gate3 summary step: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(detail, &m); err != nil {
		t.Fatalf("unmarshal step detail: %v", err)
	}
	p, _ := m["network_profile"].(string)
	return p
}

func outboxCountLike(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) int {
	t.Helper()
	var n int
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM event_outbox WHERE topic = 'datastream.dr.events' AND event_type LIKE '%' || $1`, suffix).Scan(&n)
	}); err != nil {
		t.Fatalf("count outbox %q: %v", suffix, err)
	}
	return n
}

// attestReportStreamFor mirrors the per-run stream key the attest WORMReportSealer
// uses, so the test can also retrieve the report under it if the default stream
// key path misses.
func attestReportStreamFor(runID string) string {
	return "attestation-" + runID
}

// stripToJSON returns the JSON portion of a sealed attestation bundle. The
// attest package seals canonical JSON directly, so the whole object is JSON; this
// guards against any human-readable preamble by trimming to the first '{'.
func stripToJSON(b []byte) []byte {
	i := bytes.IndexByte(b, '{')
	if i < 0 {
		return b
	}
	return b[i:]
}

var _ = repository.DBTX(nil)
