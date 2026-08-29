//go:build integration

package respond

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationStakeholderDispatchPersistsLogAndNextUpdate(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleCommander}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "executive dashboard unavailable",
		Description:      "Executive dashboards are unavailable for finance users.",
		Severity:         SeveritySEV2,
		ImpactedServices: []string{"visus-dashboard"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}
	token, err := svc.CreateStakeholderToken(ctx, tenantID, CreateStakeholderTokenInput{
		IncidentID: inc.ID,
		Actor:      actor,
	})
	if err != nil {
		t.Fatalf("create stakeholder token: %v", err)
	}

	dispatch, err := svc.DispatchStakeholderUpdate(ctx, tenantID, DispatchStakeholderUpdateInput{
		IncidentID:   inc.ID,
		Reason:       StakeholderUpdateReasonPeriodic,
		Channel:      "status_page",
		RecipientRef: "board-room",
		Actor:        actor,
	})
	if err != nil {
		t.Fatalf("dispatch stakeholder update: %v", err)
	}
	if dispatch.Status != StakeholderUpdateStatusSent || dispatch.ID == uuid.Nil {
		t.Fatalf("dispatch = %+v", dispatch)
	}
	for _, want := range []string{inc.Reference, inc.Title, string(inc.Severity), string(inc.Status), inc.Description} {
		if !strings.Contains(dispatch.Body, want) {
			t.Fatalf("dispatch body missing %q:\n%s", want, dispatch.Body)
		}
	}

	var logs []StakeholderUpdateDispatch
	err = svc.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		logs, err = svc.repo.ListStakeholderUpdateDispatches(ctx, tx, tenantID, inc.ID, 10)
		return err
	})
	if err != nil {
		t.Fatalf("list stakeholder dispatch logs: %v", err)
	}
	if len(logs) != 1 || logs[0].ID != dispatch.ID {
		t.Fatalf("dispatch logs = %+v, want dispatch %s", logs, dispatch.ID)
	}

	status, err := svc.StakeholderStatusByToken(ctx, token.Token)
	if err != nil {
		t.Fatalf("stakeholder status by token: %v", err)
	}
	if status.NextUpdateAt == nil || !status.NextUpdateAt.Equal(*dispatch.NextUpdateAt) {
		t.Fatalf("token next update = %v, want %v", status.NextUpdateAt, dispatch.NextUpdateAt)
	}
}
