package lex

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	lexseeder "github.com/clario360/platform/internal/lex/seeder"
)

// platformCoreExecer is the narrow platform_core write surface the RBAC
// provisioning step needs (the same Exec shape seeder.Execer requires).
// *pgxpool.Pool satisfies it; unit tests supply an in-memory fake. Kept package-
// local so the testable core (provisionLegalAffairsRBAC) does not depend on the
// concrete pool type.
type platformCoreExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// ProvisionLegalAffairsOptions controls applying the Legal Affairs starter
// template to a tenant.
type ProvisionLegalAffairsOptions struct {
	// TenantID is the tenant to provision. Required (uuid.Nil falls back to the
	// built-in demo tenant, matching SeedDemoDataWithOptions).
	TenantID uuid.UUID
	// SystemUserID is the actor recorded as the creator of seeded config. When
	// uuid.Nil a deterministic system user is used.
	SystemUserID uuid.UUID
	// IncludeSampleData additionally seeds the demo dataset (contracts, cases,
	// investigations, consultations, settlements, …) so the tenant looks alive.
	// Leave false for a real onboarded client — they create their own matters.
	IncludeSampleData bool
	// AdminUserID, when non-nil, is the tenant's onboarding administrator who is
	// granted the 'legal-system-admin' role for the tenant in platform_core after
	// the 14 legal roles are seeded. uuid.Nil means "no admin to bootstrap" (the
	// roles are still seeded; nobody is auto-assigned). Both the role seed and the
	// admin assignment require app.PlatformCorePool != nil and are NON-FATAL.
	AdminUserID uuid.UUID
}

// ProvisionLegalAffairs applies the reusable "Legal Affairs starter template" to
// a tenant. This is the per-tenant entrypoint used by onboarding when a customer
// subscribes to Watheeq, generalised from the demo-tenant startup seed.
//
// CONFIG (always — the structural template a real legal client needs on day one):
//   - the 8-service legal catalog + working-day SLAs (Service Catalog & SLA),
//   - the KSA working calendar,
//   - the request-approval policy templates,
//   - the organisational registry (Company → Shared-Services Unit → Legal Dept →
//     sections) with the responsibility roles the L1/L2/L3 escalation ladder walks.
//
// SAMPLE (opt-in via IncludeSampleData — for a demo tenant only): the full demo
// dataset (contracts/cases/investigations/consultations/settlements/requests).
//
// Every underlying seeder is idempotent (existence-checked), so re-running on an
// already-provisioned tenant is a safe no-op.
func ProvisionLegalAffairs(ctx context.Context, app *Application, logger zerolog.Logger, opts ProvisionLegalAffairsOptions) (uuid.UUID, error) {
	if app == nil || app.Store == nil || app.Store.DB() == nil {
		return uuid.Nil, fmt.Errorf("lex application is not initialized")
	}

	// F37: on a real onboarded tenant the demo-fixture user UUIDs do not exist, so
	// record the tenant's real onboarding admin as the seed system user when no
	// explicit SystemUserID was supplied. This gives org-registry role bindings
	// (the escalation ladder) a real holder instead of a phantom fixture.
	systemUser := opts.SystemUserID
	if systemUser == uuid.Nil {
		systemUser = opts.AdminUserID
	}

	// 1) Apply the lex_db starter template (config, +sample when requested). The
	//    fully-populated path reuses the demo seed verbatim (config + sample), so a
	//    demo tenant gets the identical alive dataset as the built-in tenant.
	var tenantID uuid.UUID
	if opts.IncludeSampleData {
		seededTenant, err := SeedDemoDataWithOptions(ctx, app, logger, SeedDemoOptions{
			TenantID:     opts.TenantID,
			SystemUserID: systemUser,
		})
		if err != nil {
			return uuid.Nil, err
		}
		tenantID = seededTenant
	} else {
		seed := newSeedDataset(SeedDemoOptions{
			TenantID:     opts.TenantID,
			SystemUserID: systemUser,
		})

		// CONFIG-only template, in dependency order (reference data first). Each call
		// is idempotent and tenant-scoped via seed.tenantID.
		if err := seed.ensureServiceCatalog(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision service catalog: %w", err)
		}
		// Per-tenant reference data the empty-`tenants`-shim migrations never seeded
		// (F16): case classifications, SLA targets, attachment policy, connectors.
		if err := seed.ensureReferenceData(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision reference data: %w", err)
		}
		if err := seed.ensureWorkingCalendar(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision working calendar: %w", err)
		}
		if err := seed.ensureRequestApprovalPolicyTemplates(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision request-approval templates: %w", err)
		}
		// Diagram B: the active sequential litigation-filing approval chain is
		// structural config a real litigation client needs on day one, not sample data.
		if err := seed.ensureLitigationApprovalPolicy(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision litigation approval policy: %w", err)
		}
		if err := seed.ensureOrgRegistry(ctx, app); err != nil {
			return uuid.Nil, fmt.Errorf("provision org registry: %w", err)
		}

		logger.Info().
			Str("tenant_id", seed.tenantID.String()).
			Bool("sample_data", false).
			Msg("provisioned Legal Affairs config template")
		tenantID = seed.tenantID
	}

	// 2) platform_core RBAC bootstrap (NON-FATAL — the lex_db template above is the
	//    contract; the role seed + admin assignment are best-effort enrichment).
	//    The roles table lives in platform_core (the shared IAM database), reached
	//    via the persistent app.PlatformCorePool. When that pool is nil (platform_core
	//    unreachable) the roles are still enforced via the auth code map, so we just
	//    warn and skip — the tenant is fully provisioned in lex_db regardless.
	provisionLegalAffairsRBAC(ctx, app, logger, tenantID, opts.AdminUserID)

	return tenantID, nil
}

// provisionLegalAffairsRBAC seeds the 14 Legal System roles for the tenant in
// platform_core and (when adminUserID is non-nil) grants that user the
// 'legal-system-admin' role. Both steps are idempotent and NON-FATAL: any error
// is logged and the provision continues, because the lex_db template — not the
// platform_core RBAC mirror — is the provisioning contract. When
// app.PlatformCorePool is nil (platform_core unreachable) both steps are skipped
// with a warning (roles remain enforced via the auth.RolePermissions code map).
func provisionLegalAffairsRBAC(ctx context.Context, app *Application, logger zerolog.Logger, tenantID, adminUserID uuid.UUID) {
	if app.PlatformCorePool == nil {
		logger.Warn().
			Str("tenant_id", tenantID.String()).
			Msg("platform_core pool unavailable; skipping legal role seed + admin assignment (roles enforced via code map)")
		return
	}
	seedLegalAffairsRBAC(ctx, app.PlatformCorePool, logger, tenantID, adminUserID)
}

// seedLegalAffairsRBAC is the testable core of the RBAC bootstrap: given a
// platform_core executor it seeds the 14 legal roles + (optionally) assigns the
// admin the legal-system-admin role. Both steps are idempotent and NON-FATAL.
func seedLegalAffairsRBAC(ctx context.Context, db platformCoreExecer, logger zerolog.Logger, tenantID, adminUserID uuid.UUID) {
	// 2a) Seed the 14 legal roles + SSD exclusions for the tenant. Same idempotent
	//     seeder lex-service startup uses. Log + continue on error.
	roleSeeder := lexseeder.NewLegalAffairsRoleSeeder(db, tenantID, logger)
	if n, err := roleSeeder.Seed(ctx); err != nil {
		logger.Error().Err(err).
			Str("tenant_id", tenantID.String()).
			Msg("legal role-matrix seed failed during provisioning (non-fatal; roles enforced via code map)")
	} else {
		logger.Info().
			Str("tenant_id", tenantID.String()).
			Int("roles", n).
			Msg("seeded legal role-matrix for provisioned tenant")
	}

	// 2b) Grant the onboarding admin the legal-system-admin role for the tenant.
	//     Idempotent INSERT … SELECT (resolves the seeded role id by tenant+slug)
	//     … ON CONFLICT DO NOTHING. Skipped when no admin user was supplied.
	if adminUserID == uuid.Nil {
		return
	}
	const assignSQL = `
INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by)
SELECT $1, r.id, $2, NULL
FROM roles r
WHERE r.tenant_id = $2 AND r.slug = 'legal-system-admin'
ON CONFLICT (user_id, role_id) DO NOTHING`
	tag, err := db.Exec(ctx, assignSQL, adminUserID, tenantID)
	if err != nil {
		logger.Error().Err(err).
			Str("tenant_id", tenantID.String()).
			Str("admin_user_id", adminUserID.String()).
			Msg("legal-system-admin assignment failed during provisioning (non-fatal)")
		return
	}
	logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("admin_user_id", adminUserID.String()).
		Int64("rows", tag.RowsAffected()).
		Msg("assigned legal-system-admin role to onboarding admin")
}
