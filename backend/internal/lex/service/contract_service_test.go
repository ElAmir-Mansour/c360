package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestStatusTransition_DraftToReview(t *testing.T) {
	if err := ValidateContractTransition(string(model.ContractStatusDraft), string(model.ContractStatusInternalReview)); err != nil {
		t.Fatalf("ValidateContractTransition() error = %v", err)
	}
}

func TestStatusTransition_ActiveToExpired(t *testing.T) {
	if err := ValidateContractTransition(string(model.ContractStatusActive), string(model.ContractStatusExpired)); err != nil {
		t.Fatalf("ValidateContractTransition() error = %v", err)
	}
}

func TestStatusTransition_DraftToActive(t *testing.T) {
	if err := ValidateContractTransition(string(model.ContractStatusDraft), string(model.ContractStatusActive)); err == nil {
		t.Fatal("ValidateContractTransition() error = nil, want invalid transition error")
	}
}

func TestStatusTransition_AllValidPaths(t *testing.T) {
	tests := []struct {
		current model.ContractStatus
		next    model.ContractStatus
	}{
		{model.ContractStatusDraft, model.ContractStatusInternalReview},
		{model.ContractStatusDraft, model.ContractStatusCancelled},
		{model.ContractStatusInternalReview, model.ContractStatusLegalReview},
		{model.ContractStatusInternalReview, model.ContractStatusDraft},
		{model.ContractStatusLegalReview, model.ContractStatusNegotiation},
		{model.ContractStatusLegalReview, model.ContractStatusInternalReview},
		{model.ContractStatusLegalReview, model.ContractStatusDraft},
		{model.ContractStatusNegotiation, model.ContractStatusPendingSignature},
		{model.ContractStatusNegotiation, model.ContractStatusCancelled},
		{model.ContractStatusNegotiation, model.ContractStatusDraft},
		{model.ContractStatusPendingSignature, model.ContractStatusCancelled},
		{model.ContractStatusActive, model.ContractStatusSuspended},
		{model.ContractStatusActive, model.ContractStatusTerminated},
		{model.ContractStatusActive, model.ContractStatusExpired},
		{model.ContractStatusActive, model.ContractStatusRenewed},
		{model.ContractStatusSuspended, model.ContractStatusActive},
		{model.ContractStatusSuspended, model.ContractStatusTerminated},
		{model.ContractStatusExpired, model.ContractStatusRenewed},
	}
	for _, tc := range tests {
		if err := ValidateContractTransition(string(tc.current), string(tc.next)); err != nil {
			t.Fatalf("ValidateContractTransition(%s, %s) error = %v", tc.current, tc.next, err)
		}
	}
}

func TestStatusTransition_InternalReviewApprovalIsWorkflowOnly(t *testing.T) {
	current := string(model.ContractStatusInternalReview)
	next := string(model.ContractStatusPendingSignature)

	if err := ValidateContractTransition(current, next); err == nil {
		t.Fatal("generic transition accepted internal_review -> pending_signature; want workflow-only rejection")
	}
	if err := validateContractWorkflowTransition(current, next); err != nil {
		t.Fatalf("workflow transition rejected internal_review -> pending_signature: %v", err)
	}
}

func TestStatusTransition_ActivationIsSignatureOnly(t *testing.T) {
	current := string(model.ContractStatusPendingSignature)
	next := string(model.ContractStatusActive)

	if err := ValidateContractTransition(current, next); err == nil {
		t.Fatal("generic transition accepted pending_signature -> active; want signature-only rejection")
	}
	if err := validateContractSignatureTransition(current, next); err != nil {
		t.Fatalf("signature transition rejected pending_signature -> active: %v", err)
	}
	if err := validateContractSignatureTransition(string(model.ContractStatusNegotiation), next); err == nil {
		t.Fatal("signature transition accepted negotiation -> active; want rejection")
	}
}

func TestDiffContractText_MarksAddedAndRemovedLines(t *testing.T) {
	base := "Section 1 Term\nOld payment term\nSection 3 Confidentiality"
	target := "Section 1 Term\nNew payment term\nSection 3 Confidentiality\nSection 4 Audit rights"

	segments, added, removed := diffContractText(base, target)

	if added != 2 {
		t.Fatalf("added = %d, want 2", added)
	}
	if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}

	var sawOld, sawNew, sawAudit bool
	for _, segment := range segments {
		switch {
		case segment.Operation == model.RedlineOperationRemoved && segment.Text == "Old payment term":
			sawOld = true
			if segment.BaseLine == nil || *segment.BaseLine != 2 {
				t.Fatalf("old payment base line = %v, want 2", segment.BaseLine)
			}
		case segment.Operation == model.RedlineOperationAdded && segment.Text == "New payment term":
			sawNew = true
			if segment.TargetLine == nil || *segment.TargetLine != 2 {
				t.Fatalf("new payment target line = %v, want 2", segment.TargetLine)
			}
		case segment.Operation == model.RedlineOperationAdded && segment.Text == "Section 4 Audit rights":
			sawAudit = true
		}
	}
	if !sawOld || !sawNew || !sawAudit {
		t.Fatalf("missing expected redline markers: old=%v new=%v audit=%v segments=%+v", sawOld, sawNew, sawAudit, segments)
	}
}

func TestContractReportFilters_IncludesAppliedFilters(t *testing.T) {
	status := model.ContractStatusActive
	contractType := model.ContractTypeVendor
	riskLevel := model.RiskLevelHigh
	expiring := 30

	filters := contractReportFilters(model.ContractListFilters{
		Search:         "vendor",
		Status:         &status,
		Type:           &contractType,
		RiskLevel:      &riskLevel,
		Department:     "legal",
		Tag:            "ksa",
		ExpiringInDays: &expiring,
	})

	for key, want := range map[string]string{
		"search":           "vendor",
		"status":           "active",
		"type":             "vendor",
		"risk_level":       "high",
		"department":       "legal",
		"tag":              "ksa",
		"expiring_in_days": "30",
	} {
		if filters[key] != want {
			t.Fatalf("filters[%s] = %q, want %q in %+v", key, filters[key], want, filters)
		}
	}
}

func TestBuildContractBrief_UsesDetailAnalysisClausesAndMetadata(t *testing.T) {
	effective := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	expiry := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)
	renewal := time.Date(2026, 11, 30, 0, 0, 0, 0, time.UTC)
	generatedAt := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	value := 250000.0
	paymentTerms := "Pay undisputed invoices within 30 days."
	section := "8"
	clauseType := model.ClauseTypeLimitationOfLiability
	contractID := uuid.New()

	brief := buildContractBrief(&model.ContractDetail{
		Contract: &model.Contract{
			ID:                contractID,
			Title:             "Facilities Services Agreement",
			Type:              model.ContractTypeServiceAgreement,
			Status:            model.ContractStatusDraft,
			PartyBName:        "Najm Facilities LLC",
			OwnerName:         "Aisha Khan",
			TotalValue:        &value,
			Currency:          "SAR",
			EffectiveDate:     &effective,
			ExpiryDate:        &expiry,
			RenewalDate:       &renewal,
			AutoRenew:         true,
			RenewalNoticeDays: 45,
			PaymentTerms:      &paymentTerms,
			RiskLevel:         model.RiskLevelLow,
			AnalysisStatus:    model.AnalysisStatusCompleted,
			Metadata: map[string]any{
				"obligations": []any{
					map[string]any{"label": "Insurance certificate", "value": "Provide annual evidence of coverage", "source": "metadata.test"},
				},
			},
		},
		Clauses: []model.Clause{
			{
				ID:               uuid.MustParse("00000000-0000-0000-0000-000000000002"),
				Title:            "Confidentiality",
				ClauseType:       model.ClauseTypeConfidentiality,
				RiskLevel:        model.RiskLevelLow,
				RiskScore:        10,
				Content:          "Standard confidentiality language.",
				SectionReference: &section,
			},
			{
				ID:               uuid.MustParse("00000000-0000-0000-0000-000000000001"),
				Title:            "Limitation of Liability",
				ClauseType:       model.ClauseTypeLimitationOfLiability,
				RiskLevel:        model.RiskLevelHigh,
				RiskScore:        75,
				Content:          "Liability is uncapped for indirect losses.",
				SectionReference: &section,
			},
		},
		LatestAnalysis: &model.ContractRiskAnalysis{
			OverallRisk:         model.RiskLevelHigh,
			RiskScore:           72.5,
			ClauseCount:         2,
			HighRiskClauseCount: 1,
			KeyFindings: []model.RiskFinding{
				{
					Title:           "Uncapped liability",
					Description:     "The limitation clause leaves indirect loss exposure open.",
					Severity:        model.RiskLevelHigh,
					ClauseReference: &section,
					Recommendation:  "Negotiate a liability cap.",
					ClauseType:      &clauseType,
				},
			},
		},
	}, generatedAt)

	if brief.ContractID != contractID || brief.Title != "Facilities Services Agreement" {
		t.Fatalf("brief identity mismatch: %+v", brief)
	}
	if brief.RiskLevel != model.RiskLevelHigh || brief.RiskScore == nil || *brief.RiskScore != 72.5 {
		t.Fatalf("brief risk = %s/%v, want high/72.5", brief.RiskLevel, brief.RiskScore)
	}
	if len(brief.TopClauses) != 2 || brief.TopClauses[0].ClauseType != model.ClauseTypeLimitationOfLiability {
		t.Fatalf("top clauses not risk ordered: %+v", brief.TopClauses)
	}
	if len(brief.TopRisks) != 1 || brief.TopRisks[0].Title != "Uncapped liability" {
		t.Fatalf("top risks = %+v, want analysis finding", brief.TopRisks)
	}
	if len(brief.Obligations) != 2 {
		t.Fatalf("obligations = %+v, want metadata obligation plus payment terms", brief.Obligations)
	}
	if len(brief.RenewalSignals) != 4 {
		t.Fatalf("renewal signals = %+v, want auto-renew, renewal date, expiry date, notice", brief.RenewalSignals)
	}
	if !brief.GeneratedAt.Equal(generatedAt) {
		t.Fatalf("generated_at = %s, want %s", brief.GeneratedAt, generatedAt)
	}
}

func TestBuildContractRenewalWarningSummary_UsesConfiguredLeadAndSorts(t *testing.T) {
	tenantID := uuid.New()
	now := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	urgentExpiry := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	warningExpiry := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	futureExpiry := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)

	summary := buildContractRenewalWarningSummary(tenantID, []model.Contract{
		{
			ID:                uuid.MustParse("00000000-0000-0000-0000-000000000003"),
			Title:             "Future contract",
			Status:            model.ContractStatusActive,
			PartyBName:        "Future LLC",
			OwnerName:         "Legal",
			ExpiryDate:        &futureExpiry,
			RenewalNoticeDays: 30,
		},
		{
			ID:                uuid.MustParse("00000000-0000-0000-0000-000000000002"),
			Title:             "Warning contract",
			Status:            model.ContractStatusActive,
			PartyBName:        "Warning LLC",
			OwnerName:         "Legal",
			ExpiryDate:        &warningExpiry,
			RenewalNoticeDays: 10,
		},
		{
			ID:                uuid.MustParse("00000000-0000-0000-0000-000000000001"),
			Title:             "Urgent contract",
			Status:            model.ContractStatusActive,
			PartyBName:        "Urgent LLC",
			OwnerName:         "Legal",
			ExpiryDate:        &urgentExpiry,
			RenewalNoticeDays: 45,
		},
	}, now, 60, 30)

	if summary.TenantID != tenantID || summary.Total != 2 || summary.Urgent != 1 || summary.Warning != 1 {
		t.Fatalf("summary counts = %+v, want total=2 urgent=1 warning=1", summary)
	}
	if summary.Items[0].Title != "Urgent contract" || summary.Items[0].ConfiguredLeadDays != 45 {
		t.Fatalf("first warning = %+v, want urgent contract using contract notice", summary.Items[0])
	}
	if summary.Items[1].Title != "Warning contract" || summary.Items[1].ConfiguredLeadDays != 30 {
		t.Fatalf("second warning = %+v, want warning contract using configured lead", summary.Items[1])
	}
}

func TestClassifyContract_RecommendsAndOverrides(t *testing.T) {
	contract := &model.Contract{
		ID:           uuid.New(),
		Type:         model.ContractTypeOther,
		Title:        "Master Services Agreement",
		Description:  "Vendor will provide managed services under strict service levels.",
		PartyBName:   "Acme LLC",
		DocumentText: "This service level agreement defines uptime and service credits.",
		Metadata:     map[string]any{},
	}
	classifiedAt := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)

	result := classifyContract(contract, dto.ClassifyContractRequest{}, classifiedAt)

	if result.RecommendedType != model.ContractTypeSLA {
		t.Fatalf("recommended_type = %s, want %s (matches=%v)", result.RecommendedType, model.ContractTypeSLA, result.MatchedTerms)
	}
	if result.Confidence <= 0.55 || len(result.MatchedTerms) == 0 {
		t.Fatalf("classification confidence/matches = %.2f/%v, want deterministic evidence", result.Confidence, result.MatchedTerms)
	}
	override := model.ContractTypeNDA
	overridden := classifyContract(contract, dto.ClassifyContractRequest{OverrideType: &override}, classifiedAt)
	if overridden.RecommendedType != model.ContractTypeNDA || overridden.Confidence != 1 {
		t.Fatalf("override result = %+v, want nda confidence 1", overridden)
	}
}

func TestBuildContractTimeline_IncludesVersionsAndMetadataEvents(t *testing.T) {
	contractID := uuid.New()
	creatorID := uuid.New()
	uploaderID := uuid.New()
	createdAt := time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC)
	uploadedAt := time.Date(2026, 6, 5, 10, 0, 0, 0, time.UTC)
	metadataAt := time.Date(2026, 6, 6, 11, 0, 0, 0, time.UTC)
	analyzedAt := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	statusAt := time.Date(2026, 6, 8, 13, 0, 0, 0, time.UTC)
	prev := model.ContractStatusDraft
	statusBy := uuid.New()
	score := 72.5
	generatedAt := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)

	timeline := buildContractTimeline(&model.Contract{
		ID:              contractID,
		Title:           "Vendor MSA",
		Type:            model.ContractTypeVendor,
		Status:          model.ContractStatusLegalReview,
		PreviousStatus:  &prev,
		StatusChangedAt: &statusAt,
		StatusChangedBy: &statusBy,
		RiskLevel:       model.RiskLevelHigh,
		RiskScore:       &score,
		LastAnalyzedAt:  &analyzedAt,
		CreatedBy:       creatorID,
		CreatedAt:       createdAt,
		UpdatedAt:       statusAt,
		Metadata: map[string]any{
			"timeline": []any{
				map[string]any{
					"id":          "negotiation-note",
					"event_type":  "negotiation_note",
					"title":       "Business accepted fallback",
					"description": "Fallback clause approved by business.",
					"actor":       "Aisha",
					"occurred_at": metadataAt.Format(time.RFC3339),
				},
			},
		},
	}, []model.ContractVersion{
		{
			ContractID:    contractID,
			Version:       1,
			FileID:        uuid.New(),
			FileName:      "vendor-msa.pdf",
			FileSizeBytes: 1200,
			ContentHash:   "sha256:contract",
			UploadedBy:    uploaderID,
			UploadedAt:    uploadedAt,
		},
	}, generatedAt)

	if timeline.ContractID != contractID || !timeline.GeneratedAt.Equal(generatedAt) {
		t.Fatalf("timeline identity = %+v", timeline)
	}
	if len(timeline.Events) != 5 {
		t.Fatalf("events = %d, want created/version/metadata/analysis/status: %+v", len(timeline.Events), timeline.Events)
	}
	if timeline.Events[0].EventType != "status_changed" || timeline.Events[1].EventType != "analysis_completed" {
		t.Fatalf("events not reverse chronological: %+v", timeline.Events[:2])
	}
	foundMetadata := false
	for _, event := range timeline.Events {
		if event.ID == "negotiation-note" && event.Source == "contract.metadata.timeline" {
			foundMetadata = true
		}
	}
	if !foundMetadata {
		t.Fatalf("metadata timeline event missing: %+v", timeline.Events)
	}
}
