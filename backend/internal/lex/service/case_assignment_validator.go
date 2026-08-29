package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	iammodel "github.com/clario360/platform/internal/iam/model"
	lexmodel "github.com/clario360/platform/internal/lex/model"
)

// CaseAssignmentUserIdentity is the minimum IAM projection needed to validate
// a case assignee without exposing credentials or role data to Lex.
type CaseAssignmentUserIdentity struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	Status    iammodel.UserStatus
	DeletedAt *time.Time
}

// CaseAssignmentUserDirectory is deliberately tenant-aware: platform_core.users
// is FORCE-RLS, so an id-only generic repository lookup is not safe here.
type CaseAssignmentUserDirectory interface {
	ResolveCaseAssignmentUser(ctx context.Context, tenantID, userID uuid.UUID) (*CaseAssignmentUserIdentity, error)
}

// PlatformCoreCaseAssignmentUserDirectory resolves assignees through a
// tenant-scoped read transaction, satisfying the users-table FORCE-RLS policy.
type PlatformCoreCaseAssignmentUserDirectory struct {
	db *pgxpool.Pool
}

func NewPlatformCoreCaseAssignmentUserDirectory(db *pgxpool.Pool) *PlatformCoreCaseAssignmentUserDirectory {
	return &PlatformCoreCaseAssignmentUserDirectory{db: db}
}

func (d *PlatformCoreCaseAssignmentUserDirectory) ResolveCaseAssignmentUser(ctx context.Context, tenantID, userID uuid.UUID) (*CaseAssignmentUserIdentity, error) {
	if d == nil || d.db == nil {
		return nil, errors.New("platform IAM database is not configured")
	}
	identity := &CaseAssignmentUserIdentity{}
	var status string
	err := database.RunReadWithTenant(ctx, d.db, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, status::text, deleted_at
			FROM users
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, userID,
		).Scan(&identity.ID, &identity.TenantID, &status, &identity.DeletedAt)
	})
	if err != nil {
		return nil, err
	}
	identity.Status = iammodel.UserStatus(status)
	return identity, nil
}

// CaseAssignmentOrgDirectory is the legal-org lookup surface needed to prove
// the case beneficiary and entity-scoped assignee membership.
type CaseAssignmentOrgDirectory interface {
	Get(ctx context.Context, tenantID, id uuid.UUID) (*lexmodel.OrgEntity, error)
	ListActiveMemberships(ctx context.Context, tenantID, entityID uuid.UUID) ([]lexmodel.OrgMembership, error)
}

// CaseAssignmentValidator centralizes the tenant/user/entity invariants shared
// by the phase-2 handoff and the later officer assignment route.
type CaseAssignmentValidator struct {
	users CaseAssignmentUserDirectory
	orgs  CaseAssignmentOrgDirectory
}

// ValidateSupportAssignee proves the full client-supplied support picker pair:
// the target is an active entity in this tenant, the assignee is an active IAM
// user in this tenant, and the assignee has an active membership in that exact
// entity. SupportRequestService uses this narrow exported seam rather than
// reimplementing case assignment's cross-tenant protections.
func (v *CaseAssignmentValidator) ValidateSupportAssignee(ctx context.Context, tenantID, entityID, assigneeID uuid.UUID) error {
	if entityID == uuid.Nil {
		return validationError("target_entity_id is required", map[string]string{"target_entity_id": "required"})
	}
	if assigneeID == uuid.Nil {
		return validationError("assignee_id is required", map[string]string{"assignee_id": "required"})
	}
	if v == nil || v.orgs == nil {
		return internalError("support assignment org directory is not configured", fmt.Errorf("missing legal-org directory"))
	}
	entity, err := v.orgs.Get(ctx, tenantID, entityID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return validationError("target_entity_id must reference an active entity in this tenant", map[string]string{"target_entity_id": "unknown entity"})
		}
		return internalError("validate support target entity", err)
	}
	if entity == nil || entity.TenantID != tenantID || !entity.Active || entity.DeletedAt != nil {
		return validationError("target_entity_id must reference an active entity in this tenant", map[string]string{"target_entity_id": "inactive or unknown entity"})
	}
	if v.users == nil {
		return internalError("support assignment user directory is not configured", fmt.Errorf("missing IAM user directory"))
	}
	user, err := v.users.ResolveCaseAssignmentUser(ctx, tenantID, assigneeID)
	if err != nil {
		if errors.Is(err, iammodel.ErrNotFound) || errors.Is(err, pgx.ErrNoRows) {
			return validationError("assignee_id must reference an active user in this tenant", map[string]string{"assignee_id": "unknown user"})
		}
		return internalError("validate support assignee", err)
	}
	if user == nil || user.ID != assigneeID || user.TenantID != tenantID || user.Status != iammodel.UserStatusActive || user.DeletedAt != nil {
		return validationError("assignee_id must reference an active user in this tenant", map[string]string{"assignee_id": "inactive or cross-tenant user"})
	}
	memberships, err := v.orgs.ListActiveMemberships(ctx, tenantID, entityID)
	if err != nil {
		return internalError("validate support assignee membership", err)
	}
	for _, membership := range memberships {
		if membership.Active && membership.TenantID == tenantID && membership.EntityID == entityID && membership.UserID == assigneeID {
			return nil
		}
	}
	return validationError("assignee_id must be an active member of target_entity_id", map[string]string{"assignee_id": "not a member of target entity"})
}

type caseAssignmentTarget struct {
	field  string
	userID uuid.UUID
}

func NewCaseAssignmentValidator(users CaseAssignmentUserDirectory, orgs CaseAssignmentOrgDirectory) *CaseAssignmentValidator {
	return &CaseAssignmentValidator{users: users, orgs: orgs}
}

func beneficiaryEntityReference(metadata map[string]any) (string, bool) {
	if metadata == nil {
		return "", false
	}
	raw, present := metadata["beneficiary_entity_id"]
	if !present {
		return "", false
	}
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value), true
	case uuid.UUID:
		return value.String(), true
	default:
		return fmt.Sprintf("%T:%v", raw, raw), true
	}
}

func beneficiaryEntityReferenceChanged(before, after map[string]any) bool {
	beforeValue, beforePresent := beneficiaryEntityReference(before)
	afterValue, afterPresent := beneficiaryEntityReference(after)
	return beforePresent != afterPresent || beforeValue != afterValue
}

// SetUserDirectory wires the platform_core-backed IAM repository after the Lex
// application has acquired its long-lived platform pool. Startup completes
// before routes are served, so this is not mutated concurrently with requests.
func (v *CaseAssignmentValidator) SetUserDirectory(users CaseAssignmentUserDirectory) {
	if v != nil && users != nil {
		v.users = users
	}
}

// validateBeneficiaryEntity parses and verifies metadata.beneficiary_entity_id.
// Absence remains valid for legacy/direct cases; once supplied it must resolve
// to an active legal-org entity belonging to the same tenant.
func (v *CaseAssignmentValidator) validateBeneficiaryEntity(ctx context.Context, tenantID uuid.UUID, metadata map[string]any) (*uuid.UUID, error) {
	if metadata == nil {
		return nil, nil
	}
	raw, present := metadata["beneficiary_entity_id"]
	if !present {
		return nil, nil
	}

	var entityID uuid.UUID
	switch value := raw.(type) {
	case string:
		parsed, err := uuid.Parse(strings.TrimSpace(value))
		if err != nil {
			return nil, validationError("beneficiary_entity_id must be a valid UUID", map[string]string{"beneficiary_entity_id": "invalid UUID"})
		}
		entityID = parsed
	case uuid.UUID:
		entityID = value
	default:
		return nil, validationError("beneficiary_entity_id must be a valid UUID", map[string]string{"beneficiary_entity_id": "invalid UUID"})
	}
	if entityID == uuid.Nil {
		return nil, validationError("beneficiary_entity_id must be a valid UUID", map[string]string{"beneficiary_entity_id": "invalid UUID"})
	}
	if v == nil || v.orgs == nil {
		return nil, internalError("case assignment org directory is not configured", fmt.Errorf("missing legal-org directory"))
	}
	entity, err := v.orgs.Get(ctx, tenantID, entityID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, validationError("beneficiary_entity_id must reference an active entity in this tenant", map[string]string{"beneficiary_entity_id": "unknown entity"})
		}
		return nil, internalError("validate case beneficiary entity", err)
	}
	if entity == nil || entity.TenantID != tenantID || !entity.Active || entity.DeletedAt != nil {
		return nil, validationError("beneficiary_entity_id must reference an active entity in this tenant", map[string]string{"beneficiary_entity_id": "inactive or unknown entity"})
	}
	return &entityID, nil
}

// validateBeneficiaryChange protects generic case edits that move a case to a
// different organisational unit. The new unit is mandatory and active in the
// same tenant, and every existing UUID-backed assignment must remain an active
// member of it. The edit is rejected before its database transaction begins.
func (v *CaseAssignmentValidator) validateBeneficiaryChange(
	ctx context.Context,
	tenantID uuid.UUID,
	before, after map[string]any,
	targets []caseAssignmentTarget,
) error {
	if !beneficiaryEntityReferenceChanged(before, after) {
		return nil
	}
	entityID, err := v.validateBeneficiaryEntity(ctx, tenantID, after)
	if err != nil {
		return err
	}
	if entityID == nil {
		return validationError(
			"beneficiary_entity_id cannot be removed from an organisationally-owned case",
			map[string]string{"beneficiary_entity_id": "required"},
		)
	}
	return v.validateTargets(ctx, tenantID, after, targets)
}

// validateTargets verifies every non-zero assignment target as an active IAM
// user in the tenant. When the case has an owning beneficiary entity, each user
// must additionally have an active membership in that exact entity.
func (v *CaseAssignmentValidator) validateTargets(ctx context.Context, tenantID uuid.UUID, metadata map[string]any, targets []caseAssignmentTarget) error {
	entityID, err := v.validateBeneficiaryEntity(ctx, tenantID, metadata)
	if err != nil {
		return err
	}
	if v == nil || v.users == nil {
		return internalError("case assignment user directory is not configured", fmt.Errorf("missing IAM user directory"))
	}

	for _, target := range targets {
		if target.userID == uuid.Nil {
			continue
		}
		user, lookupErr := v.users.ResolveCaseAssignmentUser(ctx, tenantID, target.userID)
		if lookupErr != nil {
			if errors.Is(lookupErr, iammodel.ErrNotFound) || errors.Is(lookupErr, pgx.ErrNoRows) {
				return validationError(target.field+" must reference an active user in this tenant", map[string]string{target.field: "unknown user"})
			}
			return internalError("validate "+target.field, lookupErr)
		}
		if user == nil || user.ID != target.userID || user.TenantID != tenantID || user.Status != iammodel.UserStatusActive || user.DeletedAt != nil {
			return validationError(target.field+" must reference an active user in this tenant", map[string]string{target.field: "inactive or cross-tenant user"})
		}
	}

	if entityID == nil {
		return nil
	}
	memberships, err := v.orgs.ListActiveMemberships(ctx, tenantID, *entityID)
	if err != nil {
		return internalError("validate case assignee memberships", err)
	}
	activeMembers := make(map[uuid.UUID]struct{}, len(memberships))
	for _, membership := range memberships {
		if membership.Active && membership.TenantID == tenantID && membership.EntityID == *entityID {
			activeMembers[membership.UserID] = struct{}{}
		}
	}
	for _, target := range targets {
		if target.userID == uuid.Nil {
			continue
		}
		if _, ok := activeMembers[target.userID]; !ok {
			return validationError(target.field+" must be an active member of the case beneficiary entity", map[string]string{target.field: "not an active entity member"})
		}
	}
	return nil
}
