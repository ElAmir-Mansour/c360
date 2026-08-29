package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateOtherCaseTypeContract(t *testing.T) {
	other := "  Unlisted specialist dispute  "
	otherPtr := &other
	caseType := "other"
	if err := validateAndCanonicalizeOtherCaseType(&caseType, &otherPtr, nil); err != nil {
		t.Fatalf("valid Other rejected: %v", err)
	}
	if caseType != "OTHER" || otherPtr == nil || *otherPtr != "Unlisted specialist dispute" {
		t.Fatalf("canonical Other = %q/%v", caseType, otherPtr)
	}

	missing := "OTHER"
	if err := validateAndCanonicalizeOtherCaseType(&missing, new(*string), nil); err == nil {
		t.Fatal("OTHER without other_case_type must fail")
	}

	canonical := "EVICTION"
	unwanted := "free text"
	unwantedPtr := &unwanted
	if err := validateAndCanonicalizeOtherCaseType(&canonical, &unwantedPtr, nil); err == nil {
		t.Fatal("canonical case type with other_case_type must fail")
	}
}

func TestApplyLegalCaseUpdateClearsReferencesWithoutTouchingUnrelatedFields(t *testing.T) {
	requestID := uuid.New()
	courtID := uuid.New()
	c := &model.LegalCase{
		CaseNumber: "CASE-1", CaseType: "EVICTION", Description: "keep me",
		RequestID: &requestID, CourtID: &courtID,
	}

	applyLegalCaseUpdate(c, dto.UpdateLegalCaseRequest{ClearedFields: []string{"request_id", "court_id"}})

	if c.RequestID != nil || c.CourtID != nil {
		t.Fatalf("cleared references = request %v court %v", c.RequestID, c.CourtID)
	}
	if c.CaseNumber != "CASE-1" || c.CaseType != "EVICTION" || c.Description != "keep me" {
		t.Fatalf("clear changed unrelated fields: %+v", c)
	}
}

func TestGenericCaseStatusTransitionsRejectGovernedIntakePipeline(t *testing.T) {
	for _, transition := range []struct {
		from model.CaseStatus
		to   model.CaseStatus
	}{
		{from: model.CaseStatusIntake, to: model.CaseStatusPhase1},
		{from: model.CaseStatusPhase1, to: model.CaseStatusIntake},
		{from: model.CaseStatusPhase1, to: model.CaseStatusPhase2},
		{from: model.CaseStatusPhase2, to: model.CaseStatusOpen},
	} {
		if caseTransitionAllowed(transition.from, transition.to) {
			t.Fatalf("generic transition %s -> %s allowed; intake service must own it", transition.from, transition.to)
		}
	}
}

func TestGenericCaseStatusTransitionsAllowCancellationAndOperationalMoves(t *testing.T) {
	for _, transition := range []struct {
		from model.CaseStatus
		to   model.CaseStatus
	}{
		{from: model.CaseStatusIntake, to: model.CaseStatusCancelled},
		{from: model.CaseStatusPhase1, to: model.CaseStatusCancelled},
		{from: model.CaseStatusPhase2, to: model.CaseStatusCancelled},
		{from: model.CaseStatusOpen, to: model.CaseStatusUnderProcedure},
		{from: model.CaseStatusUnderProcedure, to: caseStatusOnHold},
		{from: caseStatusOnHold, to: model.CaseStatusOpen},
		{from: model.CaseStatusOpen, to: model.CaseStatusClosed},
	} {
		if !caseTransitionAllowed(transition.from, transition.to) {
			t.Fatalf("generic transition %s -> %s rejected; expected it to be allowed", transition.from, transition.to)
		}
	}
}

func TestLegalCaseAssignmentTargetsIncludesAllExistingAssignments(t *testing.T) {
	managerID := uuid.New()
	supervisorID := uuid.New()
	officerID := uuid.New()
	targets := legalCaseAssignmentTargets(&model.LegalCase{
		SectionManagerID:  &managerID,
		SupervisorID:      &supervisorID,
		HandlingOfficerID: &officerID,
	})

	if len(targets) != 3 {
		t.Fatalf("legalCaseAssignmentTargets() count = %d, want 3", len(targets))
	}
	want := map[string]uuid.UUID{
		"section_manager_id":  managerID,
		"supervisor_id":       supervisorID,
		"handling_officer_id": officerID,
	}
	for _, target := range targets {
		if want[target.field] != target.userID {
			t.Fatalf("target %s = %s, want %s", target.field, target.userID, want[target.field])
		}
		delete(want, target.field)
	}
	if len(want) != 0 {
		t.Fatalf("missing assignment targets: %v", want)
	}
}

func TestCaseClosedEventPayloadCarriesDurationBounds(t *testing.T) {
	caseID := uuid.New()
	requestID := uuid.New()
	department := "Litigation"
	createdAt := time.Date(2026, 6, 1, 8, 30, 0, 0, time.UTC)
	closedAt := time.Date(2026, 6, 25, 14, 45, 0, 0, time.UTC)
	c := &model.LegalCase{
		ID:            caseID,
		CaseNumber:    "CASE-20260601-1",
		CaseType:      "commercial",
		CompanyStatus: model.CaseCompanyStatusPlaintiff,
		Department:    &department,
		RequestID:     &requestID,
		CreatedAt:     createdAt,
	}

	payload := caseClosedEventPayload(c, closedAt)

	if payload["id"] != caseID || payload["case_id"] != caseID {
		t.Fatalf("case identifiers = id %v case_id %v, want %s", payload["id"], payload["case_id"], caseID)
	}
	if payload["created_at"] != createdAt || payload["started_at"] != createdAt {
		t.Fatalf("start bounds = created_at %v started_at %v, want %v", payload["created_at"], payload["started_at"], createdAt)
	}
	if payload["closed_at"] != closedAt || payload["completed_at"] != closedAt {
		t.Fatalf("end bounds = closed_at %v completed_at %v, want %v", payload["closed_at"], payload["completed_at"], closedAt)
	}
	if payload["department"] != &department {
		t.Fatalf("department = %v, want pointer to department", payload["department"])
	}
	if payload["request_id"] != &requestID {
		t.Fatalf("request_id = %v, want pointer to request id", payload["request_id"])
	}
	if payload["status"] != model.CaseStatusClosed {
		t.Fatalf("status = %v, want closed", payload["status"])
	}
}

func TestCaseCollaborationSnapshots(t *testing.T) {
	commentID := uuid.New()
	mentionID := uuid.New()
	comment := &model.CaseComment{
		ID:       commentID,
		Body:     "Review this filing",
		Mentions: []string{mentionID.String()},
	}
	commentSnap := caseCommentSnapshot(comment)
	if commentSnap["id"] != commentID.String() {
		t.Fatalf("comment id = %v, want %s", commentSnap["id"], commentID)
	}
	mentions, ok := commentSnap["mentions"].([]string)
	if !ok || len(mentions) != 1 || mentions[0] != mentionID.String() {
		t.Fatalf("comment mentions = %#v, want [%s]", commentSnap["mentions"], mentionID)
	}

	category := "pleading"
	linkID := uuid.New()
	documentID := uuid.New()
	link := &model.CaseDocumentLink{
		ID:         linkID,
		DocumentID: documentID,
		Source:     "uploaded_reference",
		Category:   &category,
		Notes:      "Statement of claim",
	}
	linkSnap := caseDocumentLinkSnapshot(link)
	if linkSnap["document_id"] != documentID.String() {
		t.Fatalf("document id = %v, want %s", linkSnap["document_id"], documentID)
	}
	if linkSnap["category"] != category {
		t.Fatalf("category = %v, want %s", linkSnap["category"], category)
	}
}

func TestCaseTaskAutomationSpecsAreEventSpecific(t *testing.T) {
	tenantAssignee := uuid.New()
	now := time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC)
	c := &model.LegalCase{
		ID:                uuid.New(),
		CaseNumber:        "CASE-20260625-1",
		CompanyStatus:     model.CaseCompanyStatusPlaintiff,
		Priority:          model.LegalPriorityHigh,
		HandlingOfficerID: &tenantAssignee,
	}

	created := newCaseAutomationTasks(c, now)
	if len(created) != 1 {
		t.Fatalf("new case task count = %d, want 1", len(created))
	}
	if created[0].TemplateID != "lex.case.new.review" || created[0].Trigger != "case.created" {
		t.Fatalf("new case template/trigger = %s/%s", created[0].TemplateID, created[0].Trigger)
	}
	if created[0].AssigneeID == nil || *created[0].AssigneeID != tenantAssignee {
		t.Fatalf("new case assignee = %v, want handling officer", created[0].AssigneeID)
	}
	if created[0].DueDate == nil || !created[0].DueDate.Equal(normalizeDate(now.AddDate(0, 0, 1))) {
		t.Fatalf("new case due date = %v, want next day", created[0].DueDate)
	}

	status := statusChangeAutomationTasks(c, model.CaseStatusOpen, model.CaseStatusUnderProcedure, now)
	if status[0].TemplateID != "lex.case.status.under_procedure" {
		t.Fatalf("status template = %s", status[0].TemplateID)
	}
	if status[0].Priority != model.LegalPriorityHigh {
		t.Fatalf("status priority = %s, want high", status[0].Priority)
	}
	if status[0].Metadata["from_status"] != string(model.CaseStatusOpen) || status[0].Metadata["to_status"] != string(model.CaseStatusUnderProcedure) {
		t.Fatalf("status metadata = %+v", status[0].Metadata)
	}
}

func TestCaseTaskAutomationSpecsUseEventDeadlines(t *testing.T) {
	now := time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC)
	c := &model.LegalCase{ID: uuid.New(), CaseNumber: "CASE-20260625-2", Priority: model.LegalPriorityMedium}
	hearing := &model.CaseHearing{ID: uuid.New(), CaseID: c.ID, HearingDate: time.Date(2026, 7, 10, 13, 0, 0, 0, time.UTC)}
	hearingTasks := hearingAddedAutomationTasks(c, hearing, now)
	if hearingTasks[0].DueDate == nil || !hearingTasks[0].DueDate.Equal(time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("hearing due date = %v, want two days before hearing", hearingTasks[0].DueDate)
	}

	ownerID := uuid.New()
	deadline := time.Date(2026, 7, 15, 16, 0, 0, 0, time.UTC)
	j := &model.LegalJudgment{ID: uuid.New(), CaseID: c.ID, JudgmentRef: "J-1", ObjectionDeadline: &deadline}
	objectionTasks := objectionRecommendedAutomationTasks(c, j, &ownerID, now)
	if objectionTasks[0].Priority != model.LegalPriorityCritical {
		t.Fatalf("objection priority = %s, want critical", objectionTasks[0].Priority)
	}
	if objectionTasks[0].AssigneeID == nil || *objectionTasks[0].AssigneeID != ownerID {
		t.Fatalf("objection assignee = %v, want owner", objectionTasks[0].AssigneeID)
	}
	if objectionTasks[0].DueDate == nil || !objectionTasks[0].DueDate.Equal(normalizeDate(deadline)) {
		t.Fatalf("objection due date = %v, want objection deadline", objectionTasks[0].DueDate)
	}
}
