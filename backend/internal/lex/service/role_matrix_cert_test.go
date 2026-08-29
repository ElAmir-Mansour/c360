package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	lexseeder "github.com/clario360/platform/internal/lex/seeder"
)

// End-to-end certification of the tenant Role-Matrix Import against a REAL
// platform_core database (migration 000031 applied). Exercises the full
// lifecycle: template → dry-run → commit → four-eyes activation → enforcement
// flip through the overlay → rollback → tenant isolation.
//
// Opt-in: set ROLE_MATRIX_CERT_DSN to a platform_core DSN, e.g.
//
//	ROLE_MATRIX_CERT_DSN='postgres://clario:clario_dev_pass@localhost:5436/platform_core' \
//	  GOWORK=off go test ./internal/lex/service/ -run TestRoleMatrixCertification -v
func TestRoleMatrixCertification(t *testing.T) {
	dsn := os.Getenv("ROLE_MATRIX_CERT_DSN")
	if dsn == "" {
		t.Skip("ROLE_MATRIX_CERT_DSN not set; skipping DB-backed certification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Scratch tenant (cascades clean up roles/versions/imports on delete).
	tenantID := uuid.New()
	otherTenantID := uuid.New()
	slugA := "cert-" + tenantID.String()[:8]
	slugB := "cert-" + otherTenantID.String()[:8]
	for _, row := range [][2]any{{tenantID, slugA}, {otherTenantID, slugB}} {
		if _, err := pool.Exec(ctx, `
INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')`,
			row[0], "Role-Matrix Cert "+row[1].(string), row[1]); err != nil {
			t.Fatalf("create scratch tenant: %v", err)
		}
	}
	t.Cleanup(func() {
		cctx, ccancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer ccancel()
		_, _ = pool.Exec(cctx, `DELETE FROM tenants WHERE id = ANY($1)`, []uuid.UUID{tenantID, otherTenantID})
		auth.SetTenantOverlayLoader(nil)
	})

	svc := NewRoleMatrixService(pool, zerolog.Nop())
	importer := uuid.New()
	activator := uuid.New()

	// ── 1. Template: prefilled from the baseline (no imports yet). ──────────
	template, err := svc.Template(ctx, tenantID, true)
	if err != nil {
		t.Fatalf("template: %v", err)
	}
	if len(template.Slugs) != 14 {
		t.Fatalf("template must list the 14 baseline roles, got %d", len(template.Slugs))
	}
	if len(template.Rows) == 0 {
		t.Fatal("template must contain grant rows")
	}

	// ── 1b. ROUND-TRIP FIDELITY: parsing the prefilled template's X marks back
	// into a merge import must be a NO-OP diff (no grant silently added/removed).
	rtGrants := make(map[string][]string)
	for _, slug := range template.Slugs {
		rtGrants[slug] = nil
	}
	permCol := map[string]int{}
	for i, h := range template.Headers {
		permCol[h] = i
	}
	for _, row := range template.Rows {
		perm := row[1]
		for ci, slug := range template.Slugs {
			if row[2+ci] == "X" {
				rtGrants[slug] = append(rtGrants[slug], perm)
			}
		}
	}
	_ = permCol
	rtReq := dto.RoleMatrixImportRequest{Mode: "merge", DryRun: true, Grants: rtGrants}
	rtJob, err := svc.Import(ctx, tenantID, importer, nil, rtReq)
	if err != nil {
		t.Fatalf("round-trip dry-run: %v", err)
	}
	if rtJob.ErrorCount != 0 {
		t.Fatalf("template round-trip must validate cleanly; errors: %+v", rtJob.Errors)
	}
	if rtJob.Diff.GrantsAdded != 0 || rtJob.Diff.GrantsRemoved != 0 {
		t.Fatalf("template round-trip must be a no-op; diff added=%d removed=%d",
			rtJob.Diff.GrantsAdded, rtJob.Diff.GrantsRemoved)
	}

	// ── 2. Dry-run: revoke case:edit from the officer + add a custom role. ──
	grants := baselineGrants()
	edited := make([]string, 0)
	for _, perm := range grants["legal-officer"] {
		if perm != auth.PermLexCaseEdit {
			edited = append(edited, perm)
		}
	}
	grants["legal-officer"] = edited
	grants["legal-paralegal"] = []string{auth.PermLexDocumentView, auth.PermLexDocumentAdd}
	req := dto.RoleMatrixImportRequest{
		Mode: "merge", DryRun: true, SourceFilename: "cert.xlsx", ChangeReason: "certification",
		Roles:  []dto.RoleMatrixImportRole{{Slug: "legal-paralegal", NameEN: "Paralegal", Tier: "Legal", Active: boolPtr(true)}},
		Grants: grants,
	}
	job, err := svc.Import(ctx, tenantID, importer, nil, req)
	if err != nil {
		t.Fatalf("dry-run: %v", err)
	}
	if job.Status != model.RoleMatrixImportValidated || job.ErrorCount != 0 {
		t.Fatalf("dry-run must validate; got %s errors=%+v", job.Status, job.Errors)
	}
	if job.VersionID != nil {
		t.Fatal("dry-run must not create a version")
	}

	// ── 3. Commit → draft version. ──────────────────────────────────────────
	req.DryRun = false
	job, err = svc.Import(ctx, tenantID, importer, nil, req)
	if err != nil {
		t.Fatalf("commit: %v", err)
	}
	if job.Status != model.RoleMatrixImportCommitted || job.VersionID == nil {
		t.Fatalf("commit must create a draft version; got %s", job.Status)
	}
	versionID := *job.VersionID

	// Draft is NOT enforced: no import-provenance roles yet.
	var importedRoles int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM roles WHERE tenant_id=$1 AND source='import'`, tenantID).Scan(&importedRoles)
	if importedRoles != 0 {
		t.Fatalf("draft must not touch roles; found %d import rows", importedRoles)
	}

	// ── 4. Four-eyes: the importer cannot activate their own version. ──────
	if _, err := svc.Activate(ctx, tenantID, importer, versionID); err == nil {
		t.Fatal("importer must NOT be able to activate their own version")
	}

	// ── 5. A second admin activates. ────────────────────────────────────────
	version, err := svc.Activate(ctx, tenantID, activator, versionID)
	if err != nil {
		t.Fatalf("activate: %v", err)
	}
	if version.Status != model.RoleMatrixVersionActive {
		t.Fatalf("expected active, got %s", version.Status)
	}
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM roles WHERE tenant_id=$1 AND source='import' AND active`, tenantID).Scan(&importedRoles)
	if importedRoles < 15 { // 14 baseline + custom
		t.Fatalf("activation must upsert the full matrix; got %d rows", importedRoles)
	}

	// ── 6. ENFORCEMENT FLIP through the real overlay loader. ────────────────
	auth.SetTenantOverlayLoader(NewRoleMatrixOverlayLoader(pool))
	auth.InvalidateTenantOverlay(tenantID.String())

	if auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-officer"}, auth.PermLexCaseEdit) {
		t.Fatal("ENFORCEMENT: officer must have lost case:edit in the imported tenant")
	}
	if !auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-officer"}, auth.PermLexCaseView) {
		t.Fatal("ENFORCEMENT: officer must keep case:view in the imported tenant")
	}
	if !auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-paralegal"}, auth.PermLexDocumentAdd) {
		t.Fatal("ENFORCEMENT: the custom role must be enforced after activation")
	}
	// Baselines fold in for imported roles too (approval inbox keeps working).
	if !auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-officer"}, "workflow:task") {
		t.Fatal("ENFORCEMENT: auto-granted workflow:task must survive an import")
	}
	// Tenant isolation: the OTHER tenant still resolves from the code map.
	if !auth.HasPermissionForTenant(ctx, otherTenantID.String(), []string{"legal-officer"}, auth.PermLexCaseEdit) {
		t.Fatal("ISOLATION: the other tenant's officer must keep the code-map default")
	}
	if auth.HasPermissionForTenant(ctx, otherTenantID.String(), []string{"legal-paralegal"}, auth.PermLexDocumentAdd) {
		t.Fatal("ISOLATION: the custom role must not leak to another tenant")
	}
	// UX parity: /lex/me's source reports exactly what is enforced.
	effective := auth.EffectivePermissionsForTenant(ctx, tenantID.String(), []string{"legal-officer"})
	for _, perm := range effective {
		if perm == auth.PermLexCaseEdit {
			t.Fatal("PARITY: effective permissions must not report the revoked grant")
		}
	}

	// ── 6a2. PERSONA SURFACING: a user holding ONLY the custom import role must
	// be READY with the custom persona, not NO_LEX_ROLE (the P4 limitation is
	// now closed). Uses the REAL reader against platform_core.
	persona := NewPersonaService(&fakePersonaStore{}, zerolog.Nop())
	persona.SetRoleReader(NewRoleMatrixPersonaReader(pool))
	me, err := persona.Resolve(ctx, tenantID, uuid.New(), []string{"legal-paralegal"})
	if err != nil {
		t.Fatalf("persona resolve: %v", err)
	}
	if me.AccessState != AccessStateReady {
		t.Fatalf("PERSONA: a custom-only user must be READY, got %s", me.AccessState)
	}
	if me.ActiveLegalRole == nil || me.ActiveLegalRole.Slug != "legal-paralegal" {
		t.Fatalf("PERSONA: the custom role must be the active persona; got %+v", me.ActiveLegalRole)
	}
	if me.ActiveLegalRole.NameEN != "Paralegal" {
		t.Fatalf("PERSONA: the custom persona must carry its imported name; got %q", me.ActiveLegalRole.NameEN)
	}
	// Its effective permissions come from the overlay (custom grants + baselines).
	hasDocAdd := false
	for _, p := range me.EffectivePermissions {
		if p == auth.PermLexDocumentAdd {
			hasDocAdd = true
		}
	}
	if !hasDocAdd {
		t.Fatal("PERSONA: the custom persona's effective permissions must include its imported grants")
	}

	// ── 6a3. SELF-ESCALATION: an importer holding legal-officer cannot grant
	// their OWN role a permission they lack (four-eyes-independent hard block).
	selfEsc := baselineGrants()
	selfEsc["legal-officer"] = append(selfEsc["legal-officer"], auth.PermLexContractApprove)
	seReq := dto.RoleMatrixImportRequest{Mode: "merge", DryRun: true, Grants: selfEsc}
	seJob, err := svc.Import(ctx, tenantID, importer, []string{"legal-officer"}, seReq)
	if err != nil {
		t.Fatalf("self-escalation dry-run: %v", err)
	}
	sawSelfEsc := false
	for _, issue := range seJob.Errors {
		if issue.CodeKey == "self_escalation" {
			sawSelfEsc = true
		}
	}
	if !sawSelfEsc {
		t.Fatalf("SELF-ESCALATION: granting your own role a held-lacking perm must be blocked; errors=%+v", seJob.Errors)
	}
	// A DIFFERENT admin (holding role:manage, not officer) configuring officer is allowed.
	okJob, err := svc.Import(ctx, tenantID, importer, []string{"legal-system-admin"}, seReq)
	if err != nil {
		t.Fatalf("cross-role dry-run: %v", err)
	}
	for _, issue := range okJob.Errors {
		if issue.CodeKey == "self_escalation" {
			t.Fatal("SELF-ESCALATION: configuring a role the importer does not hold must be allowed")
		}
	}

	// ── 6b. RESTART SURVIVAL: the startup seeder must not clobber the import.
	// lex-service re-runs LegalAffairsRoleSeeder for the seeded tenant on every
	// boot; its import-aware upsert must skip rows owned by an activated
	// import, so the tenant's customisation survives a restart.
	restartSeeder := lexseeder.NewLegalAffairsRoleSeeder(pool, tenantID, zerolog.Nop())
	if _, err := restartSeeder.Seed(ctx); err != nil {
		t.Fatalf("restart seeder: %v", err)
	}
	auth.InvalidateTenantOverlay(tenantID.String())
	if auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-officer"}, auth.PermLexCaseEdit) {
		t.Fatal("SEEDER: a service restart must not clobber the activated import (officer regained the revoked grant)")
	}
	var clobbered int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM roles WHERE tenant_id=$1 AND slug='legal-officer' AND source='import'`, tenantID).Scan(&clobbered)
	if clobbered != 1 {
		t.Fatalf("SEEDER: the imported row's provenance must survive a reseed; got %d", clobbered)
	}

	// ── 6c. TRUE DEACTIVATION REVOKES: replace-mode omission of a baseline
	// role must strip it to nothing (tombstone), NOT fall back to the code map.
	deactivate := baselineGrants()
	delete(deactivate, "legal-bu-ceo") // omit in replace ⇒ deactivate
	deReq := dto.RoleMatrixImportRequest{
		Mode: "replace", DryRun: false, SourceFilename: "deactivate.xlsx",
		ChangeReason: "deactivate bu-ceo", ConfirmWarnings: true, Grants: deactivate,
	}
	deJob, err := svc.Import(ctx, tenantID, importer, nil, deReq)
	if err != nil || deJob.VersionID == nil {
		t.Fatalf("deactivation import failed: %v status=%v", err, deJob.Status)
	}
	if _, err := svc.Activate(ctx, tenantID, activator, *deJob.VersionID); err != nil {
		t.Fatalf("deactivation activate: %v", err)
	}
	auth.InvalidateTenantOverlay(tenantID.String())
	// legal-bu-ceo holds lex:request:approve in the baseline; after deactivation
	// it must grant nothing (the tombstone), not the code-map default.
	if auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-bu-ceo"}, auth.PermLexRequestApprove) {
		t.Fatal("DEACTIVATION: an omitted baseline role must be revoked, not fall back to the code map")
	}
	// The other tenant is unaffected — its bu-ceo keeps the code-map default.
	if !auth.HasPermissionForTenant(ctx, otherTenantID.String(), []string{"legal-bu-ceo"}, auth.PermLexRequestApprove) {
		t.Fatal("ISOLATION: deactivation must not leak to another tenant")
	}

	// ── 7. Rollback: baseline re-import → activate → grant restored. ────────
	restore := dto.RoleMatrixImportRequest{
		Mode: "merge", DryRun: false, SourceFilename: "restore.xlsx", ChangeReason: "rollback certification",
		Grants: baselineGrants(),
	}
	job, err = svc.Import(ctx, tenantID, importer, nil, restore)
	if err != nil || job.Status != model.RoleMatrixImportCommitted || job.VersionID == nil {
		t.Fatalf("restore commit failed: %v status=%v", err, job.Status)
	}
	if _, err := svc.Activate(ctx, tenantID, activator, *job.VersionID); err != nil {
		t.Fatalf("restore activate: %v", err)
	}
	auth.InvalidateTenantOverlay(tenantID.String())
	if !auth.HasPermissionForTenant(ctx, tenantID.String(), []string{"legal-officer"}, auth.PermLexCaseEdit) {
		t.Fatal("ROLLBACK: officer must regain case:edit after re-activating the baseline")
	}

	// Version bookkeeping invariant: EXACTLY one active version at all times,
	// every earlier one superseded, none left dangling as draft.
	var activeCount, supersededCount, draftCount int
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM legal_role_matrix_versions WHERE tenant_id=$1 AND status='active'`, tenantID).Scan(&activeCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM legal_role_matrix_versions WHERE tenant_id=$1 AND status='superseded'`, tenantID).Scan(&supersededCount)
	_ = pool.QueryRow(ctx, `SELECT COUNT(*) FROM legal_role_matrix_versions WHERE tenant_id=$1 AND status='draft'`, tenantID).Scan(&draftCount)
	if activeCount != 1 {
		t.Fatalf("exactly one version must be active; got active=%d", activeCount)
	}
	if supersededCount < 1 || draftCount != 0 {
		t.Fatalf("version bookkeeping wrong: superseded=%d draft=%d (expected superseded>=1, draft=0)", supersededCount, draftCount)
	}
}
