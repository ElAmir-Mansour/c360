package vmcapture_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/dr/vmcapture"
)

const (
	tenantA   = "aaaaaaaa-0000-0000-0000-000000000001"
	streamA   = "11111111-1111-1111-1111-111111111111"
	sourceA   = "22222222-2222-2222-2222-222222222222"
	uniqueErr = "23505"
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

func TestStore_CreateSource(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	now := time.Now()

	tests := []struct {
		name    string
		setup   func(m pgxmock.PgxPoolIface)
		src     vmcapture.Source
		wantErr error
	}{
		{
			name: "inserts and populates generated fields",
			src:  vmcapture.Source{TenantID: tenantA, StreamID: streamA, Name: "vm-a", SourceKind: "vm_disk", BindingKind: "file", BlockSizeBytes: 65536, Enabled: true},
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery("INSERT INTO dr_workload_capture_source").
					WithArgs(anyArgs(8)...).
					WillReturnRows(pgxmock.NewRows([]string{"id", "epoch_count", "last_seq", "created_at", "updated_at"}).
						AddRow(sourceA, 0, int64(0), now, now))
			},
		},
		{
			name:    "duplicate name maps to ErrAlreadyExists",
			src:     vmcapture.Source{TenantID: tenantA, StreamID: streamA, Name: "dup", SourceKind: "vm_disk", BindingKind: "file"},
			wantErr: vmcapture.ErrAlreadyExists,
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery("INSERT INTO dr_workload_capture_source").
					WithArgs(anyArgs(8)...).
					WillReturnError(&pgconn.PgError{Code: uniqueErr})
			},
		},
		{
			name:    "missing stream id is rejected before the query",
			src:     vmcapture.Source{TenantID: tenantA, Name: "x"},
			wantErr: vmcapture.ErrInvalid,
			setup:   func(m pgxmock.PgxPoolIface) {},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			m := newMock(t)
			tc.setup(m)
			src := tc.src
			err := vmcapture.NewStore().CreateSource(ctx, m, &src)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("err = %v, want %v", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if src.ID != sourceA {
				t.Fatalf("id = %q, want %q", src.ID, sourceA)
			}
			if e := m.ExpectationsWereMet(); e != nil {
				t.Fatalf("unmet expectations: %v", e)
			}
		})
	}
}

func TestStore_GetSource_NotFound(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_workload_capture_source").
		WithArgs(tenantA, sourceA).
		WillReturnError(pgx.ErrNoRows)
	_, err := vmcapture.NewStore().GetSource(context.Background(), m, tenantA, sourceA)
	if !errors.Is(err, vmcapture.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestStore_ListSources(t *testing.T) {
	t.Parallel()
	now := time.Now()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_workload_capture_source").
		WithArgs(tenantA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "stream_id", "name", "source_kind", "binding_kind", "block_size_bytes",
			"config", "enabled", "epoch_count", "last_run_at", "last_seq", "created_at", "updated_at",
		}).AddRow(sourceA, tenantA, streamA, "vm-a", "vm_disk", "file", 65536,
			[]byte(`{"path":"/img"}`), true, 2, &now, int64(12), now, now))
	sources, err := vmcapture.NewStore().ListSources(context.Background(), m, tenantA)
	if err != nil {
		t.Fatalf("ListSources: %v", err)
	}
	if len(sources) != 1 || sources[0].Config["path"] != "/img" {
		t.Fatalf("unexpected sources: %+v", sources)
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatalf("unmet expectations: %v", e)
	}
}

func TestStore_InsertEpoch_Duplicate(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectQuery("INSERT INTO dr_workload_capture_epoch").
		WithArgs(anyArgs(14)...).
		WillReturnError(&pgconn.PgError{Code: uniqueErr})
	e := vmcapture.Epoch{TenantID: tenantA, SourceID: sourceA, StreamID: streamA, Epoch: 1, EpochKind: "base", FromSeq: 1, ToSeq: 3, FrameCount: 3, ContentHash: "h"}
	err := vmcapture.NewStore().InsertEpoch(context.Background(), m, &e)
	if !errors.Is(err, vmcapture.ErrAlreadyExists) {
		t.Fatalf("err = %v, want ErrAlreadyExists", err)
	}
}

func TestStore_GetVMState_MissingReturnsZero(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_vm_capture_state").
		WithArgs(tenantA, sourceA).
		WillReturnError(pgx.ErrNoRows)
	st, err := vmcapture.NewStore().GetVMState(context.Background(), m, tenantA, sourceA)
	if err != nil {
		t.Fatalf("GetVMState: %v", err)
	}
	if st.Epoch != 0 || len(st.BlockHashes) != 0 {
		t.Fatalf("expected zero-value VMState, got %+v", st)
	}
	if st.TenantID != tenantA || st.SourceID != sourceA {
		t.Fatalf("identity not stamped on zero state: %+v", st)
	}
}

func TestStore_GetVMState_DecodesBlockHashes(t *testing.T) {
	t.Parallel()
	now := time.Now()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_vm_capture_state").
		WithArgs(tenantA, sourceA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "source_id", "block_size_bytes", "image_bytes", "block_count", "epoch", "block_hashes", "updated_at",
		}).AddRow("id1", tenantA, sourceA, 65536, int64(131072), 2, 3, []byte(`["aa","bb"]`), now))
	st, err := vmcapture.NewStore().GetVMState(context.Background(), m, tenantA, sourceA)
	if err != nil {
		t.Fatalf("GetVMState: %v", err)
	}
	if st.Epoch != 3 || len(st.BlockHashes) != 2 || st.BlockHashes[1] != "bb" {
		t.Fatalf("decoded state wrong: %+v", st)
	}
}

func TestStore_UpsertVMState(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectExec("INSERT INTO dr_vm_capture_state").
		WithArgs(anyArgs(7)...).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	err := vmcapture.NewStore().UpsertVMState(context.Background(), m, vmcapture.VMState{
		TenantID: tenantA, SourceID: sourceA, BlockSizeBytes: 65536, ImageBytes: 131072, BlockCount: 2, Epoch: 1, BlockHashes: []string{"aa", "bb"},
	})
	if err != nil {
		t.Fatalf("UpsertVMState: %v", err)
	}
	if e := m.ExpectationsWereMet(); e != nil {
		t.Fatalf("unmet expectations: %v", e)
	}
}

func TestStore_AdvanceSource_NotFound(t *testing.T) {
	t.Parallel()
	m := newMock(t)
	m.ExpectExec("UPDATE dr_workload_capture_source").
		WithArgs(tenantA, sourceA, 1, int64(3), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	err := vmcapture.NewStore().AdvanceSource(context.Background(), m, tenantA, sourceA, 1, 3, time.Now())
	if !errors.Is(err, vmcapture.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestStore_ListEpochs(t *testing.T) {
	t.Parallel()
	now := time.Now()
	m := newMock(t)
	m.ExpectQuery("SELECT (.+) FROM dr_workload_capture_epoch").
		WithArgs(tenantA, sourceA).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "source_id", "stream_id", "epoch", "epoch_kind", "from_seq", "to_seq",
			"frame_count", "changed_units", "total_units", "payload_bytes", "content_hash", "source_marker", "set_summary", "captured_at",
		}).AddRow("e1", tenantA, sourceA, streamA, 1, "base", int64(1), int64(3), 3, 3, 3, int64(100),
			"aabb", "marker", []byte(`[{"kind":"ConfigMap","namespace":"prod","name":"c","hash":"h"}]`), now))
	epochs, err := vmcapture.NewStore().ListEpochs(context.Background(), m, tenantA, sourceA)
	if err != nil {
		t.Fatalf("ListEpochs: %v", err)
	}
	if len(epochs) != 1 || len(epochs[0].SetSummary) != 1 || epochs[0].SetSummary[0].Kind != "ConfigMap" {
		t.Fatalf("unexpected epochs: %+v", epochs)
	}
}
