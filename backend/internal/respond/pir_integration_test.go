//go:build integration

package respond

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationPIRExportAndClosureGate(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleCommander}}

	detectedAt := time.Now().UTC().Add(-2 * time.Hour)
	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "checkout unavailable",
		Description:      "Checkout is unavailable for card payments.",
		Severity:         SeveritySEV1,
		DetectedAt:       &detectedAt,
		ImpactedServices: []string{"checkout", "payments-api"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	if _, err := svc.RecordTimelineEvent(ctx, tenantID, inc.ID, actor, "respond.role.assigned", map[string]any{
		"role":    string(RoleTechnicalLead),
		"user_id": uuid.New().String(),
	}); err != nil {
		t.Fatalf("role timeline: %v", err)
	}
	if _, err := svc.RecordTimelineEvent(ctx, tenantID, inc.ID, actor, "respond.task.completed", map[string]any{
		"task_id":          "task-restart-workers",
		"title":            "Restart card authorization workers",
		"status":           "completed",
		"duration_seconds": 900,
	}); err != nil {
		t.Fatalf("task timeline: %v", err)
	}
	if _, err := svc.RecordTimelineEvent(ctx, tenantID, inc.ID, actor, "respond.integration.itsm.linked", map[string]any{
		"external_system": "servicenow",
		"external_id":     "INC0012456",
		"status":          "linked",
	}); err != nil {
		t.Fatalf("integration timeline: %v", err)
	}
	if _, err := svc.DispatchStakeholderUpdate(ctx, tenantID, DispatchStakeholderUpdateInput{
		IncidentID:   inc.ID,
		Reason:       StakeholderUpdateReasonTriggered,
		Channel:      "status_page",
		RecipientRef: "executive-room",
		Actor:        actor,
	}); err != nil {
		t.Fatalf("stakeholder dispatch: %v", err)
	}

	requiredRole := RoleTechnicalLead
	approval, err := svc.RequestApproval(ctx, tenantID, RequestApprovalInput{
		IncidentID:   inc.ID,
		Action:       ApprovalActionAuthorizeFailover,
		ActionKey:    "checkout-region",
		RequiredRole: &requiredRole,
		Actor:        actor,
	})
	if err != nil {
		t.Fatalf("request approval: %v", err)
	}
	if _, err := svc.DecideApproval(ctx, tenantID, DecideApprovalInput{
		ApprovalID: approval.ID,
		Decision:   ApprovalDecisionApproved,
		Actor:      Actor{UserID: uuid.New(), IncidentRoles: []IncidentRole{RoleTechnicalLead}},
	}); err != nil {
		t.Fatalf("approve: %v", err)
	}

	resolved, err := transitionToResolved(ctx, svc, tenantID, inc, actor)
	if err != nil {
		t.Fatalf("transition to resolved: %v", err)
	}

	dueAt := time.Now().UTC().Add(48 * time.Hour)
	ownerID := uuid.New()
	pir, err := svc.GeneratePIR(ctx, tenantID, GeneratePIRInput{
		IncidentID:          resolved.ID,
		ContributingFactors: []string{"Card authorization workers saturated"},
		LessonsLearned:      []string{"Scale authorization workers before regional promotions"},
		ActionItems: []CreatePIRActionItemInput{{
			Title:       "Add regional checkout saturation alert",
			Description: "Alert before card authorization saturation reaches checkout outage levels.",
			OwnerID:     &ownerID,
			DueAt:       &dueAt,
		}},
		Actor: actor,
	})
	if err != nil {
		t.Fatalf("generate PIR: %v", err)
	}
	if len(pir.Timeline) == 0 || len(pir.Roles) == 0 || len(pir.Tasks) == 0 || len(pir.Approvals) == 0 || len(pir.Notifications) == 0 || len(pir.Integrations) == 0 {
		t.Fatalf("PIR missing real sections: timeline=%d roles=%d tasks=%d approvals=%d notifications=%d integrations=%d",
			len(pir.Timeline), len(pir.Roles), len(pir.Tasks), len(pir.Approvals), len(pir.Notifications), len(pir.Integrations))
	}
	if len(pir.ActionItems) != 1 {
		t.Fatalf("action items = %d, want 1", len(pir.ActionItems))
	}

	if _, err := svc.TransitionIncidentWithClosureGate(ctx, tenantID, TransitionIncidentInput{
		IncidentID:      resolved.ID,
		To:              StatusClosed,
		ExpectedVersion: resolved.RowVersion,
		Actor:           actor,
	}); !errors.Is(err, ErrPIRNotComplete) {
		t.Fatalf("closure before signoff error = %v, want ErrPIRNotComplete", err)
	}

	signed, err := svc.SignOffPIR(ctx, tenantID, SignOffPIRInput{IncidentID: resolved.ID, Actor: actor})
	if err != nil {
		t.Fatalf("sign off PIR: %v", err)
	}
	if signed.Status != PIRStatusSignedOff || signed.SignedOffBy == nil || signed.SignedOffAt == nil {
		t.Fatalf("signed PIR = %+v", signed)
	}

	updatedItem, err := svc.UpdatePIRActionItemStatus(ctx, tenantID, UpdatePIRActionItemInput{
		ActionItemID: signed.ActionItems[0].ID,
		Status:       PIRActionItemClosed,
		Actor:        actor,
	})
	if err != nil {
		t.Fatalf("close action item: %v", err)
	}
	if updatedItem.Status != PIRActionItemClosed || updatedItem.CompletedAt == nil {
		t.Fatalf("updated action item = %+v", updatedItem)
	}

	csvExport, err := svc.ExportIncidentEvidence(ctx, tenantID, EvidenceExportInput{
		IncidentID: resolved.ID,
		Format:     EvidenceFormatCSV,
		Actor:      actor,
	})
	if err != nil {
		t.Fatalf("export CSV: %v", err)
	}
	records, err := csv.NewReader(bytes.NewReader(csvExport.Content)).ReadAll()
	if err != nil {
		t.Fatalf("parse CSV export: %v", err)
	}
	if len(records) < 6 {
		t.Fatalf("CSV export records = %d, want complete evidence rows", len(records))
	}
	csvSum := sha256.Sum256(csvExport.Content)
	if csvExport.ContentSHA256 != hex.EncodeToString(csvSum[:]) || csvExport.ByteSize != len(csvExport.Content) {
		t.Fatalf("CSV export integrity = hash %s size %d", csvExport.ContentSHA256, csvExport.ByteSize)
	}

	pdfExport, err := svc.ExportIncidentEvidence(ctx, tenantID, EvidenceExportInput{
		IncidentID: resolved.ID,
		Format:     EvidenceFormatPDF,
		Actor:      actor,
	})
	if err != nil {
		t.Fatalf("export PDF: %v", err)
	}
	if !bytes.HasPrefix(pdfExport.Content, []byte("%PDF-1.4")) || !bytes.Contains(pdfExport.Content, []byte(resolved.Reference)) {
		t.Fatalf("PDF export missing header or incident reference")
	}
	pdfSum := sha256.Sum256(pdfExport.Content)
	if pdfExport.ContentSHA256 != hex.EncodeToString(pdfSum[:]) || pdfExport.ByteSize != len(pdfExport.Content) {
		t.Fatalf("PDF export integrity = hash %s size %d", pdfExport.ContentSHA256, pdfExport.ByteSize)
	}

	var audits []EvidenceExport
	err = svc.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		audits, err = svc.repo.ListEvidenceExports(ctx, tx, tenantID, resolved.ID, 10)
		return err
	})
	if err != nil {
		t.Fatalf("list evidence export audits: %v", err)
	}
	if len(audits) != 2 {
		t.Fatalf("evidence audit rows = %d, want 2", len(audits))
	}

	closed, err := svc.TransitionIncidentWithClosureGate(ctx, tenantID, TransitionIncidentInput{
		IncidentID:      resolved.ID,
		To:              StatusClosed,
		ExpectedVersion: resolved.RowVersion,
		Actor:           actor,
	})
	if err != nil {
		t.Fatalf("closure after signoff: %v", err)
	}
	if closed.Status != StatusClosed {
		t.Fatalf("closed status = %s, want Closed", closed.Status)
	}
}

func transitionToResolved(ctx context.Context, svc *Service, tenantID uuid.UUID, inc *Incident, actor Actor) (*Incident, error) {
	var err error
	for _, status := range []Status{StatusTriaged, StatusMobilizing, StatusInvestigating, StatusMitigating, StatusMitigated, StatusResolved} {
		inc, err = svc.TransitionIncident(ctx, tenantID, TransitionIncidentInput{
			IncidentID:      inc.ID,
			To:              status,
			ExpectedVersion: inc.RowVersion,
			Actor:           actor,
		})
		if err != nil {
			return nil, err
		}
	}
	return inc, nil
}
