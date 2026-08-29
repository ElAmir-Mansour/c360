package respond

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
)

type resolverTestRunner struct {
	db DBTX
}

func (r resolverTestRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(r.db)
}

func (r resolverTestRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(r.db)
}

func (r resolverTestRunner) RunSystemRead(_ context.Context, fn func(DBTX) error) error {
	return fn(r.db)
}

type staticMetastoreResolver struct {
	responders []ResolvedResponder
}

func (r staticMetastoreResolver) ResolveIncidentResponders(_ context.Context, _ ResponderResolutionRequest) ([]ResolvedResponder, error) {
	return r.responders, nil
}

func TestPersistentResponderResolverResolvesAndMergesSources(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close(ctx)

	tenantID := uuid.New()
	incidentID := uuid.New()
	aliceID := uuid.New()
	bobID := uuid.New()
	now := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	rolesJSON := []byte(`["technical_lead"]`)
	updatedBy := uuid.New()

	rows := pgxmock.NewRows([]string{
		"tenant_id", "user_id", "display_name", "email", "phone", "chat_handle",
		"team_key", "service_key", "roles", "on_call", "escalation_rank", "active",
		"updated_by", "created_at", "updated_at",
	}).
		AddRow(
			tenantID, aliceID, "Alice", "alice@example.test", "", "@alice",
			"payments", "checkout", rolesJSON, true, 1, true, updatedBy, now, now,
		)
	mock.ExpectQuery("SELECT (.+) FROM respond_responder_directory").
		WithArgs(tenantID, string(RoleTechnicalLead), []string{"payments"}, []string{"checkout"}, 50).
		WillReturnRows(rows)

	resolver, err := NewPersistentResponderResolver(
		resolverTestRunner{db: mock},
		NewStore(),
		WithResponderResolverClock(func() time.Time { return now }),
		WithMetastoreResponderResolver(staticMetastoreResolver{responders: []ResolvedResponder{
			{UserID: aliceID, Phone: "+15550100", Source: "metastore"},
			{UserID: bobID, DisplayName: "Bob", Email: "bob@example.test", TeamKey: "payments", EscalationRank: 2, Source: "metastore"},
		}}),
	)
	if err != nil {
		t.Fatalf("NewPersistentResponderResolver: %v", err)
	}

	got, err := resolver.ResolveResponders(ctx, ResponderResolutionRequest{
		TenantID:    tenantID,
		IncidentID:  incidentID,
		Role:        RoleTechnicalLead,
		TeamKeys:    []string{"payments"},
		ServiceKeys: []string{"checkout"},
	})
	if err != nil {
		t.Fatalf("ResolveResponders: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("responders = %d, want 2: %+v", len(got), got)
	}
	if got[0].UserID != aliceID || got[0].Phone != "+15550100" || got[0].Source != "respond_responder_directory,metastore" {
		t.Fatalf("merged first responder = %+v", got[0])
	}
	if got[1].UserID != bobID {
		t.Fatalf("second responder id = %s, want %s", got[1].UserID, bobID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgx expectations: %v", err)
	}
}
