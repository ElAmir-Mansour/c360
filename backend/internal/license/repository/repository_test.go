package repository

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func newMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool() error = %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func expectRepositoryQueries(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestListTenantIDsByPlanKey(t *testing.T) {
	mock := newMockPool(t)
	repo := New()

	mock.ExpectQuery(regexp.QuoteMeta(listTenantIDsByPlanKeySQL)).
		WithArgs("business-plus").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id"}).
			AddRow("aaaaaaaa-0000-0000-0000-000000000001").
			AddRow("bbbbbbbb-0000-0000-0000-000000000002"))

	got, err := repo.ListTenantIDsByPlanKey(context.Background(), mock, "business-plus")
	if err != nil {
		t.Fatalf("ListTenantIDsByPlanKey() error = %v", err)
	}
	want := []string{
		"aaaaaaaa-0000-0000-0000-000000000001",
		"bbbbbbbb-0000-0000-0000-000000000002",
	}
	if len(got) != len(want) {
		t.Fatalf("tenant IDs = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tenant IDs = %v, want %v", got, want)
		}
	}
	expectRepositoryQueries(t, mock)
}

func TestListTenantIDsByPlanKey_WrapsQueryError(t *testing.T) {
	mock := newMockPool(t)
	repo := New()

	mock.ExpectQuery(regexp.QuoteMeta(listTenantIDsByPlanKeySQL)).
		WithArgs("business-plus").
		WillReturnError(errors.New("database unavailable"))

	if _, err := repo.ListTenantIDsByPlanKey(context.Background(), mock, "business-plus"); err == nil {
		t.Fatal("expected query error")
	}
	expectRepositoryQueries(t, mock)
}
