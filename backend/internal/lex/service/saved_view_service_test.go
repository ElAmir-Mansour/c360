package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// Role slugs from the 14-role legal matrix (auth/legal_roles.go):
//   - legal-director / legal-system-admin carry lex:catalog:manage;
//   - legal-auditor is the read-only oversight role (lex:catalog:view only).
const (
	roleWithCatalogManage    = "legal-director"
	adminWithCatalogManage   = "legal-system-admin"
	roleWithoutCatalogManage = "legal-auditor"
)

func personalView(owner uuid.UUID) *model.SavedView {
	return &model.SavedView{ID: uuid.New(), OwnerUserID: owner, Namespace: "lex-contracts", Name: "Mine", Scope: model.SavedViewScopePersonal}
}

func sharedView(owner uuid.UUID, scope string) *model.SavedView {
	return &model.SavedView{ID: uuid.New(), OwnerUserID: owner, Namespace: "lex-contracts", Name: "Shared", Scope: scope}
}

func strPtr(s string) *string { return &s }

func TestCanReadSavedViewPersonalIsOwnerOnly(t *testing.T) {
	owner := uuid.New()
	stranger := uuid.New()
	view := personalView(owner)

	if !canReadSavedView(view, owner) {
		t.Fatalf("owner cannot read own personal view")
	}
	if canReadSavedView(view, stranger) {
		t.Fatalf("stranger can read another user's personal view")
	}
	if canReadSavedView(nil, owner) {
		t.Fatalf("nil view is readable")
	}
}

func TestCanReadSavedViewSharedIsTenantWide(t *testing.T) {
	owner := uuid.New()
	stranger := uuid.New()
	for _, scope := range []string{model.SavedViewScopeTeam, model.SavedViewScopeOrg} {
		if !canReadSavedView(sharedView(owner, scope), stranger) {
			t.Fatalf("scope %q: non-owner cannot read a shared view", scope)
		}
	}
}

func TestCanWriteSavedViewOwnerAlwaysWrites(t *testing.T) {
	owner := uuid.New()
	for _, scope := range []string{model.SavedViewScopePersonal, model.SavedViewScopeTeam, model.SavedViewScopeOrg} {
		view := sharedView(owner, scope)
		if !canWriteSavedView(context.Background(), view, owner, nil) {
			t.Fatalf("scope %q: owner (no roles) cannot write own view", scope)
		}
	}
}

func TestCanWriteSavedViewPersonalNeverWritableByOthers(t *testing.T) {
	view := personalView(uuid.New())
	stranger := uuid.New()

	// Even the config-authority roles must NOT reach another user's personal view.
	for _, roles := range [][]string{nil, {roleWithoutCatalogManage}, {roleWithCatalogManage}, {adminWithCatalogManage}} {
		if canWriteSavedView(context.Background(), view, stranger, roles) {
			t.Fatalf("roles %v: non-owner can write another user's personal view", roles)
		}
	}
}

func TestCanWriteSavedViewSharedRequiresOwnerOrCatalogManage(t *testing.T) {
	stranger := uuid.New()
	for _, scope := range []string{model.SavedViewScopeTeam, model.SavedViewScopeOrg} {
		view := sharedView(uuid.New(), scope)
		if canWriteSavedView(context.Background(), view, stranger, nil) {
			t.Fatalf("scope %q: role-less non-owner can write shared view", scope)
		}
		if canWriteSavedView(context.Background(), view, stranger, []string{roleWithoutCatalogManage}) {
			t.Fatalf("scope %q: auditor (catalog:view only) can write shared view", scope)
		}
		if !canWriteSavedView(context.Background(), view, stranger, []string{roleWithCatalogManage}) {
			t.Fatalf("scope %q: legal-director (catalog:manage) cannot write shared view", scope)
		}
		if !canWriteSavedView(context.Background(), view, stranger, []string{adminWithCatalogManage}) {
			t.Fatalf("scope %q: legal-system-admin (catalog:manage) cannot write shared view", scope)
		}
	}
}

func TestCanManageSavedViewRoleDefaults(t *testing.T) {
	if canManageSavedViewRoleDefaults(context.Background(), nil) {
		t.Fatalf("no roles grants role-default management")
	}
	if canManageSavedViewRoleDefaults(context.Background(), []string{roleWithoutCatalogManage}) {
		t.Fatalf("legal-auditor grants role-default management")
	}
	if !canManageSavedViewRoleDefaults(context.Background(), []string{roleWithCatalogManage}) {
		t.Fatalf("legal-director denied role-default management")
	}
	if !canManageSavedViewRoleDefaults(context.Background(), []string{adminWithCatalogManage}) {
		t.Fatalf("legal-system-admin denied role-default management")
	}
}

func TestSavedViewRoleDefaultChanged(t *testing.T) {
	withDefault := sharedView(uuid.New(), model.SavedViewScopeTeam)
	withDefault.RoleSlug = strPtr("legal-officer")
	without := sharedView(uuid.New(), model.SavedViewScopeTeam)

	cases := []struct {
		name     string
		existing *model.SavedView
		req      dto.UpdateSavedViewRequest
		want     bool
	}{
		{"nil slug is unchanged", withDefault, dto.UpdateSavedViewRequest{}, false},
		{"clear on view without default is a no-op", without, dto.UpdateSavedViewRequest{RoleSlug: strPtr("")}, false},
		{"clear on view with default is a change", withDefault, dto.UpdateSavedViewRequest{RoleSlug: strPtr("")}, true},
		{"same slug is unchanged", withDefault, dto.UpdateSavedViewRequest{RoleSlug: strPtr("legal-officer")}, false},
		{"different slug is a change", withDefault, dto.UpdateSavedViewRequest{RoleSlug: strPtr("legal-director")}, true},
		{"setting on view without default is a change", without, dto.UpdateSavedViewRequest{RoleSlug: strPtr("legal-officer")}, true},
	}
	for _, tc := range cases {
		if got := savedViewRoleDefaultChanged(tc.existing, tc.req); got != tc.want {
			t.Fatalf("%s: savedViewRoleDefaultChanged = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestApplySavedViewUpdateMergesFields(t *testing.T) {
	view := sharedView(uuid.New(), model.SavedViewScopeTeam)
	view.Payload = map[string]any{"density": "compact"}

	err := applySavedViewUpdate(view, dto.UpdateSavedViewRequest{
		Name:     strPtr("Renewals Q3"),
		RoleSlug: strPtr("legal-officer"),
		Payload:  map[string]any{"view": "board"},
	})
	if err != nil {
		t.Fatalf("applySavedViewUpdate: %v", err)
	}
	if view.Name != "Renewals Q3" {
		t.Fatalf("Name = %q", view.Name)
	}
	if view.Scope != model.SavedViewScopeTeam {
		t.Fatalf("Scope changed unexpectedly: %q", view.Scope)
	}
	if view.RoleSlug == nil || *view.RoleSlug != "legal-officer" {
		t.Fatalf("RoleSlug = %v", view.RoleSlug)
	}
	if view.Payload["view"] != "board" || len(view.Payload) != 1 {
		t.Fatalf("Payload not replaced: %v", view.Payload)
	}
}

func TestApplySavedViewUpdateClearsRoleDefault(t *testing.T) {
	view := sharedView(uuid.New(), model.SavedViewScopeOrg)
	view.RoleSlug = strPtr("legal-officer")

	if err := applySavedViewUpdate(view, dto.UpdateSavedViewRequest{RoleSlug: strPtr("")}); err != nil {
		t.Fatalf("applySavedViewUpdate: %v", err)
	}
	if view.RoleSlug != nil {
		t.Fatalf("RoleSlug not cleared: %v", *view.RoleSlug)
	}
}

func TestApplySavedViewUpdateRejectsPersonalRoleDefault(t *testing.T) {
	// Demoting a role-default view to personal without clearing the default
	// would strand a default nobody else can read — must be rejected.
	view := sharedView(uuid.New(), model.SavedViewScopeTeam)
	view.RoleSlug = strPtr("legal-officer")

	scope := model.SavedViewScopePersonal
	if err := applySavedViewUpdate(view, dto.UpdateSavedViewRequest{Scope: &scope}); err == nil {
		t.Fatalf("expected validation error demoting a role-default view to personal")
	}

	// Setting a role default directly onto a personal view is equally invalid.
	personal := personalView(uuid.New())
	if err := applySavedViewUpdate(personal, dto.UpdateSavedViewRequest{RoleSlug: strPtr("legal-officer")}); err == nil {
		t.Fatalf("expected validation error setting a role default on a personal view")
	}

	// But demoting to personal WHILE clearing the default in the same request is fine.
	view2 := sharedView(uuid.New(), model.SavedViewScopeTeam)
	view2.RoleSlug = strPtr("legal-officer")
	if err := applySavedViewUpdate(view2, dto.UpdateSavedViewRequest{Scope: &scope, RoleSlug: strPtr("")}); err != nil {
		t.Fatalf("demote-to-personal with cleared role default should pass: %v", err)
	}
}
