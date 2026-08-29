package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

// These tests pin the SQL SHAPE of the READ-ONLY process-analytics queries AND
// prove they run TENANT-SCOPED under RLS rather than against a raw pool. They
// inject a pgxmock pool wrapped in the PRODUCTION scopedPool (via
// newWorkflowAnalyticsRepositoryWithDB(newScopedPool(mock))) — exactly what
// NewWorkflowAnalyticsRepository builds — so each query is preceded by the
// ExpectBegin + SET LOCAL app.current_tenant_id set_config and followed by the
// ExpectCommit that the scopedPool applies. If any analytics method regressed to
// a raw-pool call (no SET LOCAL), the tenant-scope expectation below would go
// unmet and the test would fail; under the 000008 FORCE-RLS policies such a call
// returns zero rows in production, so this test is the guard.

const (
	anTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	anDefKey = "dddddddd-0000-0000-0000-000000000004"
)

func newAnalyticsMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

// newScopedAnalyticsRepo wraps the mock in the production scopedPool so the RLS
// SET LOCAL transaction wrapping is exercised — this is what
// NewWorkflowAnalyticsRepository does with the real pool.
func newScopedAnalyticsRepo(mock pgxmock.PgxPoolIface) *WorkflowAnalyticsRepository {
	return newWorkflowAnalyticsRepositoryWithDB(newScopedPool(mock))
}

// expectTenantScopedBegin asserts the scopedPool opens a tx and sets the tenant
// RLS session variable before the real query — the tenant-scoping guarantee.
func expectTenantScopedBegin(mock pgxmock.PgxPoolIface, tenantID string) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT set_config('app.current_tenant_id',")).
		WithArgs(tenantID).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))
}

func TestAnalyticsRepo_CycleTimeRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)percentile_cont\(0\.5\).*percentile_cont\(0\.9\).*percentile_cont\(0\.95\).*FROM workflow_instances i.*JOIN workflow_definitions d.*i\.status = 'completed'.*GROUP BY d\.definition_key, i\.definition_ver.*ORDER BY i\.definition_ver DESC`).
		WithArgs(anTenant, anDefKey, 30).
		WillReturnRows(pgxmock.NewRows([]string{
			"definition_key", "definition_name", "version", "completed_count",
			"mean_seconds", "p50_seconds", "p90_seconds", "p95_seconds",
			"min_seconds", "max_seconds",
		}).AddRow(anDefKey, "Contract Review", 2, 5, 3600.0, 3000.0, 5400.0, 6000.0, 1200.0, 7200.0))
	mock.ExpectCommit()

	rows, err := repo.CycleTime(context.Background(), anTenant, anDefKey, 30)
	if err != nil {
		t.Fatalf("CycleTime() error = %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("CycleTime() len = %d, want 1", len(rows))
	}
	if rows[0].Version != 2 || rows[0].P90Seconds != 5400.0 || rows[0].CompletedCount != 5 {
		t.Fatalf("CycleTime() row = %+v, unexpected values", rows[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations (tenant scope or query shape drifted): %v", err)
	}
}

func TestAnalyticsRepo_BottlenecksRunsTenantScopedAndRanks(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	// The bottleneck query joins step executions -> instances -> definitions,
	// derives a wait/work split from the task claim timestamp, counts attempt>1
	// as rework, and ranks slowest-first by p90.
	mock.ExpectQuery(`(?s)WITH step_durations AS.*workflow_step_executions se.*JOIN workflow_instances i.*LEFT JOIN LATERAL.*workflow_tasks tk.*attempt > 1.*ORDER BY p90_seconds DESC`).
		WithArgs(anTenant, "", 90).
		WillReturnRows(pgxmock.NewRows([]string{
			"step_id", "step_type", "execution_count",
			"median_seconds", "p90_seconds", "mean_seconds", "max_seconds",
			"wait_seconds", "work_seconds", "rework_rate",
		}).
			AddRow("review", "human_task", 10, 1800.0, 4000.0, 2100.0, 6000.0, 1500.0, 300.0, 0.2))
	mock.ExpectCommit()

	rows, err := repo.Bottlenecks(context.Background(), anTenant, "", 90)
	if err != nil {
		t.Fatalf("Bottlenecks() error = %v", err)
	}
	if len(rows) != 1 || rows[0].StepID != "review" || rows[0].ReworkRate != 0.2 {
		t.Fatalf("Bottlenecks() rows = %+v, unexpected", rows)
	}
	if rows[0].WaitSeconds != 1500.0 || rows[0].WorkSeconds != 300.0 {
		t.Fatalf("Bottlenecks() wait/work split = %v/%v, want 1500/300", rows[0].WaitSeconds, rows[0].WorkSeconds)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestAnalyticsRepo_BottlenecksScopedToDefinition proves the optional
// definition_key filter is passed through (non-empty $2) so the LATERAL/scoped
// filter narrows to one lineage.
func TestAnalyticsRepo_BottlenecksScopedToDefinition(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)\$2::text = '' OR d\.definition_key = NULLIF\(\$2, ''\)::uuid`).
		WithArgs(anTenant, anDefKey, 90).
		WillReturnRows(pgxmock.NewRows([]string{
			"step_id", "step_type", "execution_count",
			"median_seconds", "p90_seconds", "mean_seconds", "max_seconds",
			"wait_seconds", "work_seconds", "rework_rate",
		}))
	mock.ExpectCommit()

	if _, err := repo.Bottlenecks(context.Background(), anTenant, anDefKey, 90); err != nil {
		t.Fatalf("Bottlenecks(scoped) error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAnalyticsRepo_ReworkPerDefinitionRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)SUM\(CASE WHEN se\.attempt > 1.*FROM workflow_step_executions se.*JOIN workflow_instances i.*GROUP BY d\.definition_key.*ORDER BY rework_rate DESC`).
		WithArgs(anTenant, 90).
		WillReturnRows(pgxmock.NewRows([]string{
			"definition_key", "definition_name", "total_executions", "rework_executions", "rework_rate",
		}).AddRow(anDefKey, "Contract Review", 20, 4, 0.2))
	mock.ExpectCommit()

	rows, err := repo.ReworkPerDefinition(context.Background(), anTenant, 90)
	if err != nil {
		t.Fatalf("ReworkPerDefinition() error = %v", err)
	}
	if len(rows) != 1 || rows[0].StepID != "" || rows[0].ReworkExecutions != 4 || rows[0].ReworkRate != 0.2 {
		t.Fatalf("ReworkPerDefinition() rows = %+v, unexpected", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAnalyticsRepo_ReworkPerStepRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)se\.step_id.*FROM workflow_step_executions se.*GROUP BY d\.definition_key, se\.step_id`).
		WithArgs(anTenant, 90).
		WillReturnRows(pgxmock.NewRows([]string{
			"definition_key", "definition_name", "step_id", "total_executions", "rework_executions", "rework_rate",
		}).AddRow(anDefKey, "Contract Review", "review", 10, 3, 0.3))
	mock.ExpectCommit()

	rows, err := repo.ReworkPerStep(context.Background(), anTenant, 90)
	if err != nil {
		t.Fatalf("ReworkPerStep() error = %v", err)
	}
	if len(rows) != 1 || rows[0].StepID != "review" || rows[0].ReworkRate != 0.3 {
		t.Fatalf("ReworkPerStep() rows = %+v, unexpected", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAnalyticsRepo_ThroughputRunsTenantScopedDayBuckets(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	// interval 'day' is interpolated into DATE_TRUNC; the started/completed CTEs
	// bucket by started_at / completed_at and generate_series zero-fills.
	mock.ExpectQuery(`(?s)generate_series.*DATE_TRUNC\('day'.*FROM workflow_instances.*status = 'completed'.*status IN \('failed', 'incident'\).*ORDER BY b\.bucket_start ASC`).
		WithArgs(anTenant, 7).
		WillReturnRows(pgxmock.NewRows([]string{"bucket_start", "started", "completed", "failed"}).
			AddRow("2026-07-01T00:00:00Z", 3, 2, 1))
	mock.ExpectCommit()

	rows, err := repo.Throughput(context.Background(), anTenant, "day", 7)
	if err != nil {
		t.Fatalf("Throughput() error = %v", err)
	}
	if len(rows) != 1 || rows[0].Started != 3 || rows[0].Completed != 2 || rows[0].Failed != 1 {
		t.Fatalf("Throughput() rows = %+v, unexpected", rows)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestAnalyticsRepo_ThroughputWeekInterpolatesWeek proves the whitelisted 'week'
// interval reaches DATE_TRUNC('week', ...) (interpolation path).
func TestAnalyticsRepo_ThroughputWeekInterpolatesWeek(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)DATE_TRUNC\('week'.*INTERVAL '1 week'`).
		WithArgs(anTenant, 30).
		WillReturnRows(pgxmock.NewRows([]string{"bucket_start", "started", "completed", "failed"}))
	mock.ExpectCommit()

	if _, err := repo.Throughput(context.Background(), anTenant, "week", 30); err != nil {
		t.Fatalf("Throughput(week) error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAnalyticsRepo_ActiveCountRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedAnalyticsRepo(mock)

	// QueryRow through the scopedPool opens the tx + set_config lazily on Scan.
	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\)::int.*FROM workflow_instances.*status IN \('running', 'suspended', 'incident'\)`).
		WithArgs(anTenant).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(7))
	mock.ExpectCommit()

	n, err := repo.ActiveCount(context.Background(), anTenant)
	if err != nil {
		t.Fatalf("ActiveCount() error = %v", err)
	}
	if n != 7 {
		t.Fatalf("ActiveCount() = %d, want 7", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestAnalyticsRepo_ClampWindowDays proves the window default/bound guard.
func TestAnalyticsRepo_ClampWindowDays(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, 90}, {-5, 90}, {30, 30}, {365, 365}, {1000, 365},
	}
	for _, c := range cases {
		if got := clampWindowDays(c.in); got != c.want {
			t.Fatalf("clampWindowDays(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}
