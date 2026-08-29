package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

// These tests pin the SQL SHAPE of the READ-ONLY process-MINING queries AND
// prove they run TENANT-SCOPED under RLS rather than against a raw pool. They
// inject a pgxmock pool wrapped in the PRODUCTION scopedPool (via
// newWorkflowMiningRepositoryWithDB(newScopedPool(mock))) — exactly what
// NewWorkflowMiningRepository builds — so each query is preceded by the
// ExpectBegin + SET LOCAL app.current_tenant_id set_config and followed by the
// ExpectCommit that the scopedPool applies. If any mining method regressed to a
// raw-pool call (no SET LOCAL), the tenant-scope expectation below would go unmet
// and the test would fail; under the 000008 FORCE-RLS policies such a call
// returns zero rows in production, so this test is the guard.

func newScopedMiningRepo(mock pgxmock.PgxPoolIface) *WorkflowMiningRepository {
	return newWorkflowMiningRepositoryWithDB(newScopedPool(mock))
}

func TestMiningRepo_InstancePathsRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedMiningRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	// The path query array_aggs step_id ordered by (started_at, created_at, id)
	// per instance, joined instance -> definition, filtered to started steps in
	// the window.
	mock.ExpectQuery(`(?s)array_agg\(se\.step_id ORDER BY se\.started_at, se\.created_at, se\.id\).*FROM workflow_instances i.*JOIN workflow_definitions d.*JOIN workflow_step_executions se.*se\.started_at IS NOT NULL.*GROUP BY i\.id`).
		WithArgs(anTenant, anDefKey, 30).
		WillReturnRows(pgxmock.NewRows([]string{"instance_id", "completed", "cycle_ms", "sequence"}).
			AddRow("inst-1", true, int64(3600000), []string{"start", "review", "approve"}).
			AddRow("inst-2", false, int64(0), []string{"start", "review"}))
	mock.ExpectCommit()

	paths, err := repo.InstancePaths(context.Background(), anTenant, anDefKey, 30)
	if err != nil {
		t.Fatalf("InstancePaths() error = %v", err)
	}
	if len(paths) != 2 {
		t.Fatalf("InstancePaths() len = %d, want 2", len(paths))
	}
	if paths[0].InstanceID != "inst-1" || !paths[0].Completed || paths[0].CycleMs != 3600000 {
		t.Fatalf("InstancePaths()[0] = %+v, unexpected", paths[0])
	}
	if len(paths[0].Sequence) != 3 || paths[0].Sequence[2] != "approve" {
		t.Fatalf("InstancePaths()[0].Sequence = %v, unexpected", paths[0].Sequence)
	}
	if paths[1].Completed || paths[1].CycleMs != 0 {
		t.Fatalf("InstancePaths()[1] = %+v, want incomplete", paths[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations (tenant scope or query shape drifted): %v", err)
	}
}

func TestMiningRepo_StepDurationSamplesRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedMiningRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)EXTRACT\(EPOCH FROM \(se\.completed_at - se\.started_at\)\) \* 1000.*FROM workflow_step_executions se.*JOIN workflow_instances i.*JOIN workflow_definitions d.*se\.completed_at >= se\.started_at.*ORDER BY se\.step_id, se\.started_at`).
		WithArgs(anTenant, anDefKey, 90).
		WillReturnRows(pgxmock.NewRows([]string{"step_id", "step_type", "duration_ms"}).
			AddRow("review", "human_task", int64(1800000)).
			AddRow("review", "human_task", int64(2400000)))
	mock.ExpectCommit()

	samples, err := repo.StepDurationSamples(context.Background(), anTenant, anDefKey, 90)
	if err != nil {
		t.Fatalf("StepDurationSamples() error = %v", err)
	}
	if len(samples) != 2 || samples[0].StepID != "review" || samples[0].DurationMs != 1800000 {
		t.Fatalf("StepDurationSamples() = %+v, unexpected", samples)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestMiningRepo_LoadDefinitionGraphRunsTenantScoped(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedMiningRepo(mock)

	// QueryRow through the scopedPool opens the tx + set_config lazily on Scan.
	expectTenantScopedBegin(mock, anTenant)
	stepsJSON := []byte(`[
		{"id":"start","type":"service_task","name":"Start","transitions":[{"target":"review"}]},
		{"id":"review","type":"human_task","name":"Review","transitions":[{"target":"approve"},{"target":"reject"}]},
		{"id":"approve","type":"end","name":"Approve","transitions":[]},
		{"id":"reject","type":"end","name":"Reject","transitions":[]}
	]`)
	mock.ExpectQuery(`(?s)SELECT d\.definition_key::text, d\.name, d\.version, d\.steps.*FROM workflow_definitions d.*status = 'active'.*ORDER BY.*DESC, d\.version DESC.*LIMIT 1`).
		WithArgs(anTenant, anDefKey).
		WillReturnRows(pgxmock.NewRows([]string{"definition_key", "name", "version", "steps"}).
			AddRow(anDefKey, "Contract Review", 2, stepsJSON))
	mock.ExpectCommit()

	g, err := repo.LoadDefinitionGraph(context.Background(), anTenant, anDefKey)
	if err != nil {
		t.Fatalf("LoadDefinitionGraph() error = %v", err)
	}
	if g.Version != 2 || len(g.Steps) != 4 {
		t.Fatalf("LoadDefinitionGraph() = %+v, want 4 steps v2", g)
	}
	if g.Steps["review"] != "human_task" {
		t.Fatalf("step type for review = %q, want human_task", g.Steps["review"])
	}
	// Allowed transitions: review -> {approve, reject}; start -> {review}.
	if _, ok := g.AllowedTransitions["review"]["approve"]; !ok {
		t.Fatalf("review->approve not in allowed transitions: %+v", g.AllowedTransitions["review"])
	}
	if _, ok := g.AllowedTransitions["review"]["reject"]; !ok {
		t.Fatalf("review->reject not in allowed transitions: %+v", g.AllowedTransitions["review"])
	}
	if _, ok := g.AllowedTransitions["start"]["approve"]; ok {
		t.Fatalf("start->approve should NOT be allowed")
	}
	// StepOrder preserves declaration order.
	if len(g.StepOrder) != 4 || g.StepOrder[0] != "start" || g.StepOrder[1] != "review" {
		t.Fatalf("StepOrder = %v, unexpected", g.StepOrder)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestMiningRepo_LoadDefinitionGraphNotFound proves a lineage with no active
// version maps pgx.ErrNoRows -> model.ErrNotFound.
func TestMiningRepo_LoadDefinitionGraphNotFound(t *testing.T) {
	mock := newAnalyticsMock(t)
	repo := newScopedMiningRepo(mock)

	expectTenantScopedBegin(mock, anTenant)
	mock.ExpectQuery(`(?s)FROM workflow_definitions d.*LIMIT 1`).
		WithArgs(anTenant, anDefKey).
		WillReturnError(pgx.ErrNoRows)
	// scopedRow.Scan returns before commit on error; the deferred rollback frees
	// the connection. We assert the error mapping rather than the commit here.

	_, err := repo.LoadDefinitionGraph(context.Background(), anTenant, anDefKey)
	if err == nil {
		t.Fatal("LoadDefinitionGraph() want ErrNotFound, got nil")
	}
	if !regexp.MustCompile(`no active version`).MatchString(err.Error()) {
		t.Fatalf("LoadDefinitionGraph() err = %v, want no-active-version", err)
	}
}
