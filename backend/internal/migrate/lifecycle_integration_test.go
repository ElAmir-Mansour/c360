//go:build integration

package migrate

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"
)

// allowAllEntitlements is a permissive resolver: the lifecycle and critical-path
// service methods under test do not call it, but NewService requires one.
type allowAllEntitlements struct{}

func (allowAllEntitlements) Resolve(ctx context.Context, tenantID, authorization, key string) (bool, string, error) {
	return true, "", nil
}

func startMigratePostgres(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("migrate_it"),
		postgresmod.WithUsername("migrate"),
		postgresmod.WithPassword("migrate"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	pool, err := pgxpool.New(ctx, container.MustConnectionString(ctx, "sslmode=disable"))
	if err != nil {
		t.Fatalf("open postgres pool: %v", err)
	}
	t.Cleanup(pool.Close)

	applyMigrateMigrations(t, ctx, pool, ".up.sql")
	return ctx, pool
}

func applyMigrateMigrations(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve caller")
	}
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "migrate_db")
	migrations, err := filepath.Glob(filepath.Join(migDir, "*"+suffix))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(migrations)
	if suffix == ".down.sql" {
		for i, j := 0, len(migrations)-1; i < j; i, j = i+1, j-1 {
			migrations[i], migrations[j] = migrations[j], migrations[i]
		}
	}
	for _, migration := range migrations {
		sql, err := os.ReadFile(migration)
		if err != nil {
			t.Fatalf("read migration %s: %v", filepath.Base(migration), err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(migration), err)
		}
	}
}

func fullActor() Actor {
	return Actor{UserID: uuid.New(), Permission: []string{PermMigrateAdmin}}
}

// seedWaveForCutover builds a program -> workloads -> move group -> wave ->
// window -> approved rollback plan, and returns the IDs needed to drive the
// cutover lifecycle. Workloads carry real effort estimates and a dependency.
func seedWaveForCutover(t *testing.T, ctx context.Context, svc *Service, tenantID uuid.UUID, actor Actor) (programID, waveID, windowID uuid.UUID) {
	t.Helper()
	prog, err := svc.CreateProgram(ctx, tenantID, CreateProgramInput{Name: "Cloud Exit 2026", Actor: actor})
	if err != nil {
		t.Fatalf("create program: %v", err)
	}
	programID = prog.ID

	for _, in := range []WorkloadInput{
		{AppKey: "api", Name: "Order API", Strategy: StrategyReplatform, Tier: "tier-1", ReadinessScore: 80, EstimatedEffortHours: 4},
		{AppKey: "db", Name: "Order DB", Strategy: StrategyRehost, Tier: "tier-0", ReadinessScore: 60, EstimatedEffortHours: 6, Dependencies: []WorkloadDependency{{AppKey: "api", Criticality: "hard"}}},
	} {
		if _, err := svc.UpsertWorkload(ctx, tenantID, programID, in, actor); err != nil {
			t.Fatalf("upsert workload %s: %v", in.AppKey, err)
		}
	}

	mg, err := svc.CreateMoveGroup(ctx, tenantID, CreateMoveGroupInput{
		ProgramID: programID, Name: "Order platform", AppKeys: []string{"api", "db"}, Actor: actor,
	})
	if err != nil {
		t.Fatalf("create move group: %v", err)
	}
	// Run the real completeness -> submit -> approve flow so the group can join
	// a wave (CreateWave rejects un-approved groups).
	checked, err := svc.ValidateMoveGroupCompleteness(ctx, tenantID, mg.ID, actor, mg.RowVersion)
	if err != nil {
		t.Fatalf("validate completeness: %v", err)
	}
	if checked.Status != MoveGroupReady {
		t.Fatalf("move group completeness = %s (%v), want ready", checked.Status, checked.CompletenessFindings)
	}
	submitted, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, checked.RowVersion)
	if err != nil {
		t.Fatalf("submit move group: %v", err)
	}
	if _, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, actor, true, "approved", submitted.RowVersion, false); err != nil {
		t.Fatalf("approve move group: %v", err)
	}

	wave, err := svc.CreateWave(ctx, tenantID, CreateWaveInput{
		ProgramID: programID, Name: "Wave 1", Sequence: 1, MoveGroupIDs: []uuid.UUID{mg.ID},
		PlannedDurationSeconds: 3600, Actor: actor,
	})
	if err != nil {
		t.Fatalf("create wave: %v", err)
	}
	waveID = wave.ID

	window, _, err := svc.CreateWindow(ctx, tenantID, CreateWindowInput{
		ProgramID: programID, WaveID: waveID, Name: "Sat maintenance", WindowType: WindowMaintenance,
		StartsAt: time.Now().Add(24 * time.Hour), EndsAt: time.Now().Add(28 * time.Hour), Actor: actor,
	})
	if err != nil {
		t.Fatalf("create window: %v", err)
	}
	windowID = window.ID

	plan, err := svc.UpsertRollbackPlan(ctx, tenantID, RollbackPlan{
		WindowID: windowID, Strategy: "restore-snapshot", Procedures: "revert dns + restore db",
		SuccessCriteria: "health checks green",
	}, actor)
	if err != nil {
		t.Fatalf("upsert rollback plan: %v", err)
	}
	if _, err := svc.DecideRollbackPlan(ctx, tenantID, DecisionInput{
		ID: plan.ID, Decision: DecisionApproved, ExpectedVersion: plan.RowVersion, Actor: actor,
	}); err != nil {
		t.Fatalf("approve rollback plan: %v", err)
	}
	return programID, waveID, windowID
}

func workloadStatuses(t *testing.T, ctx context.Context, svc *Service, tenantID, programID uuid.UUID, actor Actor) map[string]WorkloadStatus {
	t.Helper()
	wls, _, err := svc.ListWorkloads(ctx, tenantID, programID, actor, "", nil, 100, 0)
	if err != nil {
		t.Fatalf("list workloads: %v", err)
	}
	out := map[string]WorkloadStatus{}
	for _, w := range wls {
		out[w.AppKey] = w.Status
	}
	return out
}

// seedReadyGate creates a required gate check of the given kind and records it
// as passed so the corresponding cutover gate does not block.
func seedReadyGate(t *testing.T, ctx context.Context, svc *Service, tenantID, programID, windowID uuid.UUID, kind CheckKind, actor Actor) {
	t.Helper()
	gc, err := svc.CreateGateCheck(ctx, tenantID, GateCheck{
		ProgramID: programID, WindowID: windowID, Kind: kind, Name: string(kind) + " check", Required: true,
	}, actor)
	if err != nil {
		t.Fatalf("create %s gate: %v", kind, err)
	}
	if _, err := svc.RecordGateCheck(ctx, tenantID, gc.ID, actor, CheckPassed, "evidence", "ok"); err != nil {
		t.Fatalf("record %s gate: %v", kind, err)
	}
}

func TestIntegrationCutoverDrivesWorkloadLifecycle(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, _, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	// Before any lifecycle event the workloads are freshly discovered. Drive
	// them explicitly to "planned" via the transition path so the cutover has
	// the legal starting state.
	wls, _, err := svc.ListWorkloads(ctx, tenantID, programID, actor, "", nil, 100, 0)
	if err != nil {
		t.Fatalf("list workloads: %v", err)
	}
	for _, w := range wls {
		if w.Status != WorkloadDiscovered {
			t.Fatalf("workload %s starts at %s, want discovered", w.AppKey, w.Status)
		}
		cur := w
		for _, to := range []WorkloadStatus{WorkloadAssessed, WorkloadPlanned} {
			updated, err := svc.TransitionWorkload(ctx, tenantID, cur.ID, to, cur.RowVersion, "prep", actor)
			if err != nil {
				t.Fatalf("transition %s -> %s: %v", cur.AppKey, to, err)
			}
			cur = *updated
		}
	}

	// An illegal explicit transition must be rejected by the state machine.
	if _, err := svc.TransitionWorkload(ctx, tenantID, wls[0].ID, WorkloadLive, 0, "", actor); err == nil {
		t.Fatal("planned -> live should be rejected by the state machine")
	}

	// Readiness gate must pass before cutover can start.
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckReadiness, actor)
	if _, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{ID: windowID, Decision: DecisionGo, ExpectedVersion: 1, Actor: actor}); err != nil {
		t.Fatalf("go decision: %v", err)
	}

	if _, err := svc.StartCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("start cutover: %v", err)
	}
	// StartCutover must drive workloads planned -> in_migration -> cutover.
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadCutover {
			t.Fatalf("after start, workload %s = %s, want cutover", app, st)
		}
	}

	// Validation gate must pass before completion.
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckValidation, actor)
	if _, err := svc.CompleteCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("complete cutover: %v", err)
	}
	// CompleteCutover must drive workloads cutover -> validated -> live.
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadLive {
			t.Fatalf("after complete, workload %s = %s, want live", app, st)
		}
	}
}

func TestIntegrationRollbackDrivesWorkloadLifecycle(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	// Move workloads to in_migration so they are mid-cutover.
	wls, _, _ := svc.ListWorkloads(ctx, tenantID, programID, actor, "", nil, 100, 0)
	for _, w := range wls {
		cur := w
		for _, to := range []WorkloadStatus{WorkloadAssessed, WorkloadPlanned, WorkloadInMigration} {
			updated, err := svc.TransitionWorkload(ctx, tenantID, cur.ID, to, cur.RowVersion, "", actor)
			if err != nil {
				t.Fatalf("transition %s -> %s: %v", cur.AppKey, to, err)
			}
			cur = *updated
		}
	}
	// Put the wave in_progress so the rollback wave-transition is legal.
	if _, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{ID: windowID, Decision: DecisionGo, ExpectedVersion: 1, Actor: actor}); err != nil {
		t.Fatalf("go decision: %v", err)
	}
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckReadiness, actor)
	if _, err := svc.StartCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("start cutover: %v", err)
	}

	// Rollback must be blocked until a rollback_success gate passes.
	if _, err := svc.RollbackCutover(ctx, tenantID, windowID, "data corruption", actor); err == nil {
		t.Fatal("rollback without a passing rollback_success gate must be blocked")
	}
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckRollbackSuccess, actor)

	if _, err := svc.RollbackCutover(ctx, tenantID, windowID, "data corruption", actor); err != nil {
		t.Fatalf("rollback cutover: %v", err)
	}
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadRolledBack {
			t.Fatalf("after rollback, workload %s = %s, want rolled_back", app, st)
		}
	}
	// The wave itself must be rolled_back too.
	wave, err := svc.GetWave(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("get wave: %v", err)
	}
	if wave.Status != WaveRolledBack {
		t.Fatalf("wave status = %s, want rolled_back", wave.Status)
	}
}

func TestIntegrationCriticalPathFromRealData(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, _ := seedWaveForCutover(t, ctx, svc, tenantID, actor)
	_ = programID

	cp, err := svc.CriticalPathForWave(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("critical path: %v", err)
	}
	// db (6h) depends on api (4h): critical path = api -> db = 10h = 36000s,
	// computed from the persisted dependency graph and effort estimates, not a
	// constant. (The wave's planned duration of 1h does not raise this.)
	if cp.TotalSeconds != 10*3600 {
		t.Fatalf("critical path total = %d, want %d (api->db from DB)", cp.TotalSeconds, 10*3600)
	}
	if cp.Method != "estimated_effort" {
		t.Fatalf("method = %q, want estimated_effort", cp.Method)
	}
	if len(cp.Nodes) != 2 || cp.Nodes[0].AppKey != "api" || cp.Nodes[1].AppKey != "db" {
		t.Fatalf("critical nodes = %#v, want api then db", cp.Nodes)
	}
	if cp.Nodes[0].OffsetSeconds != 0 || cp.Nodes[1].OffsetSeconds != 4*3600 {
		t.Fatalf("node offsets = %d,%d, want 0,%d", cp.Nodes[0].OffsetSeconds, cp.Nodes[1].OffsetSeconds, 4*3600)
	}
}

func TestIntegrationMigrationsRollBack(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	applyMigrateMigrations(t, ctx, pool, ".down.sql")
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.tables WHERE table_name = 'migrate_workload'
	)`).Scan(&exists); err != nil {
		t.Fatalf("check table existence: %v", err)
	}
	if exists {
		t.Fatalf("migrate_workload table still exists after rollback")
	}
}
