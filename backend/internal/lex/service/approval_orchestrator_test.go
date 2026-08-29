package service

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

type orchestratorAuthorityValidator struct {
	result *lexcrypto.VerifiedAuthority
	err    error
	calls  int
	lastIn lexcrypto.AuthorityEvidenceInput
}

func (v *orchestratorAuthorityValidator) Validate(_ context.Context, in lexcrypto.AuthorityEvidenceInput) (*lexcrypto.VerifiedAuthority, error) {
	v.calls++
	v.lastIn = in
	return v.result, v.err
}

func orchestratorFloat(v float64) *float64 { return &v }

func orchestratorCryptoEvidence() *dto.ApprovalAuthorityEvidence {
	return &dto.ApprovalAuthorityEvidence{
		Role:            "cfo",
		AuthorityAmount: 1000,
		Currency:        "SAR",
		EvidenceID:      "ev-1",
		CertificatePEM:  "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
		SignatureB64:    "c2ln",
		SignatureAlg:    lexcrypto.AlgECDSASHA256,
	}
}

func TestApprovalOrchestratorDecisionMetadata(t *testing.T) {
	subjectID := uuid.New()
	userID := uuid.New()
	decidedAt := time.Date(2026, 6, 24, 10, 30, 0, 123, time.UTC)
	notes := "approved with evidence"
	o := &ApprovalOrchestrator{}

	metadata := o.decisionMetadata(ApprovalSubjectSpec{
		SubjectType: "legal_request",
		SubjectID:   subjectID,
	}, dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    &notes,
		Metadata: map[string]any{
			"source": "client",
			"ticket": "REQ-1",
		},
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
			PolicyID:        "policy-1",
			Role:            "cfo",
			AuthorityAmount: 5000,
			Currency:        "SAR",
			EvidenceID:      "DOA-1",
			Source:          "board_minutes",
		},
	}, userID, decidedAt, "pending_requester_approval", workflowexec.ResolutionAdvance)

	if metadata["subject_type"] != "legal_request" || metadata["subject_id"] != subjectID.String() {
		t.Fatalf("subject metadata = %+v", metadata)
	}
	if metadata["decision"] != "approve" || metadata["resolution"] != string(workflowexec.ResolutionAdvance) {
		t.Fatalf("decision metadata = %+v", metadata)
	}
	if metadata["decided_by"] != userID.String() || metadata["decided_at"] != decidedAt.Format(time.RFC3339Nano) {
		t.Fatalf("actor metadata = %+v", metadata)
	}
	if metadata["previous_status"] != "pending_requester_approval" {
		t.Fatalf("previous_status = %v", metadata["previous_status"])
	}
	if metadata["source"] != "lex_approval_orchestrator" {
		t.Fatalf("source = %v", metadata["source"])
	}
	requestMetadata, ok := metadata["request_metadata"].(map[string]any)
	if !ok || requestMetadata["source"] != "client" || requestMetadata["ticket"] != "REQ-1" {
		t.Fatalf("request metadata = %+v", metadata["request_metadata"])
	}
	authority, ok := metadata["authority_evidence"].(map[string]any)
	if !ok || authority["policy_id"] != "policy-1" || authority["evidence_id"] != "DOA-1" {
		t.Fatalf("authority metadata = %+v", metadata["authority_evidence"])
	}
	if metadata["notes"] != notes {
		t.Fatalf("notes = %v", metadata["notes"])
	}
}

func TestValidateOrchestratorActor(t *testing.T) {
	userID := uuid.New()
	otherID := uuid.New()
	userString := userID.String()
	otherString := otherID.String()
	role := "legal_approver"

	if err := validateOrchestratorActor(context.Background(), userID, orchestratorTarget{claimedBy: &otherString}); err == nil {
		t.Fatal("expected claimed-by mismatch to be forbidden")
	}
	if err := validateOrchestratorActor(context.Background(), userID, orchestratorTarget{assigneeID: &otherString}); err == nil {
		t.Fatal("expected assignee mismatch to be forbidden")
	}
	if err := validateOrchestratorActor(context.Background(), userID, orchestratorTarget{assigneeRole: &role}); err == nil {
		t.Fatal("expected missing role context to be forbidden")
	}

	ctx := auth.WithUser(context.Background(), &auth.ContextUser{ID: userID.String(), Roles: []string{"legal_approver"}})
	if err := validateOrchestratorActor(ctx, userID, orchestratorTarget{claimedBy: &userString, assigneeID: &userString, assigneeRole: &role}); err != nil {
		t.Fatalf("expected assigned actor with role to pass, got %v", err)
	}

	adminCtx := auth.WithUser(context.Background(), &auth.ContextUser{ID: userID.String(), Roles: []string{"super_admin"}})
	adminOnly := "bespoke_approval_role"
	if err := validateOrchestratorActor(adminCtx, userID, orchestratorTarget{assigneeRole: &adminOnly}); err != nil {
		t.Fatalf("expected admin wildcard role to pass, got %v", err)
	}

	// Tenant administration must not impersonate a legal workflow recipient. Even
	// when the same account also holds legal-director, a task addressed to the
	// cases-manager role requires that exact legal role (or super_admin break-glass).
	tenantAdminCtx := auth.WithUser(context.Background(), &auth.ContextUser{
		ID: userID.String(), Roles: []string{"tenant-admin", "legal-director"},
	})
	caseManagerRole := "legal-cases-manager"
	if err := validateOrchestratorActor(tenantAdminCtx, userID, orchestratorTarget{assigneeRole: &caseManagerRole}); err == nil {
		t.Fatal("expected tenant admin without the assigned legal role to be forbidden")
	}
	caseManagerCtx := auth.WithUser(context.Background(), &auth.ContextUser{
		ID: userID.String(), Roles: []string{"tenant-admin", "legal-cases-manager"},
	})
	if err := validateOrchestratorActor(caseManagerCtx, userID, orchestratorTarget{assigneeRole: &caseManagerRole}); err != nil {
		t.Fatalf("expected exact case-manager role to pass, got %v", err)
	}
}

func TestValidateOrchestratorAuthorityEvidence(t *testing.T) {
	policy := &watheeqApprovalPolicy{
		RequiredRole:             "cfo",
		RequiredAuthorityAmount:  orchestratorFloat(1000),
		Currency:                 "SAR",
		RequireAuthorityEvidence: true,
	}

	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{Decision: "approve"}, policy); err == nil {
		t.Fatal("expected missing authority evidence to fail")
	}
	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{
		Decision:          "approve",
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{Role: "legal", AuthorityAmount: 1500, Currency: "SAR", EvidenceID: "ev"},
	}, policy); err == nil {
		t.Fatal("expected role mismatch to fail")
	}
	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{
		Decision:          "approve",
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{Role: "cfo", AuthorityAmount: 500, Currency: "SAR", EvidenceID: "ev"},
	}, policy); err == nil {
		t.Fatal("expected insufficient authority amount to fail")
	}
	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{
		Decision:          "approve",
		AuthorityEvidence: &dto.ApprovalAuthorityEvidence{Role: "CFO", AuthorityAmount: 1500, Currency: "sar", EvidenceID: "ev"},
	}, policy); err != nil {
		t.Fatalf("expected matching evidence to pass, got %v", err)
	}
	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{Decision: "approve"}, &watheeqApprovalPolicy{}); err != nil {
		t.Fatalf("expected non-requiring policy to allow absent evidence, got %v", err)
	}
	if err := validateOrchestratorAuthorityEvidence(dto.WorkflowDecisionRequest{Decision: "reject", AuthorityEvidence: &dto.ApprovalAuthorityEvidence{}}, policy); err == nil {
		t.Fatal("expected malformed optional evidence to fail")
	}
}

func TestApprovalOrchestratorValidateAuthorityEvidencePKI(t *testing.T) {
	t.Run("fallback without roots", func(t *testing.T) {
		stub := &orchestratorAuthorityValidator{}
		o := (&ApprovalOrchestrator{}).WithAuthorityEvidenceValidator(stub, false)
		req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: orchestratorCryptoEvidence()}
		if err := o.validateAuthorityEvidencePKI(context.Background(), req, &watheeqApprovalPolicy{PolicyID: "p", RequireAuthorityEvidence: true}); err != nil {
			t.Fatalf("expected fallback to pass, got %v", err)
		}
		if stub.calls != 0 {
			t.Fatalf("validator should not run without trusted roots, calls=%d", stub.calls)
		}
	})

	t.Run("invalid signed payload base64", func(t *testing.T) {
		stub := &orchestratorAuthorityValidator{}
		o := (&ApprovalOrchestrator{}).WithAuthorityEvidenceValidator(stub, true)
		ev := orchestratorCryptoEvidence()
		ev.SignedPayloadB64 = "not valid @@@"
		req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: ev}
		err := o.validateAuthorityEvidencePKI(context.Background(), req, &watheeqApprovalPolicy{PolicyID: "p", RequireAuthorityEvidence: true})
		if err == nil {
			t.Fatal("expected invalid signed payload to fail")
		}
		if stub.calls != 0 {
			t.Fatalf("validator must not run for malformed payload, calls=%d", stub.calls)
		}
	})

	t.Run("bound amount below policy", func(t *testing.T) {
		stub := &orchestratorAuthorityValidator{result: &lexcrypto.VerifiedAuthority{AuthorityAmount: orchestratorFloat(500)}}
		o := (&ApprovalOrchestrator{}).WithAuthorityEvidenceValidator(stub, true)
		req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: orchestratorCryptoEvidence()}
		policy := &watheeqApprovalPolicy{PolicyID: "p", RequireAuthorityEvidence: true, RequiredAuthorityAmount: orchestratorFloat(1000)}
		err := o.validateAuthorityEvidencePKI(context.Background(), req, policy)
		if err == nil {
			t.Fatal("expected low cryptographic bound amount to fail")
		}
		if stub.calls != 1 {
			t.Fatalf("validator should run once, calls=%d", stub.calls)
		}
	})

	t.Run("happy path forwards decoded payload", func(t *testing.T) {
		stub := &orchestratorAuthorityValidator{result: &lexcrypto.VerifiedAuthority{AuthorityAmount: orchestratorFloat(5000)}}
		o := (&ApprovalOrchestrator{}).WithAuthorityEvidenceValidator(stub, true)
		ev := orchestratorCryptoEvidence()
		ev.SignedPayloadB64 = "eyJhdXRob3JpdHlfYW1vdW50Ijo1MDAwfQ=="
		req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: ev}
		policy := &watheeqApprovalPolicy{PolicyID: "p", RequireAuthorityEvidence: true, RequiredAuthorityAmount: orchestratorFloat(1000)}
		if err := o.validateAuthorityEvidencePKI(context.Background(), req, policy); err != nil {
			t.Fatalf("expected strict PKI path to pass, got %v", err)
		}
		if stub.calls != 1 {
			t.Fatalf("validator should run once, calls=%d", stub.calls)
		}
		if len(stub.lastIn.Payload) == 0 {
			t.Fatal("expected decoded payload to be forwarded")
		}
	})
}

func TestOrchestratorChainConfig(t *testing.T) {
	cfg := orchestratorChainConfig(map[string]any{
		"approval_mode":     "parallel",
		"approval_quorum":   "n_of_m",
		"approval_quorum_n": float64(5),
		"approver_total":    float64(2),
		"approval_chain_config": map[string]any{
			"approvers": []any{
				map[string]any{"type": "role", "ref": "legal"},
				map[string]any{"type": "user", "ref": "11111111-1111-1111-1111-111111111111"},
			},
		},
	})
	if cfg.Mode != workflowexec.ApprovalModeParallel || cfg.Quorum != workflowexec.QuorumNofM {
		t.Fatalf("config mode/quorum = %+v", cfg)
	}
	if cfg.QuorumN != 2 {
		t.Fatalf("quorum_n = %d, want clamped to approver count", cfg.QuorumN)
	}
	if len(cfg.Approvers) != 2 || cfg.Approvers[0].Type != "role" || cfg.Approvers[1].Type != "user" {
		t.Fatalf("approvers = %+v", cfg.Approvers)
	}

	fallback := orchestratorChainConfig(map[string]any{
		"approval_mode":   "unexpected",
		"approval_quorum": "unexpected",
		"approver_total":  float64(0),
		"approver_ref":    "requester",
	})
	if fallback.Mode != workflowexec.ApprovalModeSequential || fallback.Quorum != workflowexec.QuorumAll {
		t.Fatalf("fallback mode/quorum = %+v", fallback)
	}
	if len(fallback.Approvers) != 1 || fallback.Approvers[0].Type != "role" || fallback.Approvers[0].Ref != "requester" {
		t.Fatalf("fallback approvers = %+v", fallback.Approvers)
	}
}

func TestApprovalOrchestratorBuildNextApproverTask(t *testing.T) {
	tenantID := uuid.New()
	instanceID := uuid.New()
	now := time.Date(2026, 6, 24, 11, 0, 0, 0, time.UTC)
	target := orchestratorTarget{
		workflowInstanceID: instanceID,
		stepID:             "request_approval",
		stepExecID:         "step-exec-1",
		formSchema:         []workflowmodel.FormField{{Name: "decision", Type: "select", Required: true}},
		taskMetadata:       map[string]any{"source": "original", "approver_index": 0},
	}
	o := &ApprovalOrchestrator{}

	roleTask := o.buildNextApproverTask(tenantID, target, workflowexec.Approver{Type: "role", Ref: "legal"}, 1, 3, now)
	if roleTask.TenantID != tenantID.String() || roleTask.InstanceID != instanceID.String() || roleTask.StepID != target.stepID {
		t.Fatalf("task identity = %+v", roleTask)
	}
	if roleTask.AssigneeRole == nil || *roleTask.AssigneeRole != "legal" || roleTask.AssigneeID != nil {
		t.Fatalf("role assignment = assignee=%v role=%v", roleTask.AssigneeID, roleTask.AssigneeRole)
	}
	if roleTask.Metadata["approver_index"] != 1 || roleTask.Metadata["approver_total"] != 3 || roleTask.Metadata["approver_type"] != "role" || roleTask.Metadata["approver_ref"] != "legal" {
		t.Fatalf("role task metadata = %+v", roleTask.Metadata)
	}
	if target.taskMetadata["approver_index"] != 0 {
		t.Fatalf("target metadata was mutated: %+v", target.taskMetadata)
	}

	userTask := o.buildNextApproverTask(tenantID, target, workflowexec.Approver{Type: "user", Ref: "22222222-2222-2222-2222-222222222222"}, 2, 3, now)
	if userTask.AssigneeID == nil || *userTask.AssigneeID != "22222222-2222-2222-2222-222222222222" || userTask.AssigneeRole != nil {
		t.Fatalf("user assignment = assignee=%v role=%v", userTask.AssigneeID, userTask.AssigneeRole)
	}
}
