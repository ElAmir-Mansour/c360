package dto

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestIsValidSavedViewNamespace(t *testing.T) {
	valid := []string{"lex-contracts", "lex-matters", "a", "lex.contracts_v2"}
	for _, ns := range valid {
		if !IsValidSavedViewNamespace(ns) {
			t.Fatalf("namespace %q should be valid", ns)
		}
	}
	invalid := []string{"", "-lex", "_lex", "Lex-Contracts", "lex contracts", "lex/contracts",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" /* 65 */}
	for _, ns := range invalid {
		if IsValidSavedViewNamespace(ns) {
			t.Fatalf("namespace %q should be invalid", ns)
		}
	}
}

func TestCreateSavedViewRequestNormalizeDefaults(t *testing.T) {
	blank := "  "
	req := CreateSavedViewRequest{Namespace: " Lex-Contracts ", Name: "  My view ", RoleSlug: &blank}
	req.Normalize()

	if req.Namespace != "lex-contracts" {
		t.Fatalf("Namespace = %q", req.Namespace)
	}
	if req.Name != "My view" {
		t.Fatalf("Name = %q", req.Name)
	}
	if req.Scope != model.SavedViewScopePersonal {
		t.Fatalf("Scope default = %q, want personal", req.Scope)
	}
	if req.RoleSlug != nil {
		t.Fatalf("blank RoleSlug should normalize to nil, got %q", *req.RoleSlug)
	}
	if req.Payload == nil || len(req.Payload) != 0 {
		t.Fatalf("nil Payload should normalize to empty object, got %v", req.Payload)
	}
}

func TestCreateSavedViewRequestValidate(t *testing.T) {
	slug := "legal-officer"

	// role_slug on a personal view is rejected (a personal view cannot be a role default).
	req := CreateSavedViewRequest{Namespace: "lex-contracts", Name: "n", Scope: model.SavedViewScopePersonal, RoleSlug: &slug}
	req.Normalize()
	fields := req.Validate()
	if fields == nil || fields["role_slug"] == "" {
		t.Fatalf("expected role_slug error for personal scope, got %v", fields)
	}

	// The same request on a shared scope passes.
	req.Scope = model.SavedViewScopeTeam
	if fields := req.Validate(); fields != nil {
		t.Fatalf("team-scoped role default should validate, got %v", fields)
	}

	bad := CreateSavedViewRequest{Namespace: "bad ns", Scope: "everyone"}
	bad.Normalize()
	fields = bad.Validate()
	for _, key := range []string{"namespace", "name", "scope"} {
		if fields[key] == "" {
			t.Fatalf("expected %s error, got %v", key, fields)
		}
	}
}

func TestUpdateSavedViewRequestTriStateRoleSlug(t *testing.T) {
	// Provided-but-blank must SURVIVE Normalize as the "clear" sentinel.
	blank := " "
	req := UpdateSavedViewRequest{RoleSlug: &blank}
	req.Normalize()
	if req.RoleSlug == nil || *req.RoleSlug != "" {
		t.Fatalf("blank RoleSlug should stay non-nil empty (clear sentinel), got %v", req.RoleSlug)
	}

	upper := " Legal-Officer "
	req = UpdateSavedViewRequest{RoleSlug: &upper}
	req.Normalize()
	if req.RoleSlug == nil || *req.RoleSlug != "legal-officer" {
		t.Fatalf("RoleSlug = %v, want legal-officer", req.RoleSlug)
	}

	req = UpdateSavedViewRequest{}
	req.Normalize()
	if req.RoleSlug != nil {
		t.Fatalf("absent RoleSlug should stay nil")
	}
	if !req.IsEmpty() {
		t.Fatalf("empty update should report IsEmpty")
	}
}

func TestUpdateSavedViewRequestValidate(t *testing.T) {
	blankName := "  "
	req := UpdateSavedViewRequest{Name: &blankName}
	req.Normalize()
	if fields := req.Validate(); fields == nil || fields["name"] == "" {
		t.Fatalf("expected name error, got %v", fields)
	}

	badScope := "shared"
	req = UpdateSavedViewRequest{Scope: &badScope}
	req.Normalize()
	if fields := req.Validate(); fields == nil || fields["scope"] == "" {
		t.Fatalf("expected scope error, got %v", fields)
	}
}
