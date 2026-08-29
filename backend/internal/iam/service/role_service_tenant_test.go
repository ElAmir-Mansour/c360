package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
)

// TestRoleService_TenantScopedMutation exercises the G7 tenant-isolation guard on
// the role MUTATION paths (PUT/DELETE /roles/{id}). A role owned by another tenant
// must resolve to ErrNotFound (404) and must never be mutated or deleted, while a
// same-tenant role is updated/deleted normally. This mirrors the GetByIDInTenant
// read fix (F19 sibling) and the user-service tenant scoping.
func TestRoleService_TenantScopedMutation(t *testing.T) {
	const callerTenant = "tenant-a"
	const otherTenant = "tenant-b"

	newSvcWithRole := func(roleTenant string) (*RoleService, *model.Role) {
		roleRepo := newMockRoleRepo()
		userRepo := newMockUserRepo()
		role := &model.Role{ID: "role-1", TenantID: roleTenant, Name: "Editors", Slug: "editors"}
		roleRepo.roles[role.ID] = role
		svc := NewRoleService(roleRepo, userRepo, nil, zerolog.Nop())
		return svc, role
	}

	newName := "Renamed"

	t.Run("update foreign-tenant role is 404 and does not mutate", func(t *testing.T) {
		svc, role := newSvcWithRole(otherTenant)
		_, err := svc.UpdateInTenant(context.Background(), callerTenant, role.ID,
			&dto.UpdateRoleRequest{Name: &newName})
		if !errors.Is(err, model.ErrNotFound) {
			t.Fatalf("expected ErrNotFound for cross-tenant update, got %v", err)
		}
		if role.Name != "Editors" {
			t.Fatalf("foreign-tenant role must not be mutated; name = %q", role.Name)
		}
	})

	t.Run("update same-tenant role succeeds", func(t *testing.T) {
		svc, role := newSvcWithRole(callerTenant)
		resp, err := svc.UpdateInTenant(context.Background(), callerTenant, role.ID,
			&dto.UpdateRoleRequest{Name: &newName})
		if err != nil {
			t.Fatalf("expected same-tenant update to succeed, got %v", err)
		}
		if resp.Name != newName {
			t.Fatalf("expected role renamed to %q, got %q", newName, resp.Name)
		}
	})

	t.Run("delete foreign-tenant role is 404", func(t *testing.T) {
		svc, role := newSvcWithRole(otherTenant)
		err := svc.DeleteInTenant(context.Background(), callerTenant, role.ID)
		if !errors.Is(err, model.ErrNotFound) {
			t.Fatalf("expected ErrNotFound for cross-tenant delete, got %v", err)
		}
	})

	t.Run("delete same-tenant role succeeds", func(t *testing.T) {
		svc, role := newSvcWithRole(callerTenant)
		if err := svc.DeleteInTenant(context.Background(), callerTenant, role.ID); err != nil {
			t.Fatalf("expected same-tenant delete to succeed, got %v", err)
		}
	})
}
