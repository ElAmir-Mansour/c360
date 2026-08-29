package dto

import (
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

func TestCreateOrgEntityRequestNormalize(t *testing.T) {
	req := CreateOrgEntityRequest{
		Code: " dept-01 ",
		Name: forms.LocalizedText{
			AR: " Legal Department AR ",
			EN: " Legal Department ",
		},
		Roles: []OrgRoleRequest{
			{
				RoleKey: model.OrgRoleLegalDirector,
				UserID:  uuid.New(),
				Label: forms.LocalizedText{
					AR: " Legal Director AR ",
					EN: " Legal Director ",
				},
			},
		},
	}

	req.Normalize()

	if req.Code != "DEPT-01" {
		t.Fatalf("Code = %q, want DEPT-01", req.Code)
	}
	if req.EntityType != model.OrgEntityTypeDepartment {
		t.Fatalf("EntityType = %q, want department default", req.EntityType)
	}
	if req.Name.AR != "Legal Department AR" || req.Name.EN != "Legal Department" {
		t.Fatalf("Name = %#v, want trimmed localized text", req.Name)
	}
	if req.Metadata == nil {
		t.Fatal("Metadata = nil, want empty map")
	}
	if got := req.Roles[0].Label; got.AR != "Legal Director AR" || got.EN != "Legal Director" {
		t.Fatalf("Role label = %#v, want trimmed localized text", got)
	}
}

func TestUpdateOrgEntityRequestNormalize(t *testing.T) {
	code := " sec-02 "
	name := forms.LocalizedText{AR: " Section AR ", EN: " Section "}
	req := UpdateOrgEntityRequest{
		Code: &code,
		Name: &name,
	}

	req.Normalize()

	if req.Code == nil || *req.Code != "SEC-02" {
		t.Fatalf("Code = %v, want SEC-02", req.Code)
	}
	if req.Name == nil || req.Name.AR != "Section AR" || req.Name.EN != "Section" {
		t.Fatalf("Name = %#v, want trimmed localized text", req.Name)
	}
}
