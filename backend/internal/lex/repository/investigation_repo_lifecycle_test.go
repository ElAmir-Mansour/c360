package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

func TestInvestigationTerminalStatusPersistsAttribution(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	repo := &InvestigationRepository{}
	tenantID, investigationID, actorID := uuid.New(), uuid.New(), uuid.New()
	closedAt := time.Date(2026, 8, 1, 12, 30, 0, 0, time.UTC)
	mock.ExpectExec(`UPDATE legal_investigations\s+SET status = \$3,\s+closed_by = \$4,\s+closed_at = \$5,\s+closure_reason = \$6`).
		WithArgs(tenantID, investigationID, model.InvestigationStatusClosed, actorID, closedAt, "completed review", (*string)(nil), (*string)(nil)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	if err := repo.UpdateTerminalStatusTx(context.Background(), mock, tenantID, investigationID, actorID, model.InvestigationStatusClosed, " completed review ", closedAt); err != nil {
		t.Fatalf("UpdateTerminalStatusTx: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestInvestigationProjectionIncludesClosureMetadata(t *testing.T) {
	query := investigationJSONSelect("li.tenant_id = $1")
	for _, column := range []string{"li.closed_by", "li.closed_at", "li.closure_reason", "li.late_justification", "sla_deadline"} {
		if !strings.Contains(query, column) {
			t.Errorf("investigation projection missing %s", column)
		}
	}
}
