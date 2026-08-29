package bcm

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func newMock(t *testing.T) pgxmock.PgxPoolIface {
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

// TestSaveAssessment asserts the header is inserted, its generated id/created_at
// are scanned back, and each control-result row is inserted with the parent
// assessment id and tenant id stamped on.
func TestSaveAssessment(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newMock(t)
	store := NewStore()

	tenantID := uuid.New()
	groupID := uuid.New()
	assessmentID := uuid.New()
	now := time.Now()

	hdr := &StoredAssessment{
		TenantID: tenantID, GroupID: groupID, PackKey: "iso22301", Standard: "ISO 22301:2019",
		PackVersion: "2019", Score: 75.0, Compliant: false, TotalControls: 2, Satisfied: 1,
		Partial: 0, Failed: 1, CreatedBy: uuid.New(),
	}
	results := []StoredControlResult{
		{ControlCode: "C1", ControlTitle: "t1", Verdict: VerdictSatisfied, Reason: "ok", Mandatory: true, Weight: 1, EvidenceRefs: []string{"e1"}},
		{ControlCode: "C2", ControlTitle: "t2", Verdict: VerdictFailed, Reason: "no evidence", Mandatory: true, Weight: 2, EvidenceRefs: nil},
	}

	mock.ExpectQuery("INSERT INTO dr_bcm_assessment").
		WithArgs(anyArgs(12)...).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow(assessmentID, now))

	r1 := uuid.New()
	r2 := uuid.New()
	mock.ExpectQuery("INSERT INTO dr_bcm_control_result").
		WithArgs(anyArgs(9)...).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(r1))
	mock.ExpectQuery("INSERT INTO dr_bcm_control_result").
		WithArgs(anyArgs(9)...).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(r2))

	if err := store.SaveAssessment(ctx, mock, hdr, results); err != nil {
		t.Fatalf("SaveAssessment: %v", err)
	}

	if hdr.ID != assessmentID {
		t.Errorf("hdr.ID = %s, want %s", hdr.ID, assessmentID)
	}
	if !hdr.CreatedAt.Equal(now) {
		t.Errorf("hdr.CreatedAt = %v, want %v", hdr.CreatedAt, now)
	}
	for i, r := range results {
		if r.AssessmentID != assessmentID {
			t.Errorf("result %d AssessmentID = %s, want %s", i, r.AssessmentID, assessmentID)
		}
		if r.TenantID != tenantID {
			t.Errorf("result %d TenantID = %s, want %s", i, r.TenantID, tenantID)
		}
	}
	if results[0].ID != r1 || results[1].ID != r2 {
		t.Errorf("result ids = %s,%s want %s,%s", results[0].ID, results[1].ID, r1, r2)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGetAssessmentNotFound asserts pgx.ErrNoRows maps to ErrAssessmentNotFound.
func TestGetAssessmentNotFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newMock(t)
	store := NewStore()
	id := uuid.New()

	mock.ExpectQuery("SELECT id, tenant_id, group_id, pack_key").
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

// TestGetAssessmentFound asserts a row scans into a StoredAssessment.
func TestGetAssessmentFound(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newMock(t)
	store := NewStore()
	id := uuid.New()
	tenantID := uuid.New()
	groupID := uuid.New()
	createdBy := uuid.New()
	now := time.Now()

	mock.ExpectQuery("SELECT id, tenant_id, group_id, pack_key").
		WithArgs(id).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "pack_key", "standard", "pack_version",
			"score", "compliant", "total_controls", "satisfied", "partial", "failed",
			"created_by", "created_at",
		}).AddRow(id, tenantID, groupID, "iso22301", "ISO 22301:2019", "2019",
			float64(88.5), true, 7, 6, 1, 0, createdBy, now))

	a, err := store.GetAssessment(ctx, mock, id)
	if err != nil {
		t.Fatalf("GetAssessment: %v", err)
	}
	if a.ID != id || a.PackKey != "iso22301" || a.Score != 88.5 || !a.Compliant {
		t.Errorf("scanned assessment mismatch: %+v", a)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestListControlResults asserts rows scan in order and the JSONB evidence_refs
// round-trips (including the empty-array case).
func TestListControlResults(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	mock := newMock(t)
	store := NewStore()
	assessmentID := uuid.New()
	tenantID := uuid.New()

	mock.ExpectQuery("SELECT id, assessment_id, tenant_id, control_code").
		WithArgs(assessmentID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "assessment_id", "tenant_id", "control_code", "control_title",
			"verdict", "reason", "mandatory", "weight", "evidence_refs",
		}).
			AddRow(uuid.New(), assessmentID, tenantID, "C1", "t1", "satisfied", "ok", true, 1, []byte(`["e1","e2"]`)).
			AddRow(uuid.New(), assessmentID, tenantID, "C2", "t2", "failed", "no evidence", true, 2, []byte(`[]`)))

	got, err := store.ListControlResults(ctx, mock, assessmentID)
	if err != nil {
		t.Fatalf("ListControlResults: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d results, want 2", len(got))
	}
	if got[0].Verdict != VerdictSatisfied || len(got[0].EvidenceRefs) != 2 || got[0].EvidenceRefs[0] != "e1" {
		t.Errorf("result 0 mismatch: %+v", got[0])
	}
	if got[1].Verdict != VerdictFailed || len(got[1].EvidenceRefs) != 0 {
		t.Errorf("result 1 mismatch: %+v", got[1])
	}
	if got[1].EvidenceRefs == nil {
		t.Error("empty evidence refs must be [] not nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

// TestGroupExists covers hit and miss.
func TestGroupExists(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := NewStore()
	groupID := uuid.New()

	t.Run("exists", func(t *testing.T) {
		mock := newMock(t)
		t.Cleanup(mock.Close)
		mock.ExpectQuery("SELECT name FROM consistency_group").
			WithArgs(groupID).
			WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("prod-group"))
		name, ok, err := store.GroupExists(ctx, mock, groupID)
		if err != nil || !ok || name != "prod-group" {
			t.Errorf("GroupExists = (%q, %v, %v), want (prod-group, true, nil)", name, ok, err)
		}
	})

	t.Run("missing", func(t *testing.T) {
		mock := newMock(t)
		t.Cleanup(mock.Close)
		mock.ExpectQuery("SELECT name FROM consistency_group").
			WithArgs(groupID).
			WillReturnError(pgx.ErrNoRows)
		_, ok, err := store.GroupExists(ctx, mock, groupID)
		if err != nil || ok {
			t.Errorf("GroupExists = (_, %v, %v), want (false, nil)", ok, err)
		}
	})
}
