package registry

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	groupA  = "11111111-1111-1111-1111-111111111111"
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

func TestStore_LoadAssetSnapshot_AssemblesRealAssets(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 11, 59, 0, 0, time.UTC)

	// 1. group exists.
	mock.ExpectQuery(`SELECT name FROM consistency_group WHERE id = \$1`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("core-banking"))

	// 2. members joined to sites, ordered by boot_order.
	mock.ExpectQuery(`FROM consistency_group_member cgm`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"site_id", "name", "kind", "primary_endpoint", "boot_order", "rto_objective_seconds", "rpo_objective_seconds"}).
			AddRow("site-db", "postgres", "database", "db:5432", 10, 900, 300).
			AddRow("site-app", "app", "vm", "app:8080", 20, 600, 120))

	// 3. network mapping for the profile.
	mock.ExpectQuery(`FROM network_mapping`).
		WithArgs(groupA, "production").
		WillReturnRows(pgxmock.NewRows([]string{"primary_cidr", "recovery_cidr"}).
			AddRow("10.0.0.0/24", "10.9.0.0/24"))

	// 4. latest validated recovery point.
	mock.ExpectQuery(`FROM recovery_point`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"id", "marker_lsn", "rpo_seconds", "validation_ratio", "is_validated", "sealed_at"}).
			AddRow("rp-1", "0/16B3F00", 42, 0.9995, true, now))

	snap, err := store.LoadAssetSnapshot(context.Background(), mock, groupA, "production")
	if err != nil {
		t.Fatalf("LoadAssetSnapshot: %v", err)
	}

	if snap.GroupName != "core-banking" {
		t.Errorf("group name = %q", snap.GroupName)
	}
	if len(snap.Members) != 2 {
		t.Fatalf("members = %d, want 2", len(snap.Members))
	}
	// Objectives aggregate to the strictest (max) across members.
	if snap.RTOObjectiveSeconds != 900 {
		t.Errorf("RTO objective = %d, want 900 (max across members)", snap.RTOObjectiveSeconds)
	}
	if snap.RPOObjectiveSeconds != 300 {
		t.Errorf("RPO objective = %d, want 300 (max across members)", snap.RPOObjectiveSeconds)
	}
	// Network remap applied uniformly.
	if snap.Members[0].RecoveryCIDR != "10.9.0.0/24" {
		t.Errorf("member 0 recovery CIDR = %q", snap.Members[0].RecoveryCIDR)
	}
	// Recovery point assembled and legal-hold flagged.
	if snap.RecoveryPoint == nil || snap.RecoveryPoint.ID != "rp-1" {
		t.Fatalf("recovery point = %+v", snap.RecoveryPoint)
	}
	if !snap.RecoveryPoint.LegalHold {
		t.Error("latest validated recovery point should be flagged legal-hold")
	}
	if snap.RecoveryPoint.ValidationRatio != 0.9995 {
		t.Errorf("validation ratio = %v", snap.RecoveryPoint.ValidationRatio)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_LoadAssetSnapshot_GroupNotFound(t *testing.T) {
	mock := newMock(t)
	store := NewStore()

	mock.ExpectQuery(`SELECT name FROM consistency_group`).
		WithArgs(groupA).
		WillReturnError(errNoRows())

	_, err := store.LoadAssetSnapshot(context.Background(), mock, groupA, "production")
	if !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("expected ErrGroupNotFound, got %v", err)
	}
}

func TestStore_LoadAssetSnapshot_NoRecoveryPoint(t *testing.T) {
	mock := newMock(t)
	store := NewStore()

	mock.ExpectQuery(`SELECT name FROM consistency_group`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"name"}).AddRow("g"))
	mock.ExpectQuery(`FROM consistency_group_member cgm`).
		WithArgs(groupA).
		WillReturnRows(pgxmock.NewRows([]string{"site_id", "name", "kind", "primary_endpoint", "boot_order", "rto_objective_seconds", "rpo_objective_seconds"}).
			AddRow("site-db", "postgres", "database", "db:5432", 10, 900, 300))
	mock.ExpectQuery(`FROM network_mapping`).
		WithArgs(groupA, "production").
		WillReturnError(errNoRows())
	mock.ExpectQuery(`FROM recovery_point`).
		WithArgs(groupA).
		WillReturnError(errNoRows())

	snap, err := store.LoadAssetSnapshot(context.Background(), mock, groupA, "production")
	if err != nil {
		t.Fatalf("LoadAssetSnapshot: %v", err)
	}
	if snap.RecoveryPoint != nil {
		t.Errorf("expected nil recovery point when none validated, got %+v", snap.RecoveryPoint)
	}
	if len(snap.Members) != 1 {
		t.Errorf("members = %d, want 1", len(snap.Members))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_EnsureRunbook_CreatesWhenAbsent(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()

	// GetRunbook miss.
	mock.ExpectQuery(`FROM dr_recovery_runbook`).
		WithArgs(groupA).
		WillReturnError(errNoRows())
	// INSERT.
	mock.ExpectQuery(`INSERT INTO dr_recovery_runbook`).
		WithArgs(tenantA, groupA, TemplateID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "tenant_id", "group_id", "current_version", "template_id", "created_at", "updated_at"}).
			AddRow("rb-1", tenantA, groupA, 0, TemplateID, now, now))

	rb, err := store.EnsureRunbook(context.Background(), mock, tenantA, groupA, TemplateID)
	if err != nil {
		t.Fatalf("EnsureRunbook: %v", err)
	}
	if rb.ID != "rb-1" || rb.CurrentVersion != 0 {
		t.Errorf("runbook = %+v", rb)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_InsertVersion_AdvancesCurrentVersion(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	now := time.Now()

	v := &RunbookVersion{
		RunbookID:  "rb-1",
		TenantID:   tenantA,
		GroupID:    groupA,
		Version:    1,
		TemplateID: TemplateID,
		Steps:      []RunbookStep{{Key: "pin_recovery_point", Order: 1, Kind: StepKindPinRecoveryPoint}},
		AssetSnapshot: AssetSnapshot{
			GroupID: groupA,
			Members: []MemberAsset{{SiteID: "site-db"}},
		},
		ContentHash: "abc123",
		Trigger:     TriggerManual,
	}

	// INSERT ... RETURNING the stored row (steps/snapshot/diff round-trip as JSON).
	mock.ExpectQuery(`INSERT INTO dr_recovery_runbook_version`).
		WithArgs(
			"rb-1", tenantA, groupA, 1, TemplateID,
			pgxmock.AnyArg(), // steps json
			pgxmock.AnyArg(), // snapshot json
			"abc123",
			[]byte(nil), // diff (nil for v1)
			TriggerManual,
		).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "runbook_id", "tenant_id", "group_id", "version", "template_id",
			"steps", "asset_snapshot", "content_hash", "diff", "trigger", "created_at",
		}).AddRow(
			"ver-1", "rb-1", tenantA, groupA, 1, TemplateID,
			[]byte(`[{"key":"pin_recovery_point","order":1,"kind":"pin_recovery_point","title":"","description":""}]`),
			[]byte(`{"group_id":"`+groupA+`","group_name":"","rto_objective_seconds":0,"rpo_objective_seconds":0,"network_profile":"","members":[{"site_id":"site-db","site_name":"","site_kind":"","primary_endpoint":"","boot_order":0,"network_profile":""}],"captured_at":"0001-01-01T00:00:00Z"}`),
			"abc123", nil, TriggerManual, now,
		))

	// UPDATE advancing current_version.
	mock.ExpectExec(`UPDATE dr_recovery_runbook`).
		WithArgs("rb-1", 1, TemplateID).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	stored, err := store.InsertVersion(context.Background(), mock, v)
	if err != nil {
		t.Fatalf("InsertVersion: %v", err)
	}
	if stored.ID != "ver-1" || stored.Version != 1 {
		t.Errorf("stored = %+v", stored)
	}
	if len(stored.Steps) != 1 || stored.Steps[0].Key != "pin_recovery_point" {
		t.Errorf("steps did not round-trip: %+v", stored.Steps)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestStore_GetRunbook_NotFound(t *testing.T) {
	mock := newMock(t)
	store := NewStore()
	mock.ExpectQuery(`FROM dr_recovery_runbook`).
		WithArgs(groupA).
		WillReturnError(errNoRows())

	_, err := store.GetRunbook(context.Background(), mock, groupA)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// errNoRows returns pgx.ErrNoRows for QueryRow expectations.
func errNoRows() error { return pgx.ErrNoRows }
