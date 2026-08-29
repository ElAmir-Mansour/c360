package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedOrgEntityTypes = map[model.OrgEntityType]struct{}{
	model.OrgEntityTypeBusinessUnit:       {},
	model.OrgEntityTypeCompany:            {},
	model.OrgEntityTypeDepartment:         {},
	model.OrgEntityTypeSection:            {},
	model.OrgEntityTypeSharedServicesUnit: {},
}

var allowedOrgRoleKeys = map[model.OrgRoleKey]struct{}{
	model.OrgRoleSectionSupervisor:     {},
	model.OrgRoleDepartmentManager:     {},
	model.OrgRoleSharedServicesManager: {},
	model.OrgRoleLegalDirector:         {},
	model.OrgRoleContractsManager:      {},
	model.OrgRoleComplianceOfficer:     {},
	model.OrgRoleGeneralCounsel:        {},
}

var escalationOrgRoleRungs = []struct {
	level   int
	roleKey model.OrgRoleKey
}{
	{1, model.OrgRoleSectionSupervisor},
	{2, model.OrgRoleDepartmentManager},
	{3, model.OrgRoleSharedServicesManager},
}

var defaultAddressableOrgRoleKeys = []model.OrgRoleKey{
	model.OrgRoleLegalDirector,
	model.OrgRoleContractsManager,
	model.OrgRoleComplianceOfficer,
	model.OrgRoleGeneralCounsel,
}

var defaultOrgRBACVerbs = []model.OrgRBACVerb{
	model.OrgRBACVerbView,
	model.OrgRBACVerbAdd,
	model.OrgRBACVerbEdit,
	model.OrgRBACVerbApprove,
	model.OrgRBACVerbClose,
}

var orgRBACPrerequisiteRoleKeys = map[model.OrgRBACVerb][]model.OrgRoleKey{
	model.OrgRBACVerbView: {
		model.OrgRoleSectionSupervisor,
		model.OrgRoleDepartmentManager,
		model.OrgRoleSharedServicesManager,
		model.OrgRoleLegalDirector,
		model.OrgRoleContractsManager,
		model.OrgRoleComplianceOfficer,
		model.OrgRoleGeneralCounsel,
	},
	model.OrgRBACVerbAdd: {
		model.OrgRoleSectionSupervisor,
		model.OrgRoleDepartmentManager,
		model.OrgRoleLegalDirector,
		model.OrgRoleContractsManager,
		model.OrgRoleComplianceOfficer,
	},
	model.OrgRBACVerbEdit: {
		model.OrgRoleSectionSupervisor,
		model.OrgRoleDepartmentManager,
		model.OrgRoleLegalDirector,
		model.OrgRoleContractsManager,
		model.OrgRoleComplianceOfficer,
	},
	model.OrgRBACVerbApprove: {
		model.OrgRoleDepartmentManager,
		model.OrgRoleSharedServicesManager,
		model.OrgRoleLegalDirector,
		model.OrgRoleGeneralCounsel,
	},
	model.OrgRBACVerbClose: {
		model.OrgRoleSharedServicesManager,
		model.OrgRoleLegalDirector,
		model.OrgRoleGeneralCounsel,
	},
}

type orgEntityStore interface {
	Create(ctx context.Context, q repository.Queryer, entity *model.OrgEntity) error
	Update(ctx context.Context, q repository.Queryer, entity *model.OrgEntity) error
	RepathDescendants(ctx context.Context, q repository.Queryer, tenantID, id uuid.UUID, newSelfPath []string) error
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgEntity, error)
	GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error)
	List(ctx context.Context, tenantID uuid.UUID, filters model.OrgEntityListFilters) ([]model.OrgEntity, int, error)
	ListAllForAudit(ctx context.Context, tenantID uuid.UUID) ([]model.OrgEntity, error)
	ListPlatformOrgUnitRefs(ctx context.Context, tenantID uuid.UUID) ([]model.PlatformOrgUnit, error)
	SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error
	HasChildren(ctx context.Context, tenantID, id uuid.UUID) (bool, error)
	Ancestors(ctx context.Context, tenantID, id uuid.UUID) ([]model.OrgEntity, error)
	UpsertRole(ctx context.Context, q repository.Queryer, role *model.OrgRole) error
	ListActiveMemberships(ctx context.Context, tenantID, entityID uuid.UUID) ([]model.OrgMembership, error)
	DeleteRole(ctx context.Context, tenantID, entityID uuid.UUID, roleKey model.OrgRoleKey) error
	ListRoles(ctx context.Context, tenantID, entityID uuid.UUID) ([]model.OrgRole, error)
	RoleForEntities(ctx context.Context, tenantID uuid.UUID, roleKey model.OrgRoleKey, entityIDs []uuid.UUID) (*model.OrgRole, error)
}

// OrgEntityService owns the legal-org master-data registry. It maintains the
// materialized ancestry path on writes and exposes ResolveEscalationRecipients
// (CAP-019) plus code lookup (CAP-153) that unblock SLA escalation, eligibility
// and distribution.
type OrgEntityService struct {
	db        *pgxpool.Pool
	entities  orgEntityStore
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewOrgEntityService(db *pgxpool.Pool, entities *repository.OrgEntityRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *OrgEntityService {
	return &OrgEntityService{
		db:        db,
		entities:  entities,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-org-entities").Logger(),
		now:       time.Now,
	}
}

func (s *OrgEntityService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateOrgEntityRequest) (*model.OrgEntity, error) {
	req.Normalize()
	if err := validateOrgEntityCreate(req); err != nil {
		return nil, err
	}
	path, parentID, err := s.resolvePath(ctx, tenantID, req.ParentID, uuid.Nil)
	if err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	entity := &model.OrgEntity{
		ID:                uuid.New(),
		TenantID:          tenantID,
		ParentID:          parentID,
		EntityType:        req.EntityType,
		Code:              req.Code,
		Name:              req.Name,
		PlatformOrgUnitID: req.PlatformOrgUnitID,
		Path:              path,
		Active:            active,
		Metadata:          req.Metadata,
		CreatedBy:         userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start org entity transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.entities.Create(ctx, tx, entity); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an org entity with this code already exists")
		}
		return nil, internalError("create org entity", err)
	}
	for _, roleReq := range req.Roles {
		if err := validateOrgRole(roleReq); err != nil {
			return nil, err
		}
		role := &model.OrgRole{
			ID:        uuid.New(),
			TenantID:  tenantID,
			EntityID:  entity.ID,
			RoleKey:   roleReq.RoleKey,
			UserID:    roleReq.UserID,
			Label:     roleReq.Label,
			CreatedBy: userID,
		}
		if err := s.entities.UpsertRole(ctx, tx, role); err != nil {
			return nil, internalError("create org role", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit org entity create", err)
	}
	entity.Roles, _ = s.entities.ListRoles(ctx, tenantID, entity.ID)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_entity.created", tenantID, &userID, map[string]any{
		"id":          entity.ID,
		"code":        entity.Code,
		"entity_type": entity.EntityType,
		"parent_id":   entity.ParentID,
	}, s.logger)
	return s.Get(ctx, tenantID, entity.ID)
}

func (s *OrgEntityService) List(ctx context.Context, tenantID uuid.UUID, filters model.OrgEntityListFilters) ([]model.OrgEntity, int, error) {
	return s.entities.List(ctx, tenantID, filters)
}

// ListEntityAudit returns the activity timeline for a single org entity,
// newest-first. The registry has no dedicated audit table, so events are
// synthesized from the entity's own row metadata (created / updated). See
// model.OrgEntityAuditEvent for the contract and its limitations.
func (s *OrgEntityService) ListEntityAudit(ctx context.Context, tenantID, id uuid.UUID) ([]model.OrgEntityAuditEvent, error) {
	entity, err := s.entities.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity", err)
	}
	events := synthesizeOrgEntityEvents(*entity)
	sortOrgEntityEventsNewestFirst(events)
	return events, nil
}

// ListAudit returns the tenant-wide org-entity activity timeline, newest-first
// and paginated. Events are synthesized from each entity's row metadata (see
// ListEntityAudit). Total is the count of synthesized events, not of entities.
func (s *OrgEntityService) ListAudit(ctx context.Context, tenantID uuid.UUID, filters model.OrgEntityAuditFilters) ([]model.OrgEntityAuditEvent, int, error) {
	entities, err := s.entities.ListAllForAudit(ctx, tenantID)
	if err != nil {
		return nil, 0, internalError("load org entities for audit", err)
	}
	events := make([]model.OrgEntityAuditEvent, 0, len(entities)*2)
	for _, entity := range entities {
		events = append(events, synthesizeOrgEntityEvents(entity)...)
	}
	sortOrgEntityEventsNewestFirst(events)
	total := len(events)
	page, perPage := normalizeOrgAuditPage(filters.Page, filters.PerPage)
	start := (page - 1) * perPage
	if start >= total {
		return []model.OrgEntityAuditEvent{}, total, nil
	}
	end := start + perPage
	if end > total {
		end = total
	}
	return events[start:end], total, nil
}

// ListPlatformUnits returns the platform_core org-units this tenant references
// for reconciliation. LIMITATION: lex cannot read platform_core org-units
// directly (no cross-service seam), so this returns the DISTINCT platform unit
// ids the registry already links to, named/coded by the linking legal entity.
// It is honest and useful for orphaned-link detection but is NOT the full
// platform org-unit catalog.
func (s *OrgEntityService) ListPlatformUnits(ctx context.Context, tenantID uuid.UUID) ([]model.PlatformOrgUnit, error) {
	units, err := s.entities.ListPlatformOrgUnitRefs(ctx, tenantID)
	if err != nil {
		return nil, internalError("load platform org units", err)
	}
	return units, nil
}

// synthesizeOrgEntityEvents derives timeline events from one entity row: a
// "created" event from created_by/created_at, and (when updated_at is materially
// later than created_at) an "updated" event. Event ids are deterministic per
// (entity, action) so repeated reads return stable identifiers.
func synthesizeOrgEntityEvents(entity model.OrgEntity) []model.OrgEntityAuditEvent {
	code := entity.Code
	out := make([]model.OrgEntityAuditEvent, 0, 2)
	out = append(out, model.OrgEntityAuditEvent{
		ID:         orgEntityEventID(entity.ID, "created"),
		At:         entity.CreatedAt.UTC(),
		Actor:      entity.CreatedBy,
		Action:     "created",
		EntityID:   entity.ID,
		EntityCode: code,
		Summary:    fmt.Sprintf("تم إنشاء الوحدة التنظيمية %s", code),
	})
	if entity.DeletedAt != nil {
		out = append(out, model.OrgEntityAuditEvent{
			ID:         orgEntityEventID(entity.ID, "deleted"),
			At:         entity.DeletedAt.UTC(),
			Actor:      entity.CreatedBy,
			Action:     "deleted",
			EntityID:   entity.ID,
			EntityCode: code,
			Summary:    fmt.Sprintf("تم حذف الوحدة التنظيمية %s", code),
		})
	} else if entity.UpdatedAt.After(entity.CreatedAt.Add(time.Second)) {
		out = append(out, model.OrgEntityAuditEvent{
			ID:         orgEntityEventID(entity.ID, "updated"),
			At:         entity.UpdatedAt.UTC(),
			Actor:      entity.CreatedBy,
			Action:     "updated",
			EntityID:   entity.ID,
			EntityCode: code,
			Summary:    fmt.Sprintf("تم تحديث الوحدة التنظيمية %s", code),
		})
	}
	return out
}

func sortOrgEntityEventsNewestFirst(events []model.OrgEntityAuditEvent) {
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].At.Equal(events[j].At) {
			return events[i].ID.String() > events[j].ID.String()
		}
		return events[i].At.After(events[j].At)
	})
}

func orgEntityEventID(entityID uuid.UUID, action string) uuid.UUID {
	return uuid.NewSHA1(entityID, []byte(action))
}

func normalizeOrgAuditPage(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	return page, perPage
}

func (s *OrgEntityService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgEntity, error) {
	entity, err := s.entities.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity", err)
	}
	roles, err := s.entities.ListRoles(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load org roles", err)
	}
	entity.Roles = roles
	return entity, nil
}

func (s *OrgEntityService) GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, validationError("code is required", map[string]string{"code": "required"})
	}
	entity, err := s.entities.GetByCode(ctx, tenantID, code)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity by code", err)
	}
	roles, err := s.entities.ListRoles(ctx, tenantID, entity.ID)
	if err != nil {
		return nil, internalError("load org roles", err)
	}
	entity.Roles = roles
	return entity, nil
}

// ListActiveMemberships exposes the employee directory scoped to one legal-org
// entity. It first proves that the entity belongs to the requesting tenant, then
// returns only active/non-deleted membership rows from the repository.
func (s *OrgEntityService) ListActiveMemberships(ctx context.Context, tenantID, entityID uuid.UUID) ([]model.OrgMembership, error) {
	if _, err := s.entities.Get(ctx, tenantID, entityID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity", err)
	}
	memberships, err := s.entities.ListActiveMemberships(ctx, tenantID, entityID)
	if err != nil {
		return nil, internalError("load org entity memberships", err)
	}
	if memberships == nil {
		memberships = []model.OrgMembership{}
	}
	return memberships, nil
}

func (s *OrgEntityService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateOrgEntityRequest) (*model.OrgEntity, error) {
	req.Normalize()
	entity, err := s.entities.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity", err)
	}
	reparent := false
	if req.ParentID != nil {
		if *req.ParentID == id {
			return nil, validationError("an org entity cannot be its own parent", map[string]string{"parent_id": "invalid"})
		}
		if entity.ParentID == nil || *entity.ParentID != *req.ParentID {
			reparent = true
		}
	}
	applyOrgEntityUpdate(entity, req)
	if reparent {
		path, parentID, err := s.resolvePath(ctx, tenantID, req.ParentID, id)
		if err != nil {
			return nil, err
		}
		entity.Path = path
		entity.ParentID = parentID
	}
	if err := validateOrgEntity(entity); err != nil {
		return nil, err
	}
	if reparent {
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return nil, internalError("start org entity reparent transaction", err)
		}
		defer tx.Rollback(ctx)
		if err := s.entities.Update(ctx, tx, entity); err != nil {
			if isUniqueViolation(err) {
				return nil, conflictError("an org entity with this code already exists")
			}
			if err == pgx.ErrNoRows {
				return nil, notFoundError("org entity not found")
			}
			return nil, internalError("update org entity", err)
		}
		if err := s.entities.RepathDescendants(ctx, tx, tenantID, id, appendSelfToPath(entity.Path, id)); err != nil {
			return nil, internalError("repath org entity descendants", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError("commit org entity reparent", err)
		}
	} else {
		if err := s.entities.Update(ctx, s.db, entity); err != nil {
			if isUniqueViolation(err) {
				return nil, conflictError("an org entity with this code already exists")
			}
			if err == pgx.ErrNoRows {
				return nil, notFoundError("org entity not found")
			}
			return nil, internalError("update org entity", err)
		}
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_entity.updated", tenantID, &userID, map[string]any{
		"id":   entity.ID,
		"code": entity.Code,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *OrgEntityService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	hasChildren, err := s.entities.HasChildren(ctx, tenantID, id)
	if err != nil {
		return internalError("check org entity children", err)
	}
	if hasChildren {
		return conflictError("cannot delete an org entity that still has child entities")
	}
	if err := s.entities.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("org entity not found")
		}
		return internalError("delete org entity", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_entity.deleted", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return nil
}

func (s *OrgEntityService) AssignRole(ctx context.Context, tenantID, userID, entityID uuid.UUID, req dto.OrgRoleRequest) (*model.OrgEntity, error) {
	req.Normalize()
	if err := validateOrgRole(req); err != nil {
		return nil, err
	}
	if _, err := s.entities.Get(ctx, tenantID, entityID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("org entity not found")
		}
		return nil, internalError("load org entity", err)
	}
	role := &model.OrgRole{
		ID:        uuid.New(),
		TenantID:  tenantID,
		EntityID:  entityID,
		RoleKey:   req.RoleKey,
		UserID:    req.UserID,
		Label:     req.Label,
		CreatedBy: userID,
	}
	if err := s.entities.UpsertRole(ctx, s.db, role); err != nil {
		return nil, internalError("assign org role", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_entity.role_assigned", tenantID, &userID, map[string]any{
		"id":       entityID,
		"role_key": req.RoleKey,
		"user_id":  req.UserID,
	}, s.logger)
	return s.Get(ctx, tenantID, entityID)
}

func (s *OrgEntityService) RemoveRole(ctx context.Context, tenantID, userID, entityID uuid.UUID, roleKey model.OrgRoleKey) error {
	if _, ok := allowedOrgRoleKeys[roleKey]; !ok {
		return validationError("invalid role key", map[string]string{"role_key": "invalid"})
	}
	if err := s.entities.DeleteRole(ctx, tenantID, entityID, roleKey); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("org role not found")
		}
		return internalError("remove org role", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_entity.role_removed", tenantID, &userID, map[string]any{
		"id":       entityID,
		"role_key": roleKey,
	}, s.logger)
	return nil
}

// ResolveEscalationRecipients walks the ancestry of entityID leaf → root and
// resolves the L1/L2/L3 escalation ladder (CAP-019): L1 section supervisor,
// L2 department manager, L3 shared-services manager. Each rung is filled by the
// nearest ancestor (or the entity itself) that carries the matching role
// binding; rungs without coverage are omitted so the SLA engine can flag gaps.
func (s *OrgEntityService) ResolveEscalationRecipients(ctx context.Context, tenantID, entityID uuid.UUID) (*model.EscalationLadder, error) {
	entity, ordered, index, err := s.resolveEntityAncestry(ctx, tenantID, entityID)
	if err != nil {
		return nil, err
	}

	ladder := &model.EscalationLadder{
		EntityID:   entity.ID,
		EntityCode: entity.Code,
		EntityName: entity.Name,
		ResolvedAt: s.now().UTC(),
		Recipients: make([]model.EscalationRecipient, 0, 3),
	}
	for _, rung := range escalationOrgRoleRungs {
		recipient, err := s.resolveNearestRoleRecipient(ctx, tenantID, rung.roleKey, ordered, index)
		if err != nil {
			return nil, err
		}
		if recipient == nil {
			continue
		}
		ladder.Recipients = append(ladder.Recipients, model.EscalationRecipient{
			Level:      rung.level,
			RoleKey:    rung.roleKey,
			UserID:     recipient.UserID,
			Label:      recipient.Label,
			EntityID:   recipient.EntityID,
			EntityCode: recipient.EntityCode,
			EntityName: recipient.EntityName,
		})
	}
	return ladder, nil
}

// ResolveDefaultAddressableRoleRecipients resolves the distribution-oriented
// role keys (legal director, contracts manager, compliance officer and general
// counsel) from the nearest entity in the ancestry path.
func (s *OrgEntityService) ResolveDefaultAddressableRoleRecipients(ctx context.Context, tenantID, entityID uuid.UUID) (*model.AddressableRoleResolution, error) {
	return s.ResolveAddressableRoleRecipients(ctx, tenantID, entityID, append([]model.OrgRoleKey(nil), defaultAddressableOrgRoleKeys...))
}

// ResolveAddressableRoleRecipients resolves each requested role key from
// entityID leaf → root. Missing role coverage is omitted from the result.
func (s *OrgEntityService) ResolveAddressableRoleRecipients(ctx context.Context, tenantID, entityID uuid.UUID, roleKeys []model.OrgRoleKey) (*model.AddressableRoleResolution, error) {
	roleKeys, err := normalizeOrgRoleKeys(roleKeys)
	if err != nil {
		return nil, err
	}
	entity, ordered, index, err := s.resolveEntityAncestry(ctx, tenantID, entityID)
	if err != nil {
		return nil, err
	}
	resolution := &model.AddressableRoleResolution{
		EntityID:   entity.ID,
		EntityCode: entity.Code,
		EntityName: entity.Name,
		ResolvedAt: s.now().UTC(),
		Recipients: make([]model.AddressableRoleRecipient, 0, len(roleKeys)),
	}
	for _, roleKey := range roleKeys {
		recipient, err := s.resolveNearestRoleRecipient(ctx, tenantID, roleKey, ordered, index)
		if err != nil {
			return nil, err
		}
		if recipient == nil {
			continue
		}
		resolution.Recipients = append(resolution.Recipients, *recipient)
	}
	return resolution, nil
}

// ResolveAddressableRoleRecipient resolves one requested role key from entityID
// leaf → root. A nil recipient with nil error means the role has no binding in
// the entity's ancestry.
func (s *OrgEntityService) ResolveAddressableRoleRecipient(ctx context.Context, tenantID, entityID uuid.UUID, roleKey model.OrgRoleKey) (*model.AddressableRoleRecipient, error) {
	resolution, err := s.ResolveAddressableRoleRecipients(ctx, tenantID, entityID, []model.OrgRoleKey{roleKey})
	if err != nil {
		return nil, err
	}
	if len(resolution.Recipients) == 0 {
		return nil, nil
	}
	recipient := resolution.Recipients[0]
	return &recipient, nil
}

// ResolveOrgRBACPrerequisites resolves the CAP-153 five-verb org-RBAC
// prerequisites for an entity. It deliberately returns role bindings, not an
// allow/deny verdict: the RBAC middleware owns enforcement and can consume this
// registry output without hard-coding org role ladders.
func (s *OrgEntityService) ResolveOrgRBACPrerequisites(ctx context.Context, tenantID, entityID uuid.UUID, verbs []model.OrgRBACVerb) (*model.OrgRBACPrerequisiteResolution, error) {
	verbs, err := normalizeOrgRBACVerbs(verbs)
	if err != nil {
		return nil, err
	}
	entity, ordered, index, err := s.resolveEntityAncestry(ctx, tenantID, entityID)
	if err != nil {
		return nil, err
	}
	resolution := &model.OrgRBACPrerequisiteResolution{
		EntityID:      entity.ID,
		EntityCode:    entity.Code,
		EntityName:    entity.Name,
		ResolvedAt:    s.now().UTC(),
		Prerequisites: make([]model.OrgRBACPrerequisite, 0, len(verbs)),
	}
	for _, verb := range verbs {
		roleKeys := orgRBACPrerequisiteRoleKeys[verb]
		prereq := model.OrgRBACPrerequisite{
			Verb:       verb,
			RoleKeys:   append([]model.OrgRoleKey(nil), roleKeys...),
			Recipients: []model.AddressableRoleRecipient{},
		}
		for _, roleKey := range roleKeys {
			recipient, err := s.resolveNearestRoleRecipient(ctx, tenantID, roleKey, ordered, index)
			if err != nil {
				return nil, err
			}
			if recipient != nil {
				prereq.Recipients = append(prereq.Recipients, *recipient)
			}
		}
		resolution.Prerequisites = append(resolution.Prerequisites, prereq)
	}
	return resolution, nil
}

func (s *OrgEntityService) resolveEntityAncestry(ctx context.Context, tenantID, entityID uuid.UUID) (*model.OrgEntity, []uuid.UUID, map[uuid.UUID]model.OrgEntity, error) {
	entity, err := s.entities.Get(ctx, tenantID, entityID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, nil, notFoundError("org entity not found")
		}
		return nil, nil, nil, internalError("load org entity", err)
	}
	ancestors, err := s.entities.Ancestors(ctx, tenantID, entityID)
	if err != nil {
		return nil, nil, nil, internalError("load org entity ancestors", err)
	}
	// Walk leaf -> root: reverse the root-first ancestor ordering.
	ordered := make([]uuid.UUID, 0, len(ancestors))
	index := make(map[uuid.UUID]model.OrgEntity, len(ancestors)+1)
	for _, ancestor := range ancestors {
		index[ancestor.ID] = ancestor
	}
	for i := len(ancestors) - 1; i >= 0; i-- {
		ordered = append(ordered, ancestors[i].ID)
	}
	if len(ordered) == 0 {
		ordered = append(ordered, entityID)
	}
	index[entityID] = *entity
	return entity, ordered, index, nil
}

func (s *OrgEntityService) resolveNearestRoleRecipient(ctx context.Context, tenantID uuid.UUID, roleKey model.OrgRoleKey, ordered []uuid.UUID, index map[uuid.UUID]model.OrgEntity) (*model.AddressableRoleRecipient, error) {
	role, err := s.entities.RoleForEntities(ctx, tenantID, roleKey, ordered)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, internalError("resolve org role recipient", err)
	}
	source, ok := index[role.EntityID]
	if !ok {
		return nil, internalError("resolve org role source", fmt.Errorf("role %s came from entity %s outside ancestry", role.RoleKey, role.EntityID))
	}
	return &model.AddressableRoleRecipient{
		RoleKey:    role.RoleKey,
		UserID:     role.UserID,
		Label:      role.Label,
		EntityID:   role.EntityID,
		EntityCode: source.Code,
		EntityName: source.Name,
	}, nil
}

// resolvePath materializes the ancestry path for a node whose parent is
// parentID. selfID (uuid.Nil on create) guards against a node parenting itself
// or one of its descendants.
func (s *OrgEntityService) resolvePath(ctx context.Context, tenantID uuid.UUID, parentID *uuid.UUID, selfID uuid.UUID) ([]string, *uuid.UUID, error) {
	if parentID == nil || *parentID == uuid.Nil {
		return []string{}, nil, nil
	}
	parent, err := s.entities.Get(ctx, tenantID, *parentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, validationError("parent org entity not found", map[string]string{"parent_id": "not found"})
		}
		return nil, nil, internalError("load parent org entity", err)
	}
	if selfID != uuid.Nil {
		if parent.ID == selfID {
			return nil, nil, validationError("an org entity cannot be its own parent", map[string]string{"parent_id": "invalid"})
		}
		for _, ancestor := range parent.Path {
			if ancestor == selfID.String() {
				return nil, nil, validationError("an org entity cannot be parented to one of its descendants", map[string]string{"parent_id": "cycle"})
			}
		}
	}
	path := make([]string, 0, len(parent.Path)+1)
	path = append(path, parent.Path...)
	path = append(path, parent.ID.String())
	pid := parent.ID
	return path, &pid, nil
}

func normalizeOrgRoleKeys(roleKeys []model.OrgRoleKey) ([]model.OrgRoleKey, error) {
	if len(roleKeys) == 0 {
		return nil, validationError("at least one role key is required", map[string]string{"role_keys": "required"})
	}
	normalized := make([]model.OrgRoleKey, 0, len(roleKeys))
	seen := make(map[model.OrgRoleKey]struct{}, len(roleKeys))
	for _, roleKey := range roleKeys {
		roleKey = model.OrgRoleKey(strings.TrimSpace(string(roleKey)))
		if _, ok := allowedOrgRoleKeys[roleKey]; !ok {
			return nil, validationError("invalid role key", map[string]string{"role_keys": "invalid"})
		}
		if _, ok := seen[roleKey]; ok {
			continue
		}
		seen[roleKey] = struct{}{}
		normalized = append(normalized, roleKey)
	}
	return normalized, nil
}

func normalizeOrgRBACVerbs(verbs []model.OrgRBACVerb) ([]model.OrgRBACVerb, error) {
	if len(verbs) == 0 {
		return append([]model.OrgRBACVerb(nil), defaultOrgRBACVerbs...), nil
	}
	normalized := make([]model.OrgRBACVerb, 0, len(verbs))
	seen := make(map[model.OrgRBACVerb]struct{}, len(verbs))
	for _, verb := range verbs {
		verb = model.OrgRBACVerb(strings.ToLower(strings.TrimSpace(string(verb))))
		if !verb.Valid() {
			return nil, validationError("invalid org RBAC verb", map[string]string{"verbs": "invalid"})
		}
		if _, ok := seen[verb]; ok {
			continue
		}
		seen[verb] = struct{}{}
		normalized = append(normalized, verb)
	}
	return normalized, nil
}

func appendSelfToPath(path []string, id uuid.UUID) []string {
	out := make([]string, 0, len(path)+1)
	out = append(out, path...)
	out = append(out, id.String())
	return out
}

func validateOrgEntityCreate(req dto.CreateOrgEntityRequest) error {
	if req.Code == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if req.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	if _, ok := allowedOrgEntityTypes[req.EntityType]; !ok {
		return validationError("invalid entity type", map[string]string{"entity_type": "invalid"})
	}
	return nil
}

func validateOrgEntity(entity *model.OrgEntity) error {
	if strings.TrimSpace(entity.Code) == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if entity.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	if _, ok := allowedOrgEntityTypes[entity.EntityType]; !ok {
		return validationError("invalid entity type", map[string]string{"entity_type": "invalid"})
	}
	return nil
}

func validateOrgRole(req dto.OrgRoleRequest) error {
	if _, ok := allowedOrgRoleKeys[req.RoleKey]; !ok {
		return validationError("invalid role key", map[string]string{"role_key": "invalid"})
	}
	if req.UserID == uuid.Nil {
		return validationError("user_id is required", map[string]string{"user_id": "required"})
	}
	return nil
}

func applyOrgEntityUpdate(entity *model.OrgEntity, req dto.UpdateOrgEntityRequest) {
	if req.EntityType != nil {
		entity.EntityType = *req.EntityType
	}
	if req.Code != nil {
		entity.Code = strings.ToUpper(strings.TrimSpace(*req.Code))
	}
	if req.Name != nil {
		entity.Name = *req.Name
	}
	if req.PlatformOrgUnitID != nil {
		entity.PlatformOrgUnitID = req.PlatformOrgUnitID
	}
	if req.Active != nil {
		entity.Active = *req.Active
	}
	if req.Metadata != nil {
		entity.Metadata = req.Metadata
	}
}
