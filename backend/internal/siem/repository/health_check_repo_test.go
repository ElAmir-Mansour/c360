package repository_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/siem/repository"
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

func TestHealthCheckRepository_Insert_OK(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.NewHealthCheckRepository(mock)

	mock.ExpectExec(`INSERT INTO siem.health_check`).
		WithArgs(pgxmock.AnyArg(), "tenant-1").
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	id, err := repo.Insert(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if id == "" {
		t.Error("Insert returned empty id")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestHealthCheckRepository_Insert_EmptyTenant(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.NewHealthCheckRepository(mock)

	_, err := repo.Insert(context.Background(), "")
	if err == nil {
		t.Fatal("expected error on empty tenant")
	}
}

func TestHealthCheckRepository_Insert_NoRowsAffected(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.NewHealthCheckRepository(mock)

	mock.ExpectExec(`INSERT INTO siem.health_check`).
		WithArgs(pgxmock.AnyArg(), "tenant-1").
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 0"))

	if _, err := repo.Insert(context.Background(), "tenant-1"); err == nil {
		t.Fatal("expected error when 0 rows affected")
	}
}

func TestHealthCheckRepository_CountByTenant(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.NewHealthCheckRepository(mock)

	mock.ExpectQuery(`SELECT count\(\*\) FROM siem.health_check`).
		WithArgs("tenant-1").
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(42)))

	n, err := repo.CountByTenant(context.Background(), "tenant-1")
	if err != nil {
		t.Fatal(err)
	}
	if n != 42 {
		t.Errorf("count=%d, want 42", n)
	}
}

func TestHealthCheckRepository_Ping(t *testing.T) {
	t.Parallel()
	mock := newMock(t)
	repo := repository.NewHealthCheckRepository(mock)

	mock.ExpectQuery(`SELECT 1 FROM siem.health_check`).
		WillReturnRows(pgxmock.NewRows([]string{"?column?"}).AddRow(1))

	if err := repo.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestHealthCheckRepository_NilDB(t *testing.T) {
	t.Parallel()
	repo := repository.NewHealthCheckRepository(nil)
	if _, err := repo.Insert(context.Background(), "t"); err == nil {
		t.Error("Insert with nil db should error")
	}
	if _, err := repo.CountByTenant(context.Background(), "t"); err == nil {
		t.Error("CountByTenant with nil db should error")
	}
	if err := repo.Ping(context.Background()); err == nil {
		t.Error("Ping with nil db should error")
	}
}
