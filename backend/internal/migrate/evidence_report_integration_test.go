//go:build integration

package migrate

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// TestIntegrationEvidenceReportStructure proves P10b: the evidence report is a
// STRUCTURED, sectioned document (program -> waves -> move-groups -> windows +
// gate decisions + cutover-run task outcomes -> approvals -> rollbacks ->
// connector invocations), NOT a flat audit-row dump; and its counts/content
// reflect the real program state driven through the lifecycle.
func TestIntegrationEvidenceReportStructure(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)

	// Drive the cutover run to completion so the report carries a completed wave +
	// real per-task outcomes.
	started, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor)
	if err != nil {
		t.Fatalf("start window run: %v", err)
	}
	for _, task := range started.LiveState.Tasks {
		if _, err := svc.ActOnWindowTask(ctx, tenantID, windowID, task.ID, DRActionComplete, "", false, actor); err != nil {
			t.Fatalf("complete task: %v", err)
		}
	}

	report, err := svc.EvidenceReport(ctx, tenantID, programID, actor)
	if err != nil {
		t.Fatalf("evidence report: %v", err)
	}

	// Top-level structure.
	if report.Program.ID != programID {
		t.Fatalf("report program id = %s, want %s", report.Program.ID, programID)
	}
	if report.GeneratedAt.IsZero() {
		t.Fatal("report generated_at is zero")
	}
	if len(report.Waves) != 1 {
		t.Fatalf("report waves = %d, want 1", len(report.Waves))
	}
	we := report.Waves[0]
	if we.Wave.ID != waveID {
		t.Fatalf("wave id = %s, want %s", we.Wave.ID, waveID)
	}
	if len(we.MoveGroups) == 0 {
		t.Fatal("wave evidence has no move groups")
	}
	if we.Runbook == nil {
		t.Fatal("wave evidence has no runbook binding")
	}
	if len(we.Windows) != 1 {
		t.Fatalf("wave windows = %d, want 1", len(we.Windows))
	}
	wnde := we.Windows[0]

	// Go/No-Go decision + its gate check evidence must be present (structured, not a
	// flat audit row).
	if wnde.Window.Decision != DecisionGo {
		t.Fatalf("window decision = %s, want go", wnde.Window.Decision)
	}
	if len(wnde.GateChecks) == 0 {
		t.Fatal("window evidence has no gate checks")
	}
	foundEvidence := false
	for _, c := range wnde.GateChecks {
		if c.Status == CheckPassed && c.Evidence != "" {
			foundEvidence = true
		}
	}
	if !foundEvidence {
		t.Fatal("no passed gate check with recorded evidence in the report")
	}

	// Cutover run with real per-task outcomes.
	if wnde.CutoverRun == nil {
		t.Fatal("window evidence has no cutover run")
	}
	if wnde.CutoverRun.Status != DRRunStatusCompleted {
		t.Fatalf("cutover run status = %s, want completed", wnde.CutoverRun.Status)
	}
	if len(wnde.CutoverRun.Tasks) == 0 {
		t.Fatal("cutover run evidence has no task outcomes")
	}
	for _, task := range wnde.CutoverRun.Tasks {
		if task.Required && task.Status != DRTaskRunComplete {
			t.Fatalf("required task %s status = %s, want complete", task.TaskKey, task.Status)
		}
	}

	// Summary rollups reflect the driven state.
	if report.Summary.WaveCount != 1 || report.Summary.CompletedWaves != 1 {
		t.Fatalf("summary waves=%d completed=%d, want 1/1", report.Summary.WaveCount, report.Summary.CompletedWaves)
	}
	if report.Summary.CutoverRunCount != 1 {
		t.Fatalf("summary cutover runs = %d, want 1", report.Summary.CutoverRunCount)
	}
	if report.Summary.GoDecisions != 1 {
		t.Fatalf("summary go decisions = %d, want 1", report.Summary.GoDecisions)
	}

	// The structured PDF renders every section (it is NOT the truncated table): a
	// non-trivial document is produced.
	export, err := buildStructuredPDFReport(report)
	if err != nil {
		t.Fatalf("structured pdf: %v", err)
	}
	if export.ContentType != "application/pdf" || export.SizeBytes < 1000 {
		t.Fatalf("structured pdf = %s (%d bytes), want a non-trivial application/pdf", export.ContentType, export.SizeBytes)
	}
}

// TestIntegrationEvidenceReportRollbackProvenance proves the report includes the
// rollback provenance section (who/why) once a rollback has been executed +
// completed against the wave.
func TestIntegrationEvidenceReportRollbackProvenance(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	programID, _, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)
	if _, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor); err != nil {
		t.Fatalf("start window run: %v", err)
	}

	// Execute a rollback and drive it to completion.
	run, err := svc.ExecuteRollback(ctx, tenantID, windowID, "prod incident: data drift detected", "live", actor)
	if err != nil {
		t.Fatalf("execute rollback: %v", err)
	}
	completeRun(t, ctx, bridge, run.DRRunID)
	if _, _, err := svc.GetRollbackRun(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("get rollback run (drive success): %v", err)
	}

	report, err := svc.EvidenceReport(ctx, tenantID, programID, actor)
	if err != nil {
		t.Fatalf("evidence report: %v", err)
	}
	if len(report.Rollbacks) != 1 {
		t.Fatalf("report rollbacks = %d, want 1", len(report.Rollbacks))
	}
	rb := report.Rollbacks[0]
	if rb.Reason != "prod incident: data drift detected" {
		t.Fatalf("rollback reason = %q, want the recorded provenance reason", rb.Reason)
	}
	if rb.TriggeredBy != actor.UserID {
		t.Fatalf("rollback triggered_by = %s, want %s", rb.TriggeredBy, actor.UserID)
	}
	if rb.Status != RollbackRunCompleted {
		t.Fatalf("rollback status = %s, want completed", rb.Status)
	}
	if report.Summary.RollbackRunCount != 1 {
		t.Fatalf("summary rollback runs = %d, want 1", report.Summary.RollbackRunCount)
	}
}

// completeRun drives every required task of a run in the stateful bridge to
// complete, so the run reaches "completed" and the migrate success gate fires.
func completeRun(t *testing.T, ctx context.Context, bridge *statefulDRBridge, runID uuid.UUID) {
	t.Helper()
	live, err := bridge.GetRun(ctx, uuid.Nil, runID)
	if err != nil {
		t.Fatalf("get run for completion: %v", err)
	}
	for _, task := range live.Tasks {
		if _, err := bridge.ActOnTask(ctx, uuid.Nil, runID, task.ID, DRActionComplete, "", false); err != nil {
			t.Fatalf("complete run task: %v", err)
		}
	}
}
