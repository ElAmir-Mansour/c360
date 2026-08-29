//go:build integration

package respond

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationSingleCommanderEnforced(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	repo := NewRepository()
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{PermRespondDeclare}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:    "payments outage",
		Severity: SeveritySEV1,
		Actor:    actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	runner := pgxTenantRunner{pool: pool}
	firstCommander := uuid.New()
	secondCommander := uuid.New()
	if err := runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		_, err := repo.AssignIncidentRole(ctx, tx, AssignRoleInput{
			TenantID:    tenantID,
			IncidentID:  inc.ID,
			Role:        RoleCommander,
			ResponderID: firstCommander,
			AssignedBy:  actor.UserID,
		})
		return err
	}); err != nil {
		t.Fatalf("assign first commander: %v", err)
	}
	err = runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		_, err := repo.AssignIncidentRole(ctx, tx, AssignRoleInput{
			TenantID:    tenantID,
			IncidentID:  inc.ID,
			Role:        RoleCommander,
			ResponderID: secondCommander,
			AssignedBy:  actor.UserID,
		})
		return err
	})
	if !errors.Is(err, ErrCommanderAlreadyAssigned) {
		t.Fatalf("second commander error = %v, want ErrCommanderAlreadyAssigned", err)
	}
	err = runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		history, err := repo.ListRoleHistory(ctx, tx, tenantID, inc.ID, 10)
		if err != nil {
			return err
		}
		if len(history) != 1 || history[0].ResponderID != firstCommander {
			t.Fatalf("role history = %+v, want one first commander assignment", history)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("read role history: %v", err)
	}
}
