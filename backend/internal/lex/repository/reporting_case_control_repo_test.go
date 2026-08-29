package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
)

func TestCasesExpectedResolutionBetweenScopesLiveCasesToHalfOpenWindow(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	from := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	to := from.Add(30 * 24 * time.Hour)
	mock.ExpectQuery(`(?s)FROM legal_cases.*tenant_id = \$1.*deleted_at IS NULL.*status NOT IN \('closed', 'cancelled'\).*expected_resolution_date >= \$2.*expected_resolution_date < \$3`).
		WithArgs(tenantID, from, to).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(4))

	got, err := casesExpectedResolutionBetween(context.Background(), mock, tenantID, from, to)
	if err != nil {
		t.Fatalf("casesExpectedResolutionBetween: %v", err)
	}
	if got != 4 {
		t.Fatalf("casesExpectedResolutionBetween = %d, want 4", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestInvestigationCaseTypeCountsRetainsUnlinkedBucket(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	mock.ExpectQuery(`(?s)FROM legal_investigations i.*LEFT JOIN legal_cases c.*c.tenant_id = i.tenant_id.*c.id = i.case_id.*c.deleted_at IS NULL.*WHERE i.tenant_id = \$1.*i.deleted_at IS NULL.*GROUP BY 1`).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"key", "count"}).
			AddRow("commercial", 7).
			AddRow("unspecified", 2))

	got, err := investigationCaseTypeCounts(context.Background(), mock, tenantID)
	if err != nil {
		t.Fatalf("investigationCaseTypeCounts: %v", err)
	}
	if len(got) != 2 || got[0].Key != "commercial" || got[0].Count != 7 || got[1].Key != "unspecified" || got[1].Count != 2 {
		t.Fatalf("investigationCaseTypeCounts = %+v, want commercial=7 unspecified=2", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestInvestigationCaseTypesScopesBothSidesOfJoinToTenant(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	investigationID := uuid.New()
	ids := []uuid.UUID{investigationID}
	mock.ExpectQuery(`(?s)FROM legal_investigations i.*JOIN legal_cases c.*c.tenant_id = i.tenant_id.*c.id = i.case_id.*c.deleted_at IS NULL.*WHERE i.tenant_id = \$1.*i.deleted_at IS NULL.*i.id = ANY\(\$2::uuid\[\]\)`).
		WithArgs(tenantID, ids).
		WillReturnRows(pgxmock.NewRows([]string{"id", "case_type"}).AddRow(investigationID, "labor"))

	got, err := investigationCaseTypes(context.Background(), mock, tenantID, ids)
	if err != nil {
		t.Fatalf("investigationCaseTypes: %v", err)
	}
	if got[investigationID] != "labor" {
		t.Fatalf("investigationCaseTypes = %+v, want investigation mapped to labor", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
