package repository

import (
	"context"
	"regexp"
	"testing"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"
)

func TestFindContractByRequestUsesContractsTable(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	tenantID := uuid.New()
	requestID := uuid.New()
	contractID := uuid.New()
	repo := &LegalRequestRepository{}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM contracts")).
		WithArgs(tenantID, requestID.String()).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(contractID))

	got, err := repo.FindContractByRequest(context.Background(), mock, tenantID, requestID)
	if err != nil {
		t.Fatalf("FindContractByRequest: %v", err)
	}
	if got != contractID {
		t.Fatalf("FindContractByRequest = %s, want %s", got, contractID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet mock expectations: %v", err)
	}
}
