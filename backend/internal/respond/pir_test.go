package respond

import (
	"bytes"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAssembleIncidentPIRFromIncidentTimelineAndApprovals(t *testing.T) {
	inc, timeline, approvals := pirFixture()
	ownerID := uuid.New()
	due := inc.DeclaredAt.Add(72 * time.Hour)

	pir, err := AssembleIncidentPIR(inc, timeline, approvals, []CreatePIRActionItemInput{{
		Title:       "Add synthetic checkout probe",
		Description: "Monitor card authorization flow from EMEA.",
		OwnerID:     &ownerID,
		DueAt:       &due,
	}}, []string{"Payment gateway saturation"}, []string{"Scale card authorization workers earlier"}, uuid.New(), (*inc.ResolvedAt).Add(10*time.Minute))
	if err != nil {
		t.Fatalf("AssembleIncidentPIR: %v", err)
	}
	if len(pir.Timeline) != len(timeline) {
		t.Fatalf("timeline entries = %d, want %d", len(pir.Timeline), len(timeline))
	}
	if len(pir.SeverityHistory) != 2 {
		t.Fatalf("severity history = %+v, want declaration plus change", pir.SeverityHistory)
	}
	if len(pir.Roles) != 1 || pir.Roles[0].Role != string(RoleTechnicalLead) {
		t.Fatalf("roles = %+v", pir.Roles)
	}
	if len(pir.Tasks) != 1 || pir.Tasks[0].DurationSeconds != 600 {
		t.Fatalf("tasks = %+v", pir.Tasks)
	}
	if len(pir.Approvals) != 1 || pir.Approvals[0].Decision != ApprovalDecisionApproved {
		t.Fatalf("approvals = %+v", pir.Approvals)
	}
	if len(pir.Notifications) != 1 || pir.Notifications[0].Channel != "status_page" {
		t.Fatalf("notifications = %+v", pir.Notifications)
	}
	if len(pir.Integrations) != 1 || pir.Integrations[0].System != "servicenow" {
		t.Fatalf("integrations = %+v", pir.Integrations)
	}
	if pir.MTTR.ActualSeconds != 5400 || pir.MTTR.TargetSeconds != int((4*time.Hour).Seconds()) || !pir.MTTR.MetTarget {
		t.Fatalf("mttr = %+v", pir.MTTR)
	}
	if pir.ContentHash == "" || pir.ContentHash != PIRContentHash(pir) {
		t.Fatalf("content hash = %q, recomputed %q", pir.ContentHash, PIRContentHash(pir))
	}
}

func TestEvidenceCSVAndPDFContainAuditableRecord(t *testing.T) {
	inc, timeline, approvals := pirFixture()
	pir, err := AssembleIncidentPIR(inc, timeline, approvals, nil, nil, nil, uuid.New(), (*inc.ResolvedAt).Add(10*time.Minute))
	if err != nil {
		t.Fatalf("AssembleIncidentPIR: %v", err)
	}
	pir.ID = uuid.New()
	pir.Status = PIRStatusSignedOff
	signedBy := uuid.New()
	signedAt := pir.GeneratedAt.Add(5 * time.Minute)
	pir.SignedOffBy = &signedBy
	pir.SignedOffAt = &signedAt

	csvBytes, err := BuildEvidenceCSV(inc, pir, timeline, approvals)
	if err != nil {
		t.Fatalf("BuildEvidenceCSV: %v", err)
	}
	records, err := csv.NewReader(bytes.NewReader(csvBytes)).ReadAll()
	if err != nil {
		t.Fatalf("parse evidence CSV: %v", err)
	}
	if len(records) < 6 {
		t.Fatalf("csv records = %d, want incident, mttr, timeline, approval, integration, signoff", len(records))
	}
	joinedCSV := string(csvBytes)
	for _, want := range []string{"incident", "mttr", "timeline", "approval", "integration", "signoff", pir.ContentHash} {
		if !strings.Contains(joinedCSV, want) {
			t.Fatalf("CSV missing %q:\n%s", want, joinedCSV)
		}
	}

	pdfBytes, err := BuildEvidencePDF(inc, pir, timeline, approvals)
	if err != nil {
		t.Fatalf("BuildEvidencePDF: %v", err)
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF-1.4")) {
		t.Fatalf("PDF header = %q", pdfBytes[:8])
	}
	if !bytes.Contains(pdfBytes, []byte("Clario Respond Evidence Export")) || !bytes.Contains(pdfBytes, []byte(inc.Reference)) {
		t.Fatalf("PDF missing expected evidence text")
	}
	sum := sha256.Sum256(pdfBytes)
	if hex.EncodeToString(sum[:]) == "" {
		t.Fatalf("PDF hash unexpectedly empty")
	}
}

func pirFixture() (*Incident, []TimelineEvent, []IncidentApproval) {
	tenantID := uuid.New()
	incidentID := uuid.New()
	actorID := uuid.New()
	approverID := uuid.New()
	start := time.Date(2026, 6, 28, 9, 0, 0, 0, time.UTC)
	resolved := start.Add(90 * time.Minute)
	inc := &Incident{
		ID:               incidentID,
		TenantID:         tenantID,
		Reference:        "INC-2026-0100",
		Title:            "Checkout outage",
		Description:      "Checkout unavailable for card payments.",
		Severity:         SeveritySEV1,
		Status:           StatusResolved,
		DeclaredBy:       actorID,
		DeclaredAt:       start,
		DetectedAt:       &start,
		ResolvedAt:       &resolved,
		ImpactedServices: []string{"checkout", "payments-api"},
	}
	timeline := []TimelineEvent{
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start,
			EventType:  EventIncidentDeclared,
			Payload: map[string]any{
				"reference": inc.Reference,
				"severity":  SeveritySEV2,
				"status":    StatusDeclared,
			},
		},
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start.Add(5 * time.Minute),
			EventType:  EventSeverityChanged,
			Payload: map[string]any{
				"from": SeveritySEV2,
				"to":   SeveritySEV1,
			},
		},
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start.Add(10 * time.Minute),
			EventType:  "respond.role.assigned",
			Payload: map[string]any{
				"role":    string(RoleTechnicalLead),
				"user_id": uuid.New().String(),
			},
		},
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start.Add(30 * time.Minute),
			EventType:  "respond.task.completed",
			Payload: map[string]any{
				"task_id":          "task-1",
				"title":            "Restart card authorization workers",
				"status":           "completed",
				"duration_seconds": 600,
			},
		},
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start.Add(35 * time.Minute),
			EventType:  EventStakeholderUpdateDispatched,
			Payload: map[string]any{
				"channel":       "status_page",
				"recipient_ref": "executive-room",
				"subject":       "INC-2026-0100 SEV1 update",
				"status":        "sent",
			},
		},
		{
			ID:         uuid.New(),
			TenantID:   tenantID,
			IncidentID: incidentID,
			ActorID:    actorID,
			OccurredAt: start.Add(40 * time.Minute),
			EventType:  "respond.integration.itsm.linked",
			Payload: map[string]any{
				"external_system": "servicenow",
				"external_id":     "INC0012345",
				"status":          "linked",
			},
		},
	}
	decidedAt := start.Add(20 * time.Minute)
	approval := IncidentApproval{
		ID:          uuid.New(),
		TenantID:    tenantID,
		IncidentID:  incidentID,
		Action:      ApprovalActionAuthorizeFailover,
		ActionKey:   "payments-region-failover",
		RequestedBy: actorID,
		RequestedAt: start.Add(15 * time.Minute),
		Decision:    ApprovalDecisionApproved,
		DecidedBy:   &approverID,
		DecidedAt:   &decidedAt,
	}
	return inc, timeline, []IncidentApproval{approval}
}
