//go:build integration

package migrate

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

// countingDBTX wraps a real pgx.Tx and records every SQL statement executed
// through it, so a test can PROVE that an aggregation does not issue a per-row
// (N+1) query pattern. It is a faithful pass-through: the queries still hit the
// real database, only their text is tallied.
type countingDBTX struct {
	tx   pgx.Tx
	mu   *sync.Mutex
	sqls *[]string
}

func (c countingDBTX) record(sql string) {
	c.mu.Lock()
	*c.sqls = append(*c.sqls, sql)
	c.mu.Unlock()
}

func (c countingDBTX) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.record(sql)
	return c.tx.Exec(ctx, sql, args...)
}

func (c countingDBTX) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.record(sql)
	return c.tx.Query(ctx, sql, args...)
}

func (c countingDBTX) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	c.record(sql)
	return c.tx.QueryRow(ctx, sql, args...)
}

// countingRunner is a tenantRunner that wraps the real pgx runner and threads a
// countingDBTX so we can inspect the SQL a service call issued.
type countingRunner struct {
	pool *pgxpool.Pool
	mu   sync.Mutex
	sqls []string
}

func (r *countingRunner) reset() {
	r.mu.Lock()
	r.sqls = nil
	r.mu.Unlock()
}

func (r *countingRunner) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, len(r.sqls))
	copy(out, r.sqls)
	return out
}

func (r *countingRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error {
		return fn(countingDBTX{tx: tx, mu: &r.mu, sqls: &r.sqls})
	})
}

func (r *countingRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error {
		return fn(countingDBTX{tx: tx, mu: &r.mu, sqls: &r.sqls})
	})
}

// countMatching returns how many recorded SQL statements contain the substring.
func countMatching(sqls []string, substr string) int {
	n := 0
	for _, s := range sqls {
		if strings.Contains(s, substr) {
			n++
		}
	}
	return n
}

// seedProgramWithNWaves builds a program with n independent waves (each its own
// approved move group + two workloads + a window), returning the program id and
// the wave ids. It reuses the real service flow so the data is authentic.
func seedProgramWithNWaves(t *testing.T, ctx context.Context, svc *Service, tenantID uuid.UUID, actor Actor, n int) (uuid.UUID, []uuid.UUID) {
	t.Helper()
	prog, err := svc.CreateProgram(ctx, tenantID, CreateProgramInput{Name: "Batch Program", Actor: actor})
	if err != nil {
		t.Fatalf("create program: %v", err)
	}
	programID := prog.ID
	waveIDs := make([]uuid.UUID, 0, n)
	for i := 0; i < n; i++ {
		apiKey := "api" + string(rune('a'+i))
		dbKey := "db" + string(rune('a'+i))
		for _, in := range []WorkloadInput{
			{AppKey: apiKey, Name: "API " + apiKey, Strategy: StrategyReplatform, Tier: "tier-1", ReadinessScore: 80, EstimatedEffortHours: 4},
			{AppKey: dbKey, Name: "DB " + dbKey, Strategy: StrategyRehost, Tier: "tier-0", ReadinessScore: 60, EstimatedEffortHours: 6, Dependencies: []WorkloadDependency{{AppKey: apiKey, Criticality: "hard"}}},
		} {
			if _, err := svc.UpsertWorkload(ctx, tenantID, programID, in, actor); err != nil {
				t.Fatalf("upsert workload %s: %v", in.AppKey, err)
			}
		}
		mg, err := svc.CreateMoveGroup(ctx, tenantID, CreateMoveGroupInput{
			ProgramID: programID, Name: "Group " + apiKey, AppKeys: []string{apiKey, dbKey}, Actor: actor,
		})
		if err != nil {
			t.Fatalf("create move group: %v", err)
		}
		checked, err := svc.ValidateMoveGroupCompleteness(ctx, tenantID, mg.ID, actor, mg.RowVersion)
		if err != nil {
			t.Fatalf("validate completeness: %v", err)
		}
		submitted, err := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, checked.RowVersion)
		if err != nil {
			t.Fatalf("submit move group: %v", err)
		}
		if _, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, actor, true, "approved", submitted.RowVersion, false); err != nil {
			t.Fatalf("approve move group: %v", err)
		}
		wave, err := svc.CreateWave(ctx, tenantID, CreateWaveInput{
			ProgramID: programID, Name: "Wave", Sequence: i + 1, MoveGroupIDs: []uuid.UUID{mg.ID},
			PlannedDurationSeconds: 3600, Actor: actor,
		})
		if err != nil {
			t.Fatalf("create wave: %v", err)
		}
		waveIDs = append(waveIDs, wave.ID)
		if _, _, err := svc.CreateWindow(ctx, tenantID, CreateWindowInput{
			ProgramID: programID, WaveID: wave.ID, Name: "Win", WindowType: WindowMaintenance,
			StartsAt: time.Now().Add(time.Duration(24*(i+1)) * time.Hour),
			EndsAt:   time.Now().Add(time.Duration(24*(i+1)+2) * time.Hour), Actor: actor,
		}); err != nil {
			t.Fatalf("create window: %v", err)
		}
	}
	return programID, waveIDs
}

// TestCommandCenterAggregationIsBatched proves the command-center aggregation does
// NOT issue a per-wave GetWave query: the count of the wave-by-id SELECT must be
// INDEPENDENT of the number of waves (the fixed N+1). We run the aggregation for a
// 2-wave and a 6-wave program through a counting runner and assert the per-wave
// query count is identical (and small), while the batched HydrateWaves query runs
// exactly once.
func TestCommandCenterAggregationIsBatched(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	defer pool.Close()

	runner := &countingRunner{pool: pool}
	svc := NewServiceWithDeps(runner, NewStore(), zerolog.Nop(), allowAllEntitlements{})
	actor := fullActor()

	tenantSmall := uuid.New()
	tenantLarge := uuid.New()
	smallProgram, _ := seedProgramWithNWaves(t, ctx, svc, tenantSmall, actor, 2)
	largeProgram, _ := seedProgramWithNWaves(t, ctx, svc, tenantLarge, actor, 6)

	// The per-wave, single-row wave fetch is uniquely identified by this fragment.
	const perWaveFetch = "FROM migrate_wave WHERE tenant_id = $1 AND id = $2"
	// The batched hydrate is uniquely identified by its ANY($2) wave-id predicate.
	const batchedHydrate = "WHERE wmg.tenant_id = $1 AND wmg.wave_id = ANY($2)"

	runner.reset()
	ccSmall, err := svc.CommandCenter(ctx, tenantSmall, smallProgram, actor)
	if err != nil {
		t.Fatalf("command center (small): %v", err)
	}
	smallSQL := runner.snapshot()
	smallPerWave := countMatching(smallSQL, perWaveFetch)
	smallHydrate := countMatching(smallSQL, batchedHydrate)

	runner.reset()
	ccLarge, err := svc.CommandCenter(ctx, tenantLarge, largeProgram, actor)
	if err != nil {
		t.Fatalf("command center (large): %v", err)
	}
	largeSQL := runner.snapshot()
	largePerWave := countMatching(largeSQL, perWaveFetch)
	largeHydrate := countMatching(largeSQL, batchedHydrate)

	// The batched hydrate must run exactly once regardless of wave count.
	if smallHydrate != 1 || largeHydrate != 1 {
		t.Fatalf("batched HydrateWaves query must run exactly once, got small=%d large=%d", smallHydrate, largeHydrate)
	}
	// The per-wave single-row fetch count must NOT grow with the number of waves.
	// (Before the fix it was one GetWave per wave: 2 vs 6.)
	if smallPerWave != largePerWave {
		t.Fatalf("per-wave GetWave N+1 detected: small(2 waves)=%d, large(6 waves)=%d — must be equal", smallPerWave, largePerWave)
	}
	if largePerWave > 1 {
		t.Fatalf("command center must not fetch waves one-by-one; per-wave fetches=%d", largePerWave)
	}

	// The payload must actually carry the hydrated waves + per-wave status views.
	if len(ccLarge.Waves) != 6 || len(ccLarge.WaveStatuses) != 6 {
		t.Fatalf("large command center must carry 6 waves + 6 status views, got %d waves / %d statuses", len(ccLarge.Waves), len(ccLarge.WaveStatuses))
	}
	for _, w := range ccLarge.Waves {
		if len(w.MoveGroups) != 1 || len(w.MoveGroups[0].Workloads) != 2 {
			t.Fatalf("wave %s not fully hydrated: %d groups / workloads", w.Reference, len(w.MoveGroups))
		}
	}
	if len(ccSmall.Waves) != 2 {
		t.Fatalf("small command center must carry 2 waves, got %d", len(ccSmall.Waves))
	}
}

// TestCommandCenterPayloadCarriesVarianceAndBlockers proves the command-center
// payload actually INCLUDES variance_seconds (from a completed wave's actual-vs-
// planned duration) and readiness_blockers (an unmet required readiness gate), so
// the UI can render them — the P9 audit gap.
func TestCommandCenterPayloadCarriesVarianceAndBlockers(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	defer pool.Close()

	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	actor := fullActor()
	tenantID := uuid.New()

	programID, waveID, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	// Drive the wave to a completed run so it has an actual duration (variance).
	// Add + pass a required readiness gate so Start is not blocked.
	startCheck, err := svc.CreateGateCheck(ctx, tenantID, GateCheck{
		WindowID: windowID, Kind: CheckReadiness, Name: "infra ready", Required: true,
	}, actor)
	if err != nil {
		t.Fatalf("create start check: %v", err)
	}
	if _, err := svc.RecordGateCheck(ctx, tenantID, startCheck.ID, actor, CheckPassed, "ok", "pass"); err != nil {
		t.Fatalf("pass start check: %v", err)
	}
	if _, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{ID: windowID, Decision: DecisionGo, Rationale: "go", ExpectedVersion: 1, Actor: actor}); err != nil {
		t.Fatalf("go decision: %v", err)
	}
	if _, err := svc.StartCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("start cutover: %v", err)
	}
	// Add a required validation gate + pass it so complete succeeds → actual dur.
	valCheck, err := svc.CreateGateCheck(ctx, tenantID, GateCheck{
		WindowID: windowID, Kind: CheckValidation, Name: "post-cutover health", Required: true,
	}, actor)
	if err != nil {
		t.Fatalf("create validation check: %v", err)
	}
	if _, err := svc.RecordGateCheck(ctx, tenantID, valCheck.ID, actor, CheckPassed, "green", "pass"); err != nil {
		t.Fatalf("pass validation: %v", err)
	}
	if _, err := svc.CompleteCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("complete cutover: %v", err)
	}
	// Now re-open a readiness blocker so the payload has one to report.
	reblock, err := svc.CreateGateCheck(ctx, tenantID, GateCheck{
		WindowID: windowID, Kind: CheckReadiness, Name: "residual risk sign-off", Required: true,
	}, actor)
	if err != nil {
		t.Fatalf("create reblock: %v", err)
	}
	if _, err := svc.RecordGateCheck(ctx, tenantID, reblock.ID, actor, CheckFailed, "awaiting sign-off", "fail"); err != nil {
		t.Fatalf("fail reblock: %v", err)
	}

	cc, err := svc.CommandCenter(ctx, tenantID, programID, actor)
	if err != nil {
		t.Fatalf("command center: %v", err)
	}

	// variance_seconds must be populated: the wave completed near-instantly against
	// a 3600s plan, so variance = actual - planned should be negative and non-zero.
	if cc.VarianceSeconds == 0 {
		t.Fatalf("command center variance_seconds must be non-zero after a completed wave, got 0")
	}
	// readiness_blockers must include the open required readiness gate.
	foundBlocker := false
	for _, b := range cc.ReadinessBlockers {
		if b.ID == reblock.ID {
			foundBlocker = true
		}
	}
	if !foundBlocker {
		t.Fatalf("command center readiness_blockers must include the open required readiness gate; got %d blockers", len(cc.ReadinessBlockers))
	}
	// The per-wave status view must be present and carry the wave variance + status.
	if len(cc.WaveStatuses) != 1 {
		t.Fatalf("expected 1 wave status view, got %d", len(cc.WaveStatuses))
	}
	view := cc.WaveStatuses[0]
	if view.WaveID != waveID {
		t.Fatalf("wave status view wave_id = %s, want %s", view.WaveID, waveID)
	}
	if view.Status != WaveCompleted || view.CompletionPercent != 100 {
		t.Fatalf("completed wave status view must be completed/100%%, got %s/%d", view.Status, view.CompletionPercent)
	}
	if view.ActualDurationSeconds == nil || view.VarianceSeconds == 0 {
		t.Fatalf("completed wave status view must carry actual duration + variance, got %#v", view)
	}

	// And the exec status summary projects the same aggregate: blockers + variance.
	summary, err := svc.ProgramStatusSummary(ctx, tenantID, programID, actor)
	if err != nil {
		t.Fatalf("status summary: %v", err)
	}
	if summary.BlockerCount == 0 || len(summary.Blockers) == 0 {
		t.Fatalf("status summary must report the open blocker, got %d", summary.BlockerCount)
	}
	if summary.VarianceSeconds != cc.VarianceSeconds {
		t.Fatalf("status summary variance %d must equal command center variance %d", summary.VarianceSeconds, cc.VarianceSeconds)
	}
	if summary.WaveCount != 1 || summary.CompletedWaves != 1 || summary.OverallPercent != 100 {
		t.Fatalf("status summary rollup wrong: waves=%d completed=%d overall=%d", summary.WaveCount, summary.CompletedWaves, summary.OverallPercent)
	}
}
