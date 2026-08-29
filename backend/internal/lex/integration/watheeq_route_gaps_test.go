//go:build integration

package integration

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/drafting"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestWatheeqSignatureRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq Signature Route Gap Contract", model.ContractTypeServiceAgreement, 720_000, lifecycleContractText())
	for _, status := range []model.ContractStatus{
		model.ContractStatusInternalReview,
		model.ContractStatusLegalReview,
		model.ContractStatusNegotiation,
		model.ContractStatusPendingSignature,
	} {
		h.updateContractStatus(t, contract.ID, status)
	}

	dueAt := time.Now().UTC().AddDate(0, 0, 5)
	expiresAt := time.Now().UTC().AddDate(0, 0, 14)
	signerEmail := "route-gap-signer@example.test"
	signingLanguage := model.SignatureLanguageBilingual
	created := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/signatures", dto.CreateSignatureEnvelopeRequest{
		ContractID:     &contract.ID,
		Title:          "Watheeq signature acceptance pack",
		Subject:        "Please sign the Watheeq acceptance pack",
		Message:        "Please review and sign the routed acceptance pack.",
		Language:       model.SignatureLanguageBilingual,
		SubjectAr:      "AR signing subject",
		MessageAr:      "AR signing message",
		LegalConsentEn: "I consent to sign this Watheeq document electronically.",
		LegalConsentAr: "AR electronic signature consent",
		Provider:       model.SignatureProviderNative,
		Method:         model.SignatureMethodOTP,
		DueAt:          &dueAt,
		ExpiresAt:      &expiresAt,
		EvidenceMetadata: map[string]any{
			"route_gap": "signature_create",
		},
		Recipients: []dto.CreateSignatureRecipientRequest{{
			Name:             "Route Gap Signer",
			Email:            &signerEmail,
			Role:             model.SignatureRecipientSigner,
			Language:         &signingLanguage,
			SigningOrder:     1,
			EvidenceMetadata: map[string]any{"recipient_control": "WTQ-SIG-ROUTE"},
		}},
	}), http.StatusCreated)
	if created.Status != model.SignatureEnvelopeDraft || len(created.Recipients) != 1 {
		t.Fatalf("created signature envelope = %+v, want draft with one recipient", created)
	}
	recipient := created.Recipients[0]

	sendMessage := "Please sign the routed acceptance pack."
	sent := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/signatures/%s/send", created.ID), dto.SendSignatureEnvelopeRequest{
		Message: &sendMessage,
		EvidenceMetadata: map[string]any{
			"dispatch_control": "WTQ-SIG-SEND",
		},
	}), http.StatusOK)
	if sent.Status != model.SignatureEnvelopeSent || sent.SentAt == nil {
		t.Fatalf("sent envelope = %+v, want sent status and sent_at", sent)
	}
	if len(sent.Recipients) != 1 || sent.Recipients[0].Status != model.SignatureRecipientSent || sent.Recipients[0].ProviderRecipientID == nil {
		t.Fatalf("sent recipients = %+v, want provider-recipient sent state", sent.Recipients)
	}

	rendered := mustData[model.RenderedSignatureText](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/watheeq/signatures/%s/recipients/%s/rendering", created.ID, recipient.ID), nil), http.StatusOK)
	if rendered.Language != model.SignatureLanguageBilingual || rendered.Primary.Language != model.SignatureLanguageAR || rendered.Secondary == nil || rendered.Secondary.Language != model.SignatureLanguageEN {
		t.Fatalf("rendered signing text = %+v, want bilingual AR primary and EN secondary", rendered)
	}

	viewed := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/signatures/%s/recipients/%s/actions", created.ID, recipient.ID), dto.SignatureRecipientActionRequest{
		Action:           dto.SignatureRecipientActionView,
		ActorName:        routeGapStringPtr("Route Gap Signer"),
		ActorEmail:       &signerEmail,
		EvidenceMetadata: map[string]any{"action": "view"},
	}), http.StatusOK)
	if viewed.Status != model.SignatureEnvelopeViewed || viewed.Recipients[0].Status != model.SignatureRecipientViewed {
		t.Fatalf("viewed envelope = %+v, want viewed envelope and recipient", viewed)
	}

	providerEventID := "native-provider-route-gap-signed"
	signedHash := "sha256:route-gap-provider-signed"
	occurredAt := time.Now().UTC()
	signed := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/signatures/%s/provider-events", created.ID), dto.SignatureProviderEventRequest{
		Provider:        model.SignatureProviderNative,
		ProviderStatus:  "completed",
		ProviderEventID: &providerEventID,
		RecipientID:     &recipient.ID,
		ActorName:       routeGapStringPtr("Route Gap Signer"),
		ActorEmail:      &signerEmail,
		EvidenceHash:    &signedHash,
		EvidenceMetadata: map[string]any{
			"provider_control": "WTQ-SIG-PROVIDER",
		},
		OccurredAt: &occurredAt,
	}), http.StatusOK)
	if signed.Status != model.SignatureEnvelopeSigned || signed.CompletedAt == nil || signed.Recipients[0].Status != model.SignatureRecipientSigned {
		t.Fatalf("provider signed envelope = %+v, want signed envelope and recipient", signed)
	}

	custodyHash := "sha256:route-gap-signed-file"
	custody := mustData[model.SignatureEnvelope](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/signatures/%s/custody", created.ID), dto.RecordSignatureCustodyRequest{
		FileID:        uuid.NewString(),
		FileName:      "watheeq-route-gap-signed.pdf",
		FileSizeBytes: 2048,
		ContentHash:   hashText("signed watheeq route gap contract"),
		EvidenceHash:  &custodyHash,
		Provider:      model.SignatureProviderNative,
		SignedAt:      &occurredAt,
		RetentionMetadata: map[string]any{
			"retention_policy": "seven_years",
		},
		CustodyMetadata: map[string]any{
			"custody_control": "WTQ-SIG-CUSTODY",
		},
	}), http.StatusOK)
	if len(custody.CustodyEvidence) != 1 || custody.CustodyEvidence[0].EvidenceHash == nil || *custody.CustodyEvidence[0].EvidenceHash != custodyHash {
		t.Fatalf("custody evidence = %+v, want one signed-file custody record", custody.CustodyEvidence)
	}
}

func TestWatheeqReminderOutboxDispatchRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq Reminder Dispatch Contract", model.ContractTypeServiceAgreement, 430_000, lifecycleContractText())
	asOf := time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)
	dueDate := asOf.AddDate(0, 0, 7)

	for _, title := range []string{"Dispatch insurance certificate reminder", "Dispatch service report reminder"} {
		created := mustData[model.Obligation](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations", dto.CreateObligationRequest{
			Title:            title,
			Description:      "Focused reminder dispatch route fixture.",
			Type:             model.ObligationTypeReporting,
			Status:           model.ObligationStatusOpen,
			Priority:         model.LegalPriorityHigh,
			ContractID:       &contract.ID,
			OwnerUserID:      h.userID,
			OwnerName:        "Integration Owner",
			DueDate:          dueDate,
			ReminderEnabled:  true,
			ReminderLeadDays: []int{7},
			Tags:             []string{"watheeq-reminder-dispatch"},
			Metadata:         map[string]any{"route_gap": "reminder_dispatch"},
		}), http.StatusCreated)
		if created.ContractID == nil || *created.ContractID != contract.ID {
			t.Fatalf("created obligation = %+v, want contract-scoped obligation", created)
		}
	}

	horizonDays := 7
	includeEscalations := false
	enqueued := mustData[model.ObligationReminderEnqueueResult](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations/reminders/enqueue", dto.EnqueueObligationRemindersRequest{
		AsOf:               &asOf,
		HorizonDays:        &horizonDays,
		IncludeEscalations: &includeEscalations,
		Channels:           []model.ObligationNotificationChannel{model.ObligationNotificationChannelEmail},
	}), http.StatusCreated)
	if enqueued.QueuedCount != 2 || len(enqueued.Queued) != 2 {
		t.Fatalf("enqueued reminders = %+v, want two pending email items", enqueued)
	}

	provider := "dry-run"
	single := mustData[model.ObligationReminderDispatchResult](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/obligations/reminders/outbox/%s/dispatch", enqueued.Queued[0].ID), dto.DispatchObligationReminderOutboxRequest{
		Provider: provider,
	}), http.StatusOK)
	assertReminderDispatchResult(t, single, 1, 1)
	if single.Attempts[0].Item == nil || single.Attempts[0].Item.ProviderMessageID == nil || single.Attempts[0].Item.ProviderMetadata["dry_run"] != true {
		t.Fatalf("single dispatch attempt = %+v, want sent dry-run proof", single.Attempts[0])
	}

	limit := 10
	bulk := mustData[model.ObligationReminderDispatchResult](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations/reminders/outbox/dispatch", dto.DispatchObligationReminderOutboxRequest{
		Provider: provider,
		Limit:    &limit,
		AsOf:     &asOf,
	}), http.StatusOK)
	assertReminderDispatchResult(t, bulk, 1, 1)
	if bulk.Attempts[0].OutboxID == enqueued.Queued[0].ID {
		t.Fatalf("bulk dispatch retried single-dispatched item %s without retry flag", enqueued.Queued[0].ID)
	}
}

func TestWatheeqSemanticSearchRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	suffix := uuid.NewString()
	clause := mustData[model.ClauseLibraryItem](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/clause-library", dto.CreateClauseLibraryItemRequest{
		Code:             "WTQ-SEM-CLAUSE-" + suffix,
		TitleEN:          "Personal Data Processing Addendum",
		TitleAR:          "AR data processing title",
		TextEN:           "The processor shall protect personal data and notify controllers after a breach.",
		TextAR:           "AR personal data processing text",
		ClauseType:       model.ClauseTypeDataProtection,
		Category:         "data_protection",
		Jurisdiction:     "SA",
		Source:           "Watheeq route gap integration",
		Version:          1,
		Status:           model.ClauseLibraryStatusActive,
		GovernanceStatus: model.ClauseGovernanceApproved,
		Tags:             []string{"pdpl", "privacy"},
		Metadata:         map[string]any{"risk_level": "high"},
	}), http.StatusCreated)

	regulation := mustData[model.RegulationLibraryItem](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/regulations", dto.CreateRegulationLibraryItemRequest{
		Code:           "WTQ-SEM-REG-" + suffix,
		TitleEN:        "Personal Data Protection Law",
		TitleAR:        "AR privacy law title",
		DescriptionEN:  "Saudi privacy requirements for controllers and processors.",
		DescriptionAR:  "AR privacy requirements description",
		Jurisdiction:   "SA",
		Authority:      "SDAIA",
		Source:         "Watheeq route gap integration",
		RegulationType: model.RegulationTypeLaw,
		Version:        1,
		Status:         model.RegulationStatusActive,
		Tags:           []string{"privacy", "pdpl"},
		Metadata:       map[string]any{"risk_level": "high"},
	}), http.StatusCreated)

	reference := mustData[model.RegulationClauseReference](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/watheeq/regulations/%s/clauses", regulation.ID), dto.CreateRegulationClauseReferenceRequest{
		ClauseID:      clause.ID,
		ReferenceType: model.RegulationClauseReferenceRequiredBy,
		Notes:         "PDPL route gap semantic mapping.",
	}), http.StatusCreated)
	if reference.ClauseID != clause.ID || reference.RegulationID != regulation.ID {
		t.Fatalf("regulation clause reference = %+v, want created semantic mapping", reference)
	}

	clauseResults := mustPaginated[model.ClauseLibrarySearchResult](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/clause-library/search?q=privacy+duties&semantic=true&language=en&status=active&page=1&per_page=5", nil), http.StatusOK)
	if clauseResults.Pagination.Total != 1 || len(clauseResults.Data) != 1 || clauseResults.Data[0].Item.ID != clause.ID {
		t.Fatalf("semantic clause search = %+v, want created data-protection clause", clauseResults)
	}
	assertSemanticRouteMetadata(t, clauseResults.Data[0].Metadata, "text_en")

	regulationResults := mustPaginated[model.RegulationLibrarySearchResult](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/regulations/search?q=privacy+duties&semantic=true&language=en&status=active&page=1&per_page=5", nil), http.StatusOK)
	if regulationResults.Pagination.Total != 1 || len(regulationResults.Data) != 1 || regulationResults.Data[0].Item.ID != regulation.ID {
		t.Fatalf("semantic regulation search = %+v, want created privacy regulation", regulationResults)
	}
	assertSemanticRouteMetadata(t, regulationResults.Data[0].Metadata, "clause_mappings")
}

func TestWatheeqReportRoutesJSONAndCSVAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Watheeq Report Route Contract", model.ContractTypeServiceAgreement, 510_000, lifecycleContractText())
	department := "Legal Operations"
	matterDueDate := time.Now().UTC().AddDate(0, 0, 20)
	matter := mustData[model.Matter](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/matters", dto.CreateMatterRequest{
		Title:       "Watheeq Report Route Matter",
		Description: "Report route fixture matter.",
		Type:        model.MatterTypeContract,
		Status:      model.MatterStatusOpen,
		Priority:    model.LegalPriorityHigh,
		OwnerUserID: h.userID,
		OwnerName:   "Integration Owner",
		Department:  &department,
		DueDate:     &matterDueDate,
		Tags:        []string{"watheeq-report"},
		Metadata:    map[string]any{"route_gap": "report"},
		ContractIDs: []uuid.UUID{contract.ID},
	}), http.StatusCreated)
	obligationDueDate := time.Now().UTC().AddDate(0, 0, 10)
	obligation := mustData[model.Obligation](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/obligations", dto.CreateObligationRequest{
		Title:       "Watheeq Report Route Obligation",
		Description: "Submit monthly service report for report route coverage.",
		Type:        model.ObligationTypeReporting,
		Status:      model.ObligationStatusOpen,
		Priority:    model.LegalPriorityHigh,
		ContractID:  &contract.ID,
		MatterID:    &matter.ID,
		OwnerUserID: h.userID,
		OwnerName:   "Integration Owner",
		DueDate:     obligationDueDate,
		Tags:        []string{"watheeq-report"},
		Metadata:    map[string]any{"route_gap": "report"},
	}), http.StatusCreated)

	contractReport := mustData[model.ContractReport](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/contracts?status=draft", nil), http.StatusOK)
	if contractReport.Total != 1 || contractReport.ByStatus[string(model.ContractStatusDraft)] != 1 || !contractReportContains(contractReport.Contracts, contract.ID) {
		t.Fatalf("contract report = %+v, want one draft contract %s", contractReport, contract.ID)
	}
	contractCSV := mustCSVRows(t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/contracts?status=draft&format=csv", nil), "lex-contract-report.csv")
	assertCSVHeader(t, contractCSV, []string{"id", "title", "type", "status", "party_b_name", "total_value", "currency", "risk_level", "risk_score", "expiry_date", "current_version", "created_at"})
	assertCSVContainsCell(t, contractCSV, contract.Title)
	assertCSVContainsCell(t, contractCSV, "[REDACTED]")

	matterReport := mustData[model.MatterReport](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/matters?status=open", nil), http.StatusOK)
	if matterReport.Total != 1 || matterReport.ByStatus[string(model.MatterStatusOpen)] != 1 || !matterReportContains(matterReport.Matters, matter.ID) {
		t.Fatalf("matter report = %+v, want one open matter %s", matterReport, matter.ID)
	}
	matterCSV := mustCSVRows(t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/matters?status=open&format=csv", nil), "lex-matter-report.csv")
	assertCSVHeader(t, matterCSV, []string{"id", "matter_number", "title", "type", "status", "priority", "owner_user_id", "owner_name", "department", "opened_at", "due_date", "closed_at", "created_at"})
	assertCSVContainsCell(t, matterCSV, matter.Title)

	obligationReport := mustData[model.ObligationReport](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/obligations?status=open", nil), http.StatusOK)
	if obligationReport.Total != 1 || obligationReport.ByStatus[string(model.ObligationStatusOpen)] != 1 || !obligationReportContains(obligationReport.Obligations, obligation.ID) {
		t.Fatalf("obligation report = %+v, want one open obligation %s", obligationReport, obligation.ID)
	}
	obligationCSV := mustCSVRows(t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/reports/obligations?status=open&format=csv", nil), "lex-obligation-report.csv")
	assertCSVHeader(t, obligationCSV, []string{"id", "title", "type", "status", "priority", "owner_user_id", "owner_name", "contract_id", "contract_title", "matter_id", "matter_title", "due_date", "days_until_due", "completed_at", "created_at"})
	assertCSVContainsCell(t, obligationCSV, obligation.Title)
}

func routeGapStringPtr(value string) *string {
	return &value
}

func assertReminderDispatchResult(t *testing.T, result model.ObligationReminderDispatchResult, requested, sent int) {
	t.Helper()
	if result.Provider != "dry_run" || result.RequestedCount != requested || result.DispatchedCount != sent || result.SentCount != sent || result.FailedCount != 0 || result.SkippedCount != 0 {
		t.Fatalf("dispatch result = %+v, want provider dry_run requested=%d sent=%d", result, requested, sent)
	}
	if len(result.Attempts) != requested {
		t.Fatalf("dispatch attempts = %d, want %d in %+v", len(result.Attempts), requested, result.Attempts)
	}
	for _, attempt := range result.Attempts {
		if attempt.Status != model.ObligationNotificationOutboxSent || attempt.ProviderMessageID == nil {
			t.Fatalf("dispatch attempt = %+v, want sent with provider message id", attempt)
		}
	}
}

func assertSemanticRouteMetadata(t *testing.T, metadata map[string]any, matchedField string) {
	t.Helper()
	if metadata["search_mode"] != "semantic" || metadata["semantic_backend"] != "deterministic_local_vector" {
		t.Fatalf("semantic metadata = %#v, want deterministic semantic mode", metadata)
	}
	if metadata["semantic_score"] == nil {
		t.Fatalf("semantic metadata = %#v, want semantic_score", metadata)
	}
	fields, ok := metadata["matched_semantic_fields"].([]any)
	if !ok {
		t.Fatalf("matched_semantic_fields = %#v, want array", metadata["matched_semantic_fields"])
	}
	for _, field := range fields {
		if field == matchedField {
			return
		}
	}
	t.Fatalf("matched_semantic_fields = %#v, want %q", fields, matchedField)
}

func TestWatheeqDraftingRoutesAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)

	assembled := mustData[drafting.AssemblyResult](t, h.doJSON(t, http.MethodPost, "/api/v1/watheeq/drafting/assemble", drafting.AssembleRequest{
		Sections: []drafting.TemplateSection{
			{ID: "intro", Heading: "Agreement", Body: "This agreement is with {{counterparty}}."},
			{ID: "arbitration", Heading: "Arbitration", Body: "Disputes go to arbitration.", Condition: "include_arbitration == true"},
			{ID: "notice", Heading: "Notice", Body: "Primary owner: {{owner}}.", Condition: "owner_required"},
			{ID: "skip", Heading: "Skipped", Body: "Should not render.", Condition: "!include_arbitration"},
		},
		Variables: map[string]any{
			"counterparty":        "Watheeq Trading LLC",
			"include_arbitration": true,
			"owner_required":      true,
		},
	}), http.StatusOK)
	if !strings.Contains(assembled.Document, "Watheeq Trading LLC") || !strings.Contains(assembled.Document, "Disputes go to arbitration.") {
		t.Fatalf("assembled document = %q", assembled.Document)
	}
	if !strings.Contains(assembled.Document, "{{owner}}") || !stringSliceContains(assembled.UnresolvedVars, "owner") {
		t.Fatalf("assembly unresolved placeholders document=%q unresolved=%v", assembled.Document, assembled.UnresolvedVars)
	}
	if len(assembled.IncludedSections) != 3 || len(assembled.SkippedSections) != 1 || !stringSliceContains(assembled.SkippedSections, "skip") {
		t.Fatalf("assembly sections included=%v skipped=%v", assembled.IncludedSections, assembled.SkippedSections)
	}

	disabledLLMRequests := []struct {
		name    string
		path    string
		payload any
	}{
		{
			name: "clause generation",
			path: "/api/v1/watheeq/drafting/clauses",
			payload: drafting.ClauseRequest{
				Intent:       "Draft a balanced confidentiality clause.",
				ContractType: "service_agreement",
				Language:     "en",
			},
		},
		{
			name: "contract draft",
			path: "/api/v1/watheeq/drafting/contracts",
			payload: drafting.ContractDraftRequest{
				ContractType: "service_agreement",
				DealTerms: map[string]any{
					"party_a": "Clario Holdings Limited",
					"party_b": "Watheeq Trading LLC",
					"term":    "12 months",
				},
				Language: "en",
			},
		},
		{
			name: "clause rewrite",
			path: "/api/v1/watheeq/drafting/clauses/rewrite",
			payload: drafting.RewriteRequest{
				Text:        "Supplier shall keep all confidential information confidential.",
				RiskPosture: "balanced",
				Language:    "en",
			},
		},
		{
			name: "fallback suggestions",
			path: "/api/v1/watheeq/drafting/clauses/fallbacks",
			payload: drafting.FallbackRequest{
				ClauseText: "Supplier shall indemnify customer for third-party claims caused by supplier breach.",
				Position:   "balanced",
				Count:      2,
				Language:   "en",
			},
		},
		{
			name: "legal translation",
			path: "/api/v1/watheeq/drafting/translate",
			payload: drafting.TranslateRequest{
				Text:       "The supplier shall maintain insurance during the term.",
				SourceLang: "en",
				TargetLang: "ar",
			},
		},
		{
			name: "contract summary",
			path: "/api/v1/watheeq/drafting/summary",
			payload: drafting.SummaryRequest{
				Text:         "This services agreement starts on 1 July 2026. The supplier shall provide managed services, maintain confidentiality, and meet monthly reporting obligations.",
				ContractType: "service_agreement",
				Language:     "en",
			},
		},
		{
			name: "glossary",
			path: "/api/v1/watheeq/drafting/glossary",
			payload: drafting.GlossaryRequest{
				Text:     `"Services" means managed legal operations support. The Services shall be provided monthly.`,
				Language: "en",
			},
		},
		{
			name: "rfp response",
			path: "/api/v1/watheeq/drafting/rfp-response",
			payload: drafting.RFPRequest{
				Requirements:   "Describe your implementation approach, data residency controls, and legal operations support model.",
				CompanyProfile: "Clario provides governed legal operations workflow software.",
				Language:       "en",
			},
		},
		{
			name: "obligation qa review",
			path: "/api/v1/watheeq/drafting/obligations/qa-review",
			payload: drafting.ObligationQARequest{
				ContractText: "Supplier shall deliver a monthly service report by the fifth business day of each month.",
				Obligations: []map[string]any{{
					"title":    "Deliver monthly service report",
					"due_date": "2026-07-05",
				}},
			},
		},
	}
	for _, tc := range disabledLLMRequests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			errResp := mustDraftingUnavailable(t, h.doJSON(t, http.MethodPost, tc.path, tc.payload))
			if errResp.Code != "DRAFTING_UNAVAILABLE" {
				t.Fatalf("%s error code = %q, want DRAFTING_UNAVAILABLE", tc.path, errResp.Code)
			}
			// The DRAFTING_UNAVAILABLE message is now supplied and localized by the
			// shared error catalog (audit fix F34), so the response carries a
			// locale-specific explanation rather than a hard-coded English string.
			// Assert the specific code plus a non-empty explanation.
			if strings.TrimSpace(errResp.Message) == "" {
				t.Fatalf("%s error message is empty, want a localized DRAFTING_UNAVAILABLE explanation", tc.path)
			}
		})
	}
}

type draftingErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func mustDraftingUnavailable(t *testing.T, resp *http.Response) draftingErrorResponse {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("response status = %d, want %d, body=%s", resp.StatusCode, http.StatusServiceUnavailable, readBody(t, resp.Body))
	}
	var envelope draftingErrorResponse
	decodeBody(t, resp.Body, &envelope)
	return envelope
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func mustCSVRows(t *testing.T, resp *http.Response, fileName string) [][]string {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("CSV response status = %d, want %d, body=%s", resp.StatusCode, http.StatusOK, readBody(t, resp.Body))
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "text/csv") {
		t.Fatalf("CSV content type = %q, want text/csv", contentType)
	}
	if disposition := resp.Header.Get("Content-Disposition"); !strings.Contains(disposition, fileName) {
		t.Fatalf("CSV content disposition = %q, want filename %q", disposition, fileName)
	}
	body := readBody(t, resp.Body)
	rows, err := csv.NewReader(strings.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatalf("parse CSV body %q: %v", body, err)
	}
	if len(rows) < 2 {
		t.Fatalf("CSV rows = %#v, want header and at least one data row", rows)
	}
	return rows
}

func assertCSVHeader(t *testing.T, rows [][]string, want []string) {
	t.Helper()
	if len(rows) == 0 {
		t.Fatal("CSV rows empty")
	}
	wantJoined := strings.Join(want, "|")
	for _, row := range rows {
		if len(row) > 0 {
			row[0] = strings.TrimPrefix(row[0], "\ufeff")
		}
		if strings.Join(row, "|") == wantJoined {
			return
		}
	}
	t.Fatalf("CSV rows = %#v, want header %#v", rows, want)
}

func assertCSVContainsCell(t *testing.T, rows [][]string, value string) {
	t.Helper()
	for _, row := range rows[1:] {
		for _, cell := range row {
			if cell == value {
				return
			}
		}
	}
	t.Fatalf("CSV rows = %#v, want cell %q", rows, value)
}

func contractReportContains(items []model.ContractSummary, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func matterReportContains(items []model.MatterSummary, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func obligationReportContains(items []model.ObligationSummary, id uuid.UUID) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}
