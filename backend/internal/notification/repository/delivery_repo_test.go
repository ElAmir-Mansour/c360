package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"
)

const (
	tenantA    = "aaaaaaaa-0000-0000-0000-000000000001"
	tenantB    = "bbbbbbbb-0000-0000-0000-000000000002"
	webhookID  = "11111111-0000-0000-0000-000000000001"
	deliveryID = "22222222-0000-0000-0000-000000000002"
)

func newDeliveryRepo(t *testing.T) (*DeliveryRepository, pgxmock.PgxPoolIface) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return &DeliveryRepository{db: mock, logger: zerolog.Nop()}, mock
}

// TestGetWebhookDeliveries_TenantScoped asserts the query carries the caller's
// tenant as $2 and that a tenant B request against tenant A's webhook (the DB
// returns nothing because the tenant predicate excludes it) yields an empty
// page — the "empty on the delivery-log paths" cross-tenant guarantee. If a
// future edit drops the tenant predicate/arg, WithArgs fails the expectation.
func TestGetWebhookDeliveries_TenantScoped(t *testing.T) {
	repo, mock := newDeliveryRepo(t)

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM notification_delivery_log WHERE webhook_id = \$1 AND tenant_id = \$2`).
		WithArgs(webhookID, tenantB).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(0)))

	mock.ExpectQuery(`FROM notification_delivery_log WHERE webhook_id = \$1 AND tenant_id = \$2`).
		WithArgs(webhookID, tenantB, 20, 0).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "webhook_id", "event_type", "status", "request_url", "request_body",
			"response_status", "response_body", "duration_ms", "attempt", "next_retry_at", "created_at",
		}))

	got, total, err := repo.GetWebhookDeliveries(context.Background(), tenantB, webhookID, 1, 20, "")
	if err != nil {
		t.Fatalf("GetWebhookDeliveries: %v", err)
	}
	if total != 0 || len(got) != 0 {
		t.Fatalf("cross-tenant listing leaked rows: total=%d len=%d", total, len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestRetryDelivery_TenantScoped asserts the UPDATE is scoped to the caller's
// tenant and returns rows-affected. A cross-tenant retry matches no row (0
// affected) so the handler answers 404; the owner's retry matches (1 affected).
func TestRetryDelivery_TenantScoped(t *testing.T) {
	t.Run("cross-tenant returns zero affected (handler 404)", func(t *testing.T) {
		repo, mock := newDeliveryRepo(t)
		mock.ExpectExec(`UPDATE notification_delivery_log SET status = 'pending', error_message = NULL WHERE id = \$1 AND tenant_id = \$2 AND status = 'failed'`).
			WithArgs(deliveryID, tenantB).
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))

		affected, err := repo.RetryDelivery(context.Background(), tenantB, deliveryID)
		if err != nil {
			t.Fatalf("RetryDelivery: %v", err)
		}
		if affected != 0 {
			t.Fatalf("cross-tenant retry affected %d rows, want 0", affected)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("owner returns one affected", func(t *testing.T) {
		repo, mock := newDeliveryRepo(t)
		mock.ExpectExec(`UPDATE notification_delivery_log SET status = 'pending'`).
			WithArgs(deliveryID, tenantA).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))

		affected, err := repo.RetryDelivery(context.Background(), tenantA, deliveryID)
		if err != nil {
			t.Fatalf("RetryDelivery: %v", err)
		}
		if affected != 1 {
			t.Fatalf("owner retry affected %d rows, want 1", affected)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

// TestGetFailedRecentFiltered_TenantScoped asserts the bulk retry-failed source
// query is confined to the caller's tenant (previously it re-fired EVERY
// tenant's failed deliveries).
func TestGetFailedRecentFiltered_TenantScoped(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	mock.ExpectQuery(`FROM notification_delivery_log\s+WHERE status = 'failed' AND tenant_id = \$1 AND created_at >= \$2`).
		WithArgs(tenantB, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "notification_id", "channel", "status", "attempt", "error_message", "metadata", "delivered_at", "created_at",
		}))

	got, err := repo.GetFailedRecentFiltered(context.Background(), tenantB, "", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("GetFailedRecentFiltered: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty cross-tenant result, got %d", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestGetNotificationByID_TenantScoped asserts the retry path loads the parent
// notification with a tenant predicate so re-dispatch stays within the tenant.
func TestGetNotificationByID_TenantScoped(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	mock.ExpectQuery(`FROM notifications WHERE id = \$1 AND tenant_id = \$2`).
		WithArgs("notif-1", tenantB).
		WillReturnError(pgx.ErrNoRows)

	_, err := repo.GetNotificationByID(context.Background(), tenantB, "notif-1")
	if err == nil {
		t.Fatalf("expected error for cross-tenant notification lookup")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
