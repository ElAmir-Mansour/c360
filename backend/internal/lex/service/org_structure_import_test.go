package service

import (
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func importRow(row int, code, parent string) dto.OrgStructureImportRow {
	return dto.OrgStructureImportRow{Row: row, Code: code, ParentCode: parent, EntityType: model.OrgEntityTypeDepartment, Name: forms.LocalizedText{EN: code}}
}

func TestBuildOrgImportPlanTopologicallySortsParents(t *testing.T) {
	req := dto.OrgStructureImportRequest{Mode: dto.OrgImportMerge, Rows: []dto.OrgStructureImportRow{
		importRow(2, "TEAM", "DEPT"), importRow(3, "ROOT", ""), importRow(4, "DEPT", "ROOT"),
	}}
	plan := buildOrgImportPlan(req, nil)
	if len(plan.errors) != 0 {
		t.Fatalf("unexpected errors: %+v", plan.errors)
	}
	got := []string{plan.ordered[0].Code, plan.ordered[1].Code, plan.ordered[2].Code}
	want := []string{"ROOT", "DEPT", "TEAM"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order = %v, want %v", got, want)
		}
	}
}

func TestBuildOrgImportPlanRejectsDuplicateAndCycle(t *testing.T) {
	req := dto.OrgStructureImportRequest{Mode: dto.OrgImportMerge, Rows: []dto.OrgStructureImportRow{
		importRow(2, "A", "B"), importRow(3, "B", "A"), importRow(4, "A", ""),
	}}
	plan := buildOrgImportPlan(req, nil)
	wanted := map[string]bool{"duplicate_code": false, "cycle": false}
	for _, issue := range plan.errors {
		if _, ok := wanted[issue.CodeKey]; ok {
			wanted[issue.CodeKey] = true
		}
	}
	for code, found := range wanted {
		if !found {
			t.Fatalf("missing %s in %+v", code, plan.errors)
		}
	}
}

func TestBuildOrgImportPlanReplaceRequiresParentsAndCountsDeactivations(t *testing.T) {
	rootID := uuid.New()
	existing := []model.OrgEntity{
		{ID: rootID, Code: "ROOT", EntityType: model.OrgEntityTypeCompany, Name: forms.LocalizedText{EN: "Root"}},
		{ID: uuid.New(), Code: "OLD", ParentID: &rootID, Path: []string{rootID.String()}, EntityType: model.OrgEntityTypeDepartment, Name: forms.LocalizedText{EN: "Old"}},
	}
	req := dto.OrgStructureImportRequest{Mode: dto.OrgImportReplace, Rows: []dto.OrgStructureImportRow{importRow(2, "NEW", "ROOT")}}
	plan := buildOrgImportPlan(req, existing)
	if plan.deactivates != 2 {
		t.Fatalf("deactivates = %d, want 2", plan.deactivates)
	}
	found := false
	for _, issue := range plan.errors {
		if issue.CodeKey == "parent_omitted" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected parent_omitted, got %+v", plan.errors)
	}
}

func TestBuildOrgImportPlanValidatesRolesAndEmployees(t *testing.T) {
	row := importRow(2, "LEGAL", "")
	row.Roles = []dto.OrgRoleRequest{{RoleKey: model.OrgRoleLegalDirector, UserID: uuid.New()}}
	row.Employees = []dto.OrgEmployeeRequest{{UserID: uuid.New()}, {UserID: uuid.Nil}}
	plan := buildOrgImportPlan(dto.OrgStructureImportRequest{Mode: dto.OrgImportMerge, Rows: []dto.OrgStructureImportRow{row}}, nil)
	if plan.roles != 1 || plan.employees != 2 {
		t.Fatalf("counts roles=%d employees=%d", plan.roles, plan.employees)
	}
	found := false
	for _, issue := range plan.errors {
		if issue.Field == "employees" && issue.CodeKey == "invalid_user" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected invalid employee error, got %+v", plan.errors)
	}
}
