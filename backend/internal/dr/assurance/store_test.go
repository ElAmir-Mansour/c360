package assurance

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func newStoreMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func anyArgs(n int) []any {
	args := make([]any, n)
	for i := range args {
		args[i] = pgxmock.AnyArg()
	}
	return args
}

func TestStoreSaveAssessmentPersistsHeaderAndResults(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newStoreMock(t)
	store := NewStore()

	tenantID := uuid.New()
	groupID := uuid.New()
	assessmentID := uuid.New()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	hdr := &StoredAssessment{
		TenantID: tenantID, GroupID: groupID, ProfileID: "profile-1", WorkloadID: "workload-1",
		Score: 75, Verdict: VerdictPartial, TotalChecks: 2, Satisfied: 1, Partial: 1,
		EvidenceSnapshot: AssuranceEvidence{RPO: []RPOEvidence{{ID: "rpo-1", ActualLagSeconds: 120}}},
		CreatedBy:        uuid.New(),
	}
	results := []StoredResult{
		{Code: "drill_cadence", Title: "Drill cadence", Verdict: VerdictSatisfied, Weight: 2, EvidenceRefs: []string{"drill-1"}},
		{Code: "rpo_breach_status", Title: "RPO breach status", Verdict: VerdictPartial, Severity: SeverityWarning, Weight: 3, Message: "lag warning", Recommendation: RecommendationInvestigateRPO},
	}

	mock.ExpectQuery("INSERT INTO dr_assurance_assessment").
		WithArgs(anyArgs(12)...).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow(assessmentID, now))
	r1 := uuid.New()
	r2 := uuid.New()
	mock.ExpectQuery("INSERT INTO dr_assurance_result").
		WithArgs(anyArgs(10)...).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(r1))
	mock.ExpectQuery("INSERT INTO dr_assurance_result").
		WithArgs(anyArgs(10)...).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(r2))

	if err := store.SaveAssessment(ctx, mock, hdr, results); err != nil {
		t.Fatalf("SaveAssessment: %v", err)
	}
	if hdr.ID != assessmentID || !hdr.CreatedAt.Equal(now) {
		t.Errorf("header id/created_at = %s/%v, want %s/%v", hdr.ID, hdr.CreatedAt, assessmentID, now)
	}
	for i, r := range results {
		if r.AssessmentID != assessmentID || r.TenantID != tenantID {
			t.Errorf("result %d assessment/tenant = %s/%s, want %s/%s", i, r.AssessmentID, r.TenantID, assessmentID, tenantID)
		}
	}
	if results[0].ID != r1 || results[1].ID != r2 {
		t.Errorf("result ids = %s,%s want %s,%s", results[0].ID, results[1].ID, r1, r2)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStoreGetAssessmentScansEvidenceSnapshot(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newStoreMock(t)
	store := NewStore()
	id := uuid.New()
	tenantID := uuid.New()
	groupID := uuid.New()
	actor := uuid.New()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery("SELECT id, tenant_id, group_id, profile_id").
		WithArgs(id).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "profile_id", "workload_id", "score", "verdict",
			"total_checks", "satisfied", "partial", "failed", "evidence_snapshot", "created_by", "created_at",
		}).AddRow(
			id, tenantID, groupID, "profile-1", "", float64(88), "partial",
			2, 1, 1, 0, []byte(`{"rpo":[{"id":"rpo-1","measured_at":"2026-06-13T12:00:00Z","actual_lag_seconds":120}]}`), actor, now,
		))

	got, err := store.GetAssessment(ctx, mock, id)
	if err != nil {
		t.Fatalf("GetAssessment: %v", err)
	}
	if got.ID != id || got.TenantID != tenantID || got.GroupID != groupID || got.Verdict != VerdictPartial {
		t.Errorf("assessment = %+v, want scanned identity/verdict", got)
	}
	if len(got.EvidenceSnapshot.RPO) != 1 || got.EvidenceSnapshot.RPO[0].ID != "rpo-1" {
		t.Errorf("evidence snapshot = %+v, want rpo-1", got.EvidenceSnapshot)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStoreGetAssessmentNotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newStoreMock(t)
	store := NewStore()
	id := uuid.New()

	mock.ExpectQuery("SELECT id, tenant_id, group_id, profile_id").
		WithArgs(id).
		WillReturnError(pgx.ErrNoRows)

	_, err := store.GetAssessment(ctx, mock, id)
	if err != ErrAssessmentNotFound {
		t.Errorf("err = %v, want ErrAssessmentNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStoreListResultsScansEvidenceRefs(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newStoreMock(t)
	store := NewStore()
	assessmentID := uuid.New()
	tenantID := uuid.New()
	resultID := uuid.New()

	mock.ExpectQuery("SELECT id, assessment_id, tenant_id, control_code").
		WithArgs(assessmentID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "assessment_id", "tenant_id", "control_code", "control_title", "verdict",
			"severity", "weight", "message", "recommendation", "evidence_refs",
		}).AddRow(
			resultID, assessmentID, tenantID, "rpo_breach_status", "RPO breach status",
			"failed", "critical", 4, "breached", RecommendationInvestigateRPO, []byte(`["rpo-1"]`),
		))

	results, err := store.ListResults(ctx, mock, assessmentID)
	if err != nil {
		t.Fatalf("ListResults: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("len(results) = %d, want 1", len(results))
	}
	got := results[0]
	if got.ID != resultID || got.TenantID != tenantID || got.Verdict != VerdictFailed || got.Severity != SeverityCritical {
		t.Errorf("result = %+v, want scanned identity/verdict/severity", got)
	}
	if len(got.EvidenceRefs) != 1 || got.EvidenceRefs[0] != "rpo-1" {
		t.Errorf("evidence refs = %v, want [rpo-1]", got.EvidenceRefs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
