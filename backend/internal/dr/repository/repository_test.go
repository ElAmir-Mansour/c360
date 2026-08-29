package repository_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

const (
	tenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	tenantB = "bbbbbbbb-0000-0000-0000-000000000002"
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

func TestCreateSite(t *testing.T) {
	t.Parallel()
	now := time.Now()

	tests := []struct {
		name    string
		setup   func(m pgxmock.PgxPoolIface)
		wantErr error
	}{
		{
			name: "ok",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO protected_site`).
					WithArgs(tenantA, "prod-db", model.SiteKindDatabase, "pg://primary", 900, 300).
					WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
						AddRow("site-1", now, now))
			},
		},
		{
			name: "duplicate name maps to ErrAlreadyExists",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO protected_site`).
					WithArgs(tenantA, "prod-db", model.SiteKindDatabase, "pg://primary", 900, 300).
					WillReturnError(&pgconn.PgError{Code: "23505"})
			},
			wantErr: model.ErrAlreadyExists,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			repo := repository.New()
			tt.setup(mock)

			site := &model.ProtectedSite{
				TenantID:            tenantA,
				Name:                "prod-db",
				Kind:                model.SiteKindDatabase,
				PrimaryEndpoint:     "pg://primary",
				RTOObjectiveSeconds: 900,
				RPOObjectiveSeconds: 300,
			}
			err := repo.CreateSite(context.Background(), mock, site)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("got err %v, want %v", err, tt.wantErr)
				}
			} else {
				if err != nil {
					t.Fatalf("CreateSite: %v", err)
				}
				if site.ID != "site-1" {
					t.Errorf("ID = %q, want site-1", site.ID)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGetSite_TenantScoped(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()
	now := time.Now()

	// The query MUST carry the tenant id as its first arg — this is the
	// request-path isolation filter (§7); a wrong tenant returns no rows.
	mock.ExpectQuery(`SELECT .* FROM protected_site WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantA, "site-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "name", "kind", "primary_endpoint",
			"rto_objective_seconds", "rpo_objective_seconds", "created_at", "updated_at",
		}).AddRow("site-1", tenantA, "prod-db", "database", "pg://primary", 900, 300, now, now))

	site, err := repo.GetSite(context.Background(), mock, tenantA, "site-1")
	if err != nil {
		t.Fatalf("GetSite: %v", err)
	}
	if site.TenantID != tenantA {
		t.Errorf("TenantID = %q, want %q", site.TenantID, tenantA)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetSite_OtherTenantNotFound(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	// Tenant B asking for tenant A's site: the WHERE tenant_id filter yields
	// no rows, which the repo maps to ErrNotFound.
	mock.ExpectQuery(`SELECT .* FROM protected_site WHERE tenant_id = \$1 AND id = \$2`).
		WithArgs(tenantB, "site-1").
		WillReturnError(pgx.ErrNoRows)

	_, err := repo.GetSite(context.Background(), mock, tenantB, "site-1")
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("got err %v, want ErrNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpdateStreamCheckpoint(t *testing.T) {
	t.Parallel()
	now := time.Now()

	tests := []struct {
		name    string
		result  pgconn.CommandTag
		wantErr error
	}{
		{name: "advances ledger", result: pgconn.NewCommandTag("UPDATE 1")},
		{name: "unknown stream is ErrNotFound", result: pgconn.NewCommandTag("UPDATE 0"), wantErr: model.ErrNotFound},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			repo := repository.New()

			// No source-committed timestamp supplied: the variadic is empty, so
			// the 7th arg is a nil *time.Time and COALESCE keeps the prior value.
			mock.ExpectExec(`UPDATE replication_stream`).
				WithArgs(tenantA, "stream-1", int64(42), "0/16B6248", now, model.StreamStatusStreaming, (*time.Time)(nil)).
				WillReturnResult(tt.result)

			err := repo.UpdateStreamCheckpoint(context.Background(), mock, tenantA, "stream-1", 42, "0/16B6248", now, model.StreamStatusStreaming)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("got err %v, want %v", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("UpdateStreamCheckpoint: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSystemListStreamsForMonitor(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()
	now := time.Now()
	appliedAt := now.Add(-30 * time.Second)

	mock.ExpectQuery(`FROM replication_stream rs`).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "site_id", "status", "applied_seq",
			"source_lsn", "applied_at", "source_committed_at", "last_error", "created_at", "updated_at",
			"name", "kind", "rpo_objective_seconds", "group_name",
		}).AddRow(
			"stream-1", tenantA, "site-1", model.StreamStatusStreaming, int64(42),
			"0/16B6248", appliedAt, appliedAt.Add(-45*time.Second), "", now, now,
			"prod-db", model.SiteKindDatabase, 60, "prod-group",
		))

	streams, err := repo.SystemListStreamsForMonitor(context.Background(), mock)
	if err != nil {
		t.Fatalf("SystemListStreamsForMonitor: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("streams = %d, want 1", len(streams))
	}
	got := streams[0]
	if got.ID != "stream-1" || got.SiteName != "prod-db" || got.RPOObjectiveSeconds != 60 || got.GroupName != "prod-group" {
		t.Fatalf("unexpected monitor snapshot: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemUpdateStreamStatusForMonitor_Guarded(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		result      pgconn.CommandTag
		wantChanged bool
	}{
		{name: "transition applied", result: pgconn.NewCommandTag("UPDATE 1"), wantChanged: true},
		{name: "stale snapshot no-op", result: pgconn.NewCommandTag("UPDATE 0"), wantChanged: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			repo := repository.New()
			lastError := "live RPO is 61s; RPO objective is 60s"

			mock.ExpectExec(`UPDATE replication_stream`).
				WithArgs(tenantA, "stream-1", model.StreamStatusStreaming, model.StreamStatusDegraded, &lastError).
				WillReturnResult(tt.result)

			changed, err := repo.SystemUpdateStreamStatusForMonitor(
				context.Background(),
				mock,
				tenantA,
				"stream-1",
				model.StreamStatusStreaming,
				model.StreamStatusDegraded,
				&lastError,
			)
			if err != nil {
				t.Fatalf("SystemUpdateStreamStatusForMonitor: %v", err)
			}
			if changed != tt.wantChanged {
				t.Fatalf("changed = %v, want %v", changed, tt.wantChanged)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestApproveFailoverRun_GuardedTransition(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		result  pgconn.CommandTag
		wantErr error
	}{
		{name: "awaiting -> approved", result: pgconn.NewCommandTag("UPDATE 1")},
		{name: "second approval is a no-op (ErrInvalidState)", result: pgconn.NewCommandTag("UPDATE 0"), wantErr: model.ErrInvalidState},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			repo := repository.New()

			// The WHERE status='AWAITING_APPROVAL' guard means a second approval
			// affects zero rows (§6.2).
			mock.ExpectExec(`UPDATE failover_run SET approved_by`).
				WithArgs(tenantA, "run-1", "user-9", model.StatusApproved).
				WillReturnResult(tt.result)

			err := repo.ApproveFailoverRun(context.Background(), mock, tenantA, "run-1", "user-9")
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("got err %v, want %v", err, tt.wantErr)
				}
			} else if err != nil {
				t.Fatalf("ApproveFailoverRun: %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSystemClaimFailoverRun_NoWork(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	// The driver claim across all tenants returns (nil, nil) when there is
	// nothing to claim (FOR UPDATE SKIP LOCKED found no advanceable run).
	mock.ExpectQuery(`UPDATE failover_run`).
		WillReturnError(pgx.ErrNoRows)

	run, err := repo.SystemClaimFailoverRun(context.Background(), mock)
	if err != nil {
		t.Fatalf("SystemClaimFailoverRun: %v", err)
	}
	if run != nil {
		t.Errorf("expected nil run, got %+v", run)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRecoveryPoint(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()
	now := time.Now()
	ratio := 0.9991

	mock.ExpectQuery(`INSERT INTO recovery_point`).
		WithArgs(tenantA, "group-1", "0/16B6248", 12, pgxmock.AnyArg(), "deadbeef", &ratio, true, false, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "sealed_at"}).AddRow("rp-1", now))

	rp := &model.RecoveryPoint{
		TenantID:        tenantA,
		GroupID:         "group-1",
		MarkerLSN:       "0/16B6248",
		RPOSeconds:      12,
		ObjectKeys:      map[string]string{"site-1": "dr-recovery-points/site-1/chunk-0"},
		ContentHash:     "deadbeef",
		ValidationRatio: &ratio,
		IsValidated:     true,
		RetentionUntil:  now.Add(7 * 24 * time.Hour),
	}
	if err := repo.CreateRecoveryPoint(context.Background(), mock, rp); err != nil {
		t.Fatalf("CreateRecoveryPoint: %v", err)
	}
	if rp.ID != "rp-1" {
		t.Errorf("ID = %q, want rp-1", rp.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileRecoveryPointLegalHolds(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	mock.ExpectExec(`WITH ranked AS`).
		WithArgs(tenantA, "group-1", 3).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 4"))

	if err := repo.ReconcileRecoveryPointLegalHolds(context.Background(), mock, tenantA, "group-1", 3); err != nil {
		t.Fatalf("ReconcileRecoveryPointLegalHolds: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemRecoveryPointPromotionSafety(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	mock.ExpectQuery(`WITH rp AS`).
		WithArgs("rp-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"tenant_id", "group_id", "cleanroom_scan_found", "cleanroom_verdict", "ransomware_blocking_signals",
		}).AddRow(tenantA, "group-1", true, "clean", 0))

	safety, err := repo.SystemRecoveryPointPromotionSafety(context.Background(), mock, "rp-1")
	if err != nil {
		t.Fatalf("SystemRecoveryPointPromotionSafety: %v", err)
	}
	if !safety.Safe() || !safety.CleanroomClean() || !safety.RansomwareClear() {
		t.Fatalf("safety should pass: %+v", safety)
	}
	if safety.TenantID != tenantA || safety.GroupID != "group-1" {
		t.Fatalf("unexpected safety identity: %+v", safety)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSystemRecoveryPointPromotionSafety_Blocked(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	mock.ExpectQuery(`WITH rp AS`).
		WithArgs("rp-unsafe").
		WillReturnRows(pgxmock.NewRows([]string{
			"tenant_id", "group_id", "cleanroom_scan_found", "cleanroom_verdict", "ransomware_blocking_signals",
		}).AddRow(tenantA, "group-1", true, "malware", 2))

	safety, err := repo.SystemRecoveryPointPromotionSafety(context.Background(), mock, "rp-unsafe")
	if err != nil {
		t.Fatalf("SystemRecoveryPointPromotionSafety: %v", err)
	}
	if safety.Safe() {
		t.Fatalf("safety should be blocked: %+v", safety)
	}
	if got := safety.BlockReason(); got != `latest clean-room verdict is "malware"` {
		t.Fatalf("block reason = %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAddGroupMember_Upsert(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	mock.ExpectExec(`INSERT INTO consistency_group_member`).
		WithArgs("group-1", "site-1", 10).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	err := repo.AddGroupMember(context.Background(), mock, &model.ConsistencyGroupMember{
		GroupID:   "group-1",
		SiteID:    "site-1",
		BootOrder: 10,
	})
	if err != nil {
		t.Fatalf("AddGroupMember: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpsertFailoverStep_Idempotent(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()
	now := time.Now()

	mock.ExpectQuery(`INSERT INTO failover_step`).
		WithArgs("run-1", "gate1", model.StepStatusPassed, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "started_at"}).AddRow("step-1", now))

	step := &model.FailoverStep{
		RunID:      "run-1",
		Step:       "gate1",
		Status:     model.StepStatusPassed,
		Detail:     map[string]any{"match_ratio": 0.9991},
		FinishedAt: &now,
	}
	if err := repo.UpsertFailoverStep(context.Background(), mock, step); err != nil {
		t.Fatalf("UpsertFailoverStep: %v", err)
	}
	if step.ID != "step-1" {
		t.Errorf("ID = %q, want step-1", step.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateAttestation_DuplicateRun(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.New()

	// run_id is UNIQUE — a second attestation for the same run is rejected.
	mock.ExpectQuery(`INSERT INTO attestation`).
		WithArgs(tenantA, "run-1", 900, 702, 12, 0.9991, "dr-recovery-points/att/run-1.json", "cafef00d").
		WillReturnError(&pgconn.PgError{Code: "23505"})

	a := &model.Attestation{
		TenantID:            tenantA,
		RunID:               "run-1",
		RTOObjectiveSeconds: 900,
		RTOActualSeconds:    702,
		RPOSeconds:          12,
		ValidationRatio:     0.9991,
		ReportObjectKey:     "dr-recovery-points/att/run-1.json",
		ContentHash:         "cafef00d",
	}
	err := repo.CreateAttestation(context.Background(), mock, a)
	if !errors.Is(err, model.ErrAlreadyExists) {
		t.Fatalf("got err %v, want ErrAlreadyExists", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
