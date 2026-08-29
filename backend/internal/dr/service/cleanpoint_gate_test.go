package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/dr/cleanroom"
)

// fakeCleanRoomScanner returns a fixed clean-room verdict for the promotion gate.
type fakeCleanRoomScanner struct {
	verdict  string
	threat   string
	streamID string
	scanErr  error
	calls    int
}

func (f *fakeCleanRoomScanner) ScanRecoveryPoint(_ context.Context, _, pointID uuid.UUID) (*cleanroom.Scan, error) {
	f.calls++
	if f.scanErr != nil {
		return nil, f.scanErr
	}
	scan := &cleanroom.Scan{
		ID:              uuid.NewString(),
		RecoveryPointID: pointID.String(),
		Verdict:         f.verdict,
		Scanner:         "test-scanner",
		FinishedAt:      time.Now().UTC(),
	}
	if f.verdict != cleanroom.VerdictClean {
		scan.Findings = []cleanroom.ChunkVerdict{{
			StreamID: f.streamID,
			Clean:    false,
			Threat:   f.threat,
		}}
	}
	return scan, nil
}

// expectValidateSetup wires the recovery-point read + per-stream validator ratio
// expectations that ValidateRecoveryPoint runs before the gate.
func expectValidateFetch(mock pgxmock.PgxPoolIface, tenantID, groupID, pointID uuid.UUID, streamID string, now time.Time) {
	mock.ExpectQuery(`FROM recovery_point WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantID.String(), pointID.String()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "group_id", "marker_lsn", "rpo_seconds",
			"object_keys", "content_hash", "validation_ratio", "is_validated",
			"legal_hold", "sealed_at", "retention_until",
		}).AddRow(pointID.String(), tenantID.String(), groupID.String(), "0/16B6248", 12,
			[]byte(`{"`+streamID+`":"k-a"}`), "deadbeef", 0.0, false,
			false, now, now.Add(7*24*time.Hour)))
}

func expectReconcileAndList(mock pgxmock.PgxPoolIface, tenantID, groupID, pointID uuid.UUID, streamID string, ratio float64, validated bool, now time.Time) {
	mock.ExpectExec(`UPDATE recovery_point SET validation_ratio`).
		WithArgs(tenantID.String(), pointID.String(), ratio, validated).
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
			[]byte(`{"`+streamID+`":"k-a"}`), "deadbeef", ratio, validated,
			validated, now, now.Add(7*24*time.Hour)))
}

// TestValidateRecoveryPoint_CleanPointGate_QuarantinesCompromisedPoint proves the
// clean-recovery-point gate refuses to mark a recovery point promotion-safe when
// the clean-room scan reports malware — even though its raw content-hash match
// ratio met the GA acceptance threshold. This is the ransomware wedge: data
// fidelity alone must not promote a compromised point.
func TestValidateRecoveryPoint_CleanPointGate_QuarantinesCompromisedPoint(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	streamA := uuid.NewString()
	now := time.Now().UTC()
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)

	scanner := &fakeCleanRoomScanner{verdict: cleanroom.VerdictMalware, threat: "eicar-test", streamID: streamA}
	// Content-hash ratio is high (0.9999) — passes the raw validator threshold —
	// so the ONLY thing that can block promotion is the clean-point gate.
	svc.WithRecoveryPoint(wormStore, nil, fakeValidator{ratio: map[string]float64{streamA: 0.9999}}, 2).
		WithCleanPointGate(nil, scanner)

	expectValidateFetch(mock, tenantID, groupID, pointID, streamA, now)
	// The row must be persisted with is_validated = FALSE despite ratio 0.9999.
	expectReconcileAndList(mock, tenantID, groupID, pointID, streamA, 0.9999, false, now)

	point, err := svc.ValidateRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if scanner.calls != 1 {
		t.Fatalf("clean-room scanner calls = %d, want 1", scanner.calls)
	}
	if point.IsValidated {
		t.Fatalf("compromised point IsValidated = true, want false (must be refused promotion)")
	}
	if point.ValidationRatio == nil || *point.ValidationRatio != 0.9999 {
		t.Fatalf("validation ratio = %v, want 0.9999 recorded", point.ValidationRatio)
	}
	if len(stager.events) != 1 {
		t.Fatalf("staged events = %d, want 1", len(stager.events))
	}
	ev := stager.events[0].data
	if got := ev["clean_point_decision"]; got != string("quarantine") {
		t.Fatalf("clean_point_decision = %v, want quarantine", got)
	}
	if ev["clean_point_reasons"] == nil {
		t.Fatalf("clean_point_reasons missing, want malware finding reasons")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestValidateRecoveryPoint_CleanPointGate_PromotesCleanPoint proves a clean
// recovery point (clean-room verdict clean + content-hash match) passes the gate
// and is marked promotion-safe.
func TestValidateRecoveryPoint_CleanPointGate_PromotesCleanPoint(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	streamA := uuid.NewString()
	now := time.Now().UTC()
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)

	scanner := &fakeCleanRoomScanner{verdict: cleanroom.VerdictClean, streamID: streamA}
	svc.WithRecoveryPoint(wormStore, nil, fakeValidator{ratio: map[string]float64{streamA: 0.9999}}, 2).
		WithCleanPointGate(nil, scanner)

	expectValidateFetch(mock, tenantID, groupID, pointID, streamA, now)
	expectReconcileAndList(mock, tenantID, groupID, pointID, streamA, 0.9999, true, now)

	point, err := svc.ValidateRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if scanner.calls != 1 {
		t.Fatalf("clean-room scanner calls = %d, want 1", scanner.calls)
	}
	if !point.IsValidated {
		t.Fatalf("clean point IsValidated = false, want true (must be promotable)")
	}
	if len(stager.events) != 1 {
		t.Fatalf("staged events = %d, want 1", len(stager.events))
	}
	// A clean point promotes; missing non-blocking evidence (e.g. RPO objective)
	// may downgrade the label to promote_with_warnings, which is still promotable.
	if got := stager.events[0].data["clean_point_decision"]; got != "promote" && got != "promote_with_warnings" {
		t.Fatalf("clean_point_decision = %v, want a promotable decision", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestValidateRecoveryPoint_CleanPointGate_FailSafeWithoutScanner proves the gate
// is fail-safe: with a scorer wired but NO clean-room scanner, a point with a
// perfect content-hash match is NOT silently promoted, because the missing
// clean-room / malware evidence is treated as not-clean.
func TestValidateRecoveryPoint_CleanPointGate_FailSafeWithoutScanner(t *testing.T) {
	t.Parallel()

	mock := newMock(t)
	tenantID := uuid.New()
	groupID := uuid.New()
	pointID := uuid.New()
	streamA := uuid.NewString()
	now := time.Now().UTC()
	stager := &fakeStager{}
	wormStore := &fakeWORM{}
	svc, _ := newService(mock, stager)

	// No scanner: clean-room verdict is absent -> gate must refuse promotion.
	svc.WithRecoveryPoint(wormStore, nil, fakeValidator{ratio: map[string]float64{streamA: 1.0}}, 2).
		WithCleanPointGate(nil, nil)

	expectValidateFetch(mock, tenantID, groupID, pointID, streamA, now)
	expectReconcileAndList(mock, tenantID, groupID, pointID, streamA, 1.0, false, now)

	point, err := svc.ValidateRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if point.IsValidated {
		t.Fatalf("point without clean-room evidence IsValidated = true, want false (fail-safe)")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
