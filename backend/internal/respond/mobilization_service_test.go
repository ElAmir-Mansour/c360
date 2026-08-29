package respond

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"
)

func TestMobilizeRoleDispatchesOnceForIdempotentResend(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close(ctx)

	fixture := newMobilizationFixture()
	expectMobilizationRead(mock, fixture)
	expectMobilizationTimeline(mock, fixture, EventRoleMobilized)
	expectMobilizationRead(mock, fixture)
	expectMobilizationTimeline(mock, fixture, EventRoleMobilized)

	sender := &recordingNotificationSender{}
	svc := newMobilizationTestService(mock, sender, fixture.Now)

	first, err := svc.MobilizeRole(ctx, fixture.TenantID, MobilizeRoleInput{
		IncidentID:   fixture.IncidentID,
		AssignmentID: fixture.AssignmentID,
		Channels:     []NotificationChannel{NotificationChannelInApp},
		Actor:        fixture.Actor,
	})
	if err != nil {
		t.Fatalf("first MobilizeRole: %v", err)
	}
	second, err := svc.MobilizeRole(ctx, fixture.TenantID, MobilizeRoleInput{
		IncidentID:   fixture.IncidentID,
		AssignmentID: fixture.AssignmentID,
		Channels:     []NotificationChannel{NotificationChannelInApp},
		Actor:        fixture.Actor,
	})
	if err != nil {
		t.Fatalf("second MobilizeRole: %v", err)
	}
	if first.CreatedCount != 1 || second.CreatedCount != 0 {
		t.Fatalf("created counts = %d/%d, want 1/0", first.CreatedCount, second.CreatedCount)
	}
	if len(sender.messages) != 1 {
		t.Fatalf("sender calls = %d, want 1", len(sender.messages))
	}
	if len(first.Dispatches) != 1 || first.Dispatches[0].AckState != NotificationAckPending {
		t.Fatalf("first dispatches = %+v", first.Dispatches)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgx expectations: %v", err)
	}
}

func TestMobilizeRoleMissingAssignment(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close(ctx)

	fixture := newMobilizationFixture()
	expectIncidentLookup(mock, fixture)
	mock.ExpectQuery("SELECT (.+) FROM respond_incident_role_assignment").
		WithArgs(fixture.TenantID, fixture.IncidentID, fixture.AssignmentID).
		WillReturnRows(pgxmock.NewRows(roleAssignmentRowColumns()))

	svc := newMobilizationTestService(mock, &recordingNotificationSender{}, fixture.Now)
	_, err = svc.MobilizeRole(ctx, fixture.TenantID, MobilizeRoleInput{
		IncidentID:   fixture.IncidentID,
		AssignmentID: fixture.AssignmentID,
		Channels:     []NotificationChannel{NotificationChannelInApp},
		Actor:        fixture.Actor,
	})
	if !errors.Is(err, ErrRoleAssignmentNotFound) {
		t.Fatalf("error = %v, want ErrRoleAssignmentNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgx expectations: %v", err)
	}
}

func TestMobilizeRoleRecordsSenderFailure(t *testing.T) {
	ctx := context.Background()
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close(ctx)

	fixture := newMobilizationFixture()
	expectMobilizationRead(mock, fixture)
	expectMobilizationTimeline(mock, fixture, EventNotificationDispatchFailed)

	sender := &recordingNotificationSender{err: ErrNotificationHTTPDelivery}
	svc := newMobilizationTestService(mock, sender, fixture.Now)
	result, err := svc.MobilizeRole(ctx, fixture.TenantID, MobilizeRoleInput{
		IncidentID:   fixture.IncidentID,
		AssignmentID: fixture.AssignmentID,
		Channels:     []NotificationChannel{NotificationChannelInApp},
		Actor:        fixture.Actor,
	})
	if !errors.Is(err, ErrNotificationHTTPDelivery) {
		t.Fatalf("error = %v, want ErrNotificationHTTPDelivery", err)
	}
	if result == nil || len(result.Dispatches) != 1 || result.Dispatches[0].DeliveryState != NotificationDeliveryFailed {
		t.Fatalf("result = %+v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgx expectations: %v", err)
	}
}

type mobilizationFixture struct {
	TenantID     uuid.UUID
	IncidentID   uuid.UUID
	AssignmentID uuid.UUID
	ResponderID  uuid.UUID
	Actor        Actor
	Now          time.Time
}

func newMobilizationFixture() mobilizationFixture {
	actorID := uuid.New()
	return mobilizationFixture{
		TenantID:     uuid.New(),
		IncidentID:   uuid.New(),
		AssignmentID: uuid.New(),
		ResponderID:  uuid.New(),
		Actor:        Actor{UserID: actorID, GlobalPermissions: []string{PermRespondUpdate, PermRespondRead}},
		Now:          time.Date(2026, 6, 29, 10, 0, 0, 0, time.UTC),
	}
}

func newMobilizationTestService(db DBTX, sender NotificationSender, now time.Time) *Service {
	engine, err := NewNotificationEngine(
		newMemoryNotificationDispatchStore(),
		sender,
		WithNotificationEngineClock(func() time.Time { return now }),
		WithDefaultAckTimeout(time.Minute),
	)
	if err != nil {
		panic(err)
	}
	svc := NewServiceWithDeps(resolverTestRunner{db: db}, NewRepository(), NewTimelineFeed(8), zerolog.Nop())
	svc.now = func() time.Time { return now }
	svc.EnableNotificationMobilization(engine, nil, time.Minute)
	return svc
}

func expectMobilizationRead(mock pgxmock.PgxConnIface, f mobilizationFixture) {
	expectIncidentLookup(mock, f)
	mock.ExpectQuery("SELECT (.+) FROM respond_incident_role_assignment").
		WithArgs(f.TenantID, f.IncidentID, f.AssignmentID).
		WillReturnRows(roleAssignmentRows(f))
	mock.ExpectQuery("SELECT (.+) FROM respond_responder_directory").
		WithArgs(f.TenantID, f.ResponderID).
		WillReturnRows(responderDirectoryRows(f))
}

func expectIncidentLookup(mock pgxmock.PgxConnIface, f mobilizationFixture) {
	mock.ExpectQuery("SELECT (.+) FROM respond_incident").
		WithArgs(f.TenantID, f.IncidentID).
		WillReturnRows(incidentRows(f))
}

func expectMobilizationTimeline(mock pgxmock.PgxConnIface, f mobilizationFixture, eventType string) {
	mock.ExpectQuery("INSERT INTO respond_incident_timeline_event").
		WithArgs(f.TenantID, f.IncidentID, f.Actor.UserID, pgxmock.AnyArg(), eventType, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "occurred_at"}).AddRow(uuid.New(), f.Now))
}

func incidentRows(f mobilizationFixture) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "reference", "title", "description", "severity", "status",
		"declared_by", "declared_at", "detected_at", "mitigated_at", "resolved_at", "closed_at",
		"impacted_services", "row_version", "created_at", "updated_at",
	}).AddRow(
		f.IncidentID, f.TenantID, "INC-2026-0042", "Checkout outage", "Payments unavailable",
		string(SeveritySEV1), string(StatusMobilizing), f.Actor.UserID, f.Now, nil, nil, nil, nil,
		[]byte(`["checkout"]`), 1, f.Now, f.Now,
	)
}

func roleAssignmentRows(f mobilizationFixture) *pgxmock.Rows {
	return pgxmock.NewRows(roleAssignmentRowColumns()).AddRow(
		f.AssignmentID, f.TenantID, f.IncidentID, string(RoleTechnicalLead), f.ResponderID,
		f.Actor.UserID, f.Now, nil, nil, "", string(RoleAssignmentActive), "manual", []byte(`{}`), 1, f.Now, f.Now,
	)
}

func roleAssignmentRowColumns() []string {
	return []string{
		"id", "tenant_id", "incident_id", "role", "responder_id", "assigned_by", "assigned_at",
		"released_by", "released_at", "release_reason", "status", "source", "metadata",
		"row_version", "created_at", "updated_at",
	}
}

func responderDirectoryRows(f mobilizationFixture) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"tenant_id", "user_id", "display_name", "email", "phone", "chat_handle",
		"team_key", "service_key", "roles", "on_call", "escalation_rank", "active",
		"updated_by", "created_at", "updated_at",
	}).AddRow(
		f.TenantID, f.ResponderID, "Alice Responder", "alice@example.test", "+15550100", "@alice",
		"payments", "checkout", []byte(`["technical_lead"]`), true, 0, true, f.Actor.UserID, f.Now, f.Now,
	)
}
