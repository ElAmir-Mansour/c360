package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

type RoleService struct {
	roleRepo repository.RoleRepository
	userRepo repository.UserRepository
	producer *events.Producer
	logger   zerolog.Logger
}

func NewRoleService(
	roleRepo repository.RoleRepository,
	userRepo repository.UserRepository,
	producer *events.Producer,
	logger zerolog.Logger,
) *RoleService {
	return &RoleService{
		roleRepo: roleRepo,
		userRepo: userRepo,
		producer: producer,
		logger:   logger,
	}
}

func (s *RoleService) List(ctx context.Context, tenantID string) ([]dto.RoleResponse, error) {
	roles, err := s.roleRepo.List(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return dto.RolesToResponse(roles), nil
}

func (s *RoleService) GetByID(ctx context.Context, roleID string) (*dto.RoleResponse, error) {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return nil, err
	}
	resp := dto.RoleToResponse(role)
	return &resp, nil
}

// getRoleInTenant loads a role by ID but enforces tenant isolation: if the role
// exists in a different tenant it is reported as ErrNotFound, so a caller can
// neither read nor mutate a foreign-tenant role by UUID. Roles are always
// tenant-scoped (SeedSystemRoles inserts one row per tenant), so an empty
// tenantID (trusted internal callers) is the only path that skips the check.
// This is the guard the public /roles/{id} read, update and delete endpoints
// route through, mirroring the user-service tenant scoping.
func (s *RoleService) getRoleInTenant(ctx context.Context, tenantID, roleID string) (*model.Role, error) {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return nil, err
	}
	if tenantID != "" && role.TenantID != tenantID {
		return nil, fmt.Errorf("role %s: %w", roleID, model.ErrNotFound)
	}
	return role, nil
}

// GetByIDInTenant returns a role only when it belongs to the caller's tenant,
// closing the cross-tenant read on GET /api/v1/roles/{id}.
func (s *RoleService) GetByIDInTenant(ctx context.Context, tenantID, roleID string) (*dto.RoleResponse, error) {
	role, err := s.getRoleInTenant(ctx, tenantID, roleID)
	if err != nil {
		return nil, err
	}
	resp := dto.RoleToResponse(role)
	return &resp, nil
}

func (s *RoleService) Create(ctx context.Context, tenantID string, req *dto.CreateRoleRequest) (*dto.RoleResponse, error) {
	// Check if slug already exists
	_, err := s.roleRepo.GetBySlug(ctx, tenantID, req.Slug)
	if err == nil {
		return nil, fmt.Errorf("role slug %s: %w", req.Slug, model.ErrConflict)
	}

	role := &model.Role{
		TenantID:    tenantID,
		Name:        req.Name,
		Slug:        req.Slug,
		Description: req.Description,
		Permissions: req.Permissions,
	}

	if err := s.roleRepo.Create(ctx, role); err != nil {
		return nil, fmt.Errorf("creating role: %w", err)
	}

	s.publishEvent(ctx, "role.created", tenantID, "")

	resp := dto.RoleToResponse(role)
	return &resp, nil
}

// UpdateInTenant is the tenant-scoped entry point for the admin PUT /roles/{id}
// endpoint: it rejects a foreign-tenant target with ErrNotFound before delegating
// to Update, closing the cross-tenant role-mutation gap (sibling to the
// GetByIDInTenant read fix).
func (s *RoleService) UpdateInTenant(ctx context.Context, tenantID, roleID string, req *dto.UpdateRoleRequest) (*dto.RoleResponse, error) {
	if _, err := s.getRoleInTenant(ctx, tenantID, roleID); err != nil {
		return nil, err
	}
	return s.Update(ctx, roleID, req)
}

func (s *RoleService) Update(ctx context.Context, roleID string, req *dto.UpdateRoleRequest) (*dto.RoleResponse, error) {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return nil, err
	}

	if role.IsSystemRole {
		return nil, model.ErrSystemRole
	}

	if req.Name != nil {
		role.Name = *req.Name
	}
	if req.Description != nil {
		role.Description = *req.Description
	}
	if req.Permissions != nil {
		role.Permissions = req.Permissions
	}

	if err := s.roleRepo.Update(ctx, role); err != nil {
		return nil, err
	}

	updated, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return nil, err
	}
	resp := dto.RoleToResponse(updated)
	return &resp, nil
}

// DeleteInTenant is the tenant-scoped entry point for the admin DELETE /roles/{id}
// endpoint: it rejects a foreign-tenant target with ErrNotFound before delegating
// to Delete.
func (s *RoleService) DeleteInTenant(ctx context.Context, tenantID, roleID string) error {
	if _, err := s.getRoleInTenant(ctx, tenantID, roleID); err != nil {
		return err
	}
	return s.Delete(ctx, roleID)
}

func (s *RoleService) Delete(ctx context.Context, roleID string) error {
	role, err := s.roleRepo.GetByID(ctx, roleID)
	if err != nil {
		return err
	}
	if role.IsSystemRole {
		return model.ErrSystemRole
	}
	return s.roleRepo.Delete(ctx, roleID)
}

func (s *RoleService) AssignRole(ctx context.Context, userID string, req *dto.AssignRoleRequest, tenantID, assignedBy string) error {
	// Verify user exists
	if _, err := s.userRepo.GetByID(ctx, userID); err != nil {
		return err
	}

	// Verify role exists
	candidate, err := s.roleRepo.GetByID(ctx, req.RoleID)
	if err != nil {
		return err
	}

	// SSD (Legal_Role_Matrix_Design.md v2 §4.2 / changelog #7): before persisting
	// the grant, reject assigning a legal role that is mutually exclusive with one
	// the user already holds (e.g. legal-officer + legal-cases-manager, any
	// operational legal role + legal-auditor). The exclusion set is keyed by role
	// SLUG and only legal-* slugs participate; non-legal roles are a no-op in the
	// guard, so this is inert for ordinary RBAC roles.
	//
	// Org-entity scope: the user_roles table carries no org-entity column, so role
	// assignment in this platform is tenant-wide. SSD is therefore enforced
	// tenant-wide here — the user's existing roles across the tenant form the
	// `existing` set. (When per-entity role binding is added, scope `existing` to
	// the same entity per §4.2.)
	if err := s.checkRoleExclusion(ctx, userID, candidate.Slug); err != nil {
		return err
	}

	if err := s.roleRepo.AssignToUser(ctx, userID, req.RoleID, tenantID, assignedBy); err != nil {
		return err
	}

	s.publishEvent(ctx, "role.assigned", tenantID, userID)
	return nil
}

// checkRoleExclusion loads the slugs of the roles the user already holds and runs
// the §4.2 SSD guard against the candidate slug. A conflict is surfaced as a
// model.ErrConflict (HTTP 409) wrapping the descriptive SoD reason. A user who
// already holds the candidate role (idempotent re-assign) is allowed.
func (s *RoleService) checkRoleExclusion(ctx context.Context, userID, candidateSlug string) error {
	if candidateSlug == "" {
		return nil
	}
	existingRoles, err := s.roleRepo.GetUserRoles(ctx, userID)
	if err != nil {
		return err
	}
	existing := make([]string, 0, len(existingRoles))
	for i := range existingRoles {
		existing = append(existing, existingRoles[i].Slug)
	}
	if conflict := auth.CheckRoleExclusion(candidateSlug, existing); conflict != nil {
		return fmt.Errorf("%w: %s", model.ErrConflict, conflict.Error())
	}
	return nil
}

func (s *RoleService) GetUserRoles(ctx context.Context, userID string) ([]dto.RoleResponse, error) {
	roles, err := s.roleRepo.GetUserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}
	return dto.RolesToResponse(roles), nil
}

func (s *RoleService) ListUsersByRole(ctx context.Context, tenantID, roleSlug string) ([]dto.UserResponse, error) {
	userIDs, err := s.ListUserIDsByRole(ctx, tenantID, roleSlug)
	if err != nil {
		return nil, err
	}
	var users []dto.UserResponse
	for _, id := range userIDs {
		user, err := s.userRepo.GetByID(ctx, id)
		if err != nil {
			continue
		}
		users = append(users, dto.UserToResponse(user))
	}
	return users, nil
}

func (s *RoleService) ListUserIDsByRole(ctx context.Context, tenantID, roleSlug string) ([]string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(roleSlug, "_", "-"))
	return s.roleRepo.ListUserIDsByRole(ctx, tenantID, normalized)
}

func (s *RoleService) RemoveRole(ctx context.Context, userID, roleID string) error {
	if err := s.roleRepo.RemoveFromUser(ctx, userID, roleID); err != nil {
		return err
	}

	s.publishEvent(ctx, "role.removed", "", userID)
	return nil
}

func (s *RoleService) publishEvent(ctx context.Context, eventType, tenantID, userID string) {
	if s.producer == nil {
		return
	}
	payload := map[string]any{}
	if tenantID != "" {
		payload["tenant_id"] = tenantID
	}
	if userID != "" {
		payload["user_id"] = userID
	}

	evt, err := events.NewEvent(normalizeIAMEventType(eventType), "iam-service", tenantID, payload)
	if err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to create event")
		return
	}
	if userID != "" {
		evt.UserID = userID
	}
	if err := s.producer.Publish(ctx, "platform.iam.events", evt); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("failed to publish event")
	}
}
