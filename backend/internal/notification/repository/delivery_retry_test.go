package repository

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// TestClaimDueRetries_ScansAndReturns asserts the claim query flips rows to
// 'retrying', pushes next_retry_at to the lease, and scans the returned columns
// (including a NULL tenant_id COALESCEd to ”) into DeliveryRecord.
func TestClaimDueRetries_ScansAndReturns(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	lease := time.Now().Add(5 * time.Minute)
	next := time.Now().Add(-time.Minute)

	mock.ExpectQuery(`UPDATE notification_delivery_log dl\s+SET status = 'retrying', next_retry_at = \$2`).
		WithArgs(50, lease).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "notification_id", "channel", "status",
			"attempt", "max_retries", "error_message", "metadata",
			"next_retry_at", "deliver_after", "delivered_at", "created_at",
		}).AddRow(
			deliveryID, tenantA, "notif-1", "webhook", "retrying",
			1, 3, strptr("boom"), []byte("{}"),
			&next, (*time.Time)(nil), (*time.Time)(nil), time.Now(),
		))

	got, err := repo.ClaimDueRetries(context.Background(), 50, lease)
	if err != nil {
		t.Fatalf("ClaimDueRetries: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 claimed row, got %d", len(got))
	}
	if got[0].TenantID != tenantA || got[0].Channel != "webhook" || got[0].MaxRetries != 3 {
		t.Fatalf("unexpected claimed record: %+v", got[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestClaimDueDeferred_FiltersPendingDue asserts the deferred flush claim
// targets pending rows whose deliver_after has passed.
func TestClaimDueDeferred_FiltersPendingDue(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	lease := time.Now().Add(5 * time.Minute)

	mock.ExpectQuery(`WHERE status = 'pending'\s+AND deliver_after IS NOT NULL\s+AND deliver_after <= now\(\)`).
		WithArgs(50, lease).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "notification_id", "channel", "status",
			"attempt", "max_retries", "error_message", "metadata",
			"next_retry_at", "deliver_after", "delivered_at", "created_at",
		}))

	got, err := repo.ClaimDueDeferred(context.Background(), 50, lease)
	if err != nil {
		t.Fatalf("ClaimDueDeferred: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty, got %d", len(got))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestMarkDeliverySucceeded clears next_retry_at and sets delivered.
func TestMarkDeliverySucceeded(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	mock.ExpectExec(`SET status = 'delivered', attempt = \$2, delivered_at = now\(\), next_retry_at = NULL`).
		WithArgs(deliveryID, 2).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.MarkDeliverySucceeded(context.Background(), deliveryID, 2); err != nil {
		t.Fatalf("MarkDeliverySucceeded: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestMarkDeliveryExhausted terminally fails a row with next_retry_at cleared so
// it is never re-claimed.
func TestMarkDeliveryExhausted(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	msg := "gave up"
	mock.ExpectExec(`SET status = 'failed', attempt = \$2, next_retry_at = NULL, error_message = \$3`).
		WithArgs(deliveryID, 3, &msg).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.MarkDeliveryExhausted(context.Background(), deliveryID, 3, &msg); err != nil {
		t.Fatalf("MarkDeliveryExhausted: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestRescheduleDelivery arms the next retry.
func TestRescheduleDelivery(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	next := time.Now().Add(time.Minute)
	msg := "transient"
	mock.ExpectExec(`SET status = 'retrying', attempt = \$2, next_retry_at = \$3, error_message = \$4`).
		WithArgs(deliveryID, 2, next, &msg).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.RescheduleDelivery(context.Background(), deliveryID, 2, next, &msg); err != nil {
		t.Fatalf("RescheduleDelivery: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestCountRetryBacklog returns the due-row count for the gauge.
func TestCountRetryBacklog(t *testing.T) {
	repo, mock := newDeliveryRepo(t)
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM notification_delivery_log\s+WHERE status IN \('failed', 'retrying'\)`).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(7)))

	got, err := repo.CountRetryBacklog(context.Background())
	if err != nil {
		t.Fatalf("CountRetryBacklog: %v", err)
	}
	if got != 7 {
		t.Fatalf("CountRetryBacklog = %d, want 7", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func strptr(s string) *string { return &s }
