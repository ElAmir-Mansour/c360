//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

// ============================================================================
// WS6 — litigation + approval concurrency integration tests.
//
// These exercise the runtime contracts wired in Rounds 1+2 over the litigation
// surface (CAP-052..073) and the subject-agnostic ApprovalOrchestrator:
//
//   - the defendant first-response memo review is a MANDATORY two-tier
//     supervisor→section_manager sequential chain (BOTH tiers must approve in
//     order before the defendant case advances to response_approved);
//   - StudyJudgment(object) creates the objection-deadline obligation EXACTLY
//     ONCE; a concurrent double-study cannot duplicate it (the FOR UPDATE study
//     lock + the uq_legal_obligations_judgment_live partial-unique guard);
//   - the pleading approval chain approves/files and a reject re-opens the draft
//     (reject -> redraft -> resubmit);
//   - two simultaneous DecideTask calls on the SAME task prove the orchestrator's
//     `FOR UPDATE OF wi, wt` lock serialises the decision: one wins (200), the
//     other observes the already-decided task and conflicts (409).
// ============================================================================

// createLegalCase materialises a first-class litigation case (CAP-032) for the
// litigation flows. company_status defaults to defendant so the defendant-side
// review applies; callers pass plaintiff when they need the plaintiff flows.
func (h *lexHarness) createLegalCase(t *testing.T, title string, companyStatus model.CaseCompanyStatus) model.LegalCase {
	t.Helper()
	req := dto.CreateLegalCaseRequest{
		CaseType:      "civil",
		CompanyStatus: companyStatus,
		Title:         forms.LocalizedText{AR: title, EN: title},
		Description:   "Litigation concurrency fixture case.",
		Status:        model.CaseStatusIntake,
		Priority:      model.LegalPriorityHigh,
	}
	return mustData[model.LegalCase](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/legal-cases", req), http.StatusCreated)
}

// activeWorkflowTaskID returns the single PENDING workflow task on an instance.
// StartResponseReview / SubmitPleadingForApproval return the subject row (not the
// task id), so the active approver task is read straight from the workflow store —
// mirroring how watheeq_workflow_test.go locates approval-chain tasks.
func (h *lexHarness) activeWorkflowTaskID(t *testing.T, instanceID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var taskID uuid.UUID
	if err := h.env.db.QueryRow(ctx, `
		SELECT id
		FROM workflow_tasks
		WHERE tenant_id = $1 AND instance_id = $2 AND status = 'pending'
		ORDER BY created_at DESC
		LIMIT 1`,
		h.tenantID, instanceID,
	).Scan(&taskID); err != nil {
		t.Fatalf("load active workflow task for instance %s: %v", instanceID, err)
	}
	return taskID
}

// liveObjectionObligationCount counts the LIVE objection obligations linked to a
// judgment via the real judgment_id column the partial-unique guard constrains.
func (h *lexHarness) liveObjectionObligationCount(t *testing.T, judgmentID uuid.UUID) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var n int
	if err := h.env.db.QueryRow(ctx, `
		SELECT count(*)
		FROM legal_obligations
		WHERE tenant_id = $1 AND judgment_id = $2 AND deleted_at IS NULL`,
		h.tenantID, judgmentID,
	).Scan(&n); err != nil {
		t.Fatalf("count objection obligations for judgment %s: %v", judgmentID, err)
	}
	return n
}

// rawStudyResult is a goroutine-safe (no *testing.T) study-judgment response: the
// HTTP status plus the decoded judgment. Used by the concurrent double-study so the
// off-test goroutines never touch t.
type rawStudyResult struct {
	status   int
	judgment model.LegalJudgment
}

// studyJudgmentRaw POSTs a StudyJudgment without any *testing.T dependency so it is
// safe to call from worker goroutines. Decode errors collapse to a zero judgment;
// the caller asserts on the recorded status + obligation id on the test goroutine.
func (h *lexHarness) studyJudgmentRaw(path string, body dto.StudyJudgmentRequest) rawStudyResult {
	raw, err := json.Marshal(body)
	if err != nil {
		return rawStudyResult{status: -1}
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, h.env.server.URL+path, bytes.NewReader(raw))
	if err != nil {
		return rawStudyResult{status: -1}
	}
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return rawStudyResult{status: -1}
	}
	defer resp.Body.Close()
	out := rawStudyResult{status: resp.StatusCode}
	if resp.StatusCode == http.StatusOK {
		var env dataEnvelope[model.LegalJudgment]
		if json.NewDecoder(resp.Body).Decode(&env) == nil {
			out.judgment = env.Data
		}
	}
	return out
}

// draftedDefendantReview registers a defendant case, drafts its first-response memo
// and returns the case in response_drafting, ready for review.
func (h *lexHarness) draftedDefendantReview(t *testing.T, caseID uuid.UUID, plaintiff string) model.LegalDefendantCase {
	t.Helper()
	notified := time.Now().UTC().Add(-72 * time.Hour)
	defendant := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant", caseID), dto.RegisterDefendantCaseRequest{
		PlaintiffName:    plaintiff,
		NotificationDate: &notified,
	}), http.StatusCreated)

	drafted := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-memo", caseID, defendant.ID), dto.DraftResponseMemoRequest{
		Body: "First-response memo: the company denies the allegations and requests dismissal.",
	}), http.StatusOK)
	if drafted.Status != model.DefendantCaseStatusResponseDrafting {
		t.Fatalf("drafted defendant status = %s, want %s", drafted.Status, model.DefendantCaseStatusResponseDrafting)
	}
	return drafted
}

// TestLitigationDefendantTwoTierReviewRequiresBothTiers proves the defendant
// first-response memo review is a mandatory two-tier supervisor→section_manager
// sequential chain: the supervisor approval ALONE does not advance the case (it
// only spawns the section_manager task), and only the second (section_manager)
// approval moves the case to response_approved with the workflow completed.
func TestLitigationDefendantTwoTierReviewRequiresBothTiers(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Defendant Two-Tier Review Case", model.CaseCompanyStatusDefendant)
	defendant := h.draftedDefendantReview(t, legalCase.ID, "Acme Plaintiff LLC")

	supervisorID := uuid.New()
	sectionManagerID := uuid.New()
	inReview := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-review", legalCase.ID, defendant.ID), dto.StartResponseReviewRequest{
		SupervisorID:     &supervisorID,
		SectionManagerID: &sectionManagerID,
	}), http.StatusOK)
	if inReview.Status != model.DefendantCaseStatusResponseInReview {
		t.Fatalf("defendant status after start review = %s, want %s", inReview.Status, model.DefendantCaseStatusResponseInReview)
	}
	if inReview.WorkflowInstanceID == nil {
		t.Fatal("start review did not link a workflow instance")
	}
	workflowID := *inReview.WorkflowInstanceID
	tier1TaskID := h.activeWorkflowTaskID(t, workflowID)

	decisionPath := func(taskID uuid.UUID) string {
		return fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-review/%s/tasks/%s/decision", legalCase.ID, defendant.ID, workflowID, taskID)
	}

	// The supervisor tier is assigned to a specific user: a different user (even the
	// tenant_admin owner) cannot decide it.
	mustError(t, h.doJSON(t, http.MethodPost, decisionPath(tier1TaskID), dto.WorkflowDecisionRequest{Decision: "approve"}), http.StatusForbidden)

	supervisor := h.withToken(h.env.mustToken(t, h.tenantID, supervisorID, "tenant_admin", "legal-case-supervisor"))
	sectionManager := h.withToken(h.env.mustToken(t, h.tenantID, sectionManagerID, "tenant_admin", "legal-cases-manager"))

	// Tier 1 (supervisor) approves: the case must NOT yet be approved — the chain is
	// sequential with QuorumAll, so it only spawns the tier-2 (section_manager) task.
	tier1 := mustData[service.ApprovalDecisionOutcome](t, supervisor.doJSON(t, http.MethodPost, decisionPath(tier1TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    ptr("Supervisor approves the first-response memo."),
	}), http.StatusOK)
	if tier1.Resolution != "wait" {
		t.Fatalf("tier-1 resolution = %s, want wait (quorum not yet met)", tier1.Resolution)
	}
	if tier1.WorkflowStatus != "running" {
		t.Fatalf("tier-1 workflow status = %s, want running", tier1.WorkflowStatus)
	}
	if tier1.Status != string(model.DefendantCaseStatusResponseInReview) {
		t.Fatalf("tier-1 defendant status = %s, want %s (not yet approved)", tier1.Status, model.DefendantCaseStatusResponseInReview)
	}
	if tier1.NextTaskID == nil {
		t.Fatal("tier-1 approval did not spawn the section_manager task")
	}

	// A re-read confirms the defendant case is still in review after tier 1.
	afterTier1 := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s", legalCase.ID, defendant.ID), nil), http.StatusOK)
	if afterTier1.Status != model.DefendantCaseStatusResponseInReview {
		t.Fatalf("defendant status after tier-1 = %s, want still in review", afterTier1.Status)
	}

	// The supervisor cannot decide the section_manager task (wrong assignee).
	tier2TaskID := *tier1.NextTaskID
	mustError(t, supervisor.doJSON(t, http.MethodPost, decisionPath(tier2TaskID), dto.WorkflowDecisionRequest{Decision: "approve"}), http.StatusForbidden)

	// Tier 2 (section_manager) approves: NOW the case advances and the workflow completes.
	tier2 := mustData[service.ApprovalDecisionOutcome](t, sectionManager.doJSON(t, http.MethodPost, decisionPath(tier2TaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    ptr("Section manager approves the first-response memo."),
	}), http.StatusOK)
	if tier2.Resolution != "advance" {
		t.Fatalf("tier-2 resolution = %s, want advance", tier2.Resolution)
	}
	if tier2.WorkflowStatus != "completed" {
		t.Fatalf("tier-2 workflow status = %s, want completed", tier2.WorkflowStatus)
	}
	if tier2.Status != string(model.DefendantCaseStatusResponseApproved) {
		t.Fatalf("tier-2 defendant status = %s, want %s", tier2.Status, model.DefendantCaseStatusResponseApproved)
	}

	final := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s", legalCase.ID, defendant.ID), nil), http.StatusOK)
	if final.Status != model.DefendantCaseStatusResponseApproved {
		t.Fatalf("final defendant status = %s, want %s", final.Status, model.DefendantCaseStatusResponseApproved)
	}
	if final.ResponseApprovedBy == nil || *final.ResponseApprovedBy != sectionManagerID {
		t.Fatalf("final response_approved_by = %v, want section_manager %s", final.ResponseApprovedBy, sectionManagerID)
	}
}

// TestLitigationDefendantReviewRejectRedraft proves the reject->redraft loop: a
// supervisor rejection sends the case to response_rejected, drafting the memo again
// re-opens it to response_drafting, and a fresh review can then be started.
func TestLitigationDefendantReviewRejectRedraft(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Defendant Reject Redraft Case", model.CaseCompanyStatusDefendant)
	defendant := h.draftedDefendantReview(t, legalCase.ID, "Beta Plaintiff Co")

	supervisorID := uuid.New()
	sectionManagerID := uuid.New()
	inReview := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-review", legalCase.ID, defendant.ID), dto.StartResponseReviewRequest{
		SupervisorID:     &supervisorID,
		SectionManagerID: &sectionManagerID,
	}), http.StatusOK)
	workflowID := *inReview.WorkflowInstanceID
	tier1TaskID := h.activeWorkflowTaskID(t, workflowID)

	supervisor := h.withToken(h.env.mustToken(t, h.tenantID, supervisorID, "tenant_admin", "legal-case-supervisor"))
	rejected := mustData[service.ApprovalDecisionOutcome](t, supervisor.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-review/%s/tasks/%s/decision", legalCase.ID, defendant.ID, workflowID, tier1TaskID),
		dto.WorkflowDecisionRequest{Decision: "reject", Notes: ptr("Memo needs stronger defences.")}), http.StatusOK)
	if rejected.Resolution != "reject" {
		t.Fatalf("reject resolution = %s, want reject", rejected.Resolution)
	}
	if rejected.Status != string(model.DefendantCaseStatusResponseRejected) {
		t.Fatalf("reject defendant status = %s, want %s", rejected.Status, model.DefendantCaseStatusResponseRejected)
	}

	afterReject := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s", legalCase.ID, defendant.ID), nil), http.StatusOK)
	if afterReject.Status != model.DefendantCaseStatusResponseRejected {
		t.Fatalf("defendant status after reject = %s, want %s", afterReject.Status, model.DefendantCaseStatusResponseRejected)
	}
	if afterReject.WorkflowInstanceID != nil {
		t.Fatalf("defendant still linked to a workflow after reject: %v", afterReject.WorkflowInstanceID)
	}

	// Redraft: a rejected response can be drafted again, re-opening the FSM.
	redrafted := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-memo", legalCase.ID, defendant.ID), dto.DraftResponseMemoRequest{
		Body: "Revised first-response memo with strengthened defences and counterclaims.",
	}), http.StatusOK)
	if redrafted.Status != model.DefendantCaseStatusResponseDrafting {
		t.Fatalf("redrafted defendant status = %s, want %s", redrafted.Status, model.DefendantCaseStatusResponseDrafting)
	}

	// A fresh review can be started on the redrafted memo.
	reReview := mustData[model.LegalDefendantCase](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/defendant/%s/response-review", legalCase.ID, defendant.ID), dto.StartResponseReviewRequest{
		SupervisorID:     &supervisorID,
		SectionManagerID: &sectionManagerID,
	}), http.StatusOK)
	if reReview.Status != model.DefendantCaseStatusResponseInReview {
		t.Fatalf("defendant status after re-review = %s, want %s", reReview.Status, model.DefendantCaseStatusResponseInReview)
	}
	if reReview.WorkflowInstanceID == nil || *reReview.WorkflowInstanceID == workflowID {
		t.Fatalf("re-review workflow instance = %v, want a NEW instance distinct from %s", reReview.WorkflowInstanceID, workflowID)
	}
}

// TestLitigationJudgmentStudyCreatesObjectionObligationOnce proves an objecting
// StudyJudgment creates the objection-deadline obligation exactly once, AND that a
// concurrent double-study cannot duplicate it: the FOR UPDATE study lock serialises
// the two calls and the partial-unique guard (uq_legal_obligations_judgment_live)
// keeps the live count at exactly one.
func TestLitigationJudgmentStudyCreatesObjectionObligationOnce(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Judgment Objection Obligation Case", model.CaseCompanyStatusDefendant)

	judgment := mustData[model.LegalJudgment](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/judgments", legalCase.ID), dto.CreateJudgmentRequest{
		JudgmentRef: "JDG-OBJ-0001",
		Summary:     "Adverse first-instance judgment awarding damages against the company.",
	}), http.StatusCreated)
	if judgment.Recommendation != model.JudgmentRecommendationPending {
		t.Fatalf("new judgment recommendation = %s, want pending", judgment.Recommendation)
	}

	ownerID := uuid.New()
	deadline := time.Now().UTC().Add(30 * 24 * time.Hour)
	studyBody := func() dto.StudyJudgmentRequest {
		d := deadline
		return dto.StudyJudgmentRequest{
			StudyNotes:        "Recommend objection/appeal: judgment is appealable on procedural grounds.",
			Recommendation:    model.JudgmentRecommendationObject,
			ObjectionDeadline: &d,
			OwnerUserID:       &ownerID,
			OwnerName:         "Litigation Officer",
		}
	}

	studyPath := fmt.Sprintf("/api/v1/lex/legal-cases/%s/judgments/%s/study", legalCase.ID, judgment.ID)
	studied := mustData[model.LegalJudgment](t, h.doJSON(t, http.MethodPost, studyPath, studyBody()), http.StatusOK)
	if studied.Recommendation != model.JudgmentRecommendationObject {
		t.Fatalf("studied recommendation = %s, want object", studied.Recommendation)
	}
	if studied.ObjectionDeadline == nil {
		t.Fatal("objecting study did not set the objection_deadline")
	}
	if studied.ObligationID == nil {
		t.Fatal("objecting study did not create the linked objection obligation")
	}
	if got := h.liveObjectionObligationCount(t, judgment.ID); got != 1 {
		t.Fatalf("objection obligation count after first study = %d, want 1", got)
	}
	firstObligationID := *studied.ObligationID

	// Concurrent double-study: two simultaneous objecting studies on the same already
	// (or freshly) studied judgment. The FOR UPDATE study lock serialises them and the
	// already-studied path / partial-unique guard prevents a second obligation. Every
	// call returns the studied judgment (200) with the SAME obligation id; the live
	// objection-obligation count stays at exactly one.
	const concurrency = 6
	var wg sync.WaitGroup
	wg.Add(concurrency)
	statuses := make([]int, concurrency)
	obligationIDs := make([]string, concurrency)
	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			defer wg.Done()
			// Decode inline (no t.Fatalf) — this runs off the test goroutine.
			resp := h.studyJudgmentRaw(studyPath, studyBody())
			statuses[idx] = resp.status
			if resp.judgment.ObligationID != nil {
				obligationIDs[idx] = resp.judgment.ObligationID.String()
			}
		}(i)
	}
	wg.Wait()

	for i := range statuses {
		if statuses[i] != http.StatusOK {
			t.Fatalf("concurrent study %d status = %d, want 200", i, statuses[i])
		}
		if obligationIDs[i] != firstObligationID.String() {
			t.Fatalf("concurrent study %d obligation id = %q, want stable %s", i, obligationIDs[i], firstObligationID)
		}
	}
	if got := h.liveObjectionObligationCount(t, judgment.ID); got != 1 {
		t.Fatalf("objection obligation count after concurrent double-study = %d, want exactly 1", got)
	}
}

// TestLitigationPleadingApprovalChainAndRejectRedraft proves the plaintiff pleading
// approval chain: submit -> reject re-opens the draft (workflow link cleared) ->
// resubmit -> approve -> file. The section_manager-role-addressed task is decided by
// a user carrying that role.
func TestLitigationPleadingApprovalChainAndRejectRedraft(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Pleading Approval Chain Case", model.CaseCompanyStatusPlaintiff)

	pleading := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings", legalCase.ID), dto.CreatePleadingRequest{
		Type:  model.PleadingTypeStatementOfClaim,
		Title: "Statement of Claim",
		Body:  "The plaintiff claims damages for breach of the service agreement.",
	}), http.StatusCreated)
	if pleading.Status != model.PleadingStatusDraft {
		t.Fatalf("new pleading status = %s, want draft", pleading.Status)
	}

	// Section-manager approver carries the assigned role so the orchestrator's actor
	// check passes (tenant_admin grants the lex:approval:write permission tier).
	sectionManager := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "tenant_admin", "section_manager", "legal-cases-manager"))

	submitPath := fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s/submit", legalCase.ID, pleading.ID)
	decisionPath := func(workflowID, taskID uuid.UUID) string {
		return fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s/approvals/%s/tasks/%s/decision", legalCase.ID, pleading.ID, workflowID, taskID)
	}

	// First submission, then reject -> the pleading re-opens to rejected with the
	// workflow link cleared so it can be edited + resubmitted.
	submitted := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, submitPath, nil), http.StatusOK)
	if submitted.Status != model.PleadingStatusInApproval || submitted.WorkflowInstanceID == nil {
		t.Fatalf("submitted pleading = %+v, want in_approval with a workflow instance", submitted)
	}
	rejectWorkflowID := *submitted.WorkflowInstanceID
	rejectTaskID := h.activeWorkflowTaskID(t, rejectWorkflowID)

	rejected := mustData[service.ApprovalDecisionOutcome](t, sectionManager.doJSON(t, http.MethodPost, decisionPath(rejectWorkflowID, rejectTaskID), dto.WorkflowDecisionRequest{
		Decision: "reject",
		Notes:    ptr("Tighten the prayer for relief and re-file."),
	}), http.StatusOK)
	if rejected.Resolution != "reject" || rejected.Status != string(model.PleadingStatusRejected) {
		t.Fatalf("reject outcome = %+v, want reject/%s", rejected, model.PleadingStatusRejected)
	}

	afterReject := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s", legalCase.ID, pleading.ID), nil), http.StatusOK)
	if afterReject.Status != model.PleadingStatusRejected {
		t.Fatalf("pleading status after reject = %s, want rejected", afterReject.Status)
	}
	if afterReject.WorkflowInstanceID != nil {
		t.Fatalf("rejected pleading still linked to workflow %v", afterReject.WorkflowInstanceID)
	}

	// Redraft the rejected pleading, then resubmit + approve + file.
	edited := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s", legalCase.ID, pleading.ID), dto.UpdatePleadingRequest{
		Body:         ptr("The plaintiff claims damages and specific performance for breach of the service agreement."),
		ChangeReason: "Address section_manager feedback.",
	}), http.StatusOK)
	if edited.Status != model.PleadingStatusRejected {
		t.Fatalf("edited pleading status = %s, want still rejected (editable)", edited.Status)
	}

	resubmitted := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, submitPath, nil), http.StatusOK)
	if resubmitted.Status != model.PleadingStatusInApproval || resubmitted.WorkflowInstanceID == nil {
		t.Fatalf("resubmitted pleading = %+v, want in_approval with a workflow instance", resubmitted)
	}
	approveWorkflowID := *resubmitted.WorkflowInstanceID
	if approveWorkflowID == rejectWorkflowID {
		t.Fatalf("resubmission reused the rejected workflow instance %s", rejectWorkflowID)
	}
	approveTaskID := h.activeWorkflowTaskID(t, approveWorkflowID)

	approved := mustData[service.ApprovalDecisionOutcome](t, sectionManager.doJSON(t, http.MethodPost, decisionPath(approveWorkflowID, approveTaskID), dto.WorkflowDecisionRequest{
		Decision: "approve",
		Notes:    ptr("Approved for filing."),
	}), http.StatusOK)
	if approved.Resolution != "advance" || approved.Status != string(model.PleadingStatusApproved) {
		t.Fatalf("approve outcome = %+v, want advance/%s", approved, model.PleadingStatusApproved)
	}

	filed := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s/file", legalCase.ID, pleading.ID), dto.FilePleadingRequest{
		Note: "Filed with the competent court.",
	}), http.StatusOK)
	if filed.Status != model.PleadingStatusFiled {
		t.Fatalf("filed pleading status = %s, want filed", filed.Status)
	}
	if filed.FiledAt == nil {
		t.Fatal("filed pleading missing filed_at")
	}
}

// TestApprovalOrchestratorConcurrentDecideSerializes proves the orchestrator's
// `FOR UPDATE OF wi, wt` lock serialises two simultaneous DecideTask calls on the
// SAME task: exactly one wins (200, advancing the pleading), and the loser observes
// the already-decided task and conflicts (409). This guards against a double-advance
// or duplicate side-effects under concurrency.
func TestApprovalOrchestratorConcurrentDecideSerializes(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Orchestrator Concurrency Case", model.CaseCompanyStatusPlaintiff)

	pleading := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings", legalCase.ID), dto.CreatePleadingRequest{
		Type:  model.PleadingTypeStatementOfClaim,
		Title: "Concurrency Statement of Claim",
		Body:  "The plaintiff claims damages for breach of contract.",
	}), http.StatusCreated)

	submitted := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s/submit", legalCase.ID, pleading.ID), nil), http.StatusOK)
	if submitted.WorkflowInstanceID == nil {
		t.Fatal("submit did not link a workflow instance")
	}
	workflowID := *submitted.WorkflowInstanceID
	taskID := h.activeWorkflowTaskID(t, workflowID)

	sectionManager := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "tenant_admin", "section_manager", "legal-cases-manager"))
	decisionPath := fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s/approvals/%s/tasks/%s/decision", legalCase.ID, pleading.ID, workflowID, taskID)

	// Fire N simultaneous approve decisions on the same task, gated on a shared start
	// barrier so they contend on the FOR UPDATE lock as tightly as possible.
	const concurrency = 8
	var ready sync.WaitGroup
	var done sync.WaitGroup
	start := make(chan struct{})
	ready.Add(concurrency)
	done.Add(concurrency)
	statuses := make([]int, concurrency)
	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			defer done.Done()
			ready.Done()
			<-start
			resp := sectionManager.doJSON(t, http.MethodPost, decisionPath, dto.WorkflowDecisionRequest{Decision: "approve"})
			statuses[idx] = resp.StatusCode
			resp.Body.Close()
		}(i)
	}
	ready.Wait()
	close(start)
	done.Wait()

	wins, conflicts, others := 0, 0, 0
	for _, code := range statuses {
		switch code {
		case http.StatusOK:
			wins++
		case http.StatusConflict:
			conflicts++
		default:
			others++
		}
	}
	if others != 0 {
		t.Fatalf("unexpected non-200/409 statuses in %v", statuses)
	}
	if wins != 1 {
		t.Fatalf("winning decisions = %d, want exactly 1 (FOR UPDATE must serialise) in %v", wins, statuses)
	}
	if conflicts != concurrency-1 {
		t.Fatalf("conflicting decisions = %d, want %d in %v", conflicts, concurrency-1, statuses)
	}

	// The single winner advanced the pleading to approved exactly once.
	final := mustData[model.LegalPleading](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/pleadings/%s", legalCase.ID, pleading.ID), nil), http.StatusOK)
	if final.Status != model.PleadingStatusApproved {
		t.Fatalf("final pleading status = %s, want approved (single advance)", final.Status)
	}
}
