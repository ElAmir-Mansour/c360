package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
)

type caseIntakeTaskRepoStub struct {
	roles    []string
	statuses []string
	matches  []workflowrepo.TaskMetadataMatch
	limit    int
	offset   int
}

func (s *caseIntakeTaskRepoStub) ListForUserMatchingMetadata(
	_ context.Context,
	_, _ string,
	roles, statuses []string,
	matches []workflowrepo.TaskMetadataMatch,
	_, _ string,
	limit, offset int,
) ([]*workflowmodel.HumanTask, int, error) {
	s.roles = append([]string(nil), roles...)
	s.statuses = append([]string(nil), statuses...)
	s.matches = append([]workflowrepo.TaskMetadataMatch(nil), matches...)
	s.limit = limit
	s.offset = offset
	return []*workflowmodel.HumanTask{}, 0, nil
}

func TestValidateCaseIntakePhase1StartRequiresDirectiveEvidenceAndStrength(t *testing.T) {
	strength := model.CaseStrengthStrong
	tests := []struct {
		name      string
		req       dto.StartCaseIntakeRequest
		wantField string
	}{
		{
			name:      "missing CEO directive",
			req:       dto.StartCaseIntakeRequest{DoAAuthorityRef: ptrString("DOA-1"), StrengthAssessment: &strength},
			wantField: "ceo_directive_ref",
		},
		{
			name:      "missing DoA reference",
			req:       dto.StartCaseIntakeRequest{CEODirectiveRef: ptrString("CEO-1"), StrengthAssessment: &strength},
			wantField: "doa_authority_ref",
		},
		{
			name:      "missing strength assessment",
			req:       dto.StartCaseIntakeRequest{CEODirectiveRef: ptrString("CEO-1"), DoAAuthorityRef: ptrString("DOA-1")},
			wantField: "strength_assessment",
		},
		{
			name:      "invalid strength assessment",
			req:       dto.StartCaseIntakeRequest{CEODirectiveRef: ptrString("CEO-1"), DoAAuthorityRef: ptrString("DOA-1"), StrengthAssessment: ptrCaseStrength(model.CaseStrength("medium"))},
			wantField: "strength_assessment",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.req.Normalize()
			err := validateCaseIntakePhase1Start(tt.req)
			if err == nil {
				t.Fatal("expected validation error")
			}
			var appErr *apperrors.AppError
			if !errors.As(err, &appErr) {
				t.Fatalf("error type = %T, want *AppError", err)
			}
			if _, ok := appErr.Fields[tt.wantField]; !ok {
				t.Fatalf("fields = %+v, want %s", appErr.Fields, tt.wantField)
			}
		})
	}

	valid := dto.StartCaseIntakeRequest{
		CEODirectiveRef:    ptrString("CEO-1"),
		DoAAuthorityRef:    ptrString("DOA-1"),
		StrengthAssessment: &strength,
	}
	valid.Normalize()
	if err := validateCaseIntakePhase1Start(valid); err != nil {
		t.Fatalf("valid directive evidence failed: %v", err)
	}
}

func TestBuildDirectiveTaskStampsTwoTierLegalChain(t *testing.T) {
	svc := &LegalCaseIntakeService{}
	tenantID := uuid.New()
	submittedBy := uuid.New()
	now := time.Date(2026, 6, 25, 9, 0, 0, 0, time.UTC)
	c := &model.LegalCase{ID: uuid.New(), CaseNumber: "CASE-20260625-1"}
	instance := &workflowmodel.WorkflowInstance{ID: uuid.NewString()}
	step := &workflowmodel.StepExecution{ID: uuid.NewString()}
	doaRef := "DOA-2026-001"

	task := svc.buildDirectiveTask(tenantID, submittedBy, "Aisha Director", c, instance, step, dto.StartCaseIntakeRequest{DoAAuthorityRef: &doaRef}, now)

	// The initial task is addressed to the first tier (cases manager). Both tiers
	// hold lex:case:approve so each can clear the case-decision route gate; the CEO
	// is not an approver (SoD scopes legal-ceo to lex:request:approve only).
	if task.AssigneeRole == nil || *task.AssigneeRole != "legal-cases-manager" {
		t.Fatalf("first approver role = %v, want legal-cases-manager", task.AssigneeRole)
	}
	if task.Metadata["require_authority_evidence"] != true {
		t.Fatalf("require_authority_evidence = %v, want true", task.Metadata["require_authority_evidence"])
	}
	if task.Metadata["doa_authority_ref"] != doaRef {
		t.Fatalf("doa_authority_ref = %v, want %s", task.Metadata["doa_authority_ref"], doaRef)
	}
	if task.Metadata["submitted_by"] != submittedBy.String() || task.Metadata["submitted_by_name"] != "Aisha Director" {
		t.Fatalf("submitted-by metadata = %v/%v, want canonical initiator", task.Metadata["submitted_by"], task.Metadata["submitted_by_name"])
	}
	policy, ok := task.Metadata["approval_policy"].(map[string]any)
	if !ok || policy["require_authority_evidence"] != true || policy["currency"] != "SAR" {
		t.Fatalf("approval_policy = %#v, want required SAR evidence", task.Metadata["approval_policy"])
	}
	if task.Metadata["approval_chain"] != true {
		t.Fatalf("approval_chain = %v, want true", task.Metadata["approval_chain"])
	}
	if got := task.Metadata["approver_total"]; got != 2 {
		t.Fatalf("approver_total = %v, want 2", got)
	}
	chain, ok := task.Metadata["approval_chain_config"].(map[string]any)
	if !ok {
		t.Fatalf("approval_chain_config = %T, want map", task.Metadata["approval_chain_config"])
	}
	if distinct, _ := chain["require_distinct_approvers"].(bool); !distinct {
		t.Fatalf("require_distinct_approvers = %v, want true", chain["require_distinct_approvers"])
	}
	approvers, ok := chain["approvers"].([]any)
	if !ok || len(approvers) != 2 {
		t.Fatalf("approvers = %#v, want two-tier chain", chain["approvers"])
	}
	first, _ := approvers[0].(map[string]any)
	second, _ := approvers[1].(map[string]any)
	if first["type"] != "role" || first["ref"] != "legal-cases-manager" {
		t.Fatalf("first approver = %#v, want legal-cases-manager role", first)
	}
	if second["type"] != "role" || second["ref"] != "legal-director" {
		t.Fatalf("second approver = %#v, want legal-director role", second)
	}

	// The shared orchestrator reconstructs this config when each decision is
	// resumed. One unrestricted demo account may act on either tier, but cannot
	// act on BOTH tiers of the same case; admin and director must be distinct.
	cfg := orchestratorChainConfig(task.Metadata)
	if !cfg.RequireDistinctApprovers {
		t.Fatalf("orchestratorChainConfig dropped distinct-approver SoD: %+v", cfg)
	}
	adminActor := uuid.NewString()
	directorActor := uuid.NewString()
	sameActor := []workflowexec.ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: workflowexec.DecisionApprove, DecidedBy: adminActor},
		{Approver: cfg.Approvers[1], Decision: workflowexec.DecisionApprove, DecidedBy: adminActor},
	}
	if actor, conflict := workflowexec.DistinctApproverConflict(cfg, sameActor); !conflict {
		t.Fatalf("one demo admin deciding both case tiers must conflict; actor=%q", actor)
	}
	distinctActors := []workflowexec.ApproverDecision{
		{Approver: cfg.Approvers[0], Decision: workflowexec.DecisionApprove, DecidedBy: adminActor},
		{Approver: cfg.Approvers[1], Decision: workflowexec.DecisionApprove, DecidedBy: directorActor},
	}
	if actor, conflict := workflowexec.DistinctApproverConflict(cfg, distinctActors); conflict {
		t.Fatalf("distinct admin/director decisions must pass; conflict actor=%q", actor)
	}
}

func TestListCurrentCaseIntakeTasksUsesLexRepoVisibilityAndPagination(t *testing.T) {
	repo := &caseIntakeTaskRepoStub{}
	svc := &LegalCaseIntakeService{taskRepo: repo}

	if _, _, err := svc.ListCurrentTasks(
		context.Background(), uuid.New(), uuid.New(), []string{"tenant_admin"}, 2, 25,
	); err != nil {
		t.Fatalf("ListCurrentTasks() error = %v", err)
	}

	for _, want := range []string{"tenant_admin", "tenant-admin"} {
		if !containsString(repo.roles, want) {
			t.Errorf("visibility roles = %v, missing %q", repo.roles, want)
		}
	}
	for _, forbidden := range []string{"legal-cases-manager", "legal-director"} {
		if containsString(repo.roles, forbidden) {
			t.Errorf("visibility roles = %v, tenant admin must not inherit %q", repo.roles, forbidden)
		}
	}
	wantStatuses := []string{
		workflowmodel.TaskStatusPending,
		workflowmodel.TaskStatusClaimed,
		workflowmodel.TaskStatusEscalated,
	}
	for _, want := range wantStatuses {
		if !containsString(repo.statuses, want) {
			t.Errorf("statuses = %v, missing %q", repo.statuses, want)
		}
	}
	if repo.limit != 25 || repo.offset != 25 {
		t.Errorf("pagination limit/offset = %d/%d, want 25/25", repo.limit, repo.offset)
	}
	if len(repo.matches) != 2 || repo.matches[0] != (workflowrepo.TaskMetadataMatch{Key: "subject_type", Value: "legal_case"}) || repo.matches[1] != (workflowrepo.TaskMetadataMatch{Key: "source", Value: "lex_case_intake"}) {
		t.Errorf("metadata matches = %#v, want legal-case AND lex-case-intake", repo.matches)
	}
}

func TestCaseIntakeVisibilityRolesBroadensBreakGlassSuperAdmin(t *testing.T) {
	roles := caseIntakeVisibilityRoles(context.Background(), []string{"super-admin"})
	for _, want := range []string{"legal-cases-manager", "legal-director"} {
		if !containsString(roles, want) {
			t.Errorf("visibility roles = %v, super-admin missing break-glass role %q", roles, want)
		}
	}
}

func TestCaseIntakeVisibilityRolesDoesNotBroadenOrdinaryApprovers(t *testing.T) {
	roles := caseIntakeVisibilityRoles(context.Background(), []string{"legal-director"})
	if !containsString(roles, "legal-director") {
		t.Fatalf("roles = %v, want legal-director", roles)
	}
	if containsString(roles, "legal-cases-manager") {
		t.Fatalf("roles = %v, ordinary approver must not inherit another task tier", roles)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func ptrCaseStrength(v model.CaseStrength) *model.CaseStrength { return &v }
