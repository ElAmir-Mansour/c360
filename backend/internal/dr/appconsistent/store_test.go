package appconsistent

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
	groupA  = "cccccccc-0000-0000-0000-000000000003"
	rpA     = "dddddddd-0000-0000-0000-000000000004"
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

func TestStore_CreateBarrier(t *testing.T) {
	now := time.Now()
	rp := rpA

	tests := []struct {
		name    string
		barrier *Barrier
		setup   func(m pgxmock.PgxPoolIface)
		wantErr error
	}{
		{
			name: "application-consistent success",
			barrier: &Barrier{
				TenantID:         tenantA,
				GroupID:          groupA,
				RecoveryPointID:  &rp,
				ConsistencyLevel: ConsistencyApplication,
				Provider:         ProviderScript,
				BarrierLSN:       "0/16B3748",
				Success:          true,
				Quiesced:         true,
				Thawed:           true,
				Detail:           "sealed",
			},
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_consistency_barrier`).
					WithArgs(tenantA, groupA, &rp, ConsistencyApplication, ProviderScript,
						"0/16B3748", true, true, true, "sealed", "", (*string)(nil),
						(*time.Time)(nil), (*time.Time)(nil), (*time.Time)(nil), (*time.Time)(nil)).
					WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).
						AddRow("barrier-1", now))
			},
		},
		{
			name: "crash-consistent failed quiesce",
			barrier: &Barrier{
				TenantID:         tenantA,
				GroupID:          groupA,
				ConsistencyLevel: ConsistencyCrash,
				Provider:         ProviderScript,
				Success:          false,
				Error:            "quiesce failed",
			},
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_consistency_barrier`).
					WithArgs(tenantA, groupA, (*string)(nil), ConsistencyCrash, ProviderScript,
						"", false, false, false, "", "quiesce failed", (*string)(nil),
						(*time.Time)(nil), (*time.Time)(nil), (*time.Time)(nil), (*time.Time)(nil)).
					WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).
						AddRow("barrier-2", now))
			},
		},
		{
			name:    "missing tenant id rejected",
			barrier: &Barrier{GroupID: groupA, ConsistencyLevel: ConsistencyCrash, Provider: ProviderNone},
			setup:   func(m pgxmock.PgxPoolIface) {},
			wantErr: ErrInvalidInput,
		},
		{
			name:    "missing group id rejected",
			barrier: &Barrier{TenantID: tenantA, ConsistencyLevel: ConsistencyCrash, Provider: ProviderNone},
			setup:   func(m pgxmock.PgxPoolIface) {},
			wantErr: ErrInvalidInput,
		},
		{
			name:    "bad consistency level rejected",
			barrier: &Barrier{TenantID: tenantA, GroupID: groupA, ConsistencyLevel: "bogus", Provider: ProviderNone},
			setup:   func(m pgxmock.PgxPoolIface) {},
			wantErr: ErrInvalidInput,
		},
		{
			name:    "bad provider rejected",
			barrier: &Barrier{TenantID: tenantA, GroupID: groupA, ConsistencyLevel: ConsistencyCrash, Provider: "bogus"},
			setup:   func(m pgxmock.PgxPoolIface) {},
			wantErr: ErrInvalidInput,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mock := newStoreMock(t)
			tt.setup(mock)
			err := NewStore().CreateBarrier(context.Background(), mock, tt.barrier)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("got err %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.barrier.ID == "" {
				t.Fatal("generated id not populated")
			}
			if tt.barrier.CreatedAt.IsZero() {
				t.Fatal("created_at not populated")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet expectations: %v", err)
			}
		})
	}
}

func TestStore_GetBarrier(t *testing.T) {
	now := time.Now()
	rp := rpA

	t.Run("found", func(t *testing.T) {
		mock := newStoreMock(t)
		mock.ExpectQuery(`SELECT[\s\S]+FROM dr_consistency_barrier\s+WHERE tenant_id = \$1 AND id = \$2`).
			WithArgs(tenantA, "barrier-1").
			WillReturnRows(pgxmock.NewRows([]string{
				"id", "tenant_id", "group_id", "recovery_point_id", "consistency_level", "provider",
				"barrier_lsn", "success", "quiesced", "thawed", "detail", "error", "requested_by",
				"quiesce_started_at", "quiesce_finished_at", "thaw_started_at", "thaw_finished_at", "created_at",
			}).AddRow(
				"barrier-1", tenantA, groupA, &rp, ConsistencyApplication, ProviderHTTP,
				"0/9", true, true, true, "ok", "", (*string)(nil),
				&now, &now, &now, &now, now,
			))

		b, err := NewStore().GetBarrier(context.Background(), mock, tenantA, "barrier-1")
		if err != nil {
			t.Fatalf("GetBarrier: %v", err)
		}
		if !b.IsApplicationConsistent() {
			t.Fatalf("expected application-consistent barrier, got %+v", b)
		}
		if b.RecoveryPointID == nil || *b.RecoveryPointID != rp {
			t.Fatalf("recovery point id = %v, want %q", b.RecoveryPointID, rp)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("not found maps to ErrNotFound", func(t *testing.T) {
		mock := newStoreMock(t)
		mock.ExpectQuery(`SELECT[\s\S]+FROM dr_consistency_barrier`).
			WithArgs(tenantA, "missing").
			WillReturnError(pgx.ErrNoRows)

		_, err := NewStore().GetBarrier(context.Background(), mock, tenantA, "missing")
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("got err %v, want ErrNotFound", err)
		}
	})
}

func TestStore_ListBarriersByGroup(t *testing.T) {
	now := time.Now()
	rp := rpA

	t.Run("orders newest first", func(t *testing.T) {
		mock := newStoreMock(t)
		mock.ExpectQuery(`SELECT[\s\S]+FROM dr_consistency_barrier\s+WHERE tenant_id = \$1 AND group_id = \$2\s+ORDER BY created_at DESC`).
			WithArgs(tenantA, groupA).
			WillReturnRows(pgxmock.NewRows(barrierColumnNames()).
				AddRow("b2", tenantA, groupA, &rp, ConsistencyApplication, ProviderScript,
					"0/2", true, true, true, "", "", (*string)(nil), &now, &now, &now, &now, now).
				AddRow("b1", tenantA, groupA, (*string)(nil), ConsistencyCrash, ProviderNone,
					"0/1", false, false, false, "", "quiesce failed", (*string)(nil), nil, nil, nil, nil, now.Add(-time.Hour)))

		got, err := NewStore().ListBarriersByGroup(context.Background(), mock, tenantA, groupA)
		if err != nil {
			t.Fatalf("ListBarriersByGroup: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("got %d barriers, want 2", len(got))
		}
		if got[0].ID != "b2" || !got[0].IsApplicationConsistent() {
			t.Fatalf("first barrier = %+v, want application-consistent b2", got[0])
		}
		if got[1].ID != "b1" || got[1].IsApplicationConsistent() {
			t.Fatalf("second barrier = %+v, want crash-level b1", got[1])
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("empty group returns no rows", func(t *testing.T) {
		mock := newStoreMock(t)
		mock.ExpectQuery(`SELECT[\s\S]+FROM dr_consistency_barrier`).
			WithArgs(tenantA, groupA).
			WillReturnRows(pgxmock.NewRows(barrierColumnNames()))

		got, err := NewStore().ListBarriersByGroup(context.Background(), mock, tenantA, groupA)
		if err != nil {
			t.Fatalf("ListBarriersByGroup: %v", err)
		}
		if len(got) != 0 {
			t.Fatalf("got %d barriers, want 0", len(got))
		}
	})
}

// barrierColumnNames mirrors the SELECT column list for building empty rows.
func barrierColumnNames() []string {
	return []string{
		"id", "tenant_id", "group_id", "recovery_point_id", "consistency_level", "provider",
		"barrier_lsn", "success", "quiesced", "thawed", "detail", "error", "requested_by",
		"quiesce_started_at", "quiesce_finished_at", "thaw_started_at", "thaw_finished_at", "created_at",
	}
}
