package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestServiceCatalogSeedMigrationHasDefaultServiceCodes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "lex_db", "000089_othaim_prd_catalog_alignment.up.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(raw)
	for _, code := range model.DefaultLegalServiceCodes {
		if !strings.Contains(sql, "'"+code+"'") {
			t.Fatalf("aligned service seed does not contain %s", code)
		}
	}
}

func TestEvaluateEligibilityAnyOfPredicates(t *testing.T) {
	service := &model.ServiceCatalogEntry{ID: uuid.New(), Code: model.ServiceCodeContractReview}
	rules := []model.ServiceEligibilityRule{
		{RuleType: model.EligibilityRuleDepartment, Value: "FIN"},
		{RuleType: model.EligibilityRuleRole, Value: string(model.OrgRoleLegalDirector)},
	}

	decision := evaluateEligibility(service, rules, eligibilityInput{
		Department: "HR",
		RoleKeys:   map[string]struct{}{string(model.OrgRoleLegalDirector): {}},
	})
	if !decision.Eligible || decision.MatchedRule != string(model.EligibilityRuleRole) {
		t.Fatalf("decision = %+v, want role match", decision)
	}

	decision = evaluateEligibility(service, rules, eligibilityInput{
		Department: "HR",
		RoleKeys:   map[string]struct{}{},
	})
	if decision.Eligible {
		t.Fatalf("decision eligible = true, want denied: %+v", decision)
	}
	if len(decision.Reasons) != 2 {
		t.Fatalf("reasons = %#v, want both failed predicates", decision.Reasons)
	}
}

func TestResolveEligibilityInputUsesOrgAncestryRecipients(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	rootID := uuid.New()
	deptID := uuid.New()
	sectionID := uuid.New()
	requesterID := uuid.New()
	store := newFakeOrgEntityStore(
		fakeEntity(tenantID, rootID, "ROOT", nil),
		fakeEntity(tenantID, deptID, "FIN", []uuid.UUID{rootID}),
		fakeEntity(tenantID, sectionID, "FIN-OPS", []uuid.UUID{rootID, deptID}),
	)
	store.addRole(fakeRole(tenantID, deptID, model.OrgRoleLegalDirector, requesterID, "Legal director"))
	orgs := &OrgEntityService{
		entities: store,
		now:      func() time.Time { return time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC) },
	}
	rules := []model.ServiceEligibilityRule{
		{RuleType: model.EligibilityRuleRole, Value: string(model.OrgRoleLegalDirector)},
	}

	input, err := resolveEligibilityInput(ctx, tenantID, orgs, requesterID, nil, nil, &sectionID, rules)
	if err != nil {
		t.Fatalf("resolveEligibilityInput() error = %v", err)
	}
	if input.BeneficiaryCode != "FIN-OPS" || input.Department != "FIN-OPS" {
		t.Fatalf("input beneficiary/department = %q/%q, want FIN-OPS", input.BeneficiaryCode, input.Department)
	}
	if _, ok := input.RoleKeys[string(model.OrgRoleLegalDirector)]; !ok {
		t.Fatalf("role keys = %#v, want ancestry legal_director", input.RoleKeys)
	}

	decision := evaluateEligibility(&model.ServiceCatalogEntry{ID: uuid.New(), Code: model.ServiceCodeLegalOpinion}, rules, input)
	if !decision.Eligible {
		t.Fatalf("decision = %+v, want eligible via ancestry role", decision)
	}
}

func TestValidateEligibilityRuleRequestAllowsDefaultDoAMatrix(t *testing.T) {
	if err := validateEligibilityRuleRequest(dto.ServiceEligibilityRuleRequest{RuleType: model.EligibilityRuleDoAMatrix}); err != nil {
		t.Fatalf("validateEligibilityRuleRequest(default DoA) error = %v", err)
	}
	err := validateEligibilityRuleRequest(dto.ServiceEligibilityRuleRequest{RuleType: model.EligibilityRuleRole, Value: "not_a_role"})
	requireAppFieldValue(t, err, "value", "invalid_role_key")
}

func TestIntakeClassifierReturnsMatchedServiceIdentity(t *testing.T) {
	serviceID := uuid.New()
	classification := newIntakeClassifier("general_legal_request").Classify("Contract review needed", "Please review this supplier agreement.", []model.ServiceCatalogEntry{
		{
			ID:          serviceID,
			Code:        model.ServiceCodeContractReview,
			RequestType: "contract_review",
			Name:        forms.LocalizedText{EN: "Contract Review"},
			Channel:     model.ServiceChannelBoth,
			Active:      true,
		},
	})
	if !classification.Matched {
		t.Fatalf("classification matched = false, want true")
	}
	if classification.ServiceID != serviceID || classification.ServiceCode != model.ServiceCodeContractReview || classification.RequestType != "contract_review" {
		t.Fatalf("classification = %+v, want matched contract review service", classification)
	}
}

func TestVerifyIntakeSignatureRequiresFreshTimestamp(t *testing.T) {
	secret := "intake-secret"
	body := []byte(`{"message_id":"m-1","to":"legal@example.com"}`)
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	timestamp := now.Format(time.RFC3339)
	signature := signIntakeWebhookTestPayload(secret, timestamp, body)

	if !verifyIntakeSignature(secret, body, timestamp, signature, now) {
		t.Fatal("verifyIntakeSignature() = false, want true")
	}
	if verifyIntakeSignature(secret, body, timestamp, signature, now.Add(10*time.Minute)) {
		t.Fatal("verifyIntakeSignature(stale) = true, want false")
	}
	bodyOnlyMAC := hmac.New(sha256.New, []byte(secret))
	bodyOnlyMAC.Write(body)
	bodyOnlySignature := "sha256=" + hex.EncodeToString(bodyOnlyMAC.Sum(nil))
	if verifyIntakeSignature(secret, body, timestamp, bodyOnlySignature, now) {
		t.Fatal("verifyIntakeSignature(body-only) = true, want false")
	}
}

func TestBuildPlatformLegalRequestCreateCarriesCatalogRouting(t *testing.T) {
	userID := uuid.New()
	serviceID := uuid.New()
	beneficiaryID := uuid.New()
	department := "Finance"
	justification := "Court filing deadline expires tomorrow and creates material default risk."
	req := dto.IntakeSubmitRequest{
		Title:                forms.LocalizedText{EN: "Review supplier dispute"},
		Description:          "Need advice on supplier dispute.",
		BeneficiaryEntityID:  &beneficiaryID,
		Department:           &department,
		Priority:             model.RequestPriorityUrgent,
		UrgencyJustification: &justification,
		Metadata:             map[string]any{"source": "portal"},
	}
	service := &model.ServiceCatalogEntry{
		ID:                    serviceID,
		Code:                  model.ServiceCodeLitigationSupport,
		RequestType:           "litigation_support",
		RequesterApprovalReqd: true,
		ProviderApprovalReqd:  true,
	}

	createReq := buildPlatformLegalRequestCreate(userID, " requester@example.com ", req, service)
	if createReq.RequestType != "litigation_support" || createReq.ServiceID == nil || *createReq.ServiceID != serviceID {
		t.Fatalf("create request routing = %+v, want service request type/id", createReq)
	}
	if createReq.RequesterName != "requester@example.com" || createReq.BeneficiaryEntityID == nil || *createReq.BeneficiaryEntityID != beneficiaryID {
		t.Fatalf("requester/beneficiary = %q/%v, want requester and beneficiary", createReq.RequesterName, createReq.BeneficiaryEntityID)
	}
	if !createReq.RequesterApprovalReqd || !createReq.ProviderApprovalReqd || createReq.Priority != model.RequestPriorityUrgent || createReq.UrgencyJustification == nil {
		t.Fatalf("approval/priority fields = %+v, want inherited approval and urgent justification", createReq)
	}
	if createReq.Metadata["intake_service_code"] != model.ServiceCodeLitigationSupport ||
		createReq.Metadata["intake_service_id"] != serviceID.String() ||
		createReq.Metadata["requester_user_id"] != userID.String() ||
		createReq.Metadata["beneficiary_entity_id"] != beneficiaryID.String() {
		t.Fatalf("metadata = %#v, want canonical intake routing details", createReq.Metadata)
	}
}

func requireAppFieldValue(t *testing.T, err error, field, value string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want field %s=%s", field, value)
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", appErr.Status, http.StatusUnprocessableEntity)
	}
	if appErr.Fields[field] != value {
		t.Fatalf("field %s = %q, want %q; fields=%#v", field, appErr.Fields[field], value, appErr.Fields)
	}
}

func signIntakeWebhookTestPayload(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}
