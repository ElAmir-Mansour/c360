package journal_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/dr/journal"
)

func pgxNoRows() error { return pgx.ErrNoRows }

// anyArgs returns n AnyArg matchers for INSERT expectations whose exact values
// are not under test (only the error mapping is).
func anyArgs(n int) []any {
	args := make([]any, n)
	for i := range args {
		args[i] = pgxmock.AnyArg()
	}
	return args
}

const (
	tenantA  = "aaaaaaaa-0000-0000-0000-000000000001"
	streamID = "11111111-1111-1111-1111-111111111111"
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

func segRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "stream_id", "min_seq", "max_seq", "frame_count",
		"min_lsn", "max_lsn", "min_ts", "max_ts", "object_key", "payload_bytes", "content_hash",
		"pruned", "pruned_at", "sealed_at",
	})
}

func TestStore_AppendSegment(t *testing.T) {
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
				m.ExpectQuery(`INSERT INTO dr_journal_segment`).
					WithArgs(tenantA, streamID, int64(1), int64(100), 100, "0/1", "0/64",
						pgxmock.AnyArg(), pgxmock.AnyArg(), "obj/seg-1", int64(2048),
						"0000000000000000000000000000000000000000000000000000000000000000").
					WillReturnRows(pgxmock.NewRows([]string{"id", "pruned", "sealed_at"}).
						AddRow("seg-1", false, now))
			},
		},
		{
			name: "duplicate range maps to ErrAlreadyExists",
			setup: func(m pgxmock.PgxPoolIface) {
				m.ExpectQuery(`INSERT INTO dr_journal_segment`).
					WithArgs(anyArgs(12)...).
					WillReturnError(&pgconn.PgError{Code: "23505"})
			},
			wantErr: journal.ErrAlreadyExists,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			store := journal.NewStore()
			tt.setup(mock)

			seg := &journal.Segment{
				TenantID:     tenantA,
				StreamID:     streamID,
				MinSeq:       1,
				MaxSeq:       100,
				FrameCount:   100,
				MinLSN:       "0/1",
				MaxLSN:       "0/64",
				MinTS:        now,
				MaxTS:        now.Add(time.Minute),
				ObjectKey:    "obj/seg-1",
				PayloadBytes: 2048,
				ContentHash:  "0000000000000000000000000000000000000000000000000000000000000000",
			}
			err := store.AppendSegment(context.Background(), mock, seg)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("got %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("AppendSegment: %v", err)
			}
			if seg.ID != "seg-1" {
				t.Errorf("ID = %q, want seg-1", seg.ID)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStore_AppendSegment_ValidatesInput(t *testing.T) {
	t.Parallel()
	store := journal.NewStore()
	mock := newMock(t)

	// No DB call should be issued for invalid input.
	bad := &journal.Segment{TenantID: tenantA, StreamID: "", MinSeq: 1, MaxSeq: 1, ObjectKey: "o"}
	if err := store.AppendSegment(context.Background(), mock, bad); !errors.Is(err, journal.ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid", err)
	}
}

func TestStore_ListSegments_TenantScoped(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	now := time.Now()

	mock.ExpectQuery(`SELECT .* FROM dr_journal_segment\s+WHERE tenant_id = \$1 AND stream_id = \$2`).
		WithArgs(tenantA, streamID).
		WillReturnRows(segRows().
			AddRow("seg-1", tenantA, streamID, int64(1), int64(100), 100, "0/1", "0/64",
				now, now.Add(time.Minute), "obj/seg-1", int64(2048),
				"0000000000000000000000000000000000000000000000000000000000000000",
				false, nil, now))

	segs, err := store.ListSegments(context.Background(), mock, tenantA, streamID)
	if err != nil {
		t.Fatalf("ListSegments: %v", err)
	}
	if len(segs) != 1 || segs[0].TenantID != tenantA || segs[0].MaxSeq != 100 {
		t.Fatalf("unexpected segments: %+v", segs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_LatestSealedSeq(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()

	mock.ExpectQuery(`SELECT COALESCE\(MAX\(max_seq\), 0\)`).
		WithArgs(tenantA, streamID).
		WillReturnRows(pgxmock.NewRows([]string{"max"}).AddRow(int64(250)))

	seq, err := store.LatestSealedSeq(context.Background(), mock, tenantA, streamID)
	if err != nil {
		t.Fatalf("LatestSealedSeq: %v", err)
	}
	if seq != 250 {
		t.Fatalf("seq = %d, want 250", seq)
	}
}

func TestStore_PruneCandidates_GuardsBookmarks(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	now := time.Now()
	horizon := now.Add(-7 * 24 * time.Hour)

	// The query MUST carry the NOT EXISTS bookmark guard; assert the SQL shape.
	mock.ExpectQuery(`FROM dr_journal_segment seg.*NOT EXISTS.*dr_journal_bookmark`).
		WithArgs(tenantA, streamID, horizon, 100).
		WillReturnRows(segRows().
			AddRow("seg-old", tenantA, streamID, int64(1), int64(100), 100, "0/1", "0/64",
				now.Add(-8*24*time.Hour), now.Add(-8*24*time.Hour), "obj/seg-old", int64(2048),
				"0000000000000000000000000000000000000000000000000000000000000000",
				false, nil, now.Add(-8*24*time.Hour)))

	segs, err := store.PruneCandidates(context.Background(), mock, tenantA, streamID, horizon, 100)
	if err != nil {
		t.Fatalf("PruneCandidates: %v", err)
	}
	if len(segs) != 1 || segs[0].ID != "seg-old" {
		t.Fatalf("unexpected candidates: %+v", segs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_MarkPruned(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		rows     int64
		wantMark bool
	}{
		{name: "pruned", rows: 1, wantMark: true},
		{name: "protected or already pruned", rows: 0, wantMark: false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			mock := newMock(t)
			store := journal.NewStore()
			mock.ExpectExec(`UPDATE dr_journal_segment\s+SET pruned = true`).
				WithArgs(tenantA, streamID, "seg-1").
				WillReturnResult(pgxmock.NewResult("UPDATE", tt.rows))

			ok, err := store.MarkPruned(context.Background(), mock, journal.PruneInput{
				TenantID: tenantA, StreamID: streamID, ID: "seg-1",
			})
			if err != nil {
				t.Fatalf("MarkPruned: %v", err)
			}
			if ok != tt.wantMark {
				t.Fatalf("marked = %v, want %v", ok, tt.wantMark)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStore_CreateBookmark(t *testing.T) {
	t.Parallel()
	now := time.Now()
	mock := newMock(t)
	store := journal.NewStore()

	mock.ExpectQuery(`INSERT INTO dr_journal_bookmark`).
		WithArgs(tenantA, streamID, "barrier-1", journal.BookmarkBarrier, int64(100), "0/64", pgxmock.AnyArg(), "note", pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow("bm-1", now))

	bm := &journal.Bookmark{
		TenantID: tenantA, StreamID: streamID, Name: "barrier-1", Kind: journal.BookmarkBarrier,
		AtSeq: 100, AtLSN: "0/64", AtTS: now, Note: "note",
	}
	if err := store.CreateBookmark(context.Background(), mock, bm); err != nil {
		t.Fatalf("CreateBookmark: %v", err)
	}
	if bm.ID != "bm-1" {
		t.Errorf("ID = %q, want bm-1", bm.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_CreateBookmark_DuplicateName(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	mock.ExpectQuery(`INSERT INTO dr_journal_bookmark`).
		WithArgs(anyArgs(9)...).
		WillReturnError(&pgconn.PgError{Code: "23505"})

	bm := &journal.Bookmark{TenantID: tenantA, StreamID: streamID, Name: "dup", Kind: journal.BookmarkManual, AtSeq: 1, AtTS: time.Now()}
	if err := store.CreateBookmark(context.Background(), mock, bm); !errors.Is(err, journal.ErrAlreadyExists) {
		t.Fatalf("got %v, want ErrAlreadyExists", err)
	}
}

func TestStore_CreateBookmark_InvalidKind(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	bm := &journal.Bookmark{TenantID: tenantA, StreamID: streamID, Name: "x", Kind: "bogus", AtSeq: 1, AtTS: time.Now()}
	if err := store.CreateBookmark(context.Background(), mock, bm); !errors.Is(err, journal.ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid", err)
	}
}

func TestStore_DeleteBookmark_NotFound(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	mock.ExpectExec(`DELETE FROM dr_journal_bookmark`).
		WithArgs(tenantA, streamID, "bm-x").
		WillReturnResult(pgxmock.NewResult("DELETE", 0))

	if err := store.DeleteBookmark(context.Background(), mock, tenantA, streamID, "bm-x"); !errors.Is(err, journal.ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}

func TestStore_GetBookmark_NotFound(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	store := journal.NewStore()
	mock.ExpectQuery(`SELECT .* FROM dr_journal_bookmark`).
		WithArgs(tenantA, streamID, "bm-x").
		WillReturnError(pgxNoRows())

	if _, err := store.GetBookmark(context.Background(), mock, tenantA, streamID, "bm-x"); !errors.Is(err, journal.ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
}
