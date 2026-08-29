package service

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	iammodel "github.com/clario360/platform/internal/iam/model"
	lexmodel "github.com/clario360/platform/internal/lex/model"
)

type fakeCaseAssignmentUsers struct {
	users map[uuid.UUID]*CaseAssignmentUserIdentity
}

func (f fakeCaseAssignmentUsers) ResolveCaseAssignmentUser(_ context.Context, tenantID, id uuid.UUID) (*CaseAssignmentUserIdentity, error) {
	user, ok := f.users[id]
	if !ok {
		return nil, pgx.ErrNoRows
	}
	_ = tenantID // Validator independently verifies the returned tenant identity.
	return user, nil
}

type fakeCaseAssignmentOrgs struct {
	entities    map[uuid.UUID]*lexmodel.OrgEntity
	memberships map[uuid.UUID][]lexmodel.OrgMembership
}

func (f fakeCaseAssignmentOrgs) Get(_ context.Context, tenantID, id uuid.UUID) (*lexmodel.OrgEntity, error) {
	entity, ok := f.entities[id]
	if !ok || entity.TenantID != tenantID {
		return nil, pgx.ErrNoRows
	}
	return entity, nil
}

func (f fakeCaseAssignmentOrgs) ListActiveMemberships(_ context.Context, tenantID, entityID uuid.UUID) ([]lexmodel.OrgMembership, error) {
	items := f.memberships[entityID]
	out := make([]lexmodel.OrgMembership, 0, len(items))
	for _, item := range items {
		if item.TenantID == tenantID && item.EntityID == entityID && item.Active {
			out = append(out, item)
		}
	}
	return out, nil
}

func TestCaseAssignmentValidatorAcceptsActiveTenantEntityMembers(t *testing.T) {
	tenantID := uuid.New()
	entityID := uuid.New()
	managerID := uuid.New()
	supervisorID := uuid.New()
	officerID := uuid.New()
	users := map[uuid.UUID]*CaseAssignmentUserIdentity{}
	for _, id := range []uuid.UUID{managerID, supervisorID, officerID} {
		users[id] = &CaseAssignmentUserIdentity{ID: id, TenantID: tenantID, Status: iammodel.UserStatusActive}
	}
	memberships := make([]lexmodel.OrgMembership, 0, 3)
	for _, id := range []uuid.UUID{managerID, supervisorID, officerID} {
		memberships = append(memberships, lexmodel.OrgMembership{TenantID: tenantID, EntityID: entityID, UserID: id, Active: true})
	}
	validator := NewCaseAssignmentValidator(fakeCaseAssignmentUsers{users: users}, fakeCaseAssignmentOrgs{
		entities: map[uuid.UUID]*lexmodel.OrgEntity{
			entityID: {ID: entityID, TenantID: tenantID, Active: true},
		},
		memberships: map[uuid.UUID][]lexmodel.OrgMembership{entityID: memberships},
	})

	err := validator.validateTargets(context.Background(), tenantID, map[string]any{"beneficiary_entity_id": entityID.String()}, []caseAssignmentTarget{
		{field: "section_manager_id", userID: managerID},
		{field: "supervisor_id", userID: supervisorID},
		{field: "handling_officer_id", userID: officerID},
	})
	if err != nil {
		t.Fatalf("validateTargets() error = %v", err)
	}
}

func TestCaseAssignmentValidatorSupportAssigneeRejectsCrossTenantAndWrongEntity(t *testing.T) {
	tenantID, otherTenantID := uuid.New(), uuid.New()
	targetID, otherEntityID := uuid.New(), uuid.New()
	memberID, wrongEntityID, crossTenantID := uuid.New(), uuid.New(), uuid.New()
	validator := NewCaseAssignmentValidator(fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{
		memberID:      {ID: memberID, TenantID: tenantID, Status: iammodel.UserStatusActive},
		wrongEntityID: {ID: wrongEntityID, TenantID: tenantID, Status: iammodel.UserStatusActive},
		crossTenantID: {ID: crossTenantID, TenantID: otherTenantID, Status: iammodel.UserStatusActive},
	}}, fakeCaseAssignmentOrgs{
		entities: map[uuid.UUID]*lexmodel.OrgEntity{
			targetID:      {ID: targetID, TenantID: tenantID, Active: true},
			otherEntityID: {ID: otherEntityID, TenantID: tenantID, Active: true},
		},
		memberships: map[uuid.UUID][]lexmodel.OrgMembership{
			targetID:      {{TenantID: tenantID, EntityID: targetID, UserID: memberID, Active: true}},
			otherEntityID: {{TenantID: tenantID, EntityID: otherEntityID, UserID: wrongEntityID, Active: true}},
		},
	})
	if err := validator.ValidateSupportAssignee(context.Background(), tenantID, targetID, memberID); err != nil {
		t.Fatalf("active exact member: %v", err)
	}
	for _, id := range []uuid.UUID{wrongEntityID, crossTenantID, uuid.New()} {
		if status := httpStatus(validator.ValidateSupportAssignee(context.Background(), tenantID, targetID, id)); status != http.StatusUnprocessableEntity {
			t.Fatalf("assignee %s status = %d, want 422", id, status)
		}
	}
	if status := httpStatus(validator.ValidateSupportAssignee(context.Background(), tenantID, uuid.New(), memberID)); status != http.StatusUnprocessableEntity {
		t.Fatalf("unknown target status = %d, want 422", status)
	}
}

func TestCaseAssignmentValidatorRejectsInactiveCrossTenantAndNonMemberUsers(t *testing.T) {
	tenantID := uuid.New()
	otherTenantID := uuid.New()
	entityID := uuid.New()
	activeMemberID := uuid.New()
	inactiveID := uuid.New()
	crossTenantID := uuid.New()
	nonMemberID := uuid.New()
	validator := NewCaseAssignmentValidator(fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{
		activeMemberID: {ID: activeMemberID, TenantID: tenantID, Status: iammodel.UserStatusActive},
		inactiveID:     {ID: inactiveID, TenantID: tenantID, Status: iammodel.UserStatusSuspended},
		crossTenantID:  {ID: crossTenantID, TenantID: otherTenantID, Status: iammodel.UserStatusActive},
		nonMemberID:    {ID: nonMemberID, TenantID: tenantID, Status: iammodel.UserStatusActive},
	}}, fakeCaseAssignmentOrgs{
		entities: map[uuid.UUID]*lexmodel.OrgEntity{
			entityID: {ID: entityID, TenantID: tenantID, Active: true},
		},
		memberships: map[uuid.UUID][]lexmodel.OrgMembership{
			entityID: {{TenantID: tenantID, EntityID: entityID, UserID: activeMemberID, Active: true}},
		},
	})
	metadata := map[string]any{"beneficiary_entity_id": entityID.String()}

	for _, tt := range []struct {
		name   string
		field  string
		userID uuid.UUID
	}{
		{name: "inactive", field: "supervisor_id", userID: inactiveID},
		{name: "cross tenant", field: "section_manager_id", userID: crossTenantID},
		{name: "not an entity member", field: "handling_officer_id", userID: nonMemberID},
		{name: "unknown", field: "handling_officer_id", userID: uuid.New()},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := validator.validateTargets(context.Background(), tenantID, metadata, []caseAssignmentTarget{{field: tt.field, userID: tt.userID}})
			if err == nil {
				t.Fatal("validateTargets() error = nil, want 422")
			}
			if got := httpStatus(err); got != http.StatusUnprocessableEntity {
				t.Fatalf("validateTargets() error = %v status=%d, want 422", err, got)
			}
		})
	}
}

func TestCaseAssignmentValidatorRejectsInvalidOrInactiveBeneficiaryEntity(t *testing.T) {
	tenantID := uuid.New()
	inactiveID := uuid.New()
	deletedAt := time.Now()
	validator := NewCaseAssignmentValidator(fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{}}, fakeCaseAssignmentOrgs{
		entities: map[uuid.UUID]*lexmodel.OrgEntity{
			inactiveID: {ID: inactiveID, TenantID: tenantID, Active: false, DeletedAt: &deletedAt},
		},
		memberships: map[uuid.UUID][]lexmodel.OrgMembership{},
	})

	for _, metadata := range []map[string]any{
		{"beneficiary_entity_id": nil},
		{"beneficiary_entity_id": "not-a-uuid"},
		{"beneficiary_entity_id": uuid.Nil.String()},
		{"beneficiary_entity_id": uuid.NewString()},
		{"beneficiary_entity_id": inactiveID.String()},
	} {
		_, err := validator.validateBeneficiaryEntity(context.Background(), tenantID, metadata)
		if err == nil {
			t.Fatalf("validateBeneficiaryEntity(%v) error = nil, want 422", metadata)
		}
		if got := httpStatus(err); got != http.StatusUnprocessableEntity {
			t.Fatalf("validateBeneficiaryEntity(%v) error = %v status=%d, want 422", metadata, err, got)
		}
	}
}

func TestCaseAssignmentValidatorLegacyCaseStillRequiresActiveTenantUser(t *testing.T) {
	tenantID := uuid.New()
	officerID := uuid.New()
	validator := NewCaseAssignmentValidator(fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{
		officerID: {ID: officerID, TenantID: tenantID, Status: iammodel.UserStatusActive},
	}}, fakeCaseAssignmentOrgs{entities: map[uuid.UUID]*lexmodel.OrgEntity{}, memberships: map[uuid.UUID][]lexmodel.OrgMembership{}})

	if err := validator.validateTargets(context.Background(), tenantID, nil, []caseAssignmentTarget{{field: "handling_officer_id", userID: officerID}}); err != nil {
		t.Fatalf("legacy case assignment error = %v", err)
	}
}

func TestCaseAssignmentValidatorBeneficiaryChangeKeepsExistingAssignmentsInScope(t *testing.T) {
	tenantID := uuid.New()
	oldEntityID := uuid.New()
	newEntityID := uuid.New()
	managerID := uuid.New()
	users := fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{
		managerID: {ID: managerID, TenantID: tenantID, Status: iammodel.UserStatusActive},
	}}
	orgs := fakeCaseAssignmentOrgs{
		entities: map[uuid.UUID]*lexmodel.OrgEntity{
			oldEntityID: {ID: oldEntityID, TenantID: tenantID, Active: true},
			newEntityID: {ID: newEntityID, TenantID: tenantID, Active: true},
		},
		memberships: map[uuid.UUID][]lexmodel.OrgMembership{
			oldEntityID: {{TenantID: tenantID, EntityID: oldEntityID, UserID: managerID, Active: true}},
		},
	}
	validator := NewCaseAssignmentValidator(users, orgs)

	err := validator.validateBeneficiaryChange(
		context.Background(),
		tenantID,
		map[string]any{"beneficiary_entity_id": oldEntityID.String()},
		map[string]any{"beneficiary_entity_id": newEntityID.String()},
		[]caseAssignmentTarget{{field: "section_manager_id", userID: managerID}},
	)
	if err == nil || httpStatus(err) != http.StatusUnprocessableEntity {
		t.Fatalf("validateBeneficiaryChange() error = %v, want 422 for manager outside new entity", err)
	}

	orgs.memberships[newEntityID] = []lexmodel.OrgMembership{{
		TenantID: tenantID,
		EntityID: newEntityID,
		UserID:   managerID,
		Active:   true,
	}}
	validator = NewCaseAssignmentValidator(users, orgs)
	if err := validator.validateBeneficiaryChange(
		context.Background(),
		tenantID,
		map[string]any{"beneficiary_entity_id": oldEntityID.String()},
		map[string]any{"beneficiary_entity_id": newEntityID.String()},
		[]caseAssignmentTarget{{field: "section_manager_id", userID: managerID}},
	); err != nil {
		t.Fatalf("validateBeneficiaryChange() with active new membership error = %v", err)
	}
}

func TestCaseAssignmentValidatorBeneficiaryChangeRejectsRemovalAndInvalidEntity(t *testing.T) {
	tenantID := uuid.New()
	oldEntityID := uuid.New()
	validator := NewCaseAssignmentValidator(
		fakeCaseAssignmentUsers{users: map[uuid.UUID]*CaseAssignmentUserIdentity{}},
		fakeCaseAssignmentOrgs{
			entities: map[uuid.UUID]*lexmodel.OrgEntity{
				oldEntityID: {ID: oldEntityID, TenantID: tenantID, Active: true},
			},
			memberships: map[uuid.UUID][]lexmodel.OrgMembership{},
		},
	)
	before := map[string]any{"beneficiary_entity_id": oldEntityID.String()}

	for name, after := range map[string]map[string]any{
		"removed":      {},
		"unknown":      {"beneficiary_entity_id": uuid.NewString()},
		"malformed id": {"beneficiary_entity_id": "not-a-uuid"},
	} {
		t.Run(name, func(t *testing.T) {
			err := validator.validateBeneficiaryChange(context.Background(), tenantID, before, after, nil)
			if err == nil || httpStatus(err) != http.StatusUnprocessableEntity {
				t.Fatalf("validateBeneficiaryChange() error = %v, want 422", err)
			}
		})
	}
}

func TestCaseAssignmentValidatorBeneficiaryChangeSkipsUnchangedReference(t *testing.T) {
	entityID := uuid.New()
	validator := NewCaseAssignmentValidator(nil, nil)
	if err := validator.validateBeneficiaryChange(
		context.Background(),
		uuid.New(),
		map[string]any{"beneficiary_entity_id": "  " + entityID.String() + " "},
		map[string]any{"beneficiary_entity_id": entityID},
		nil,
	); err != nil {
		t.Fatalf("unchanged canonical entity reference was revalidated: %v", err)
	}
}
