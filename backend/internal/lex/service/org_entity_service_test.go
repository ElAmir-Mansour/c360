package service

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

func TestOrgEntityResolvePathBuildsPathAndRejectsCycles(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	rootID := uuid.New()
	deptID := uuid.New()
	sectionID := uuid.New()
	store := newFakeOrgEntityStore(
		fakeEntity(tenantID, rootID, "ROOT", nil),
		fakeEntity(tenantID, deptID, "DEPT", []uuid.UUID{rootID}),
		fakeEntity(tenantID, sectionID, "SEC", []uuid.UUID{rootID, deptID}),
	)
	svc := &OrgEntityService{entities: store}

	path, parentID, err := svc.resolvePath(ctx, tenantID, &deptID, sectionID)
	if err != nil {
		t.Fatalf("resolvePath() error = %v", err)
	}
	wantPath := []string{rootID.String(), deptID.String()}
	if !reflect.DeepEqual(path, wantPath) {
		t.Fatalf("path = %#v, want %#v", path, wantPath)
	}
	if parentID == nil || *parentID != deptID {
		t.Fatalf("parentID = %v, want %s", parentID, deptID)
	}

	path, parentID, err = svc.resolvePath(ctx, tenantID, nil, sectionID)
	if err != nil {
		t.Fatalf("resolvePath(root) error = %v", err)
	}
	if len(path) != 0 || parentID != nil {
		t.Fatalf("root path=%#v parentID=%v, want empty/nil", path, parentID)
	}

	_, _, err = svc.resolvePath(ctx, tenantID, &sectionID, sectionID)
	requireAppField(t, err, "parent_id", "invalid")

	_, _, err = svc.resolvePath(ctx, tenantID, &sectionID, deptID)
	requireAppField(t, err, "parent_id", "cycle")

	missingID := uuid.New()
	_, _, err = svc.resolvePath(ctx, tenantID, &missingID, deptID)
	requireAppField(t, err, "parent_id", "not found")
}

func TestOrgEntityResolveEscalationRecipientsNearestAncestry(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	rootID := uuid.New()
	deptID := uuid.New()
	sectionID := uuid.New()
	l1UserID := uuid.New()
	l2UserID := uuid.New()
	l3UserID := uuid.New()
	store := newFakeOrgEntityStore(
		fakeEntity(tenantID, rootID, "ROOT", nil),
		fakeEntity(tenantID, deptID, "DEPT", []uuid.UUID{rootID}),
		fakeEntity(tenantID, sectionID, "SEC", []uuid.UUID{rootID, deptID}),
	)
	store.addRole(fakeRole(tenantID, rootID, model.OrgRoleSectionSupervisor, uuid.New(), "Root supervisor"))
	store.addRole(fakeRole(tenantID, rootID, model.OrgRoleSharedServicesManager, l3UserID, "Shared services"))
	store.addRole(fakeRole(tenantID, deptID, model.OrgRoleDepartmentManager, l2UserID, "Department manager"))
	store.addRole(fakeRole(tenantID, sectionID, model.OrgRoleSectionSupervisor, l1UserID, "Section supervisor"))

	resolvedAt := time.Date(2026, 6, 24, 9, 30, 0, 0, time.UTC)
	svc := &OrgEntityService{
		entities: store,
		now:      func() time.Time { return resolvedAt },
	}

	ladder, err := svc.ResolveEscalationRecipients(ctx, tenantID, sectionID)
	if err != nil {
		t.Fatalf("ResolveEscalationRecipients() error = %v", err)
	}
	if ladder.EntityID != sectionID || ladder.EntityCode != "SEC" {
		t.Fatalf("ladder entity = %s/%s, want section SEC", ladder.EntityID, ladder.EntityCode)
	}
	if !ladder.ResolvedAt.Equal(resolvedAt) {
		t.Fatalf("ResolvedAt = %v, want %v", ladder.ResolvedAt, resolvedAt)
	}
	want := []struct {
		level    int
		roleKey  model.OrgRoleKey
		userID   uuid.UUID
		entityID uuid.UUID
	}{
		{1, model.OrgRoleSectionSupervisor, l1UserID, sectionID},
		{2, model.OrgRoleDepartmentManager, l2UserID, deptID},
		{3, model.OrgRoleSharedServicesManager, l3UserID, rootID},
	}
	if len(ladder.Recipients) != len(want) {
		t.Fatalf("recipients len = %d, want %d: %#v", len(ladder.Recipients), len(want), ladder.Recipients)
	}
	for i, wantRecipient := range want {
		got := ladder.Recipients[i]
		if got.Level != wantRecipient.level || got.RoleKey != wantRecipient.roleKey || got.UserID != wantRecipient.userID || got.EntityID != wantRecipient.entityID {
			t.Fatalf("recipient[%d] = %+v, want level=%d role=%s user=%s entity=%s", i, got, wantRecipient.level, wantRecipient.roleKey, wantRecipient.userID, wantRecipient.entityID)
		}
	}
}

func TestOrgEntityListActiveMembershipsScopesToExistingEntity(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	entityID := uuid.New()
	activeUserID := uuid.New()
	inactiveUserID := uuid.New()
	store := newFakeOrgEntityStore(fakeEntity(tenantID, entityID, "LEGAL", nil))
	store.memberships = append(store.memberships,
		model.OrgMembership{ID: uuid.New(), TenantID: tenantID, EntityID: entityID, UserID: activeUserID, Active: true},
		model.OrgMembership{ID: uuid.New(), TenantID: tenantID, EntityID: entityID, UserID: inactiveUserID, Active: false},
		model.OrgMembership{ID: uuid.New(), TenantID: uuid.New(), EntityID: entityID, UserID: uuid.New(), Active: true},
	)
	svc := &OrgEntityService{entities: store}

	memberships, err := svc.ListActiveMemberships(ctx, tenantID, entityID)
	if err != nil {
		t.Fatalf("ListActiveMemberships() error = %v", err)
	}
	if len(memberships) != 1 || memberships[0].UserID != activeUserID {
		t.Fatalf("memberships = %#v, want only active user %s", memberships, activeUserID)
	}

	_, err = svc.ListActiveMemberships(ctx, tenantID, uuid.New())
	if err == nil || !apperrors.IsNotFound(err) {
		t.Fatalf("missing entity error = %v, want not found", err)
	}
}

func TestOrgEntityResolveAddressableRoleRecipients(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	rootID := uuid.New()
	deptID := uuid.New()
	sectionID := uuid.New()
	legalDirectorID := uuid.New()
	contractsManagerID := uuid.New()
	generalCounselID := uuid.New()
	store := newFakeOrgEntityStore(
		fakeEntity(tenantID, rootID, "ROOT", nil),
		fakeEntity(tenantID, deptID, "DEPT", []uuid.UUID{rootID}),
		fakeEntity(tenantID, sectionID, "SEC", []uuid.UUID{rootID, deptID}),
	)
	store.addRole(fakeRole(tenantID, rootID, model.OrgRoleContractsManager, uuid.New(), "Root contracts"))
	store.addRole(fakeRole(tenantID, rootID, model.OrgRoleGeneralCounsel, generalCounselID, "General counsel"))
	store.addRole(fakeRole(tenantID, deptID, model.OrgRoleContractsManager, contractsManagerID, "Contracts manager"))
	store.addRole(fakeRole(tenantID, sectionID, model.OrgRoleLegalDirector, legalDirectorID, "Legal director"))
	svc := &OrgEntityService{
		entities: store,
		now:      func() time.Time { return time.Date(2026, 6, 24, 10, 0, 0, 0, time.UTC) },
	}

	resolution, err := svc.ResolveAddressableRoleRecipients(ctx, tenantID, sectionID, []model.OrgRoleKey{
		model.OrgRoleContractsManager,
		model.OrgRoleContractsManager,
		model.OrgRoleGeneralCounsel,
		model.OrgRoleComplianceOfficer,
	})
	if err != nil {
		t.Fatalf("ResolveAddressableRoleRecipients() error = %v", err)
	}
	wantExplicit := []struct {
		roleKey  model.OrgRoleKey
		userID   uuid.UUID
		entityID uuid.UUID
	}{
		{model.OrgRoleContractsManager, contractsManagerID, deptID},
		{model.OrgRoleGeneralCounsel, generalCounselID, rootID},
	}
	requireAddressableRecipients(t, resolution.Recipients, wantExplicit)

	defaultResolution, err := svc.ResolveDefaultAddressableRoleRecipients(ctx, tenantID, sectionID)
	if err != nil {
		t.Fatalf("ResolveDefaultAddressableRoleRecipients() error = %v", err)
	}
	wantDefault := []struct {
		roleKey  model.OrgRoleKey
		userID   uuid.UUID
		entityID uuid.UUID
	}{
		{model.OrgRoleLegalDirector, legalDirectorID, sectionID},
		{model.OrgRoleContractsManager, contractsManagerID, deptID},
		{model.OrgRoleGeneralCounsel, generalCounselID, rootID},
	}
	requireAddressableRecipients(t, defaultResolution.Recipients, wantDefault)

	missing, err := svc.ResolveAddressableRoleRecipient(ctx, tenantID, sectionID, model.OrgRoleComplianceOfficer)
	if err != nil {
		t.Fatalf("ResolveAddressableRoleRecipient(missing) error = %v", err)
	}
	if missing != nil {
		t.Fatalf("missing recipient = %+v, want nil", missing)
	}
	_, err = svc.ResolveAddressableRoleRecipients(ctx, tenantID, sectionID, []model.OrgRoleKey{model.OrgRoleKey("unknown")})
	requireAppField(t, err, "role_keys", "invalid")
	_, err = svc.ResolveAddressableRoleRecipients(ctx, tenantID, sectionID, nil)
	requireAppField(t, err, "role_keys", "required")
}

func TestOrgEntityResolveOrgRBACPrerequisites(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	rootID := uuid.New()
	deptID := uuid.New()
	sectionID := uuid.New()
	legalDirectorID := uuid.New()
	departmentManagerID := uuid.New()
	generalCounselID := uuid.New()
	store := newFakeOrgEntityStore(
		fakeEntity(tenantID, rootID, "ROOT", nil),
		fakeEntity(tenantID, deptID, "DEPT", []uuid.UUID{rootID}),
		fakeEntity(tenantID, sectionID, "SEC", []uuid.UUID{rootID, deptID}),
	)
	store.addRole(fakeRole(tenantID, rootID, model.OrgRoleGeneralCounsel, generalCounselID, "General counsel"))
	store.addRole(fakeRole(tenantID, deptID, model.OrgRoleDepartmentManager, departmentManagerID, "Department manager"))
	store.addRole(fakeRole(tenantID, sectionID, model.OrgRoleLegalDirector, legalDirectorID, "Legal director"))
	resolvedAt := time.Date(2026, 6, 24, 11, 0, 0, 0, time.UTC)
	svc := &OrgEntityService{
		entities: store,
		now:      func() time.Time { return resolvedAt },
	}

	resolution, err := svc.ResolveOrgRBACPrerequisites(ctx, tenantID, sectionID, []model.OrgRBACVerb{
		model.OrgRBACVerbView,
		model.OrgRBACVerbApprove,
		model.OrgRBACVerbClose,
		model.OrgRBACVerbApprove,
	})
	if err != nil {
		t.Fatalf("ResolveOrgRBACPrerequisites() error = %v", err)
	}
	if resolution.EntityID != sectionID || resolution.EntityCode != "SEC" || !resolution.ResolvedAt.Equal(resolvedAt) {
		t.Fatalf("resolution header = %+v, want SEC at %s", resolution, resolvedAt)
	}
	if len(resolution.Prerequisites) != 3 {
		t.Fatalf("prerequisites len = %d, want 3: %#v", len(resolution.Prerequisites), resolution.Prerequisites)
	}
	byVerb := map[model.OrgRBACVerb]model.OrgRBACPrerequisite{}
	for _, prereq := range resolution.Prerequisites {
		byVerb[prereq.Verb] = prereq
	}
	requireRecipientUser(t, byVerb[model.OrgRBACVerbView].Recipients, legalDirectorID)
	requireRecipientUser(t, byVerb[model.OrgRBACVerbApprove].Recipients, departmentManagerID)
	requireRecipientUser(t, byVerb[model.OrgRBACVerbApprove].Recipients, generalCounselID)
	requireRecipientUser(t, byVerb[model.OrgRBACVerbClose].Recipients, legalDirectorID)

	defaults, err := svc.ResolveOrgRBACPrerequisites(ctx, tenantID, sectionID, nil)
	if err != nil {
		t.Fatalf("ResolveOrgRBACPrerequisites(defaults) error = %v", err)
	}
	if len(defaults.Prerequisites) != 5 {
		t.Fatalf("default prerequisites len = %d, want 5", len(defaults.Prerequisites))
	}

	_, err = svc.ResolveOrgRBACPrerequisites(ctx, tenantID, sectionID, []model.OrgRBACVerb{model.OrgRBACVerb("publish")})
	requireAppField(t, err, "verbs", "invalid")
}

func TestOrgEntityValidation(t *testing.T) {
	if err := validateOrgEntityCreate(dto.CreateOrgEntityRequest{Code: "A", EntityType: model.OrgEntityTypeDepartment}); err == nil {
		t.Fatal("validateOrgEntityCreate() error = nil, want missing name")
	} else {
		requireAppField(t, err, "name", "required")
	}

	err := validateOrgEntityCreate(dto.CreateOrgEntityRequest{
		Code:       "A",
		EntityType: model.OrgEntityType("invalid"),
		Name:       forms.LocalizedText{EN: "Legal"},
	})
	requireAppField(t, err, "entity_type", "invalid")

	err = validateOrgRole(dto.OrgRoleRequest{RoleKey: model.OrgRoleLegalDirector})
	requireAppField(t, err, "user_id", "required")
}

func requireRecipientUser(t *testing.T, recipients []model.AddressableRoleRecipient, userID uuid.UUID) {
	t.Helper()
	for _, recipient := range recipients {
		if recipient.UserID == userID {
			return
		}
	}
	t.Fatalf("recipient user %s not found in %#v", userID, recipients)
}

func requireAddressableRecipients(t *testing.T, got []model.AddressableRoleRecipient, want []struct {
	roleKey  model.OrgRoleKey
	userID   uuid.UUID
	entityID uuid.UUID
}) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("recipients len = %d, want %d: %#v", len(got), len(want), got)
	}
	for i, wantRecipient := range want {
		if got[i].RoleKey != wantRecipient.roleKey || got[i].UserID != wantRecipient.userID || got[i].EntityID != wantRecipient.entityID {
			t.Fatalf("recipient[%d] = %+v, want role=%s user=%s entity=%s", i, got[i], wantRecipient.roleKey, wantRecipient.userID, wantRecipient.entityID)
		}
	}
}

func requireAppField(t *testing.T, err error, field, value string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want field %s=%s", field, value)
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields[field] != value {
		t.Fatalf("field %s = %q, want %q; fields=%#v", field, appErr.Fields[field], value, appErr.Fields)
	}
}

func fakeEntity(tenantID, id uuid.UUID, code string, pathIDs []uuid.UUID) model.OrgEntity {
	path := make([]string, 0, len(pathIDs))
	for _, pathID := range pathIDs {
		path = append(path, pathID.String())
	}
	return model.OrgEntity{
		ID:         id,
		TenantID:   tenantID,
		EntityType: model.OrgEntityTypeDepartment,
		Code:       code,
		Name:       forms.LocalizedText{EN: code},
		Path:       path,
		Active:     true,
		Metadata:   map[string]any{},
	}
}

func fakeRole(tenantID, entityID uuid.UUID, roleKey model.OrgRoleKey, userID uuid.UUID, label string) model.OrgRole {
	return model.OrgRole{
		ID:       uuid.New(),
		TenantID: tenantID,
		EntityID: entityID,
		RoleKey:  roleKey,
		UserID:   userID,
		Label:    forms.LocalizedText{EN: label},
	}
}

type fakeOrgEntityStore struct {
	entities    map[uuid.UUID]model.OrgEntity
	roles       map[uuid.UUID]map[model.OrgRoleKey]model.OrgRole
	memberships []model.OrgMembership
}

func newFakeOrgEntityStore(entities ...model.OrgEntity) *fakeOrgEntityStore {
	store := &fakeOrgEntityStore{
		entities: make(map[uuid.UUID]model.OrgEntity, len(entities)),
		roles:    map[uuid.UUID]map[model.OrgRoleKey]model.OrgRole{},
	}
	for _, entity := range entities {
		store.entities[entity.ID] = entity
	}
	return store
}

func (f *fakeOrgEntityStore) addRole(role model.OrgRole) {
	if f.roles[role.EntityID] == nil {
		f.roles[role.EntityID] = map[model.OrgRoleKey]model.OrgRole{}
	}
	f.roles[role.EntityID][role.RoleKey] = role
}

func (f *fakeOrgEntityStore) Create(context.Context, repository.Queryer, *model.OrgEntity) error {
	panic("unexpected Create call")
}

func (f *fakeOrgEntityStore) Update(context.Context, repository.Queryer, *model.OrgEntity) error {
	panic("unexpected Update call")
}

func (f *fakeOrgEntityStore) RepathDescendants(context.Context, repository.Queryer, uuid.UUID, uuid.UUID, []string) error {
	panic("unexpected RepathDescendants call")
}

func (f *fakeOrgEntityStore) Get(_ context.Context, tenantID, id uuid.UUID) (*model.OrgEntity, error) {
	entity, ok := f.entities[id]
	if !ok || entity.TenantID != tenantID {
		return nil, pgx.ErrNoRows
	}
	return &entity, nil
}

func (f *fakeOrgEntityStore) GetByCode(_ context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error) {
	for _, entity := range f.entities {
		if entity.TenantID == tenantID && entity.Code == code {
			return &entity, nil
		}
	}
	return nil, pgx.ErrNoRows
}

func (f *fakeOrgEntityStore) List(context.Context, uuid.UUID, model.OrgEntityListFilters) ([]model.OrgEntity, int, error) {
	panic("unexpected List call")
}

func (f *fakeOrgEntityStore) ListAllWith(_ context.Context, _ repository.Queryer, tenantID uuid.UUID) ([]model.OrgEntity, error) {
	entities := make([]model.OrgEntity, 0, len(f.entities))
	for _, entity := range f.entities {
		if entity.TenantID == tenantID {
			entities = append(entities, entity)
		}
	}
	return entities, nil
}

func (f *fakeOrgEntityStore) ListAllForAudit(context.Context, uuid.UUID) ([]model.OrgEntity, error) {
	panic("unexpected ListAllForAudit call")
}

func (f *fakeOrgEntityStore) ListPlatformOrgUnitRefs(context.Context, uuid.UUID) ([]model.PlatformOrgUnit, error) {
	panic("unexpected ListPlatformOrgUnitRefs call")
}

func (f *fakeOrgEntityStore) SoftDelete(context.Context, uuid.UUID, uuid.UUID) error {
	panic("unexpected SoftDelete call")
}

func (f *fakeOrgEntityStore) SoftDeleteWith(context.Context, repository.Queryer, uuid.UUID, uuid.UUID) error {
	panic("unexpected SoftDeleteWith call")
}

func (f *fakeOrgEntityStore) HasChildren(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	panic("unexpected HasChildren call")
}

func (f *fakeOrgEntityStore) Ancestors(_ context.Context, tenantID, id uuid.UUID) ([]model.OrgEntity, error) {
	entity, ok := f.entities[id]
	if !ok || entity.TenantID != tenantID {
		return nil, pgx.ErrNoRows
	}
	ancestors := make([]model.OrgEntity, 0, len(entity.Path)+1)
	for _, rawID := range entity.Path {
		ancestorID, err := uuid.Parse(rawID)
		if err != nil {
			return nil, fmt.Errorf("parse path id: %w", err)
		}
		ancestor, ok := f.entities[ancestorID]
		if !ok || ancestor.TenantID != tenantID {
			return nil, fmt.Errorf("missing path ancestor %s", ancestorID)
		}
		ancestors = append(ancestors, ancestor)
	}
	ancestors = append(ancestors, entity)
	return ancestors, nil
}

func (f *fakeOrgEntityStore) UpsertRole(context.Context, repository.Queryer, *model.OrgRole) error {
	panic("unexpected UpsertRole call")
}

func (f *fakeOrgEntityStore) ListActiveMemberships(_ context.Context, tenantID, entityID uuid.UUID) ([]model.OrgMembership, error) {
	memberships := make([]model.OrgMembership, 0)
	for _, membership := range f.memberships {
		if membership.TenantID == tenantID && membership.EntityID == entityID && membership.Active {
			memberships = append(memberships, membership)
		}
	}
	return memberships, nil
}

func (f *fakeOrgEntityStore) DeleteRole(context.Context, uuid.UUID, uuid.UUID, model.OrgRoleKey) error {
	panic("unexpected DeleteRole call")
}

func (f *fakeOrgEntityStore) ListRoles(_ context.Context, tenantID, entityID uuid.UUID) ([]model.OrgRole, error) {
	entityRoles := f.roles[entityID]
	roles := make([]model.OrgRole, 0, len(entityRoles))
	for _, role := range entityRoles {
		if role.TenantID == tenantID {
			roles = append(roles, role)
		}
	}
	return roles, nil
}

func (f *fakeOrgEntityStore) RoleForEntities(_ context.Context, tenantID uuid.UUID, roleKey model.OrgRoleKey, entityIDs []uuid.UUID) (*model.OrgRole, error) {
	for _, entityID := range entityIDs {
		role, ok := f.roles[entityID][roleKey]
		if ok && role.TenantID == tenantID {
			return &role, nil
		}
	}
	return nil, pgx.ErrNoRows
}

func (f *fakeOrgEntityStore) CreateImportJob(context.Context, *model.OrgImportJob, any) error {
	panic("unexpected CreateImportJob call")
}

func (f *fakeOrgEntityStore) ListImportJobs(context.Context, uuid.UUID, int) ([]model.OrgImportJob, error) {
	panic("unexpected ListImportJobs call")
}

func (f *fakeOrgEntityStore) GetImportJob(context.Context, uuid.UUID, uuid.UUID) (*model.OrgImportJob, error) {
	panic("unexpected GetImportJob call")
}
