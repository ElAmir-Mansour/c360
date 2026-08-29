package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

const notifID = "44444444-0000-0000-0000-000000000004"

func newNotificationRepo(t *testing.T) (*NotificationRepository, pgxmock.PgxPoolIface) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	// A pgxmock pool is not a *pgxpool.Pool, so the tenant-GUC tx path is
	// skipped and the direct-exec path (which the mock can satisfy) is taken —
	// exactly the seam documented on NotificationRepository.db.
	return &NotificationRepository{db: mock, logger: zerolog.Nop()}, mock
}

func notifColumns() []string {
	return []string{
		"id", "tenant_id", "user_id", "type", "category", "priority",
		"title", "body", "data", "action_url", "source_event_id", "read_at", "created_at",
	}
}

// TestInsertWithDedup_InsertAndDedup covers both arms of the ON CONFLICT DO
// NOTHING upsert: a fresh insert returns the new id, and a redelivery (the DB
// returns no row because the partial-unique dedup index collapsed it) returns an
// empty id with no error.
func TestInsertWithDedup_InsertAndDedup(t *testing.T) {
	repo, mock := newNotificationRepo(t)
	src := "evt-1"
	n := &model.Notification{
		TenantID: tenantA, UserID: "user-1", Type: model.NotifAlertCreated,
		Category: model.CategorySecurity, Priority: model.PriorityHigh,
		Title: "t", Body: "b", SourceEventID: &src,
	}

	// Fresh insert → row returned.
	mock.ExpectQuery(`INSERT INTO notifications`).
		WithArgs(tenantA, "user-1", string(model.NotifAlertCreated), model.CategorySecurity,
			model.PriorityHigh, "t", "b", pgxmock.AnyArg(), "", &src).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(notifID))

	id, err := repo.InsertWithDedup(context.Background(), n)
	if err != nil {
		t.Fatalf("InsertWithDedup: %v", err)
	}
	if id != notifID {
		t.Fatalf("expected id %s, got %q", notifID, id)
	}

	// Redelivery → ON CONFLICT DO NOTHING yields no row → ("" , nil).
	mock.ExpectQuery(`INSERT INTO notifications`).
		WithArgs(tenantA, "user-1", string(model.NotifAlertCreated), model.CategorySecurity,
			model.PriorityHigh, "t", "b", pgxmock.AnyArg(), "", &src).
		WillReturnError(pgx.ErrNoRows)

	id, err = repo.InsertWithDedup(context.Background(), n)
	if err != nil {
		t.Fatalf("InsertWithDedup dedup: %v", err)
	}
	if id != "" {
		t.Fatalf("expected empty id on dedup collapse, got %q", id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestFindByID_TenantUserScoped asserts FindByID carries id+tenant+user and that
// a cross-tenant request (whose predicate matches nothing) returns nil.
func TestFindByID_TenantUserScoped(t *testing.T) {
	repo, mock := newNotificationRepo(t)

	mock.ExpectQuery(`FROM notifications`).
		WithArgs(notifID, tenantA, "user-1").
		WillReturnRows(pgxmock.NewRows(notifColumns()).AddRow(
			notifID, tenantA, "user-1", string(model.NotifAlertCreated),
			model.CategorySecurity, model.PriorityHigh, "t", "b",
			[]byte(`{}`), "", nil, nil, time.Now(),
		))

	got, err := repo.FindByID(context.Background(), tenantA, "user-1", notifID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.ID != notifID {
		t.Fatalf("expected notification %s, got %+v", notifID, got)
	}
	if got.Read {
		t.Error("expected unread (read_at nil) to compute Read=false")
	}

	// Cross-tenant: tenant B → no row → nil.
	mock.ExpectQuery(`FROM notifications`).
		WithArgs(notifID, tenantB, "user-1").
		WillReturnRows(pgxmock.NewRows(notifColumns()))

	got, err = repo.FindByID(context.Background(), tenantB, "user-1", notifID)
	if err != nil {
		t.Fatalf("FindByID cross-tenant: %v", err)
	}
	if got != nil {
		t.Fatalf("cross-tenant lookup leaked a row: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestMarkRead_CTEStates exercises the single-round-trip CTE that returns
// (rows_updated, rows_found): a genuine miss returns ErrNotFound; an already-read
// row (found but not updated) is an idempotent success; a fresh mark succeeds.
func TestMarkRead_CTEStates(t *testing.T) {
	tests := []struct {
		name        string
		rowsUpdated int
		rowsFound   int
		wantErr     error
	}{
		{name: "not found", rowsUpdated: 0, rowsFound: 0, wantErr: ErrNotFound},
		{name: "already read is idempotent", rowsUpdated: 0, rowsFound: 1, wantErr: nil},
		{name: "fresh mark", rowsUpdated: 1, rowsFound: 1, wantErr: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo, mock := newNotificationRepo(t)
			mock.ExpectQuery(`UPDATE notifications SET read_at`).
				WithArgs(pgxmock.AnyArg(), notifID, tenantA, "user-1").
				WillReturnRows(pgxmock.NewRows([]string{"rows_updated", "rows_found"}).
					AddRow(tt.rowsUpdated, tt.rowsFound))

			err := repo.MarkRead(context.Background(), tenantA, "user-1", notifID)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("MarkRead err = %v, want %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet expectations: %v", err)
			}
		})
	}
}

// TestDelete_NotFound asserts a zero-row delete (cross-tenant / already gone)
// surfaces ErrNotFound while a one-row delete succeeds, both tenant+user scoped.
func TestDelete_NotFound(t *testing.T) {
	repo, mock := newNotificationRepo(t)

	mock.ExpectExec(`DELETE FROM notifications`).
		WithArgs(notifID, tenantA, "user-1").
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	if err := repo.Delete(context.Background(), tenantA, "user-1", notifID); err != nil {
		t.Fatalf("Delete success: %v", err)
	}

	mock.ExpectExec(`DELETE FROM notifications`).
		WithArgs(notifID, tenantB, "user-1").
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	if err := repo.Delete(context.Background(), tenantB, "user-1", notifID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on zero-row delete, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestGetCounts asserts the single-query per-category aggregation maps the eight
// projected counts into the typed result, tenant+user scoped.
func TestGetCounts(t *testing.T) {
	repo, mock := newNotificationRepo(t)

	mock.ExpectQuery(`FROM notifications`).
		WithArgs(tenantA, "user-1").
		WillReturnRows(pgxmock.NewRows([]string{
			"unread", "all", "security", "data", "workflow", "governance", "legal", "system",
		}).AddRow(3, 10, 4, 1, 2, 1, 1, 1))

	counts, err := repo.GetCounts(context.Background(), tenantA, "user-1")
	if err != nil {
		t.Fatalf("GetCounts: %v", err)
	}
	if counts.Unread != 3 || counts.All != 10 || counts.Security != 4 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestUnreadCount asserts the tenant+user-scoped unread tally.
func TestUnreadCount(t *testing.T) {
	repo, mock := newNotificationRepo(t)

	mock.ExpectQuery(`SELECT COUNT`).
		WithArgs(tenantA, "user-1").
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(7)))

	n, err := repo.UnreadCount(context.Background(), tenantA, "user-1")
	if err != nil {
		t.Fatalf("UnreadCount: %v", err)
	}
	if n != 7 {
		t.Fatalf("expected 7, got %d", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
