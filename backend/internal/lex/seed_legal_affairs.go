package lex

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// systemActorUUID is the synthetic system actor ('00000000-…-01') that the
// reference-data migrations record as created_by. Reused here so provision-time
// seeding matches the migration-seeded rows and stays idempotent across both.
const systemActorUUID = "00000000-0000-0000-0000-000000000001"

// This file seeds the Legal Affairs operational domains that the spine exposes
// in the Watheeq suite navigation — the organisational registry, the working
// calendar, litigation cases, investigations, consultations, settlements/ADR,
// and service-desk legal requests. The data follows the client requirements in
// docs/client_requirement_must/Legal System Capabilities.xlsx (8 services, the
// 3-level escalation ladder, working-day SLAs) for Abdullah Al Othaim
// Investment Company's legal department.
//
// Every function is idempotent: it checks for existing tenant rows before
// seeding and is a no-op once the domain is populated, so re-seeding and live
// edits are never clobbered.

// seedPtr returns a pointer to v. Used throughout for the many optional pointer
// fields on the create DTOs.
func seedPtr[T any](v T) *T { return &v }

// bilingual builds an AR/EN localized text value.
func bilingual(en, ar string) forms.LocalizedText { return forms.LocalizedText{EN: en, AR: ar} }

// countRows returns the number of tenant rows in table.
func (seed seedDataset) countRows(ctx context.Context, app *Application, table string) (int, error) {
	var n int
	if err := app.Store.DB().QueryRow(ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE tenant_id = $1", table), seed.tenantID).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// fetchMatterIDs returns up to limit matter IDs for the tenant, used to anchor
// settlement records (which require an owning matter).
func (seed seedDataset) fetchMatterIDs(ctx context.Context, app *Application, limit int) ([]uuid.UUID, error) {
	rows, err := app.Store.DB().Query(ctx,
		"SELECT id FROM legal_matters WHERE tenant_id = $1 ORDER BY created_at LIMIT $2", seed.tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ensureReferenceData seeds the per-tenant REFERENCE data that the lex_db
// migrations were designed to seed by CROSS JOINing a `tenants` registry: the
// case-classification taxonomy (000025), SLA targets (000023), the default
// attachment policy (000032) and the integration / e-sign connector registry
// (000032 + 000061). On every deployment built from scratch that `tenants` shim
// is created empty (000001) and never populated, so those migrations insert ZERO
// rows (F16) — the create form then shows "No case classifications configured
// yet." for every tenant. Seeding here, where a real tenant id exists, closes the
// gap. Every statement is idempotent (ON CONFLICT / existence checks) so it is
// safe to run on every startup/provision and never clobbers admin edits.
func (seed seedDataset) ensureReferenceData(ctx context.Context, app *Application) error {
	if app == nil || app.Store == nil || app.Store.DB() == nil {
		return nil
	}
	if err := seed.ensureCaseClassifications(ctx, app); err != nil {
		return err
	}
	if err := seed.ensureSLATargets(ctx, app); err != nil {
		return err
	}
	if err := seed.ensureAttachmentPolicies(ctx, app); err != nil {
		return err
	}
	if err := seed.ensureIntegrationRegistry(ctx, app); err != nil {
		return err
	}
	return nil
}

// ensureCaseClassifications seeds the 8 flat base classifications (CAP-074) and
// the cascading rental-dispute chain (CAP-076). Ported from migration 000025,
// scoped to this tenant. Idempotent via the (tenant_id, code) partial-unique
// index and per-node get-or-create.
func (seed seedDataset) ensureCaseClassifications(ctx context.Context, app *Application) error {
	const baseSQL = `
INSERT INTO legal_case_classifications (tenant_id, code, name, path, is_system, active, sort, created_by)
SELECT $1, b.code, b.name::jsonb, '{}'::text[], true, true, b.sort, '` + systemActorUUID + `'::uuid
FROM (VALUES
    ('EVICTION',               '{"ar":"إخلاء","en":"Eviction"}',                     10),
    ('RENT_CLAIM',             '{"ar":"مطالبة بالأجرة","en":"Rent Claim"}',          20),
    ('FAIR_RENT',              '{"ar":"أجرة المثل","en":"Fair Rent"}',               30),
    ('TAX',                    '{"ar":"اللجنة الضريبية","en":"Tax Committee"}',      40),
    ('LABOR',                  '{"ar":"عمالية","en":"Labor"}',                       50),
    ('COMMERCIAL',             '{"ar":"تجارية","en":"Commercial"}',                  60),
    ('ENFORCEMENT',            '{"ar":"تنفيذ","en":"Enforcement"}',                  70),
    ('INTERNAL_INVESTIGATION', '{"ar":"تحقيق داخلي","en":"Internal Investigation"}', 80)
) AS b(code, name, sort)
ON CONFLICT DO NOTHING`
	if _, err := app.Store.DB().Exec(ctx, baseSQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed base case classifications: %w", err)
	}

	// Cascading rental-dispute chain: each node get-or-created with a materialized
	// path built from its ancestors' ids (mirrors the 000025 PL/pgSQL block).
	root, err := seed.ensureClassificationNode(ctx, app, "RENTAL_DISPUTE", `{"ar":"نزاع إيجاري","en":"Rental Dispute"}`, uuid.Nil, nil, 5)
	if err != nil {
		return err
	}
	evict, err := seed.ensureClassificationNode(ctx, app, "RD_EVICTION", `{"ar":"إخلاء","en":"Eviction"}`, root, []string{root.String()}, 10)
	if err != nil {
		return err
	}
	rent, err := seed.ensureClassificationNode(ctx, app, "RD_RENT_CLAIM", `{"ar":"مطالبة بالأجرة","en":"Rent Claim"}`, evict, []string{root.String(), evict.String()}, 20)
	if err != nil {
		return err
	}
	fair, err := seed.ensureClassificationNode(ctx, app, "RD_FAIR_RENT", `{"ar":"أجرة المثل","en":"Fair Rent"}`, rent, []string{root.String(), evict.String(), rent.String()}, 30)
	if err != nil {
		return err
	}
	if _, err := seed.ensureClassificationNode(ctx, app, "RD_TAX_COMMITTEE", `{"ar":"اللجنة الضريبية","en":"Tax Committee"}`, fair, []string{root.String(), evict.String(), rent.String(), fair.String()}, 40); err != nil {
		return err
	}
	return nil
}

// ensureClassificationNode get-or-creates a single classification node (by
// tenant+code among live rows) and returns its id; the caller supplies the
// materialized path from the already-resolved ancestor ids.
func (seed seedDataset) ensureClassificationNode(ctx context.Context, app *Application, code, nameJSON string, parentID uuid.UUID, path []string, sort int) (uuid.UUID, error) {
	db := app.Store.DB()
	var id uuid.UUID
	err := db.QueryRow(ctx,
		`SELECT id FROM legal_case_classifications WHERE tenant_id = $1 AND code = $2 AND deleted_at IS NULL`,
		seed.tenantID, code).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, fmt.Errorf("lookup case classification %q: %w", code, err)
	}
	var parent *uuid.UUID
	if parentID != uuid.Nil {
		parent = &parentID
	}
	if path == nil {
		path = []string{}
	}
	if err := db.QueryRow(ctx, `
INSERT INTO legal_case_classifications (tenant_id, parent_id, code, name, path, is_system, active, sort, created_by)
VALUES ($1, $2, $3, $4::jsonb, $5, true, true, $6, '`+systemActorUUID+`'::uuid)
RETURNING id`, seed.tenantID, parent, code, nameJSON, path, sort).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("seed case classification %q: %w", code, err)
	}
	return id, nil
}

// ensureSLATargets seeds the per-request-type working-day SLA targets (CAP-012),
// ported from migration 000023. Idempotent via the (tenant_id, lower(service_code),
// priority) partial-unique index.
func (seed seedDataset) ensureSLATargets(ctx context.Context, app *Application) error {
	// The delivery budget is seeded as a From–To working-day window per
	// (service_code, priority): turnaround_from is the earliest-promise lower bound
	// and turnaround_days the enforced upper-bound deadline (Al Othaim PRD 6.0 /
	// Diagram A — e.g. Consultation 4–6, Contract 3–5). from <= to always holds.
	const slaSQL = `
INSERT INTO legal_sla_targets (
    tenant_id, service_code, priority, turnaround_working_days_from, turnaround_working_days,
    ack_window_value, ack_window_unit,
    escalation_l1_days, escalation_l2_days, escalation_l3_days,
    active, created_by
)
SELECT $1, v.service_code, v.priority, v.turnaround_from, v.turnaround_days,
       v.ack_value, v.ack_unit, 2, 4, 6, true, '` + systemActorUUID + `'::uuid
FROM (VALUES
    ('LEGAL_CONSULTATION',  'emergency', 1,  2, 2, 'working_hours'),
    ('LEGAL_CONSULTATION',  'urgent',  3,  4, 4, 'working_hours'),
    ('LEGAL_CONSULTATION',  'normal',  4,  6, 1, 'working_days'),
    ('CONTRACT_REVIEW',     'emergency', 1,  1, 2, 'working_hours'),
    ('CONTRACT_REVIEW',     'urgent',  2,  3, 4, 'working_hours'),
    ('CONTRACT_REVIEW',     'normal',  3,  5, 1, 'working_days'),
    ('LEGAL_OPINION',       'emergency', 1,  2, 2, 'working_hours'),
    ('LEGAL_OPINION',       'urgent',  3,  5, 4, 'working_hours'),
    ('LEGAL_OPINION',       'normal', 10, 15, 1, 'working_days'),
    ('LITIGATION_SUPPORT',  'emergency', 3,  5, 2, 'working_hours'),
    ('LITIGATION_SUPPORT',  'urgent',  7, 10, 4, 'working_hours'),
    ('LITIGATION_SUPPORT',  'normal', 20, 30, 1, 'working_days'),
    ('ENFORCEMENT_REQUEST', 'emergency', 3,  5, 2, 'working_hours'),
    ('ENFORCEMENT_REQUEST', 'urgent',  7, 10, 4, 'working_hours'),
    ('ENFORCEMENT_REQUEST', 'normal', 14, 20, 1, 'working_days'),
    ('VIOLATION_STUDY',     'emergency', 3,  5, 2, 'working_hours'),
    ('VIOLATION_STUDY',     'urgent',  7, 10, 4, 'working_hours'),
    ('VIOLATION_STUDY',     'normal', 14, 20, 1, 'working_days'),
    ('FIELD_INSPECTION',    'emergency', 3,  5, 2, 'working_hours'),
    ('FIELD_INSPECTION',    'urgent',  7, 10, 4, 'working_hours'),
    ('FIELD_INSPECTION',    'normal', 14, 20, 1, 'working_days'),
    ('POWER_OF_ATTORNEY',   'emergency', 3,  5, 2, 'working_hours'),
    ('POWER_OF_ATTORNEY',   'urgent',  7, 10, 4, 'working_hours'),
    ('POWER_OF_ATTORNEY',   'normal', 14, 20, 1, 'working_days')
) AS v(service_code, priority, turnaround_from, turnaround_days, ack_value, ack_unit)
ON CONFLICT DO NOTHING`
	if _, err := app.Store.DB().Exec(ctx, slaSQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed SLA targets: %w", err)
	}
	return nil
}

// ensureAttachmentPolicies seeds the baseline attachment policy for the
// GENERAL_LEGAL_REQUEST service code (000032). Idempotent via the
// (tenant_id, request_type, service_code) partial-unique index.
func (seed seedDataset) ensureAttachmentPolicies(ctx context.Context, app *Application) error {
	const policySQL = `
INSERT INTO lex_attachment_policies (tenant_id, request_type, service_code, name, description, min_attachment_count, slots, active, created_by)
SELECT $1, '', 'GENERAL_LEGAL_REQUEST',
       '{"ar": "سياسة المرفقات الافتراضية", "en": "Default Attachment Policy"}'::jsonb,
       '{"ar": "تتطلب مرفقاً داعماً واحداً على الأقل", "en": "Requires at least one supporting attachment"}'::jsonb,
       1,
       '[{"key": "supporting_doc", "label": {"ar": "مستند داعم", "en": "Supporting Document"}, "required": false, "sort_order": 10}]'::jsonb,
       true,
       '` + systemActorUUID + `'::uuid
ON CONFLICT (tenant_id, request_type, service_code) WHERE deleted_at IS NULL DO NOTHING`
	if _, err := app.Store.DB().Exec(ctx, policySQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed attachment policies: %w", err)
	}
	return nil
}

// ensureIntegrationRegistry seeds the default integration endpoints (000032) and
// the per-provider e-signature connectors (000061). Config is non-secret routing
// hints only. Idempotent via the (tenant_id, code) partial-unique index.
func (seed seedDataset) ensureIntegrationRegistry(ctx context.Context, app *Application) error {
	db := app.Store.DB()
	const defaultEndpointsSQL = `
INSERT INTO lex_integration_endpoints (tenant_id, kind, code, name, description, status, config_encrypted, config_encrypted_flag, created_by)
SELECT $1, k.kind, k.code, k.name, k.description, 'planned', '{}', false, '` + systemActorUUID + `'::uuid
FROM (VALUES
    ('najiz',     'najiz_default',     'Najiz e-Litigation',    'Saudi MoJ Najiz portal (planned)'),
    ('hr',        'hr_default',        'HR / Identity Feed',    'HR system integration (planned)'),
    ('internal',  'internal_default',  'Internal Systems Bus',  'Generic internal endpoint (planned)'),
    ('archiving', 'archiving_default', 'Records / e-Archiving', 'Archiving system integration (planned)'),
    ('email',     'email_default',     'Outbound Email',        'Outbound email via dispatcher (planned)')
) AS k(kind, code, name, description)
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING`
	if _, err := db.Exec(ctx, defaultEndpointsSQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed integration endpoints: %w", err)
	}

	// Othaim PRD 14.1 — a DEMONSTRABLE, REVERSIBLE e-archive target. This is an
	// ACTIVE local-filesystem backend forced to non-WORM (worm_enabled=false): a
	// document can be pushed to it and stamped with an archive_ref today with no
	// external dependency. It is deliberately reversible — object-lock/WORM is NOT
	// enabled here and remains an external go-live gate (dedicated env + sign-off).
	// The 'archiving_default' row above stays 'planned' as the placeholder for the
	// real in-Kingdom WORM records store. Idempotent via (tenant_id, code).
	const localArchiveSQL = `
INSERT INTO lex_integration_endpoints (tenant_id, kind, code, name, description, status, config_encrypted, config_encrypted_flag, created_by)
SELECT $1, 'archiving', 'archiving_local_demo', 'Records / e-Archiving (Demo)',
       'Reversible local e-archive target (non-WORM) — demonstrable document archiving without external dependencies',
       'active',
       '{"protocol":"local","backend":"local","bucket":"lex-earchive-demo","worm_enabled":false,"in_kingdom_only":false}',
       false, '` + systemActorUUID + `'::uuid
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING`
	if _, err := db.Exec(ctx, localArchiveSQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed local e-archive endpoint: %w", err)
	}

	const esignSQL = `
INSERT INTO lex_integration_endpoints (tenant_id, kind, code, name, description, status, config_encrypted, config_encrypted_flag, created_by)
SELECT $1, 'esign', k.code, k.name, k.description, k.status, k.config, false, '` + systemActorUUID + `'::uuid
FROM (VALUES
    ('esign_native', 'Native e-Signature', 'Deterministic in-platform signing (no external provider)', 'active',
     '{"provider":"native","provider_kind":"native","mode":"deterministic","signer_id_proofing":"none","default_signature_level":"basic"}'),
    ('esign_docusign', 'DocuSign', 'DocuSign envelopes via OAuth/JWT (configure base_url + account_id + credentials)', 'planned',
     '{"provider":"docusign","provider_kind":"external","mode":"docusign","signer_id_proofing":"none","default_signature_level":"advanced"}'),
    ('esign_adobe', 'Adobe Acrobat Sign', 'Adobe Acrobat Sign agreements via OAuth (configure base_url + credentials)', 'planned',
     '{"provider":"adobe","provider_kind":"external","mode":"adobe","signer_id_proofing":"none","default_signature_level":"advanced"}'),
    ('esign_najiz', 'Najiz (MoJ) e-Signature', 'Saudi MoJ Najiz signing portal — gov-gated, sandbox-mock until MOJ credentials land', 'planned',
     '{"provider":"native","provider_kind":"najiz","mode":"najiz","signer_id_proofing":"nafath","default_signature_level":"qualified"}'),
    ('esign_emdha', 'emdha (TSP) Qualified Signature', 'emdha trust service provider qualified signature paired with Nafath identity proofing — gov-gated, sandbox-mock until credentials land', 'planned',
     '{"provider":"emdha","provider_kind":"nafath","mode":"emdha","signer_id_proofing":"nafath","default_signature_level":"qualified"}')
) AS k(code, name, description, status, config)
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING`
	if _, err := db.Exec(ctx, esignSQL, seed.tenantID); err != nil {
		return fmt.Errorf("seed e-sign connectors: %w", err)
	}
	return nil
}

// orgRoleHolder resolves the user id to bind a seeded org responsibility role to.
// For the apex demo tenant the demo users[N] are real seeded rows, so the caller's
// demoUser is used. On a real onboarded tenant those demo-fixture UUIDs
// (22222222-…) do not exist (F37) — the escalation ladder would route to a phantom
// holder — so we bind to the tenant's real system/admin user when we have one, and
// otherwise seed NO binding, letting the "Missing N" chip prompt the admin to
// appoint a real holder.
func (seed seedDataset) orgRoleHolder(demoUser uuid.UUID) (uuid.UUID, bool) {
	// Demo tenants (the built-in apex tenant and the seed fixture tenant) carry the
	// demo users[N] as their real seeded holders, so pass them through. Only a real
	// onboarded tenant lacks those fixture UUIDs.
	if seed.tenantID == apexLegalTenantID || seed.tenantID == seedTenantID {
		return demoUser, true
	}
	if seed.systemUser != uuid.Nil && seed.systemUser != seedSystemUser {
		return seed.systemUser, true
	}
	return uuid.Nil, false
}

// seedOrgRoleSpec is one responsibility-role binding request for an org entity.
type seedOrgRoleSpec struct {
	demoUser uuid.UUID
	key      model.OrgRoleKey
	label    forms.LocalizedText
}

// collectOrgRoles resolves each spec's holder via orgRoleHolder, dropping any
// binding for which no real holder exists (F37).
func (seed seedDataset) collectOrgRoles(specs ...seedOrgRoleSpec) []dto.OrgRoleRequest {
	roles := make([]dto.OrgRoleRequest, 0, len(specs))
	for _, s := range specs {
		holder, ok := seed.orgRoleHolder(s.demoUser)
		if !ok {
			continue
		}
		roles = append(roles, dto.OrgRoleRequest{RoleKey: s.key, UserID: holder, Label: s.label})
	}
	return roles
}

// ensureOrgEntity get-or-creates an org entity by (tenant, code) and returns it.
// Reusing an existing node (rather than a has-any-row guard over the whole tree)
// makes the registry seed idempotent per-entity, so a partial prior seed
// self-heals on the next startup instead of being skipped forever (F38).
func (seed seedDataset) ensureOrgEntity(ctx context.Context, app *Application, parentID *uuid.UUID, entityType model.OrgEntityType, code string, name forms.LocalizedText, roles []dto.OrgRoleRequest) (*model.OrgEntity, error) {
	if existing, err := app.OrgEntityService.GetByCode(ctx, seed.tenantID, code); err == nil {
		return existing, nil
	} else if !apperrors.IsNotFound(err) {
		return nil, fmt.Errorf("lookup org entity %q: %w", code, err)
	}
	req := dto.CreateOrgEntityRequest{
		ParentID:   parentID,
		EntityType: entityType,
		Code:       code,
		Name:       name,
		Active:     seedPtr(true),
		Roles:      roles,
	}
	entity, err := app.OrgEntityService.Create(ctx, seed.tenantID, seed.systemUser, req)
	if err != nil {
		return nil, fmt.Errorf("seed org entity %q: %w", code, err)
	}
	return entity, nil
}

// ensureOrgRegistry seeds the legal department's organisational hierarchy and
// its responsibility roles (CAP-008 eligibility, CAP-017..019 escalation). The
// tree is Company → Shared Services Management → Legal Department → Sections,
// with the section_supervisor / department_manager / shared_services_manager
// roles that the 3-level SLA escalation ladder walks. Per-entity get-or-create
// (F38) and real-holder role binding (F37).
func (seed seedDataset) ensureOrgRegistry(ctx context.Context, app *Application) error {
	if app.OrgEntityService == nil {
		return nil
	}
	users := seed.users

	company, err := seed.ensureOrgEntity(ctx, app, nil, model.OrgEntityTypeCompany, "OTHAIM",
		bilingual("Abdullah Al Othaim Investment Company", "شركة عبدالله العثيم للاستثمار"),
		seed.collectOrgRoles(
			seedOrgRoleSpec{users[0].ID, model.OrgRoleGeneralCounsel, bilingual("General Counsel", "المستشار العام")},
		))
	if err != nil {
		return err
	}

	ssm, err := seed.ensureOrgEntity(ctx, app, seedPtr(company.ID), model.OrgEntityTypeSharedServicesUnit, "SSM",
		bilingual("Shared Services Management", "إدارة الخدمات المشتركة"),
		seed.collectOrgRoles(
			seedOrgRoleSpec{users[3].ID, model.OrgRoleSharedServicesManager, bilingual("Shared Services Unit Manager", "مدير وحدة الخدمات المشتركة")},
		))
	if err != nil {
		return err
	}

	legalDept, err := seed.ensureOrgEntity(ctx, app, seedPtr(ssm.ID), model.OrgEntityTypeDepartment, "LEGAL",
		bilingual("Legal Department", "الإدارة القانونية"),
		seed.collectOrgRoles(
			seedOrgRoleSpec{users[1].ID, model.OrgRoleDepartmentManager, bilingual("Legal Department Manager", "مدير الإدارة الطالبة")},
			seedOrgRoleSpec{users[0].ID, model.OrgRoleLegalDirector, bilingual("Legal Director", "مدير الإدارة القانونية")},
			seedOrgRoleSpec{users[6].ID, model.OrgRoleComplianceOfficer, bilingual("Compliance Officer", "مسؤول الالتزام")},
		))
	if err != nil {
		return err
	}

	if _, err := seed.ensureOrgEntity(ctx, app, seedPtr(legalDept.ID), model.OrgEntityTypeSection, "CASES",
		bilingual("Cases & Investigations Section", "قسم القضايا والتحقيقات"),
		seed.collectOrgRoles(
			seedOrgRoleSpec{users[2].ID, model.OrgRoleSectionSupervisor, bilingual("Cases & Investigations Supervisor", "مشرف القضايا والتحقيقات")},
		)); err != nil {
		return err
	}

	if _, err := seed.ensureOrgEntity(ctx, app, seedPtr(legalDept.ID), model.OrgEntityTypeSection, "CONTRACTS",
		bilingual("Contracts & Consultations Section", "قسم العقود والاستشارات"),
		seed.collectOrgRoles(
			seedOrgRoleSpec{users[4].ID, model.OrgRoleSectionSupervisor, bilingual("Contracts & Consultations Supervisor", "مشرف العقود والاستشارات")},
			seedOrgRoleSpec{users[1].ID, model.OrgRoleContractsManager, bilingual("Contracts Manager", "مدير العقود")},
		)); err != nil {
		return err
	}
	return nil
}

// ensureWorkingCalendar seeds the tenant's default KSA working calendar used for
// SLA and KPI duration math (CAP-020, CAP-021, CAP-029): Sunday–Thursday hours,
// a Ramadan profile, and the main official/religious holidays.
func (seed seedDataset) ensureWorkingCalendar(ctx context.Context, app *Application) error {
	if app.WorkingCalendarService == nil {
		return nil
	}
	// F38: get-or-create the default calendar, then add only MISSING holidays. A
	// has-any-row guard would skip the whole body once the calendar row committed,
	// so a partial prior seed (calendar in, a holiday insert failed) left a
	// permanent gap that made SLA math count a holiday as a working day.
	calID, err := seed.ensureDefaultWorkingCalendar(ctx, app)
	if err != nil {
		return err
	}

	cal, err := app.WorkingCalendarService.Get(ctx, seed.tenantID, calID)
	if err != nil {
		return fmt.Errorf("load working calendar: %w", err)
	}
	existing := make(map[string]struct{}, len(cal.Holidays))
	for _, h := range cal.Holidays {
		existing[h.Date.UTC().Format("2006-01-02")] = struct{}{}
	}

	holidays := []dto.AddCalendarHolidayRequest{
		{Date: time.Date(2026, 2, 22, 0, 0, 0, 0, time.UTC), Kind: model.CalendarHolidayKindOfficial, Name: bilingual("Founding Day", "يوم التأسيس")},
		{Date: time.Date(2026, 9, 23, 0, 0, 0, 0, time.UTC), Kind: model.CalendarHolidayKindOfficial, Name: bilingual("Saudi National Day", "اليوم الوطني")},
		{Date: time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC), Kind: model.CalendarHolidayKindReligious, Name: bilingual("Eid al-Fitr", "عيد الفطر")},
	}
	for _, h := range holidays {
		if _, seeded := existing[h.Date.UTC().Format("2006-01-02")]; seeded {
			continue
		}
		if _, err := app.WorkingCalendarService.AddHoliday(ctx, seed.tenantID, seed.systemUser, calID, h); err != nil {
			return fmt.Errorf("seed calendar holiday %q: %w", h.Name.EN, err)
		}
	}
	return nil
}

// ensureDefaultWorkingCalendar get-or-creates the tenant's default KSA working
// calendar (CAP-020/021/029) and returns its id.
func (seed seedDataset) ensureDefaultWorkingCalendar(ctx context.Context, app *Application) (uuid.UUID, error) {
	var id uuid.UUID
	err := app.Store.DB().QueryRow(ctx,
		`SELECT id FROM legal_working_calendars WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1`,
		seed.tenantID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, fmt.Errorf("lookup working calendar: %w", err)
	}

	hours := make([]dto.WorkingHoursInput, 0, 10)
	for day := 0; day <= 4; day++ { // Sunday(0) .. Thursday(4)
		hours = append(hours,
			dto.WorkingHoursInput{Profile: model.CalendarProfileStandard, DayOfWeek: day, SegmentIndex: 0, StartMinute: 540, EndMinute: 1020}, // 09:00–17:00
			dto.WorkingHoursInput{Profile: model.CalendarProfileRamadan, DayOfWeek: day, SegmentIndex: 0, StartMinute: 540, EndMinute: 900},   // 09:00–15:00
		)
	}

	ramadanStart := time.Date(2026, 2, 18, 0, 0, 0, 0, time.UTC)
	ramadanEnd := time.Date(2026, 3, 19, 0, 0, 0, 0, time.UTC)

	cal, err := app.WorkingCalendarService.Create(ctx, seed.tenantID, seed.systemUser, dto.CreateWorkingCalendarRequest{
		Name:         "تقويم العمل الرسمي — المملكة العربية السعودية",
		Description:  "ساعات العمل الرسمية لاحتساب مدد اتفاقيات مستوى الخدمة ومؤشرات الأداء (الأحد–الخميس).",
		Timezone:     "Asia/Riyadh",
		IsDefault:    true,
		RamadanStart: &ramadanStart,
		RamadanEnd:   &ramadanEnd,
		WorkingHours: hours,
	})
	if err != nil {
		return uuid.Nil, fmt.Errorf("seed working calendar: %w", err)
	}
	return cal.ID, nil
}

// ensureLitigationCases seeds representative litigation cases with parties,
// hearings and tasks (CAP-042..046, §5.2). Cases span plaintiff/defendant
// posture, case types and lifecycle states.
func (seed seedDataset) ensureLitigationCases(ctx context.Context, app *Application) error {
	if app.LegalCaseService == nil {
		return nil
	}
	if ok, err := seed.hasRows(ctx, app, "legal_cases", false); err != nil {
		return err
	} else if ok {
		return nil
	}
	users := seed.users
	company := seed.partyAName()
	day := func(offset int) time.Time { return seed.referenceAt.AddDate(0, 0, offset) }

	type caseSpec struct {
		caseType       string
		companyStatus  model.CaseCompanyStatus
		titleEN        string
		titleAR        string
		description    string
		status         model.CaseStatus
		priority       model.LegalPriority
		strength       *model.CaseStrength
		courtNumber    string
		competentCourt string
		counterparty   string
		lawyer         string
		hearingOffset  int
		hearingNote    string
		tasks          []string
	}

	specs := []caseSpec{
		{
			caseType: "commercial", companyStatus: model.CaseCompanyStatusPlaintiff,
			titleEN: "Supply Agreement Breach — Gulf Distribution Co.", titleAR: "إخلال باتفاقية توريد — شركة الخليج للتوزيع",
			description: "دعوى مطالبة بالتعويض عن الأضرار الناشئة عن إخلال الموزّع بكميات التوريد الملتزم بها بموجب اتفاقية التوريد الرئيسية.",
			status:      model.CaseStatusOpen, priority: model.LegalPriorityHigh, strength: seedPtr(model.CaseStrengthStrong),
			courtNumber: "COM-2026-1184", competentCourt: "المحكمة التجارية بالرياض", counterparty: "شركة الخليج للتوزيع",
			lawyer: users[1].Name, hearingOffset: 21, hearingNote: "أولى الجلسات الموضوعية للنظر في المسؤولية.",
			tasks: []string{"إعداد صحيفة الدعوى", "تجهيز حافظة مستندات كميات التوريد"},
		},
		{
			caseType: "labor", companyStatus: model.CaseCompanyStatusDefendant,
			titleEN: "Labor Claim — Former Regional Manager", titleAR: "دعوى عمالية — مدير إقليمي سابق",
			description: "الدفاع في دعوى عمالية أقامها مدير إقليمي سابق للمطالبة بمكافأة نهاية الخدمة والتعويض عن الفصل التعسفي.",
			status:      model.CaseStatusUnderProcedure, priority: model.LegalPriorityMedium,
			courtNumber: "LAB-2026-0473", competentCourt: "محكمة العمل بالرياض", counterparty: "مدير إقليمي سابق",
			lawyer: users[2].Name, hearingOffset: 12, hearingNote: "جلسة لبحث التسوية الودية أمام الدائرة العمالية.",
			tasks: []string{"مراجعة احتساب مستحقات نهاية الخدمة", "إعداد المذكرة الجوابية"},
		},
		{
			caseType: "civil", companyStatus: model.CaseCompanyStatusPlaintiff,
			titleEN: "Property Damage — Central Warehouse Fire", titleAR: "أضرار ممتلكات — حريق المستودع المركزي",
			description: "دعوى رجوع على المقاول للمطالبة بالتعويض عن أضرار الحريق التي لحقت بمستودع التوزيع المركزي نتيجة الإهمال في الأعمال الكهربائية.",
			status:      model.CaseStatusPhase1, priority: model.LegalPriorityHigh, strength: seedPtr(model.CaseStrengthStrong),
			competentCourt: "المحكمة العامة بالرياض", counterparty: "مؤسسة نجد للأعمال الكهربائية",
			lawyer: users[1].Name, hearingOffset: 35, hearingNote: "النظر في تقرير الخبير الهندسي المعيّن من المحكمة.",
			tasks: []string{"تكليف خبير لتقدير الأضرار", "حصر الخسائر القابلة للمطالبة"},
		},
		{
			caseType: "commercial", companyStatus: model.CaseCompanyStatusDefendant,
			titleEN: "Trademark Infringement Defence — Private Label", titleAR: "دفاع في انتهاك علامة تجارية — علامة خاصة",
			description: "الدفاع في دعوى تعدٍّ على علامة تجارية تتعلق بخط منتجات العلامة الخاصة.",
			status:      model.CaseStatusOpen, priority: model.LegalPriorityCritical,
			courtNumber: "IP-2026-0091", competentCourt: "المحكمة التجارية — دائرة الملكية الفكرية", counterparty: "مؤسسة براندمارك التجارية",
			lawyer: users[2].Name, hearingOffset: 9, hearingNote: "جلسة النظر في طلب الإجراء التحفظي المستعجل.",
			tasks: []string{"تقديم شهادات تسجيل العلامة التجارية ضمن الأدلة", "إعداد الدفع بانتفاء اللبس بين العلامتين"},
		},
		{
			caseType: "execution", companyStatus: model.CaseCompanyStatusPlaintiff,
			titleEN: "Judgment Enforcement — Lease Arrears", titleAR: "تنفيذ حكم — متأخرات إيجار",
			description: "تنفيذ حكم نهائي بمتأخرات إيجار تجاري مستحقة في مواجهة مستأجر سابق.",
			status:      model.CaseStatusIntake, priority: model.LegalPriorityMedium,
			competentCourt: "محكمة التنفيذ", counterparty: "مؤسسة المستأجر السابق",
			lawyer: users[1].Name, hearingOffset: 0, hearingNote: "",
			tasks: []string{"تقديم طلب التنفيذ", "حصر الأصول القابلة للتنفيذ عليها"},
		},
	}

	for _, sp := range specs {
		req := dto.CreateLegalCaseRequest{
			CaseType:          sp.caseType,
			CompanyStatus:     sp.companyStatus,
			Title:             bilingual(sp.titleEN, sp.titleAR),
			Description:       sp.description,
			Status:            sp.status,
			Priority:          sp.priority,
			Strength:          sp.strength,
			CompetentCourt:    seedPtr(sp.competentCourt),
			ResponsibleLawyer: seedPtr(sp.lawyer),
			Department:        seedPtr("الإدارة القانونية"),
		}
		if sp.courtNumber != "" {
			req.CourtNumber = seedPtr(sp.courtNumber)
		}
		c, err := app.LegalCaseService.Create(ctx, seed.tenantID, seed.systemUser, req)
		if err != nil {
			return fmt.Errorf("seed legal case %q: %w", sp.titleEN, err)
		}

		// Parties: the company plus the counterparty and handling lawyer.
		companyRole := model.CasePartyRolePlaintiff
		counterpartyRole := model.CasePartyRoleDefendant
		if sp.companyStatus == model.CaseCompanyStatusDefendant {
			companyRole = model.CasePartyRoleDefendant
			counterpartyRole = model.CasePartyRolePlaintiff
		}
		parties := []dto.CreateCasePartyRequest{
			{Role: companyRole, Name: company},
			{Role: counterpartyRole, Name: sp.counterparty},
			{Role: model.CasePartyRoleLawyer, Name: sp.lawyer, Contact: seedPtr("legal@othaim.com")},
		}
		for _, p := range parties {
			if _, err := app.LegalCaseService.AddParty(ctx, seed.tenantID, seed.systemUser, c.ID, p); err != nil {
				return fmt.Errorf("seed case party for %q: %w", sp.titleEN, err)
			}
		}

		// Hearing (skip the intake-stage enforcement case with no scheduled date).
		if sp.hearingOffset > 0 {
			if _, err := app.LegalCaseService.AddHearing(ctx, seed.tenantID, seed.systemUser, c.ID, dto.CreateCaseHearingRequest{
				HearingDate: day(sp.hearingOffset),
				Location:    seedPtr(sp.competentCourt),
				Notes:       sp.hearingNote,
			}); err != nil {
				return fmt.Errorf("seed case hearing for %q: %w", sp.titleEN, err)
			}
		}

		// Tasks assigned to the handling lawyer / section.
		for i, title := range sp.tasks {
			if _, err := app.LegalCaseService.DefineTask(ctx, seed.tenantID, seed.systemUser, c.ID, dto.CreateCaseTaskRequest{
				Title:    title,
				Priority: sp.priority,
				Status:   model.CaseTaskStatusOpen,
				DueDate:  seedPtr(day(7 + i*7)),
			}); err != nil {
				return fmt.Errorf("seed case task for %q: %w", sp.titleEN, err)
			}
		}
	}
	return nil
}

// ensureInvestigations seeds legal investigations with parties, statements and
// evidence (violation/misconduct studies, CAP-004 service #6, §5).
func (seed seedDataset) ensureInvestigations(ctx context.Context, app *Application) error {
	if app.InvestigationService == nil {
		return nil
	}
	if ok, err := seed.hasRows(ctx, app, "legal_investigations", false); err != nil {
		return err
	} else if ok {
		return nil
	}
	users := seed.users
	at := func(offset int) time.Time { return seed.referenceAt.AddDate(0, 0, offset) }

	type invSpec struct {
		subject     string
		lead        string
		priority    model.LegalPriority
		department  string
		subjectName string
		complainant string
		witness     string
		statement   string
		evidence    string
		evidenceTy  string
	}
	specs := []invSpec{
		{
			subject: "مخالفة في إجراءات المشتريات — تسجيل الموردين بالمنطقة الوسطى", lead: users[6].Name, priority: model.LegalPriorityHigh,
			department: "المشتريات", subjectName: "مسؤول المشتريات بالمنطقة الوسطى", complainant: "المراجعة الداخلية", witness: "منسق علاقات الموردين",
			statement: "أفاد الشاهد بأنه جرى تسجيل ثلاثة موردين خلال الربع الرابع دون استيفاء خطوة عروض الأسعار التنافسية الإلزامية.",
			evidence:  "سجل اعتماد تسجيل الموردين (الربع الرابع)", evidenceTy: "document",
		},
		{
			subject: "عجز في المخزون — مركز التوزيع بجدة", lead: users[2].Name, priority: model.LegalPriorityMedium,
			department: "سلسلة الإمداد", subjectName: "مشرف وردية المستودع", complainant: "مدير العمليات الإقليمي", witness: "مراقب المخزون",
			statement: "أفاد مراقب المخزون بتكرار فروقات الجرد في الوردية الليلية على مدى شهرين.",
			evidence:  "تقرير فروقات الجرد الدوري", evidenceTy: "document",
		},
		{
			subject: "مخالفة قواعد السلوك المهني — إحالة من الموارد البشرية", lead: users[6].Name, priority: model.LegalPriorityHigh,
			department: "الموارد البشرية", subjectName: "موظف بالإدارة", complainant: "شريك أعمال الموارد البشرية", witness: "رئيس الفريق",
			statement: "أيّد رئيس الفريق التسلسل الزمني للوقائع المشار إليها في إحالة الموارد البشرية.",
			evidence:  "مذكرة الإحالة من الموارد البشرية", evidenceTy: "document",
		},
	}

	for _, sp := range specs {
		inv, err := app.InvestigationService.Create(ctx, seed.tenantID, seed.systemUser, dto.CreateInvestigationRequest{
			Subject:          sp.subject,
			LeadInvestigator: sp.lead,
			Priority:         sp.priority,
			Department:       seedPtr(sp.department),
		})
		if err != nil {
			return fmt.Errorf("seed investigation %q: %w", sp.subject, err)
		}

		parties := []dto.AddInvestigationPartyRequest{
			{Role: model.InvestigationPartyRoleSubject, Name: sp.subjectName},
			{Role: model.InvestigationPartyRoleComplainant, Name: sp.complainant},
			{Role: model.InvestigationPartyRoleWitness, Name: sp.witness},
			{Role: model.InvestigationPartyRoleInvestigator, Name: sp.lead},
		}
		for _, p := range parties {
			if _, err := app.InvestigationService.AddParty(ctx, seed.tenantID, seed.systemUser, inv.ID, p); err != nil {
				return fmt.Errorf("seed investigation party for %q: %w", sp.subject, err)
			}
		}

		if _, err := app.InvestigationService.RecordStatement(ctx, seed.tenantID, seed.systemUser, inv.ID, dto.RecordInvestigationStatementRequest{
			DeponentName: sp.witness,
			Statement:    sp.statement,
			TakenAt:      seedPtr(at(-3)),
			TakenBy:      sp.lead,
		}); err != nil {
			return fmt.Errorf("seed investigation statement for %q: %w", sp.subject, err)
		}

		if _, err := app.InvestigationService.UploadEvidence(ctx, seed.tenantID, seed.systemUser, inv.ID, dto.UploadInvestigationEvidenceRequest{
			Title:        sp.evidence,
			Description:  "جُمع ضمن مرحلة التحقق الأولي من الوقائع.",
			EvidenceType: sp.evidenceTy,
			CollectedBy:  sp.lead,
			CollectedAt:  seedPtr(at(-2)),
		}); err != nil {
			return fmt.Errorf("seed investigation evidence for %q: %w", sp.subject, err)
		}
	}
	return nil
}

// ensureConsultations seeds legal consultations across subject-matter types
// (CAP-004 service #1, §5). It tops up the catalogue so the Consultations
// surface is representative without disturbing any existing rows.
func (seed seedDataset) ensureConsultations(ctx context.Context, app *Application) error {
	if app.ConsultationService == nil {
		return nil
	}
	if n, err := seed.countRows(ctx, app, "legal_consultations"); err != nil {
		return err
	} else if n >= 4 {
		return nil
	}

	type consultSpec struct {
		cType      model.ConsultationType
		titleEN    string
		titleAR    string
		priority   model.LegalPriority
		requester  string
		department string
		question   string
		tags       []string
	}
	specs := []consultSpec{
		{
			cType: model.ConsultationTypeContractual, titleEN: "Supplier framework agreement terms", titleAR: "شروط اتفاقية إطارية مع مورّد",
			priority: model.LegalPriorityMedium, requester: "مدير إدارة المشتريات", department: "المشتريات",
			question: "هل البندان المقترحان لحد أقصى للمسؤولية وللإنهاء دون إبداء أسباب مقبولان في اتفاقية إطارية مع مورّد مدتها ثلاث سنوات؟",
			tags:     []string{"contracts", "procurement"},
		},
		{
			cType: model.ConsultationTypeLabor, titleEN: "End-of-service benefit calculation", titleAR: "احتساب مكافأة نهاية الخدمة",
			priority: model.LegalPriorityMedium, requester: "مدير الموارد البشرية", department: "الموارد البشرية",
			question: "كيف تُحتسب مكافأة نهاية الخدمة للموظف المستقيل قبل إتمام خمس سنوات من الخدمة وفقًا لنظام العمل؟",
			tags:     []string{"labor", "hr"},
		},
		{
			cType: model.ConsultationTypeRegulatory, titleEN: "ZATCA e-invoicing phase 2 compliance", titleAR: "الامتثال للمرحلة الثانية من الفوترة الإلكترونية (هيئة الزكاة والضريبة والجمارك)",
			priority: model.LegalPriorityHigh, requester: "المراقب المالي", department: "المالية",
			question: "ما الالتزامات النظامية والغرامات المترتبة على المرحلة الثانية من الفوترة الإلكترونية لدى هيئة الزكاة والضريبة والجمارك وفق جدولنا الزمني للربط؟",
			tags:     []string{"regulatory", "tax"},
		},
		{
			cType: model.ConsultationTypeCorporate, titleEN: "Board resolution for new subsidiary", titleAR: "قرار مجلس إدارة لتأسيس شركة تابعة",
			priority: model.LegalPriorityMedium, requester: "الرئيس التنفيذي للعمليات", department: "الشؤون المؤسسية",
			question: "ما الموافقات النظامية وقرارات مجلس الإدارة اللازمة لتأسيس شركة تابعة للخدمات اللوجستية مملوكة بالكامل؟",
			tags:     []string{"corporate", "governance"},
		},
	}

	for _, sp := range specs {
		if _, err := app.ConsultationService.Submit(ctx, seed.tenantID, seed.systemUser, dto.SubmitConsultationRequest{
			Type:          sp.cType,
			Title:         bilingual(sp.titleEN, sp.titleAR),
			Priority:      sp.priority,
			RequesterName: sp.requester,
			Department:    seedPtr(sp.department),
			Question:      sp.question,
			Tags:          sp.tags,
		}); err != nil {
			return fmt.Errorf("seed consultation %q: %w", sp.titleEN, err)
		}
	}
	return nil
}

// ensureSettlements seeds reconciliation / ADR records anchored to existing
// matters, each with one or more negotiation rounds (CAP-090/091).
func (seed seedDataset) ensureSettlements(ctx context.Context, app *Application) error {
	if app.SettlementService == nil {
		return nil
	}
	if ok, err := seed.hasRows(ctx, app, "legal_settlement", false); err != nil {
		return err
	} else if ok {
		return nil
	}
	matterIDs, err := seed.fetchMatterIDs(ctx, app, 3)
	if err != nil {
		return err
	}
	if len(matterIDs) == 0 {
		return nil // no matters to anchor settlements to
	}

	type settlementSpec struct {
		method       model.SettlementMethod
		title        string
		terms        string
		value        float64
		counterparty string
		rounds       []struct {
			by      string
			value   float64
			terms   string
			outcome string
		}
	}
	specs := []settlementSpec{
		{
			method: model.SettlementMethodMediation, title: "تسوية عبر الوساطة — نزاع توريد",
			terms: "يلتزم الطرف المقابل بسداد الرصيد المستحق على دفعتين مقابل إبراء متبادل من المطالبات.",
			value: 500000, counterparty: "شركة الخليج للتوزيع",
			rounds: []struct {
				by      string
				value   float64
				terms   string
				outcome string
			}{
				{by: "الإدارة القانونية للطرف المقابل", value: 380000, terms: "عرض أولي بمبلغ 380,000 ريال سعودي مع السداد خلال 90 يومًا.", outcome: "counter_proposed"},
				{by: "الإدارة القانونية — شركة عبدالله العثيم", value: 500000, terms: "عرض مقابل بمبلغ 500,000 ريال سعودي على دفعتين.", outcome: "pending"},
			},
		},
		{
			method: model.SettlementMethodReconciliation, title: "صلح — متأخرات إيجار",
			terms: "خطة سداد ودية لمتأخرات الإيجار التجاري المستحقة مع التنازل عن غرامات التأخير.",
			value: 250000, counterparty: "مؤسسة المستأجر السابق",
			rounds: []struct {
				by      string
				value   float64
				terms   string
				outcome string
			}{
				{by: "مؤسسة المستأجر السابق", value: 250000, terms: "قبول سداد كامل أصل المبلغ على ست دفعات شهرية.", outcome: "accepted"},
			},
		},
		{
			method: model.SettlementMethodArbitration, title: "تنفيذ حكم هيئة التحكيم",
			terms: "تسوية مجدولة لتنفيذ حكم هيئة التحكيم في مطالبة مسؤولية المقاول.",
			value: 1200000, counterparty: "مؤسسة نجد للأعمال الكهربائية",
			rounds: []struct {
				by      string
				value   float64
				terms   string
				outcome string
			}{
				{by: "بإشراف هيئة التحكيم", value: 1200000, terms: "جدول زمني لسداد المبلغ المحكوم به.", outcome: "pending"},
			},
		},
	}

	for i, sp := range specs {
		matterID := matterIDs[i%len(matterIDs)]
		st, err := app.SettlementService.OpenReconciliation(ctx, seed.tenantID, seed.systemUser, dto.OpenReconciliationRequest{
			MatterID:         matterID,
			Method:           sp.method,
			Title:            sp.title,
			Terms:            sp.terms,
			Value:            seedPtr(sp.value),
			Currency:         seedPtr("SAR"),
			CounterpartyName: seedPtr(sp.counterparty),
		})
		if err != nil {
			return fmt.Errorf("seed settlement %q: %w", sp.title, err)
		}
		for _, r := range sp.rounds {
			if _, err := app.SettlementService.AddNegotiationRound(ctx, seed.tenantID, seed.systemUser, st.ID, dto.AddNegotiationRoundRequest{
				ProposedBy:    r.by,
				ProposedValue: seedPtr(r.value),
				Currency:      seedPtr("SAR"),
				Terms:         r.terms,
				Outcome:       r.outcome,
			}); err != nil {
				return fmt.Errorf("seed settlement round for %q: %w", sp.title, err)
			}
		}
	}
	return nil
}

// ensureLegalRequests seeds service-desk legal requests (the "My Requests"
// surface, CAP-001/004). Requests span the catalogue's request types and
// priorities; those without approval gating are submitted so the list shows a
// realistic spread of draft and live requests.
func (seed seedDataset) ensureLegalRequests(ctx context.Context, app *Application) error {
	if app.LegalRequestService == nil {
		return nil
	}
	// Threshold (not has-any) gate: requesters may already have raised a few
	// live requests through the wizard, so only treat the surface as populated
	// once it holds a representative spread.
	if n, err := seed.countRows(ctx, app, "legal_requests"); err != nil {
		return err
	} else if n >= 5 {
		return nil
	}

	type requestSpec struct {
		requestType string
		titleEN     string
		titleAR     string
		description string
		requester   string
		department  string
		priority    model.RequestPriority
		urgency     string
		submit      bool
	}
	specs := []requestSpec{
		{
			requestType: "consultation", titleEN: "Advice on distributor exclusivity clause", titleAR: "استشارة بشأن بند الحصرية للموزع",
			description: "مطلوب استشارة قانونية بشأن مدى نفاذ بند الحصرية في اتفاقية موزّع إقليمي.",
			requester:   "مدير إدارة المشتريات", department: "المشتريات", priority: model.RequestPriorityNormal, submit: true,
		},
		{
			requestType: "contract_review", titleEN: "Review of cold-storage lease agreement", titleAR: "مراجعة عقد إيجار مستودع مبرّد",
			description: "مراجعة عقد إيجار منشأة التخزين المبرّد المقترح وإبداء التعديلات عليه قبل التوقيع.",
			requester:   "مدير سلسلة الإمداد", department: "سلسلة الإمداد", priority: model.RequestPriorityNormal, submit: true,
		},
		{
			requestType: "litigation", titleEN: "Litigation study — overdue receivables", titleAR: "دراسة قضائية — ذمم متأخرة",
			description: "تقييم فرص التقاضي لتحصيل ذمم مدينة متأخرة السداد من أحد عملاء الجملة.",
			requester:   "المراقب المالي", department: "المالية", priority: model.RequestPriorityUrgent,
			urgency: "تنقضي المدة المقررة نظامًا لسماع الدعوى بشأن الذمم خلال أربعة أسابيع، مما يستوجب قيد الدعوى قبل انقضائها.", submit: false,
		},
		{
			requestType: "legal_opinion", titleEN: "Preliminary study — franchise expansion", titleAR: "دراسة أولية — توسّع الامتياز التجاري",
			description: "دراسة قانونية أولية لموقف الشركة بشأن النموذج المقترح للتوسع في الامتياز التجاري.",
			requester:   "مسؤول التطوير المؤسسي", department: "الشؤون المؤسسية", priority: model.RequestPriorityNormal, submit: true,
		},
		{
			requestType: "enforcement", titleEN: "Enforcement of supplier judgment", titleAR: "تنفيذ حكم ضد مورّد",
			description: "طلب قيد تنفيذ حكم نهائي صادر في مواجهة مورّد متعثر عن السداد.",
			requester:   "مدير الخزينة", department: "المالية", priority: model.RequestPriorityUrgent,
			urgency: "وردت معلومات عن قيام الطرف المقابل بتصفية أصوله؛ ويتعين تقديم طلب التنفيذ على وجه السرعة حفاظًا على فرص التحصيل.", submit: false,
		},
		{
			requestType: "investigation", titleEN: "Misconduct study — branch cash handling", titleAR: "دراسة تجاوز — التعامل النقدي بالفرع",
			description: "طلب دراسة مخالفة وتجاوز بشأن ملاحظات مبلغ عنها في التعامل النقدي بأحد الفروع.",
			requester:   "مدير العمليات الإقليمي", department: "العمليات", priority: model.RequestPriorityNormal, submit: true,
		},
		{
			requestType: "power_of_attorney", titleEN: "Issuance of PoA for government transactions", titleAR: "إصدار وكالة للمعاملات الحكومية",
			description: "إصدار توكيل يخوّل أحد المديرين إنجاز المعاملات الحكومية والبلدية.",
			requester:   "مسؤول العلاقات الحكومية", department: "العلاقات الحكومية", priority: model.RequestPriorityNormal, submit: false,
		},
	}

	for _, sp := range specs {
		req := dto.CreateLegalRequestRequest{
			RequestType:   sp.requestType,
			Title:         bilingual(sp.titleEN, sp.titleAR),
			Description:   sp.description,
			RequesterName: sp.requester,
			Department:    seedPtr(sp.department),
			Priority:      sp.priority,
		}
		if sp.priority == model.RequestPriorityUrgent {
			req.UrgencyJustification = seedPtr(sp.urgency)
		}
		created, err := app.LegalRequestService.Create(ctx, seed.tenantID, seed.systemUser, req)
		if err != nil {
			return fmt.Errorf("seed legal request %q: %w", sp.titleEN, err)
		}
		if sp.submit {
			if _, err := app.LegalRequestService.Submit(ctx, seed.tenantID, seed.systemUser, created.ID, dto.SubmitLegalRequestRequest{
				Notes: "تم تقديم الطلب عبر قناة الاستقبال المعتمدة.",
			}); err != nil {
				return fmt.Errorf("submit seeded legal request %q: %w", sp.titleEN, err)
			}
		}
	}
	return nil
}

// -----------------------------------------------------------------------------
// Diagram B — active litigation-filing approval chain (CAP-006/007)
// -----------------------------------------------------------------------------

// ensureLitigationApprovalPolicy activates the sequential lawsuit-filing approval
// chain (PRD "Diagram B") as a LIVE policy — not merely a reusable template. Only
// TEMPLATE policies ship out of the box (ensureRequestApprovalPolicyTemplates), and
// a template is inert until an admin instantiates it, so a live `litigation`
// request otherwise routes to a single generic unassigned task. This seeds an
// ACTIVE policy scoped to request_type='litigation' with the three named role
// approvers in DoA order — Department Manager → Business-Unit CEO (Executive
// Manager for the Group) → Legal Director (Legal Department Manager) — so the
// litigation gate is enforced the moment a litigation request is submitted.
//
// Idempotent: a no-op once an active litigation-scoped policy already exists for
// the tenant (a prior seed run or an admin-created one), so re-seeding never
// duplicates the chain or clobbers an operator's edit.
func (seed seedDataset) ensureLitigationApprovalPolicy(ctx context.Context, app *Application) error {
	if app.RequestApprovalPolicyService == nil {
		return nil
	}
	litigation := "litigation"
	active := model.RequestApprovalPolicyStatusActive
	existing, _, err := app.RequestApprovalPolicyService.List(ctx, seed.tenantID, model.RequestApprovalPolicyListFilters{
		RequestType: &litigation,
		Status:      &active,
		Page:        1,
		PerPage:     100,
	})
	if err != nil {
		return fmt.Errorf("list litigation approval policies: %w", err)
	}
	if len(existing) > 0 {
		return nil // an active litigation gate already exists — leave it untouched.
	}

	stage := model.RequestApprovalStageProvider
	req := dto.CreateRequestApprovalPolicyRequest{
		Name:        "سلسلة اعتماد رفع الدعوى القضائية",
		Description: "بوابة اعتماد تسلسلية إلزامية لطلبات التقاضي (مخطط ب): يعتمدها مدير الإدارة الطالبة ثم الرئيس التنفيذي للقطاع ثم مدير الإدارة القانونية بالترتيب قبل قيد الدعوى.",
		Status:      active,
		Priority:    90, // high precedence so it wins scope resolution for litigation.
		RequestType: &litigation,
		Stage:       &stage,
		Currency:    "SAR",
		Mode:        "sequential",
		Quorum:      "all",
		Approvers: []dto.ApprovalPolicyApprover{
			// DoA order, bound to real 14-role-matrix slugs (auth.LegalAffairsRoleDefs),
			// each holding lex:request:approve so every tier can actually sign off.
			{Type: "role", Ref: "legal-dept-manager", Label: "مدير الإدارة الطالبة"},
			{Type: "role", Ref: "legal-bu-ceo", Label: "الرئيس التنفيذي للقطاع"},
			{Type: "role", Ref: "legal-director", Label: "مدير الإدارة القانونية"},
		},
		FormFields: []dto.ApprovalFormFieldRequest{
			{Name: "case_summary", Type: "text", Label: "ملخص موضوع الدعوى", Required: true},
			{Name: "legal_basis", Type: "text", Label: "الأساس النظامي للمطالبة", Required: true},
			{Name: "estimated_exposure", Type: "number", Label: "قيمة المطالبة التقديرية (ريال سعودي)", Required: false},
		},
		Metadata: map[string]any{"seeded": true, "diagram": "B", "chain": "litigation_filing"},
	}
	if _, err := app.RequestApprovalPolicyService.Create(ctx, seed.tenantID, seed.systemUser, req); err != nil {
		if apperrors.IsConflict(err) {
			return nil // raced with an admin/another seeder — the gate exists.
		}
		return fmt.Errorf("seed litigation approval policy: %w", err)
	}
	return nil
}

// -----------------------------------------------------------------------------
// Email intake mailboxes (CAP-002)
// -----------------------------------------------------------------------------

// seedIntakeMailboxSpec is one inbound mailbox → request-type routing binding.
type seedIntakeMailboxSpec struct {
	address     string
	requestType string
	labelAR     string
}

// ensureIntakeMailboxes seeds the ACTIVE email-intake mailboxes for the Al Othaim
// PRD addresses (CAP-002). Without any legal_intake_mailboxes row the admin
// integration health screen flags every email-backed service "email not wired"
// and shows destructive badges, because the email connector's inbound leg grades
// unhealthy when no active mailbox with an ingest secret exists (email_connector
// verifyInboundMailbox). Seeding these — through the real IntakeService so the
// HMAC ingest secret is encrypted at rest exactly as the admin console would
// write it — clears those badges (hasMailbox=true).
//
// Idempotent: existing addresses are skipped, so re-seeding never duplicates a
// mailbox or rotates a live ingest secret.
func (seed seedDataset) ensureIntakeMailboxes(ctx context.Context, app *Application) error {
	if app.IntakeService == nil {
		return nil
	}
	existing, _, err := app.IntakeService.ListMailboxes(ctx, seed.tenantID, model.IntakeMailboxListFilters{Page: 1, PerPage: 200})
	if err != nil {
		return fmt.Errorf("list intake mailboxes: %w", err)
	}
	have := make(map[string]struct{}, len(existing))
	for i := range existing {
		have[normalizeMailboxAddress(existing[i].Address)] = struct{}{}
	}

	specs := []seedIntakeMailboxSpec{
		{address: "contract-legal@othaim.com", requestType: "contract_review", labelAR: "استقبال طلبات مراجعة العقود عبر البريد"},
		{address: "case-legal@othaim.com", requestType: "litigation", labelAR: "استقبال طلبات القضايا والتقاضي عبر البريد"},
		{address: "ref@othaim.com", requestType: "legal_opinion", labelAR: "استقبال طلبات الرأي والدراسات القانونية عبر البريد"},
		{address: "am@othaim.com", requestType: "power_of_attorney", labelAR: "استقبال طلبات إصدار الوكالات والتفاويض عبر البريد"},
	}
	active := true
	for _, sp := range specs {
		if _, seeded := have[normalizeMailboxAddress(sp.address)]; seeded {
			continue
		}
		if _, err := app.IntakeService.CreateMailbox(ctx, seed.tenantID, seed.systemUser, dto.CreateIntakeMailboxRequest{
			Address:      sp.address,
			RequestType:  sp.requestType,
			IngestSecret: intakeMailboxSeedSecret(seed.tenantID, sp.address),
			Active:       &active,
			Metadata:     map[string]any{"seeded": true, "label_ar": sp.labelAR},
		}); err != nil {
			if apperrors.IsConflict(err) {
				continue // raced with another seeder/admin on the unique address.
			}
			return fmt.Errorf("seed intake mailbox %q: %w", sp.address, err)
		}
	}
	return nil
}

// normalizeMailboxAddress lower-cases and trims a mailbox address for comparison.
func normalizeMailboxAddress(addr string) string {
	return strings.ToLower(strings.TrimSpace(addr))
}

// intakeMailboxSeedSecret derives a deterministic per-mailbox HMAC ingest secret
// for demo seeding. It is stable across re-seeds (so it is not rotated) and unique
// per (tenant, address). IntakeService.CreateMailbox encrypts it at rest.
func intakeMailboxSeedSecret(tenantID uuid.UUID, address string) string {
	sum := sha256.Sum256([]byte("lex-intake-ingest:" + tenantID.String() + ":" + normalizeMailboxAddress(address)))
	return "whmac_" + hex.EncodeToString(sum[:])
}

// -----------------------------------------------------------------------------
// Terminal request-processing history → KPI + performance facts (CAP-146..151)
// -----------------------------------------------------------------------------

// seedHistRequestSpec is one historical, fully-delivered legal request used to
// backfill the request-processing performance and SLA-compliance surfaces.
type seedHistRequestSpec struct {
	requestType string
	serviceCode string
	titleEN     string
	titleAR     string
	requester   string
	department  string
	targetDays  int  // working-day SLA target for the service.
	startOffset int  // clock_started_at offset (negative days) from referenceAt.
	processDays int  // wall-clock days from clock start to delivery.
	breached    bool // true => SLA outcome breached; else on_time.
}

// ensureRequestProcessingHistory drives a spread of legal requests to a TERMINAL
// delivered/closed state and produces their processing-time facts through the
// live reporting path, so the KPI + performance tiles render instead of showing
// empty (BLOCKER 6.4 / 11.0). The base seeder only Creates+Submits requests and
// never drives them terminal, so legal_request_execution_state.delivered_at and
// the request_processing duration facts are never written and every performance
// KPI reads zero rows.
//
// For each spec it: (1) gets-or-creates the legal_requests row (real service,
// deterministic request_number for idempotency); (2) writes the canonical source
// rows the reporting consumer reads — legal_request_execution_state (clock start +
// delivered/closed) and legal_sla_clocks (terminal on_time/breached outcome); and
// (3) invokes DurationFactService.UpsertFromSource — the EXACT code path the
// reporting consumer runs — to reconstruct and upsert the request_processing
// duration fact (working-minute math via the tenant calendar, sla_outcome + quarter
// bucketing identical to production). Nothing is hand-inserted into
// lex_duration_facts; the fact is always produced by the live reporting code.
//
// The set spans the last ~4 calendar quarters with a realistic on-time/breached
// mix (2 breached of 24 ⇒ ~91.7% compliance), so the flagship quarterly SLA
// compliance trend (CAP-151) lands in the 90–95% band.
//
// Idempotent: each request is keyed by a deterministic request_number and every
// downstream write is ON CONFLICT DO NOTHING / an idempotent upsert, so a partial
// prior run self-heals and a completed run is a no-op.
func (seed seedDataset) ensureRequestProcessingHistory(ctx context.Context, app *Application) error {
	if app.LegalRequestService == nil || app.DurationFactService == nil {
		return nil
	}

	specs := seedHistRequestSpecs()
	for _, sp := range specs {
		number := seed.histRequestNumber(sp)
		requestID, err := seed.getOrCreateHistRequest(ctx, app, sp, number)
		if err != nil {
			return err
		}

		clockStart := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, sp.startOffset))
		delivered := clockStart.AddDate(0, 0, sp.processDays)
		targetSeconds := int64(sp.targetDays) * 8 * 3600
		turnaroundDue := clockStart.AddDate(0, 0, sp.targetDays)
		outcome := model.SLAClockOutcomeOnTime
		if sp.breached {
			outcome = model.SLAClockOutcomeBreached
		}

		if err := seed.writeHistExecutionState(ctx, app, requestID, clockStart, delivered, targetSeconds); err != nil {
			return err
		}
		if err := seed.writeHistSLAClock(ctx, app, requestID, sp, clockStart, turnaroundDue, delivered, outcome); err != nil {
			return err
		}
		if err := seed.backfillHistRequestRow(ctx, app, requestID, clockStart, delivered); err != nil {
			return err
		}

		// Produce the request_processing duration fact via the live reporting path
		// (reads the source rows just written; computes working minutes + outcome +
		// quarter exactly as the reporting consumer does). Non-fatal: a fact hiccup
		// must not fail the whole seed — the perf tiles still read the source rows.
		if _, err := app.DurationFactService.UpsertFromSource(ctx, seed.tenantID, model.DurationFactRequestProcessing, requestID, delivered); err != nil {
			return fmt.Errorf("upsert request-processing duration fact for %q: %w", number, err)
		}
	}
	return nil
}

// histRequestNumber builds the deterministic request number that keys a historical
// seed request for idempotent get-or-create.
func (seed seedDataset) histRequestNumber(sp seedHistRequestSpec) string {
	return fmt.Sprintf("REQ-HIST-%s-%d", seed.tenantID.String()[:8], -sp.startOffset)
}

// getOrCreateHistRequest resolves the historical request by its deterministic
// number, creating it through the real service when absent. Returns its id.
func (seed seedDataset) getOrCreateHistRequest(ctx context.Context, app *Application, sp seedHistRequestSpec, number string) (uuid.UUID, error) {
	var id uuid.UUID
	err := app.Store.DB().QueryRow(ctx,
		`SELECT id FROM legal_requests WHERE tenant_id = $1 AND request_number = $2 AND deleted_at IS NULL`,
		seed.tenantID, number).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return uuid.Nil, fmt.Errorf("lookup historical request %q: %w", number, err)
	}
	created, cerr := app.LegalRequestService.Create(ctx, seed.tenantID, seed.systemUser, dto.CreateLegalRequestRequest{
		RequestNumber: seedPtr(number),
		RequestType:   sp.requestType,
		Title:         bilingual(sp.titleEN, sp.titleAR),
		Description:   sp.titleAR,
		RequesterName: sp.requester,
		Department:    seedPtr(sp.department),
		Priority:      model.RequestPriorityNormal,
	})
	if cerr != nil {
		return uuid.Nil, fmt.Errorf("seed historical request %q: %w", number, cerr)
	}
	return created.ID, nil
}

// writeHistExecutionState writes the terminal execution-state row (the perf-tile
// source: clock_started_at → delivered_at) for a historical request.
func (seed seedDataset) writeHistExecutionState(ctx context.Context, app *Application, requestID uuid.UUID, clockStart, delivered time.Time, targetSeconds int64) error {
	const sql = `
INSERT INTO legal_request_execution_state (
    tenant_id, legal_request_id, status, clock_started_at, completeness_confirmed_at,
    sla_target_seconds, delivered_at, closed_at, created_by
) VALUES ($1, $2, 'closed', $3, $3, $4, $5, $5, $6)
ON CONFLICT (tenant_id, legal_request_id) DO NOTHING`
	if _, err := app.Store.DB().Exec(ctx, sql, seed.tenantID, requestID, clockStart, targetSeconds, delivered, seed.systemUser); err != nil {
		return fmt.Errorf("seed execution state for historical request %s: %w", requestID, err)
	}
	return nil
}

// writeHistSLAClock writes the resolved SLA clock (the CAP-149/150 source and the
// terminal outcome the request_processing duration fact inherits) for a historical
// request.
func (seed seedDataset) writeHistSLAClock(ctx context.Context, app *Application, requestID uuid.UUID, sp seedHistRequestSpec, clockStart, turnaroundDue, delivered time.Time, outcome model.SLAClockOutcome) error {
	var breachedAt *time.Time
	if outcome == model.SLAClockOutcomeBreached {
		breachedAt = &turnaroundDue
	}
	ackDue := clockStart.AddDate(0, 0, 1)
	l1 := clockStart.AddDate(0, 0, 2)
	l2 := clockStart.AddDate(0, 0, 4)
	l3 := clockStart.AddDate(0, 0, 6)
	const sql = `
INSERT INTO legal_sla_clocks (
    tenant_id, legal_request_id, service_code, priority, clock_started_at,
    ack_due_at, turnaround_due_at, escalation_l1_due_at, escalation_l2_due_at, escalation_l3_due_at,
    ack_done, ack_done_at, breached, breached_at, outcome, resolved_at, created_by
) VALUES ($1, $2, $3, 'normal', $4, $5, $6, $7, $8, $9, true, $5, $10, $11, $12, $13, $14)
ON CONFLICT (tenant_id, legal_request_id, cycle) DO NOTHING`
	if _, err := app.Store.DB().Exec(ctx, sql,
		seed.tenantID, requestID, sp.serviceCode, clockStart,
		ackDue, turnaroundDue, l1, l2, l3,
		outcome == model.SLAClockOutcomeBreached, breachedAt, string(outcome), delivered, seed.systemUser,
	); err != nil {
		return fmt.Errorf("seed sla clock for historical request %s: %w", requestID, err)
	}
	return nil
}

// backfillHistRequestRow ages a historical request into a coherent terminal state
// (status closed, created just before the clock started, updated at delivery) so
// the request list and status reports read as genuine history rather than fresh
// drafts. Bounded to the seeded historical rows via the WHERE guard.
func (seed seedDataset) backfillHistRequestRow(ctx context.Context, app *Application, requestID uuid.UUID, clockStart, delivered time.Time) error {
	submittedAt := clockStart.AddDate(0, 0, -1)
	const sql = `
UPDATE legal_requests
SET status = 'closed', created_at = $3, updated_at = $4
WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`
	if _, err := app.Store.DB().Exec(ctx, sql, seed.tenantID, requestID, submittedAt, delivered); err != nil {
		return fmt.Errorf("age historical request %s: %w", requestID, err)
	}
	return nil
}

// seedHistRequestSpecs returns the 24 historical delivered requests, 6 per quarter
// across the last ~4 quarters (clock-start offsets −30…−300 days), cycling the
// service catalogue's request types. Two are breached (one in Q-2, one in Q-4) for
// a ~91.7% compliance rate that lands the CAP-151 quarterly trend in the 90–95%
// target band.
func seedHistRequestSpecs() []seedHistRequestSpec {
	type tmpl struct {
		requestType string
		serviceCode string
		titleEN     string
		titleAR     string
		requester   string
		department  string
		targetDays  int
		processDays int
	}
	templates := []tmpl{
		{"contract_review", "CONTRACT_REVIEW", "Supplier NDA review", "مراجعة اتفاقية سرية مع مورّد", "مدير المشتريات", "المشتريات", 5, 3},
		{"consultation", "LEGAL_CONSULTATION", "Labor policy consultation", "استشارة بشأن سياسة عمالية", "مدير الموارد البشرية", "الموارد البشرية", 6, 4},
		{"legal_opinion", "LEGAL_OPINION", "Regulatory opinion — new market", "رأي قانوني — دخول سوق جديد", "مسؤول التطوير المؤسسي", "الشؤون المؤسسية", 15, 9},
		{"litigation", "LITIGATION_SUPPORT", "Litigation study — receivables", "دراسة قضائية — ذمم مدينة", "المراقب المالي", "المالية", 30, 12},
		{"enforcement", "ENFORCEMENT_REQUEST", "Judgment enforcement — supplier", "تنفيذ حكم — مورّد متعثر", "مدير الخزينة", "المالية", 20, 8},
		{"contract_review", "CONTRACT_REVIEW", "Lease agreement review", "مراجعة عقد إيجار", "مدير سلسلة الإمداد", "سلسلة الإمداد", 5, 4},
	}
	specs := make([]seedHistRequestSpec, 0, len(templates)*4)
	for q := 0; q < 4; q++ {
		quarterBase := -30 - q*90
		for i, t := range templates {
			breached := (q == 1 && i == 3) || (q == 3 && i == 4)
			processDays := t.processDays
			if breached {
				processDays = t.targetDays + t.targetDays/2 + 4 // comfortably past the target.
			}
			specs = append(specs, seedHistRequestSpec{
				requestType: t.requestType,
				serviceCode: t.serviceCode,
				titleEN:     t.titleEN,
				titleAR:     t.titleAR,
				requester:   t.requester,
				department:  t.department,
				targetDays:  t.targetDays,
				startOffset: quarterBase - i*10,
				processDays: processDays,
				breached:    breached,
			})
		}
	}
	return specs
}
