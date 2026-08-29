package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

func newWebhookRepo(t *testing.T) (*WebhookRepository, pgxmock.PgxPoolIface) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return &WebhookRepository{db: mock, logger: zerolog.Nop()}, mock
}

// webhookRow returns a full 15-column webhook row matching scanWebhook's
// projection so both scanWebhook and scanWebhooks can reuse it.
func webhookRow(id, tenantID string, events []string) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "name", "url", "secret", "event_types", "active",
		"headers", "retry_policy", "last_triggered_at", "success_count",
		"failure_count", "created_by", "created_at", "updated_at",
	}).AddRow(
		id, tenantID, "my-hook", "https://example.com/hook", nil,
		events, true,
		[]byte(`{"X-Test":"1"}`),
		[]byte(`{"max_retries":3,"backoff_type":"exponential","initial_delay_seconds":10}`),
		nil, int64(5), int64(0), "creator-1", time.Now(), time.Now(),
	)
}

// TestWebhookInsert_ReturnsID asserts Insert carries the tenant + endpoint and
// returns the generated id.
func TestWebhookInsert_ReturnsID(t *testing.T) {
	repo, mock := newWebhookRepo(t)

	mock.ExpectQuery(`INSERT INTO notification_webhooks`).
		WithArgs(tenantA, "my-hook", "https://example.com/hook", pgxmock.AnyArg(),
			pgxmock.AnyArg(), true, pgxmock.AnyArg(), pgxmock.AnyArg(), "creator-1").
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(webhookID))

	id, err := repo.Insert(context.Background(), &model.Webhook{
		TenantID:  tenantA,
		Name:      "my-hook",
		URL:       "https://example.com/hook",
		Events:    []string{"alert.created"},
		Active:    true,
		CreatedBy: "creator-1",
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if id != webhookID {
		t.Fatalf("expected id %s, got %s", webhookID, id)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestWebhookFindByID_TenantScoped asserts FindByID filters by (id, tenant) and
// hydrates the derived fields. A cross-tenant lookup that matches nothing returns
// (nil, nil) so the handler answers 404 without leaking existence.
func TestWebhookFindByID_TenantScoped(t *testing.T) {
	repo, mock := newWebhookRepo(t)

	mock.ExpectQuery(`FROM notification_webhooks WHERE id = `).
		WithArgs(webhookID, tenantA).
		WillReturnRows(webhookRow(webhookID, tenantA, []string{"alert.created"}))

	wh, err := repo.FindByID(context.Background(), tenantA, webhookID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if wh == nil || wh.ID != webhookID {
		t.Fatalf("expected webhook %s, got %+v", webhookID, wh)
	}
	if wh.Status != "active" {
		t.Errorf("expected derived status active, got %q", wh.Status)
	}
	if wh.Headers["X-Test"] != "1" {
		t.Errorf("headers did not hydrate: %+v", wh.Headers)
	}

	// Cross-tenant: tenant B asks for tenant A's webhook; the predicate excludes
	// it so the DB returns nothing → (nil, nil).
	mock.ExpectQuery(`FROM notification_webhooks WHERE id = `).
		WithArgs(webhookID, tenantB).
		WillReturnError(pgx.ErrNoRows)

	wh, err = repo.FindByID(context.Background(), tenantB, webhookID)
	if err != nil {
		t.Fatalf("FindByID cross-tenant: %v", err)
	}
	if wh != nil {
		t.Fatalf("cross-tenant lookup leaked a webhook: %+v", wh)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestWebhookGetActiveForEvent asserts the active+event predicate is tenant
// scoped and scans multiple rows.
func TestWebhookGetActiveForEvent(t *testing.T) {
	repo, mock := newWebhookRepo(t)

	rows := webhookRow(webhookID, tenantA, []string{"alert.created"})
	rows.AddRow(
		"33333333-0000-0000-0000-000000000003", tenantA, "hook-2",
		"https://example.com/2", nil, []string{}, true,
		[]byte(`{}`), []byte(`{}`), nil, int64(0), int64(0), "creator-1",
		time.Now(), time.Now(),
	)

	mock.ExpectQuery(`FROM notification_webhooks`).
		WithArgs(tenantA, "alert.created").
		WillReturnRows(rows)

	hooks, err := repo.GetActiveForEvent(context.Background(), tenantA, "alert.created")
	if err != nil {
		t.Fatalf("GetActiveForEvent: %v", err)
	}
	if len(hooks) != 2 {
		t.Fatalf("expected 2 active webhooks, got %d", len(hooks))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestWebhookDeactivate_NotFound asserts Deactivate distinguishes a successful
// soft-delete (rows affected) from a webhook that does not belong to the tenant
// (zero rows → "webhook not found").
func TestWebhookDeactivate_NotFound(t *testing.T) {
	repo, mock := newWebhookRepo(t)

	// Success path: one row updated.
	mock.ExpectExec(`UPDATE notification_webhooks SET active = false`).
		WithArgs(pgxmock.AnyArg(), webhookID, tenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.Deactivate(context.Background(), tenantA, webhookID); err != nil {
		t.Fatalf("Deactivate success: %v", err)
	}

	// Cross-tenant / missing: zero rows updated → not found.
	mock.ExpectExec(`UPDATE notification_webhooks SET active = false`).
		WithArgs(pgxmock.AnyArg(), webhookID, tenantB).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	if err := repo.Deactivate(context.Background(), tenantB, webhookID); err == nil {
		t.Fatal("expected an error when no row is affected (cross-tenant)")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestWebhookIncrementCounters asserts the success/failure counters bump the
// right column, tenant scoped.
func TestWebhookIncrementCounters(t *testing.T) {
	repo, mock := newWebhookRepo(t)

	mock.ExpectExec(`success_count = success_count \+ 1`).
		WithArgs(pgxmock.AnyArg(), webhookID, tenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := repo.IncrementSuccess(context.Background(), tenantA, webhookID); err != nil {
		t.Fatalf("IncrementSuccess: %v", err)
	}

	mock.ExpectExec(`failure_count = failure_count \+ 1`).
		WithArgs(pgxmock.AnyArg(), webhookID, tenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := repo.IncrementFailure(context.Background(), tenantA, webhookID); err != nil {
		t.Fatalf("IncrementFailure: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
