package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
)

// ssdRoleRepo is a focused RoleRepository stub for the SSD (§4.2) assignment
// guard: GetByID resolves the candidate role by id, GetUserRoles returns the
// roles the user already holds, and AssignToUser records the persisted grant so
// the test can assert it ran (or didn't) without a database.
type ssdRoleRepo struct {
	mockRoleRepo // satisfies the unused interface methods
	byID         map[string]*model.Role
	userRoles    map[string][]model.Role
	assigned     []string // "<userID>:<roleID>" recorded on successful AssignToUser
}

func newSSDRoleRepo() *ssdRoleRepo {
	return &ssdRoleRepo{
		mockRoleRepo: *newMockRoleRepo(),
		byID:         map[string]*model.Role{},
		userRoles:    map[string][]model.Role{},
	}
}

func (r *ssdRoleRepo) GetByID(ctx context.Context, id string) (*model.Role, error) {
	if role, ok := r.byID[id]; ok {
		return role, nil
	}
	return nil, model.ErrNotFound
}

func (r *ssdRoleRepo) GetUserRoles(ctx context.Context, userID string) ([]model.Role, error) {
	return r.userRoles[userID], nil
}

func (r *ssdRoleRepo) AssignToUser(ctx context.Context, userID, roleID, tenantID, assignedBy string) error {
	r.assigned = append(r.assigned, userID+":"+roleID)
	return nil
}

func roleWithSlug(id, slug string) *model.Role {
	return &model.Role{ID: id, Slug: slug, TenantID: "tenant-ssd", Name: slug}
}

// TestRoleService_AssignRole_SSD exercises the §4.2 separation-of-duties guard on
// the role-ASSIGNMENT path: a mutually-exclusive legal role pair is rejected with
// a 409-class ErrConflict, while a non-conflicting pair persists.
func TestRoleService_AssignRole_SSD(t *testing.T) {
	const userID = "user-ssd"
	const tenantID = "tenant-ssd"

	candidateCasesMgr := roleWithSlug("role-cases-mgr", "legal-cases-manager")
	candidateContractsMgr := roleWithSlug("role-contracts-mgr", "legal-contracts-manager")
	heldOfficer := *roleWithSlug("role-officer", "legal-officer")

	t.Run("conflicting pair rejected (cases-manager onto officer)", func(t *testing.T) {
		roleRepo := newSSDRoleRepo()
		userRepo := newMockUserRepo()
		userRepo.users[userID] = &model.User{ID: userID, TenantID: tenantID}

		roleRepo.byID[candidateCasesMgr.ID] = candidateCasesMgr
		roleRepo.userRoles[userID] = []model.Role{heldOfficer}

		svc := NewRoleService(roleRepo, userRepo, nil, zerolog.Nop())

		err := svc.AssignRole(context.Background(), userID,
			&dto.AssignRoleRequest{RoleID: candidateCasesMgr.ID}, tenantID, "admin")
		if err == nil {
			t.Fatal("expected SSD rejection assigning legal-cases-manager to a legal-officer, got nil")
		}
		if !errors.Is(err, model.ErrConflict) {
			t.Fatalf("expected error to wrap model.ErrConflict (409), got %v", err)
		}
		if len(roleRepo.assigned) != 0 {
			t.Fatalf("conflicting assignment must NOT persist; recorded %v", roleRepo.assigned)
		}
	})

	t.Run("non-conflicting pair allowed (contracts-manager onto officer)", func(t *testing.T) {
		roleRepo := newSSDRoleRepo()
		userRepo := newMockUserRepo()
		userRepo.users[userID] = &model.User{ID: userID, TenantID: tenantID}

		// legal-officer ⊥ legal-contracts-manager is NOT a declared §4.2 conflict.
		roleRepo.byID[candidateContractsMgr.ID] = candidateContractsMgr
		roleRepo.userRoles[userID] = []model.Role{heldOfficer}

		svc := NewRoleService(roleRepo, userRepo, nil, zerolog.Nop())

		err := svc.AssignRole(context.Background(), userID,
			&dto.AssignRoleRequest{RoleID: candidateContractsMgr.ID}, tenantID, "admin")
		if err != nil {
			t.Fatalf("expected non-conflicting assignment to succeed, got %v", err)
		}
		if want := userID + ":" + candidateContractsMgr.ID; len(roleRepo.assigned) != 1 || roleRepo.assigned[0] != want {
			t.Fatalf("expected assignment %q to persist, recorded %v", want, roleRepo.assigned)
		}
	})
}
