package repository

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

func TestListActiveMembershipsWithScopesAndFiltersCandidates(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	entityID := uuid.New()
	userID := uuid.New()
	want := model.OrgMembership{
		ID:           uuid.New(),
		TenantID:     tenantID,
		EntityID:     entityID,
		UserID:       userID,
		EmployeeCode: "EMP-001",
		Title:        map[string]string{"en": "Legal counsel"},
		CapacityUnits: func() *float64 {
			value := 0.8
			return &value
		}(),
		Active:    true,
		Metadata:  map[string]any{},
		CreatedBy: uuid.New(),
	}
	raw, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM legal_org_memberships")+`(?s).*tenant_id = \$1.*entity_id = \$2.*active = true.*deleted_at IS NULL`).
		WithArgs(tenantID, entityID).
		WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}).AddRow(raw))

	got, err := listActiveMembershipsWith(context.Background(), mock, tenantID, entityID)
	if err != nil {
		t.Fatalf("listActiveMembershipsWith() error = %v", err)
	}
	if len(got) != 1 || got[0].UserID != userID || got[0].TenantID != tenantID || got[0].EntityID != entityID || got[0].CapacityUnits == nil || *got[0].CapacityUnits != 0.8 || !got[0].Active {
		t.Fatalf("listActiveMembershipsWith() = %+v, want active scoped membership %+v", got, want)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
