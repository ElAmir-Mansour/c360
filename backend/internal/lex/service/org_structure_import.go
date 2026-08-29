package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type orgImportPlan struct {
	ordered     []dto.OrgStructureImportRow
	errors      []model.OrgImportRowError
	creates     int
	updates     int
	deactivates int
	roles       int
	employees   int
}

type orgImportStore interface {
	ListAllWith(ctx context.Context, q repository.Queryer, tenantID uuid.UUID) ([]model.OrgEntity, error)
	SoftDeleteWith(ctx context.Context, q repository.Queryer, tenantID, id uuid.UUID) error
	CreateImportJob(ctx context.Context, job *model.OrgImportJob, rows any) error
	ListImportJobs(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.OrgImportJob, error)
	GetImportJob(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgImportJob, error)
	UpsertMembership(ctx context.Context, q repository.Queryer, membership *model.OrgMembership) error
}

func (s *OrgEntityService) importStore() (orgImportStore, error) {
	store, ok := s.entities.(orgImportStore)
	if !ok {
		return nil, fmt.Errorf("org import persistence is not configured")
	}
	return store, nil
}

// ImportStructure validates the complete final graph and records an immutable
// job for both previews and applies. A non-dry-run with any row error performs
// no mutation. Successful applies are atomic under a tenant advisory lock.
func (s *OrgEntityService) ImportStructure(ctx context.Context, tenantID, userID uuid.UUID, req dto.OrgStructureImportRequest) (*model.OrgImportJob, error) {
	imports, err := s.importStore()
	if err != nil {
		return nil, internalError("initialize org import", err)
	}
	req.Normalize()
	job := &model.OrgImportJob{
		ID: uuid.New(), TenantID: tenantID, Mode: string(req.Mode), DryRun: req.DryRun,
		SourceFilename: req.SourceFilename, TotalRows: len(req.Rows), CreatedBy: userID,
	}

	if !validOrgImportMode(req.Mode) {
		job.Errors = []model.OrgImportRowError{{Field: "mode", CodeKey: "invalid_mode", Message: "mode must be create, update, merge, or replace"}}
		job.Status = "failed"
		if err := imports.CreateImportJob(ctx, job, req.Rows); err != nil {
			return nil, internalError("record org import", err)
		}
		return job, nil
	}
	if len(req.Rows) == 0 || len(req.Rows) > 10000 {
		job.Errors = []model.OrgImportRowError{{Field: "rows", CodeKey: "invalid_row_count", Message: "import must contain between 1 and 10000 rows"}}
		job.Status = "failed"
		if err := imports.CreateImportJob(ctx, job, req.Rows); err != nil {
			return nil, internalError("record org import", err)
		}
		return job, nil
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start org import transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set org import tenant context", err)
	}
	// Serialize imports for one tenant without blocking other tenants.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, tenantID.String()); err != nil {
		return nil, internalError("lock org import", err)
	}
	existing, err := imports.ListAllWith(ctx, tx, tenantID)
	if err != nil {
		return nil, internalError("load org registry for import", err)
	}
	plan := buildOrgImportPlan(req, existing)
	job.Errors = plan.errors
	job.CreateCount = plan.creates
	job.UpdateCount = plan.updates
	job.DeactivateCount = plan.deactivates
	job.RoleCount = plan.roles
	job.EmployeeCount = plan.employees

	if len(plan.errors) > 0 {
		job.Status = "failed"
		_ = tx.Rollback(ctx)
		if err := imports.CreateImportJob(ctx, job, req.Rows); err != nil {
			return nil, internalError("record failed org import", err)
		}
		return job, nil
	}
	if req.DryRun {
		job.Status = "validated"
		_ = tx.Rollback(ctx)
		if err := imports.CreateImportJob(ctx, job, req.Rows); err != nil {
			return nil, internalError("record org import preview", err)
		}
		return job, nil
	}

	byCode := make(map[string]*model.OrgEntity, len(existing)+len(plan.ordered))
	for i := range existing {
		byCode[existing[i].Code] = &existing[i]
	}
	for _, row := range plan.ordered {
		parentID, path := importedParent(byCode, row.ParentCode)
		active := true
		if row.Active != nil {
			active = *row.Active
		}
		entity := byCode[row.Code]
		if entity == nil {
			entity = &model.OrgEntity{
				ID: uuid.New(), TenantID: tenantID, Code: row.Code, EntityType: row.EntityType,
				Name: row.Name, ParentID: parentID, PlatformOrgUnitID: row.PlatformOrgUnitID,
				Path: path, Active: active, Metadata: row.Metadata, CreatedBy: userID,
			}
			if err := s.entities.Create(ctx, tx, entity); err != nil {
				return nil, internalError("create imported org entity", err)
			}
			byCode[row.Code] = entity
		} else {
			oldParent := entity.ParentID
			entity.EntityType, entity.Name, entity.ParentID = row.EntityType, row.Name, parentID
			entity.PlatformOrgUnitID, entity.Path, entity.Active, entity.Metadata = row.PlatformOrgUnitID, path, active, row.Metadata
			if err := s.entities.Update(ctx, tx, entity); err != nil {
				return nil, internalError("update imported org entity", err)
			}
			if !sameUUID(oldParent, parentID) {
				if err := s.entities.RepathDescendants(ctx, tx, tenantID, entity.ID, appendSelfToPath(path, entity.ID)); err != nil {
					return nil, internalError("repath imported org descendants", err)
				}
			}
		}
		roles := append([]dto.OrgRoleRequest(nil), row.Roles...)
		if row.ManagerUserID != nil {
			roles = append(roles, dto.OrgRoleRequest{RoleKey: managerRoleForType(row.EntityType), UserID: *row.ManagerUserID, Label: row.Name})
		}
		for _, roleReq := range roles {
			role := &model.OrgRole{ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, RoleKey: roleReq.RoleKey, UserID: roleReq.UserID, Label: roleReq.Label, CreatedBy: userID}
			if role.Label.IsEmpty() {
				role.Label = forms.LocalizedText{EN: string(role.RoleKey), AR: string(role.RoleKey)}
			}
			if err := s.entities.UpsertRole(ctx, tx, role); err != nil {
				return nil, internalError("assign imported org role", err)
			}
		}
		for _, employee := range row.Employees {
			active := true
			if employee.Active != nil {
				active = *employee.Active
			}
			membership := &model.OrgMembership{
				ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, UserID: employee.UserID,
				EmployeeCode: employee.EmployeeCode, Title: map[string]string{"en": employee.Title.EN, "ar": employee.Title.AR},
				ManagerUserID: employee.ManagerUserID, CapacityUnits: employee.CapacityUnits,
				Active: active, Metadata: employee.Metadata, CreatedBy: userID,
			}
			if err := imports.UpsertMembership(ctx, tx, membership); err != nil {
				return nil, internalError("map imported org employee", err)
			}
		}
	}
	if req.Mode == dto.OrgImportReplace {
		included := make(map[string]struct{}, len(req.Rows))
		for _, row := range req.Rows {
			included[row.Code] = struct{}{}
		}
		// deepest-first is friendlier to self-referential FK trees.
		sort.Slice(existing, func(i, j int) bool { return len(existing[i].Path) > len(existing[j].Path) })
		for _, entity := range existing {
			if _, keep := included[entity.Code]; keep {
				continue
			}
			if err := imports.SoftDeleteWith(ctx, tx, tenantID, entity.ID); err != nil {
				return nil, internalError("deactivate replaced org entity", err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit org import", err)
	}
	now := time.Now().UTC()
	job.Status, job.CompletedAt = "completed", &now
	if err := imports.CreateImportJob(ctx, job, req.Rows); err != nil {
		return nil, internalError("record completed org import", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.org_structure.imported", tenantID, &userID, map[string]any{
		"job_id": job.ID, "mode": job.Mode, "created": job.CreateCount, "updated": job.UpdateCount, "deactivated": job.DeactivateCount,
	}, s.logger)
	return job, nil
}

func (s *OrgEntityService) ListImportJobs(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.OrgImportJob, error) {
	imports, err := s.importStore()
	if err != nil {
		return nil, internalError("initialize org import", err)
	}
	jobs, err := imports.ListImportJobs(ctx, tenantID, limit)
	if err != nil {
		return nil, internalError("list org import jobs", err)
	}
	return jobs, nil
}

func (s *OrgEntityService) GetImportJob(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgImportJob, error) {
	imports, err := s.importStore()
	if err != nil {
		return nil, internalError("initialize org import", err)
	}
	job, err := imports.GetImportJob(ctx, tenantID, id)
	if err == pgx.ErrNoRows {
		return nil, notFoundError("org import job not found")
	}
	if err != nil {
		return nil, internalError("load org import job", err)
	}
	return job, nil
}

func validOrgImportMode(mode dto.OrgStructureImportMode) bool {
	switch mode {
	case dto.OrgImportCreate, dto.OrgImportUpdate, dto.OrgImportMerge, dto.OrgImportReplace:
		return true
	}
	return false
}

func buildOrgImportPlan(req dto.OrgStructureImportRequest, existing []model.OrgEntity) orgImportPlan {
	plan := orgImportPlan{errors: make([]model.OrgImportRowError, 0)}
	existingByCode := make(map[string]model.OrgEntity, len(existing))
	existingCodeByID := make(map[uuid.UUID]string, len(existing))
	for _, entity := range existing {
		existingByCode[entity.Code], existingCodeByID[entity.ID] = entity, entity.Code
	}
	rowsByCode := make(map[string]dto.OrgStructureImportRow, len(req.Rows))
	for _, row := range req.Rows {
		add := func(field, key, message string) {
			plan.errors = append(plan.errors, model.OrgImportRowError{Row: row.Row, Code: row.Code, Field: field, CodeKey: key, Message: message})
		}
		if row.Code == "" {
			add("code", "required", "code is required")
			continue
		}
		if _, duplicate := rowsByCode[row.Code]; duplicate {
			add("code", "duplicate_code", "code appears more than once in the import")
			continue
		}
		rowsByCode[row.Code] = row
		if row.Name.IsEmpty() {
			add("name", "required", "name is required in at least one locale")
		}
		if _, ok := allowedOrgEntityTypes[row.EntityType]; !ok {
			add("entity_type", "invalid_type", "unsupported entity type")
		}
		_, exists := existingByCode[row.Code]
		if req.Mode == dto.OrgImportCreate && exists {
			add("code", "already_exists", "code already exists")
		}
		if req.Mode == dto.OrgImportUpdate && !exists {
			add("code", "not_found", "code does not exist for update mode")
		}
		if exists {
			plan.updates++
		} else {
			plan.creates++
		}
		seenRoles := map[model.OrgRoleKey]bool{}
		for _, role := range row.Roles {
			if _, ok := allowedOrgRoleKeys[role.RoleKey]; !ok {
				add("roles", "invalid_role", fmt.Sprintf("unsupported role %q", role.RoleKey))
			}
			if role.UserID == uuid.Nil {
				add("roles", "invalid_user", "role user_id must be a UUID")
			}
			if seenRoles[role.RoleKey] {
				add("roles", "duplicate_role", fmt.Sprintf("role %q appears more than once", role.RoleKey))
			}
			seenRoles[role.RoleKey] = true
			plan.roles++
		}
		if row.ManagerUserID != nil {
			plan.roles++
		}
		seenEmployees := map[uuid.UUID]bool{}
		for _, employee := range row.Employees {
			if employee.UserID == uuid.Nil {
				add("employees", "invalid_user", "employee user_id must be a UUID")
			}
			if seenEmployees[employee.UserID] {
				add("employees", "duplicate_employee", "employee appears more than once for this entity")
			}
			if employee.CapacityUnits != nil && (*employee.CapacityUnits < 0 || *employee.CapacityUnits > 1) {
				add("employees", "invalid_capacity", "capacity_units must be between 0 and 1")
			}
			seenEmployees[employee.UserID] = true
			plan.employees++
		}
	}
	for _, row := range rowsByCode {
		if row.ParentCode == "" {
			continue
		}
		_, inFile := rowsByCode[row.ParentCode]
		_, exists := existingByCode[row.ParentCode]
		if !inFile && !exists {
			plan.errors = append(plan.errors, model.OrgImportRowError{Row: row.Row, Code: row.Code, Field: "parent_code", CodeKey: "parent_not_found", Message: fmt.Sprintf("parent code %q was not found", row.ParentCode)})
		}
		if req.Mode == dto.OrgImportReplace && !inFile {
			plan.errors = append(plan.errors, model.OrgImportRowError{Row: row.Row, Code: row.Code, Field: "parent_code", CodeKey: "parent_omitted", Message: "replace mode requires every referenced parent to be present in the file"})
		}
	}
	// Build final code->parent graph (submitted relationships override existing).
	parents := make(map[string]string, len(existing)+len(rowsByCode))
	for _, entity := range existing {
		if entity.ParentID != nil {
			parents[entity.Code] = existingCodeByID[*entity.ParentID]
		}
	}
	for code, row := range rowsByCode {
		parents[code] = row.ParentCode
	}
	state := map[string]uint8{}
	var visit func(string, []string)
	visit = func(code string, stack []string) {
		if state[code] == 2 {
			return
		}
		if state[code] == 1 {
			for _, member := range stack {
				if row, ok := rowsByCode[member]; ok {
					plan.errors = append(plan.errors, model.OrgImportRowError{Row: row.Row, Code: member, Field: "parent_code", CodeKey: "cycle", Message: "organizational hierarchy contains a cycle"})
				}
			}
			return
		}
		state[code] = 1
		if parent := parents[code]; parent != "" {
			visit(parent, append(stack, code))
		}
		state[code] = 2
	}
	for code := range parents {
		visit(code, nil)
	}
	// Stable Kahn ordering for submitted rows.
	remaining := make(map[string]dto.OrgStructureImportRow, len(rowsByCode))
	for code, row := range rowsByCode {
		remaining[code] = row
	}
	for len(remaining) > 0 {
		codes := make([]string, 0)
		for code, row := range remaining {
			if _, waits := remaining[row.ParentCode]; !waits {
				codes = append(codes, code)
			}
		}
		if len(codes) == 0 {
			break
		}
		sort.Strings(codes)
		for _, code := range codes {
			plan.ordered = append(plan.ordered, remaining[code])
			delete(remaining, code)
		}
	}
	if req.Mode == dto.OrgImportReplace {
		plan.deactivates = len(existing) - plan.updates
		if plan.deactivates < 0 {
			plan.deactivates = 0
		}
	}
	return plan
}

func importedParent(byCode map[string]*model.OrgEntity, code string) (*uuid.UUID, []string) {
	if code == "" {
		return nil, []string{}
	}
	parent := byCode[code]
	if parent == nil {
		return nil, []string{}
	}
	id := parent.ID
	path := append([]string(nil), parent.Path...)
	path = append(path, parent.ID.String())
	return &id, path
}

func sameUUID(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func managerRoleForType(entityType model.OrgEntityType) model.OrgRoleKey {
	switch entityType {
	case model.OrgEntityTypeSection:
		return model.OrgRoleSectionSupervisor
	case model.OrgEntityTypeSharedServicesUnit:
		return model.OrgRoleSharedServicesManager
	default:
		return model.OrgRoleDepartmentManager
	}
}

func orgImportErrorsCSV(errors []model.OrgImportRowError) string {
	var b strings.Builder
	b.WriteString("row,code,field,error_code,message\n")
	for _, issue := range errors {
		b.WriteString(fmt.Sprintf("%d,%s,%s,%s,%s\n", issue.Row, csvSafe(issue.Code), csvSafe(issue.Field), csvSafe(issue.CodeKey), csvSafe(issue.Message)))
	}
	return b.String()
}

func csvSafe(value string) string { return `"` + strings.ReplaceAll(value, `"`, `""`) + `"` }
