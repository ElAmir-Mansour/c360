package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	workflowexec "github.com/clario360/platform/internal/workflow/executor"
)

func TestInvestigationLifecycleHappyPathWithRejectedRework(t *testing.T) {
	if !investigationTransitionAllowed(model.InvestigationStatusRegistered, model.InvestigationStatusInProgress) {
		t.Fatal("registered -> in_progress must be allowed")
	}
	if !investigationResultsRecordable(model.InvestigationStatusInProgress) {
		t.Fatal("in_progress must allow findings")
	}
	if !investigationRecommendationsRecordable(model.InvestigationStatusResults) || !investigationApprovalSubmittable(model.InvestigationStatusResults) {
		t.Fatal("results_recorded must allow recommendations and approval submission")
	}

	rejected := investigationApprovalAdvancePlanFor(model.InvestigationStatusPendingApprove, workflowexec.ResolutionReject)
	if !rejected.changed || rejected.target != model.InvestigationStatusRejected {
		t.Fatalf("reject plan = %+v, want changed -> rejected", rejected)
	}
	if !investigationTransitionAllowed(rejected.target, model.InvestigationStatusInProgress) {
		t.Fatal("rejected -> in_progress rework edge must be allowed")
	}
	if investigationApprovalSubmittable(model.InvestigationStatusRejected) {
		t.Fatal("rejected must be reopened and findings re-recorded before resubmission")
	}

	approved := investigationApprovalAdvancePlanFor(model.InvestigationStatusPendingApprove, workflowexec.ResolutionAdvance)
	if !approved.changed || approved.target != model.InvestigationStatusApproved {
		t.Fatalf("approval plan = %+v, want changed -> approved", approved)
	}
	if !investigationTransitionAllowed(approved.target, model.InvestigationStatusClosed) {
		t.Fatal("approved -> closed must be allowed")
	}
}

func TestInvestigationLifecycleRejectsInvalidForwardEdges(t *testing.T) {
	statuses := []model.InvestigationStatus{
		model.InvestigationStatusRegistered,
		model.InvestigationStatusResults,
		model.InvestigationStatusPendingApprove,
		model.InvestigationStatusRejected,
		model.InvestigationStatusApproved,
		model.InvestigationStatusClosed,
		model.InvestigationStatusCancelled,
	}
	for _, status := range statuses {
		if investigationResultsRecordable(status) {
			t.Errorf("RecordResults unexpectedly allowed from %s", status)
		}
	}
	for _, status := range []model.InvestigationStatus{
		model.InvestigationStatusRegistered,
		model.InvestigationStatusInProgress,
		model.InvestigationStatusPendingApprove,
		model.InvestigationStatusRejected,
		model.InvestigationStatusApproved,
		model.InvestigationStatusClosed,
		model.InvestigationStatusCancelled,
	} {
		if investigationRecommendationsRecordable(status) {
			t.Errorf("RecordRecommendations unexpectedly allowed from %s", status)
		}
		if investigationApprovalSubmittable(status) {
			t.Errorf("StartApproval unexpectedly allowed from %s", status)
		}
	}
}

func TestInvestigationPendingApprovalAndRejectedContentAreImmutable(t *testing.T) {
	svc := &InvestigationService{}
	for _, status := range []model.InvestigationStatus{
		model.InvestigationStatusPendingApprove,
		model.InvestigationStatusRejected,
		model.InvestigationStatusApproved,
		model.InvestigationStatusClosed,
		model.InvestigationStatusCancelled,
	} {
		err := svc.ensureMutable(context.Background(), uuid.New(), &model.LegalInvestigation{Status: status})
		if err == nil {
			t.Errorf("ensureMutable(%s) = nil, want conflict", status)
		}
	}
	for _, status := range []model.InvestigationStatus{
		model.InvestigationStatusRegistered,
		model.InvestigationStatusInProgress,
		model.InvestigationStatusResults,
	} {
		if err := svc.ensureMutable(context.Background(), uuid.New(), &model.LegalInvestigation{Status: status}); err != nil {
			t.Errorf("ensureMutable(%s) = %v, want nil", status, err)
		}
	}
}

type fakeInvestigationEvidenceFiles struct {
	ready    bool
	metadata *RequestFileMetadata
	err      error
}

func (f fakeInvestigationEvidenceFiles) Ready() bool { return f.ready }
func (f fakeInvestigationEvidenceFiles) Metadata(context.Context, string, string) (*RequestFileMetadata, error) {
	return f.metadata, f.err
}

func TestInvestigationEvidenceFileMustBelongToTenantAndInvestigation(t *testing.T) {
	tenantID := uuid.New()
	investigationID := uuid.New()
	fileID := uuid.New()
	entityType := "legal_investigation"
	entityID := investigationID.String()
	svc := &InvestigationService{evidenceFiles: fakeInvestigationEvidenceFiles{ready: true, metadata: &RequestFileMetadata{
		ID: fileID.String(), TenantID: tenantID.String(), EntityType: &entityType, EntityID: &entityID,
	}}}
	if err := svc.validateEvidenceFile(context.Background(), tenantID, investigationID, &fileID); err != nil {
		t.Fatalf("valid evidence link rejected: %v", err)
	}

	other := uuid.New().String()
	svc.evidenceFiles = fakeInvestigationEvidenceFiles{ready: true, metadata: &RequestFileMetadata{
		ID: fileID.String(), TenantID: tenantID.String(), EntityType: &entityType, EntityID: &other,
	}}
	if err := svc.validateEvidenceFile(context.Background(), tenantID, investigationID, &fileID); err == nil {
		t.Fatal("file bound to another investigation was accepted")
	}

	svc.evidenceFiles = fakeInvestigationEvidenceFiles{ready: true, metadata: &RequestFileMetadata{
		ID: fileID.String(), TenantID: uuid.NewString(), EntityType: &entityType, EntityID: &entityID,
	}}
	if err := svc.validateEvidenceFile(context.Background(), tenantID, investigationID, &fileID); err == nil {
		t.Fatal("cross-tenant file was accepted")
	}
}
