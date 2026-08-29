package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestRequestSubmitTargetStopsApprovalRequiredRequestsAtSubmitted(t *testing.T) {
	tests := []struct {
		name              string
		requesterApproval bool
		providerApproval  bool
		want              model.RequestStatus
	}{
		{
			name: "no approval required goes straight to approved",
			want: model.RequestStatusApproved,
		},
		{
			name:              "requester approval stops at submitted",
			requesterApproval: true,
			want:              model.RequestStatusSubmitted,
		},
		{
			name:             "provider approval stops at submitted",
			providerApproval: true,
			want:             model.RequestStatusSubmitted,
		},
		{
			name:              "requester approval is first when both are required",
			requesterApproval: true,
			providerApproval:  true,
			want:              model.RequestStatusSubmitted,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := requestSubmitTarget(&model.LegalRequest{
				RequesterApprovalReqd: tt.requesterApproval,
				ProviderApprovalReqd:  tt.providerApproval,
			})
			if got != tt.want {
				t.Fatalf("requestSubmitTarget() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestLegalRequestEventPayloadIncludesRequesterUserID(t *testing.T) {
	requestID := uuid.New()
	requesterID := uuid.New()
	request := &model.LegalRequest{
		ID:              requestID,
		RequestNumber:   "REQ-20260625-ABC12345",
		RequestType:     "consultation",
		RequesterUserID: requesterID,
		RequesterName:   "Requester Name",
		Priority:        model.RequestPriorityUrgent,
		Status:          model.RequestStatusSubmitted,
	}

	payload := legalRequestEventPayload(request)

	if payload["id"] != requestID {
		t.Fatalf("id = %v, want %s", payload["id"], requestID)
	}
	if payload["requester_user_id"] != requesterID.String() {
		t.Fatalf("requester_user_id = %v, want %s", payload["requester_user_id"], requesterID)
	}
	if payload["request_number"] != request.RequestNumber || payload["request_type"] != request.RequestType {
		t.Fatalf("request identity fields = %#v", payload)
	}
	if payload["priority"] != model.RequestPriorityUrgent || payload["status"] != model.RequestStatusSubmitted {
		t.Fatalf("request state fields = %#v", payload)
	}
}

func TestCaseSpawnRequestPreservesBeneficiaryEntity(t *testing.T) {
	beneficiaryID := uuid.New()
	request := &model.LegalRequest{
		ID:                  uuid.New(),
		RequestNumber:       "REQ-20260713-CASE0001",
		RequestType:         "litigation",
		Description:         "Recover an overdue commercial debt.",
		BeneficiaryEntityID: &beneficiaryID,
		Priority:            model.RequestPriorityNormal,
	}

	spawn := (&LegalRequestService{}).caseSpawnRequest(request)

	if spawn.RequestID == nil || *spawn.RequestID != request.ID {
		t.Fatalf("request_id = %v, want %s", spawn.RequestID, request.ID)
	}
	if got := spawn.Metadata["beneficiary_entity_id"]; got != beneficiaryID.String() {
		t.Fatalf("beneficiary_entity_id = %v, want %s", got, beneficiaryID)
	}
	if got := spawn.Metadata["spawned_from_request"]; got != request.RequestNumber {
		t.Fatalf("spawned_from_request = %v, want %s", got, request.RequestNumber)
	}
}

func TestContractRequestRoutesToAssignmentReadyDraft(t *testing.T) {
	requesterID := uuid.New()
	department := "Procurement"
	request := &model.LegalRequest{
		ID:              uuid.New(),
		RequestNumber:   "REQ-20260726-CONTRACT1",
		RequestType:     "contract_review",
		RequesterUserID: requesterID,
		RequesterName:   "Section Manager",
		Department:      &department,
		Description:     "Review the proposed supplier agreement.",
	}
	request.Title.EN = "Supplier agreement"

	if got := classifyRouteSubject(request.RequestType); got != routeSubjectContract {
		t.Fatalf("classifyRouteSubject() = %q, want %q", got, routeSubjectContract)
	}

	spawn := (&LegalRequestService{}).contractSpawnRequest(request)
	if spawn.OwnerUserID != requesterID || spawn.OwnerName != request.RequesterName {
		t.Fatalf("owner = %s/%q, want %s/%q", spawn.OwnerUserID, spawn.OwnerName, requesterID, request.RequesterName)
	}
	if spawn.PartyAName != department || spawn.PartyBName == "" {
		t.Fatalf("parties = %q/%q, want department plus visible placeholder", spawn.PartyAName, spawn.PartyBName)
	}
	if got := spawn.Metadata["legal_request_id"]; got != request.ID.String() {
		t.Fatalf("legal_request_id = %v, want %s", got, request.ID)
	}
}

func TestValidateUrgencyJustification(t *testing.T) {
	structured := "External regulator filing deadline expires tomorrow with material penalty exposure."
	delayOnly := "forgot last minute poor planning asap"
	short := "Court deadline"

	tests := []struct {
		name          string
		priority      model.RequestPriority
		justification *string
		wantErr       bool
	}{
		{
			name:     "normal priority does not require justification",
			priority: model.RequestPriorityNormal,
		},
		{
			name:     "urgent priority requires justification",
			priority: model.RequestPriorityUrgent,
			wantErr:  true,
		},
		{
			name:          "urgent priority rejects brief justification",
			priority:      model.RequestPriorityUrgent,
			justification: &short,
			wantErr:       true,
		},
		{
			name:          "urgent priority rejects requester delay only",
			priority:      model.RequestPriorityUrgent,
			justification: &delayOnly,
			wantErr:       true,
		},
		{
			name:          "urgent priority accepts structured external urgency",
			priority:      model.RequestPriorityUrgent,
			justification: &structured,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateUrgencyJustification(tt.priority, tt.justification, "urgency_justification")
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateUrgencyJustification() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestLegalRequestSpineMigrationEnforcesUrgentJustificationAtDB(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "lex_db", "000020_legal_request_spine.up.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(raw)
	for _, needle := range []string{
		"chk_legal_requests_urgent_justification",
		"priority <> 'urgent'",
		"length(btrim(urgency_justification)) >= 20",
		"poor planning",
		"last[ -]?minute",
		"سوء التخطيط",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("urgent justification DB check missing %q", needle)
		}
	}
}

func TestReclassifiedUrgencyJustification(t *testing.T) {
	currentUrgency := "External regulator deadline justified the existing urgent classification."
	newUrgency := "Court filing window closes tomorrow and delay creates adverse judgment risk."

	got, err := reclassifiedUrgencyJustification(&model.LegalRequest{
		Priority:             model.RequestPriorityNormal,
		UrgencyJustification: nil,
	}, dto.ReclassifyPriorityRequest{
		Priority:             model.RequestPriorityUrgent,
		UrgencyJustification: &newUrgency,
	})
	if err != nil {
		t.Fatalf("reclassify to urgent returned error: %v", err)
	}
	if got == nil || *got != newUrgency {
		t.Fatalf("urgent justification = %v, want %q", got, newUrgency)
	}

	got, err = reclassifiedUrgencyJustification(&model.LegalRequest{
		Priority:             model.RequestPriorityUrgent,
		UrgencyJustification: &currentUrgency,
	}, dto.ReclassifyPriorityRequest{
		Priority: model.RequestPriorityNormal,
	})
	if err != nil {
		t.Fatalf("reclassify to normal returned error: %v", err)
	}
	if got != nil {
		t.Fatalf("normal reclassification justification = %v, want nil", *got)
	}

	_, err = reclassifiedUrgencyJustification(&model.LegalRequest{
		Priority: model.RequestPriorityUrgent,
	}, dto.ReclassifyPriorityRequest{
		Priority: model.RequestPriorityUrgent,
	})
	if err == nil {
		t.Fatal("same-priority reclassification returned nil error")
	}
}

func TestNewLegalRequestPriorityChangeAuditsReclassification(t *testing.T) {
	tenantID := uuid.New()
	requestID := uuid.New()
	changedBy := uuid.New()
	change := newLegalRequestPriorityChange(
		tenantID,
		requestID,
		changedBy,
		model.RequestPriorityNormal,
		model.RequestPriorityUrgent,
		"External legal deadline",
	)

	if change.ID == uuid.Nil {
		t.Fatal("priority change ID was not generated")
	}
	if change.TenantID != tenantID || change.RequestID != requestID || change.ChangedBy != changedBy {
		t.Fatalf("priority change identifiers not preserved: %+v", change)
	}
	if change.FromPriority != model.RequestPriorityNormal || change.ToPriority != model.RequestPriorityUrgent {
		t.Fatalf("priority change = %s -> %s, want normal -> urgent", change.FromPriority, change.ToPriority)
	}
	if change.Reason != "External legal deadline" {
		t.Fatalf("reason = %q, want External legal deadline", change.Reason)
	}
}

// PRD 4.0/5.0: priority reclassification is a provider-review capability. The
// base legal-requester holds lex:request:edit (to author/revise its own request)
// but NOT lex:request:approve, so it must be denied reclassification — otherwise
// it could self-escalate its own request to Urgent. Provider-review roles that
// hold lex:request:approve are admitted, and an unauthenticated context (no roles)
// fails closed.
func TestRequireReclassifyAuthorityBlocksRequesterSelfEscalation(t *testing.T) {
	tests := []struct {
		name    string
		roles   []string
		wantErr bool
	}{
		{name: "base requester (edit only) is denied", roles: []string{"legal-requester"}, wantErr: true},
		{name: "handling officer (edit only) is denied", roles: []string{"legal-officer"}, wantErr: true},
		{name: "no authenticated roles fails closed", roles: nil, wantErr: true},
		{name: "cases section manager (approve) is allowed", roles: []string{"legal-cases-manager"}, wantErr: false},
		{name: "requester-side DOA approver (approve) is allowed", roles: []string{"legal-dept-manager"}, wantErr: false},
		{name: "legal director is allowed", roles: []string{"legal-director"}, wantErr: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			if tt.roles != nil {
				ctx = auth.WithUser(ctx, &auth.ContextUser{ID: uuid.NewString(), Roles: tt.roles})
			}
			err := requireReclassifyAuthority(ctx)
			if (err != nil) != tt.wantErr {
				t.Fatalf("requireReclassifyAuthority(%v) error = %v, wantErr %v", tt.roles, err, tt.wantErr)
			}
		})
	}
}
