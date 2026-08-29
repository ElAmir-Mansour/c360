package repository

import (
	"context"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

func newSuppressionRepo(t *testing.T) (*SuppressionRepository, pgxmock.PgxPoolIface) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return &SuppressionRepository{db: mock, logger: zerolog.Nop()}, mock
}

func TestIsSuppressed_TrueAndFalse(t *testing.T) {
	repo, mock := newSuppressionRepo(t)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(tenantA, "user-1", model.ChannelEmail).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	got, err := repo.IsSuppressed(context.Background(), tenantA, "user-1", model.ChannelEmail)
	if err != nil {
		t.Fatalf("IsSuppressed: %v", err)
	}
	if !got {
		t.Fatal("expected suppressed=true")
	}

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs(tenantA, "user-2", model.ChannelEmail).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	got, err = repo.IsSuppressed(context.Background(), tenantA, "user-2", model.ChannelEmail)
	if err != nil {
		t.Fatalf("IsSuppressed: %v", err)
	}
	if got {
		t.Fatal("expected suppressed=false")
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAddSuppression_Upserts(t *testing.T) {
	repo, mock := newSuppressionRepo(t)

	mock.ExpectExec(`INSERT INTO notification_suppressions`).
		WithArgs(tenantA, "user-1", model.ChannelEmail, model.SuppressionReasonUnsubscribe).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := repo.Add(context.Background(), &model.Suppression{
		TenantID: tenantA,
		UserID:   "user-1",
		Channel:  model.ChannelEmail,
		Reason:   model.SuppressionReasonUnsubscribe,
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
