package lex

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/analyzer"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

var (
	seedTenantID   = mustUUID("22222222-2222-2222-2222-222222222222")
	seedSystemUser = mustUUID("22222222-2222-2222-2222-222222222201")

	apexLegalTenantID    = mustUUID("aaaaaaaa-0000-0000-0000-000000000001")
	apexLegalAdminUserID = mustUUID("bbbbbbbb-0000-0000-0000-000000000001")
	apexLegalLeadUserID  = mustUUID("bbbbbbbb-0000-0000-0000-000000000004")
	apexLegalBoardUserID = mustUUID("bbbbbbbb-0000-0000-0000-000000000005")
	apexLegalOpsUserID   = mustUUID("bbbbbbbb-0000-0000-0000-000000000006")
	apexLegalTechUserID  = mustUUID("bbbbbbbb-0000-0000-0000-000000000002")
	apexLegalDataUserID  = mustUUID("bbbbbbbb-0000-0000-0000-000000000003")
	apexLegalRiskUserID  = mustUUID("bbbbbbbb-0000-0000-0000-000000000007")
)

type SeedDemoOptions struct {
	TenantID     uuid.UUID
	SystemUserID uuid.UUID
}

type seedDataset struct {
	tenantID    uuid.UUID
	systemUser  uuid.UUID
	referenceAt time.Time
	users       []seedUser
}

type seedUser struct {
	ID    uuid.UUID
	Name  string
	Title string
}

type seedContractSpec struct {
	Title             string
	Type              model.ContractType
	Description       string
	PartyBName        string
	PartyBEntity      string
	PartyBContact     string
	Department        string
	Tags              []string
	TotalValue        float64
	Currency          string
	PaymentTerms      string
	EffectiveOffset   int
	ExpiryOffset      int
	RenewalNoticeDays int
	AutoRenew         bool
	Status            model.ContractStatus
	Owner             seedUser
	LegalReviewer     seedUser
	ContainsPII       bool
}

type seedClauseBlueprint struct {
	ClauseType   model.ClauseType
	Title        string
	Trigger      string
	SafeBody     string
	RiskKeywords []string
}

func SeedDemoData(ctx context.Context, app *Application, logger zerolog.Logger) (uuid.UUID, error) {
	return SeedDemoDataWithOptions(ctx, app, logger, SeedDemoOptions{})
}

func SeedDemoDataWithOptions(ctx context.Context, app *Application, logger zerolog.Logger, opts SeedDemoOptions) (uuid.UUID, error) {
	seed := newSeedDataset(opts)
	return seed.run(ctx, app, logger)
}

func newSeedDataset(opts SeedDemoOptions) seedDataset {
	tenantID := opts.TenantID
	if tenantID == uuid.Nil {
		tenantID = seedTenantID
	}
	systemUser := opts.SystemUserID
	if systemUser == uuid.Nil {
		systemUser = seedSystemUser
		if tenantID == apexLegalTenantID {
			systemUser = apexLegalAdminUserID
		}
	}
	return seedDataset{
		tenantID:    tenantID,
		systemUser:  systemUser,
		referenceAt: normalizeSeedDate(time.Now().UTC()),
		users:       seedUsersForTenant(tenantID),
	}
}

func (seed seedDataset) run(ctx context.Context, app *Application, logger zerolog.Logger) (uuid.UUID, error) {
	if app == nil || app.Store == nil || app.Store.DB() == nil {
		return uuid.Nil, fmt.Errorf("lex application is not initialized")
	}
	existing, total, err := app.Store.Contracts.List(ctx, seed.tenantID, model.ContractListFilters{Page: 1, PerPage: 100})
	if err != nil {
		return uuid.Nil, err
	}

	users := seed.users
	specs := seedContractSpecs(users)
	blueprints := seedClauseBlueprints()
	recommendations := analyzer.NewRecommendationEngine("Saudi Arabia")

	contracts := make([]*model.Contract, 0, len(specs))
	if total > 0 {
		for idx := range existing {
			contracts = append(contracts, &existing[idx])
		}
	} else {
		for idx, spec := range specs {
			contract, err := seed.seedContract(ctx, app, spec, idx, blueprints, recommendations)
			if err != nil {
				return uuid.Nil, err
			}
			contracts = append(contracts, contract)
		}

		if err := seed.applySeedClauseReviews(ctx, app, contracts, users[1].ID, seed.referenceAt); err != nil {
			return uuid.Nil, err
		}
	}

	rules, err := app.ComplianceService.ListRules(ctx, seed.tenantID)
	if err != nil {
		return uuid.Nil, err
	}
	if len(rules) == 0 {
		rules, err = seed.seedComplianceRules(ctx, app, users[0].ID)
		if err != nil {
			return uuid.Nil, err
		}
	}

	if ok, err := seed.hasRows(ctx, app, "legal_documents", true); err != nil {
		return uuid.Nil, err
	} else if !ok {
		if err := seed.seedLegalDocuments(ctx, app, contracts, users[0].ID); err != nil {
			return uuid.Nil, err
		}
	}
	if ok, err := seed.hasRows(ctx, app, "compliance_alerts", false); err != nil {
		return uuid.Nil, err
	} else if !ok {
		if err := seed.seedComplianceAlerts(ctx, app, contracts, rules, users[1].ID); err != nil {
			return uuid.Nil, err
		}
	}

	libraryItems, err := seed.ensureClauseLibrary(ctx, app, users[0].ID)
	if err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureRegulations(ctx, app, libraryItems, users[0].ID); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureClausePlaybooks(ctx, app, users[0].ID); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureApprovalPolicies(ctx, app, users); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureRequestApprovalPolicyTemplates(ctx, app); err != nil {
		return uuid.Nil, err
	}
	// Diagram B: activate the LIVE sequential litigation-filing approval chain (not
	// just a template) so a real litigation request is gated by the 3-tier DoA chain.
	if err := seed.ensureLitigationApprovalPolicy(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureServiceCatalog(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureWorkflows(ctx, app, contracts, users); err != nil {
		return uuid.Nil, err
	}
	matters, err := seed.ensureMatters(ctx, app, contracts, users)
	if err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureObligations(ctx, app, contracts, matters, users); err != nil {
		return uuid.Nil, err
	}
	documents, _, err := app.DocumentService.List(ctx, seed.tenantID, model.DocumentListFilter{Page: 1, PerPage: 100})
	if err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureSignatures(ctx, app, contracts, documents, users); err != nil {
		return uuid.Nil, err
	}

	// Per-tenant REFERENCE data (case-classification taxonomy, SLA targets, the
	// default attachment policy, and the integration/e-sign connector registry).
	// These were designed to be seeded by lex_db migrations CROSS JOINing a
	// `tenants` shim that ships empty, so they inserted zero rows on every
	// from-scratch deploy (F16). Seed them here, where a real tenant id exists.
	if err := seed.ensureReferenceData(ctx, app); err != nil {
		return uuid.Nil, err
	}

	// Legal Affairs operational domains (org registry, working calendar,
	// litigation cases, investigations, consultations, settlements/ADR, and
	// service-desk legal requests). Org registry and calendar are seeded first
	// as foundational reference data; settlements run last as they anchor to the
	// matters seeded above. See seed_legal_affairs.go.
	if err := seed.ensureOrgRegistry(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureWorkingCalendar(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureLitigationCases(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureInvestigations(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureConsultations(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureSettlements(ctx, app); err != nil {
		return uuid.Nil, err
	}
	if err := seed.ensureLegalRequests(ctx, app); err != nil {
		return uuid.Nil, err
	}
	// Email intake mailboxes for the PRD addresses, so the admin health screen stops
	// flagging the email-backed services "email not wired" (hasMailbox=true).
	if err := seed.ensureIntakeMailboxes(ctx, app); err != nil {
		return uuid.Nil, err
	}
	// Terminal (delivered/closed) request history so the KPI + performance tiles and
	// the flagship quarterly SLA-compliance trend render from real reporting facts
	// instead of empty. Runs last: it reads the working calendar + service catalogue
	// seeded above and produces its duration facts via the live reporting path.
	if err := seed.ensureRequestProcessingHistory(ctx, app); err != nil {
		return uuid.Nil, err
	}

	logger.Info().
		Str("tenant_id", seed.tenantID.String()).
		Int("contracts", len(contracts)).
		Int("rules", len(rules)).
		Int("documents", 8).
		Int("alerts", 10).
		Msg("seeded lex legal-company dataset")

	return seed.tenantID, nil
}

func (seed seedDataset) seedContract(
	ctx context.Context,
	app *Application,
	spec seedContractSpec,
	index int,
	blueprints []seedClauseBlueprint,
	recommendations *analyzer.RecommendationEngine,
) (*model.Contract, error) {
	effectiveDate := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, spec.EffectiveOffset))
	expiryDate := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, spec.ExpiryOffset))
	var renewalDate *time.Time
	if spec.AutoRenew {
		date := normalizeSeedDate(expiryDate.AddDate(0, 0, -spec.RenewalNoticeDays))
		renewalDate = &date
	}

	baseContract := &model.Contract{
		ID:                uuid.NewSHA1(seed.tenantID, []byte(fmt.Sprintf("seed-contract-%02d", index+1))),
		TenantID:          seed.tenantID,
		Title:             spec.Title,
		Type:              spec.Type,
		Description:       spec.Description,
		PartyAName:        seed.partyAName(),
		PartyBName:        spec.PartyBName,
		PartyBEntity:      ptrString(spec.PartyBEntity),
		PartyBContact:     ptrString(spec.PartyBContact),
		TotalValue:        ptrFloat(spec.TotalValue),
		Currency:          spec.Currency,
		PaymentTerms:      ptrString(spec.PaymentTerms),
		EffectiveDate:     &effectiveDate,
		ExpiryDate:        &expiryDate,
		RenewalDate:       renewalDate,
		AutoRenew:         spec.AutoRenew,
		RenewalNoticeDays: spec.RenewalNoticeDays,
		Status:            model.ContractStatusDraft,
		OwnerUserID:       spec.Owner.ID,
		OwnerName:         spec.Owner.Name,
		LegalReviewerID:   &spec.LegalReviewer.ID,
		LegalReviewerName: ptrString(spec.LegalReviewer.Name),
		Department:        ptrString(spec.Department),
		Tags:              spec.Tags,
		Metadata: map[string]any{
			"portfolio":  spec.Department,
			"seed_index": index + 1,
		},
	}

	clauses, documentText := buildSeedClauses(baseContract, spec, index, blueprints, recommendations)
	req := dto.CreateContractRequest{
		Title:             spec.Title,
		Type:              spec.Type,
		Description:       spec.Description,
		PartyAName:        baseContract.PartyAName,
		PartyBName:        spec.PartyBName,
		PartyBEntity:      ptrString(spec.PartyBEntity),
		PartyBContact:     ptrString(spec.PartyBContact),
		TotalValue:        ptrFloat(spec.TotalValue),
		Currency:          spec.Currency,
		PaymentTerms:      ptrString(spec.PaymentTerms),
		EffectiveDate:     &effectiveDate,
		ExpiryDate:        &expiryDate,
		RenewalDate:       renewalDate,
		AutoRenew:         spec.AutoRenew,
		RenewalNoticeDays: spec.RenewalNoticeDays,
		OwnerUserID:       spec.Owner.ID,
		OwnerName:         spec.Owner.Name,
		LegalReviewerID:   &spec.LegalReviewer.ID,
		LegalReviewerName: ptrString(spec.LegalReviewer.Name),
		Department:        ptrString(spec.Department),
		Tags:              spec.Tags,
		Metadata: map[string]any{
			"seeded":      true,
			"seed_status": spec.Status,
		},
		Document: &dto.FileReference{
			FileID:        uuid.NewSHA1(seed.tenantID, []byte(fmt.Sprintf("seed-contract-file-%02d", index+1))),
			FileName:      slugify(spec.Title) + ".txt",
			FileSizeBytes: int64(len(documentText)),
			ContentHash:   contentHash(documentText),
			ExtractedText: documentText,
			ChangeSummary: "النسخة الأولى من مستند العقد.",
		},
	}

	contract, err := app.ContractService.CreateContract(ctx, seed.tenantID, seed.systemUser, req)
	if err != nil {
		return nil, fmt.Errorf("create seeded contract %q: %w", spec.Title, err)
	}
	if err := seed.seedContractAnalysis(ctx, app, contract, clauses, documentText); err != nil {
		return nil, fmt.Errorf("seed analysis for %q: %w", spec.Title, err)
	}
	if err := seed.driveSeedContractStatus(ctx, app, contract.ID, spec.Status); err != nil {
		return nil, fmt.Errorf("seed status for %q: %w", spec.Title, err)
	}
	updated, err := app.Store.Contracts.Get(ctx, seed.tenantID, contract.ID)
	if err != nil {
		return nil, fmt.Errorf("reload seeded contract %q: %w", spec.Title, err)
	}
	return updated, nil
}

func (seed seedDataset) seedContractAnalysis(ctx context.Context, app *Application, contract *model.Contract, clauses []model.ExtractedClause, text string) error {
	analysis, err := seed.buildSeedAnalysis(contract, clauses, text)
	if err != nil {
		return err
	}
	return database.RunInTx(ctx, app.Store.DB(), func(tx pgx.Tx) error {
		if err := app.Store.Clauses.ReplaceForContract(ctx, tx, contract.TenantID, contract.ID, clauses); err != nil {
			return err
		}
		if err := app.Store.Contracts.InsertAnalysis(ctx, tx, analysis); err != nil {
			return err
		}
		return app.Store.Contracts.UpdateAnalysisFields(ctx, tx, contract.TenantID, contract.ID, analysis.RiskScore, analysis.OverallRisk, model.AnalysisStatusCompleted, analysis.AnalyzedAt)
	})
}

func (seed seedDataset) buildSeedAnalysis(contract *model.Contract, clauses []model.ExtractedClause, text string) (*model.ContractRiskAnalysis, error) {
	found := make(map[model.ClauseType]bool, len(clauses))
	clauseRiskSum := 0.0
	highRiskCount := 0
	for _, clause := range clauses {
		found[clause.ClauseType] = true
		clauseRiskSum += clause.RiskScore
		if clause.RiskLevel == model.RiskLevelCritical || clause.RiskLevel == model.RiskLevelHigh {
			highRiskCount++
		}
	}

	missing := analyzer.NewMissingClauseDetector().Detect(contract.Type, found)
	complianceFlags := analyzer.NewComplianceChecker("Saudi Arabia").Check(contract, clauses, text)
	parties, dates, amounts := analyzer.NewEntityExtractor().Extract(text)

	clauseRiskAvg := 0.0
	if len(clauses) > 0 {
		clauseRiskAvg = clauseRiskSum / float64(len(clauses))
	}
	missingPenalty := float64(len(missing) * 8)
	valueFactor := 0.0
	if contract.TotalValue != nil {
		switch {
		case *contract.TotalValue > 10_000_000:
			valueFactor = 15
		case *contract.TotalValue > 1_000_000:
			valueFactor = 10
		}
	}
	expiryFactor := 0.0
	if contract.ExpiryDate != nil {
		days := int(contract.ExpiryDate.Sub(normalizeSeedDate(seed.referenceAt)).Hours() / 24)
		switch {
		case days <= 7:
			expiryFactor = 20
		case days <= 30:
			expiryFactor = 10
		}
	}
	compliancePenalty := float64(len(complianceFlags) * 5)
	riskScore := clampSeedScore(clauseRiskAvg + missingPenalty + valueFactor + expiryFactor + compliancePenalty)
	riskLevel := model.RiskLevelFromScore(riskScore)

	recommendations := collectSeedRecommendations(clauses, missing, complianceFlags)
	findings := buildSeedFindings(clauses, missing, complianceFlags)
	if len(findings) > 5 {
		findings = findings[:5]
	}

	return &model.ContractRiskAnalysis{
		ID:                  uuid.NewSHA1(contract.ID, []byte("seed-analysis")),
		TenantID:            contract.TenantID,
		ContractID:          contract.ID,
		ContractVersion:     contract.CurrentVersion,
		OverallRisk:         riskLevel,
		RiskScore:           riskScore,
		ClauseCount:         len(clauses),
		HighRiskClauseCount: highRiskCount,
		MissingClauses:      missing,
		KeyFindings:         findings,
		Recommendations:     recommendations,
		ComplianceFlags:     complianceFlags,
		ExtractedParties:    parties,
		ExtractedDates:      dates,
		ExtractedAmounts:    amounts,
		AnalysisDurationMS:  120,
		AnalyzedBy:          "system",
		AnalyzedAt:          seed.referenceAt,
		CreatedAt:           seed.referenceAt,
	}, nil
}

func (seed seedDataset) driveSeedContractStatus(ctx context.Context, app *Application, contractID uuid.UUID, target model.ContractStatus) error {
	for _, next := range seedStatusPath(target) {
		if _, err := app.ContractService.UpdateStatus(ctx, seed.tenantID, seed.systemUser, contractID, next); err != nil {
			return err
		}
	}
	if target == model.ContractStatusActive || target == model.ContractStatusExpired || target == model.ContractStatusTerminated {
		if err := seed.completeSeedContractSignature(ctx, app, contractID); err != nil {
			return err
		}
	}
	if target == model.ContractStatusExpired || target == model.ContractStatusTerminated {
		if _, err := app.ContractService.UpdateStatus(ctx, seed.tenantID, seed.systemUser, contractID, target); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) completeSeedContractSignature(ctx context.Context, app *Application, contractID uuid.UUID) error {
	signerName := "Clario360 Demo Signer"
	signerEmail := fmt.Sprintf("demo-signer+%s@clario360.example", contractID)
	expiresAt := seed.referenceAt.AddDate(0, 0, 14)
	title := "Demo contract activation - " + contractID.String()

	envelope, err := app.SignatureService.Create(ctx, seed.tenantID, seed.systemUser, dto.CreateSignatureEnvelopeRequest{
		ContractID: &contractID,
		Title:      title,
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		ExpiresAt:  &expiresAt,
		EvidenceMetadata: map[string]any{
			"seeded":  true,
			"purpose": "contract_activation",
		},
		Recipients: []dto.CreateSignatureRecipientRequest{{
			Name:         signerName,
			Email:        &signerEmail,
			Role:         model.SignatureRecipientSigner,
			SigningOrder: 1,
			EvidenceMetadata: map[string]any{
				"seeded": true,
			},
		}},
	})
	if err != nil {
		return fmt.Errorf("create contract activation signature: %w", err)
	}
	sent, err := app.SignatureService.Send(ctx, seed.tenantID, seed.systemUser, envelope.ID, dto.SendSignatureEnvelopeRequest{
		EvidenceMetadata: map[string]any{
			"seeded":  true,
			"purpose": "contract_activation",
		},
	})
	if err != nil {
		return fmt.Errorf("send contract activation signature: %w", err)
	}
	if len(sent.Recipients) != 1 {
		return fmt.Errorf("contract activation signature has %d recipients, want 1", len(sent.Recipients))
	}
	if _, err := app.SignatureService.RecipientAction(ctx, seed.tenantID, seed.systemUser, sent.ID, sent.Recipients[0].ID, dto.SignatureRecipientActionRequest{
		Action:       dto.SignatureRecipientActionSign,
		ActorName:    &signerName,
		ActorEmail:   &signerEmail,
		EvidenceHash: ptrString(contentHash(contractID.String() + ":seed-contract-activation")),
		EvidenceMetadata: map[string]any{
			"seeded":  true,
			"purpose": "contract_activation",
		},
	}, ptrString("127.0.0.1"), ptrString("clario360-legal-seed")); err != nil {
		return fmt.Errorf("complete contract activation signature: %w", err)
	}
	return nil
}

func (seed seedDataset) applySeedClauseReviews(ctx context.Context, app *Application, contracts []*model.Contract, reviewerID uuid.UUID, reviewedAt time.Time) error {
	allClauses := make([]model.Clause, 0, len(contracts)*3)
	for _, contract := range contracts {
		clauses, err := app.Store.Clauses.ListByContract(ctx, seed.tenantID, contract.ID)
		if err != nil {
			return err
		}
		allClauses = append(allClauses, clauses...)
	}

	statuses := make([]model.ClauseReviewStatus, 0, 30)
	for i := 0; i < 20; i++ {
		statuses = append(statuses, model.ClauseReviewReviewed)
	}
	for i := 0; i < 5; i++ {
		statuses = append(statuses, model.ClauseReviewFlagged)
	}
	for i := 0; i < 5; i++ {
		statuses = append(statuses, model.ClauseReviewAccepted)
	}
	notesByStatus := map[model.ClauseReviewStatus]string{
		model.ClauseReviewReviewed: "تمت مراجعة البند ضمن دورة المراجعة القانونية.",
		model.ClauseReviewFlagged:  "أُحيل البند إلى الشريك المسؤول للمراجعة ضمن تهيئة المحفظة القانونية.",
		model.ClauseReviewAccepted: "تم قبول البند ضمن دورة المراجعة.",
	}

	for idx, status := range statuses {
		clause := allClauses[idx]
		notes := notesByStatus[status]
		if err := app.Store.Clauses.UpdateReview(ctx, app.Store.DB(), seed.tenantID, clause.ContractID, clause.ID, status, &reviewerID, notes, reviewedAt); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) seedComplianceRules(ctx context.Context, app *Application, userID uuid.UUID) ([]model.ComplianceRule, error) {
	requests := []dto.CreateComplianceRuleRequest{
		{
			Name:          "التنبيه الافتراضي لانتهاء العقود",
			Description:   "تنبيه المسؤولين عن العقود عند اقتراب انتهاء العقود السارية.",
			RuleType:      model.ComplianceRuleExpiryWarning,
			Severity:      model.ComplianceSeverityHigh,
			Config:        map[string]any{"days_before": 30},
			ContractTypes: []string{},
			Enabled:       false,
		},
		{
			Name:          "مراجعة البنود المفقودة",
			Description:   "رصد العقود التي تفتقر إلى البنود النموذجية الإلزامية.",
			RuleType:      model.ComplianceRuleMissingClause,
			Severity:      model.ComplianceSeverityHigh,
			Config:        map[string]any{},
			ContractTypes: []string{string(model.ContractTypeServiceAgreement), string(model.ContractTypeVendor), string(model.ContractTypeLicense)},
			Enabled:       false,
		},
		{
			Name:          "بوابة مراجعة العقود عالية المخاطر",
			Description:   "يجب أن تصل العقود عالية المخاطر إلى حالة المراجعة القانونية.",
			RuleType:      model.ComplianceRuleRiskThreshold,
			Severity:      model.ComplianceSeverityCritical,
			Config:        map[string]any{"min_score": 70, "required_status": string(model.ContractStatusLegalReview)},
			ContractTypes: []string{},
			Enabled:       false,
		},
		{
			Name:          "تجاوز مهلة المراجعة",
			Description:   "لا يجوز بقاء العقود قيد المراجعة الداخلية أو القانونية بعد تجاوز اتفاقية مستوى الخدمة (SLA).",
			RuleType:      model.ComplianceRuleReviewOverdue,
			Severity:      model.ComplianceSeverityMedium,
			Config:        map[string]any{"overdue_days": 7},
			ContractTypes: []string{},
			Enabled:       true,
		},
		{
			Name:          "اشتراط حماية البيانات",
			Description:   "يجب أن تتضمن العقود المتعلقة بالبيانات الشخصية أحكاماً لحماية البيانات.",
			RuleType:      model.ComplianceRuleDataProtectionRequired,
			Severity:      model.ComplianceSeverityCritical,
			Config:        map[string]any{},
			ContractTypes: []string{string(model.ContractTypeVendor), string(model.ContractTypeServiceAgreement), string(model.ContractTypeNDA)},
			Enabled:       false,
		},
	}

	rules := make([]model.ComplianceRule, 0, len(requests))
	for _, req := range requests {
		rule, err := app.ComplianceService.CreateRule(ctx, seed.tenantID, userID, req)
		if err != nil {
			return nil, err
		}
		rules = append(rules, *rule)
	}
	return rules, nil
}

func (seed seedDataset) seedLegalDocuments(ctx context.Context, app *Application, contracts []*model.Contract, userID uuid.UUID) error {
	type docSpec struct {
		Title           string
		Type            model.LegalDocumentType
		Description     string
		Category        string
		FolderPath      string
		Confidentiality model.DocumentConfidentiality
		Status          model.DocumentStatus
		ContractIndex   int
		Tags            []string
		Content         string
		// RetentionPolicy records a records-management schedule in metadata so the
		// repository "with policy" count is non-zero. Empty == no policy (so the
		// "missing policy" count is also non-zero).
		RetentionPolicy string
		// DispositionOffsetDays, when non-nil, sets a disposition_date relative to
		// the seed reference date. A negative/zero offset is DUE now (drives the
		// "retention due" KPI); a small positive offset is "expiring soon".
		DispositionOffsetDays *int
		// ExtraVersions seeds additional document versions (history depth) so a few
		// documents show a real version trail in the viewer/board.
		ExtraVersions int
	}
	due := func(d int) *int { return &d }
	specs := []docSpec{
		// Corporate / NDAs
		{"قالب اتفاقية عدم الإفصاح المتبادلة 2026", model.DocumentTypeTemplate, "قالب معتمد لاتفاقية عدم الإفصاح المتبادلة لأغراض الفحص النافي للجهالة ومباحثات الصفقات.", "الشؤون المؤسسية", "الشؤون المؤسسية/اتفاقيات عدم الإفصاح", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"template", "nda"}, "This template provides balanced confidentiality, permitted disclosure, term, return-or-destruction, and governing law language for standard NDAs.", "templates-3y", nil, 2},
		{"قالب اتفاقية عدم إفصاح أحادية (إفصاح للموردين)", model.DocumentTypeTemplate, "اتفاقية عدم إفصاح أحادية تُستخدم عندما تفصح الشركة وحدها عن معلومات سرية للطرف المقابل.", "الشؤون المؤسسية", "الشؤون المؤسسية/اتفاقيات عدم الإفصاح", model.DocumentConfidentialityInternal, model.DocumentStatusSuperseded, -1, []string{"template", "nda", "one-way"}, "One-way confidentiality undertaking covering purpose limitation, security obligations, and survival of obligations post-termination.", "templates-3y", nil, 0},

		// Corporate / Contracts / Templates
		{"قالب اتفاقية الخدمات الرئيسية", model.DocumentTypeTemplate, "قالب موحد لاتفاقية الخدمات الرئيسية للتكليفات الاستشارية والخدمات المدارة.", "الشؤون المؤسسية", "الشؤون المؤسسية/العقود/القوالب", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"template", "msa", "contract"}, "MSA template covering scope, SLAs, fees, liability caps, indemnities, data protection, and termination for the firm's standard engagements.", "templates-3y", nil, 3},
		{"اتفاقية خدمات مورد - فالكون للاستخلاص الإلكتروني للأدلة", model.DocumentTypeOther, "اتفاقية خدمات موقعة مع المورد الرئيسي لاستضافة الاستخلاص الإلكتروني للأدلة.", "الشؤون المؤسسية", "الشؤون المؤسسية/العقود", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, 12, []string{"contract", "vendor", "ediscovery"}, "Executed agreement granting audit rights, chain-of-custody obligations, cyber-insurance evidence, and personal-data processing controls.", "contracts-7y", due(20), 0},

		// Litigation / Cases / 2026
		{"مذكرة مشمولة بالسرية المهنية - الأمر الوقتي في نزاع البحر الأحمر للخدمات اللوجستية", model.DocumentTypeMemo, "مذكرة المستشار بشأن استراتيجية الأمر الوقتي وثغرات الأدلة والجدول الزمني للإيداع.", "التقاضي", "التقاضي/القضايا/2026", model.DocumentConfidentialityPrivileged, model.DocumentStatusActive, -1, []string{"memo", "privileged", "arbitration"}, "The memo summarizes interim relief arguments, witness affidavits, document preservation issues, and expected tribunal questions.", "matter-records-10y", nil, 1},
		{"صحيفة الدعوى - البحر الأحمر للخدمات اللوجستية", model.DocumentTypeFiling, "صحيفة الدعوى المودعة لبدء إجراءات التحكيم التجاري.", "التقاضي", "التقاضي/القضايا/2026", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"pleading", "filing", "arbitration"}, "Statement of claim setting out the contractual breach, quantum of loss, interest claimed, and the relief sought from the tribunal.", "matter-records-10y", nil, 0},
		{"إفادة شاهد مشفوعة باليمين - مسؤول العمليات اللوجستية", model.DocumentTypeOther, "إفادة مشفوعة باليمين مرفقة ببيانات الشحن والمراسلات على سبيل الاستدلال.", "التقاضي", "التقاضي/القضايا/2026", model.DocumentConfidentialityPrivileged, model.DocumentStatusActive, -1, []string{"evidence", "affidavit", "privileged"}, "Affidavit exhibiting manifests, delivery logs, and counterparty correspondence relied on for the interim relief application.", "matter-records-10y", nil, 0},
		{"دليل إجراءات الحفظ لأغراض التقاضي", model.DocumentTypePolicy, "دليل تشغيلي لإشعارات الحفظ وتتبع حائزي المستندات واعتمادات رفع الحفظ.", "التقاضي", "التقاضي/الأدلة الإجرائية", model.DocumentConfidentialityPrivileged, model.DocumentStatusActive, -1, []string{"playbook", "litigation-hold"}, "The playbook defines trigger events, preservation notice content, custodian acknowledgement, evidence sources, and partner approval before release.", "policy-records-5y", nil, 0},

		// Compliance / ZATCA
		{"مذكرة الامتثال لمتطلبات الفوترة الإلكترونية - هيئة الزكاة والضريبة والجمارك", model.DocumentTypeMemo, "مذكرة استشارية بشأن التزامات المرحلة الثانية من الفوترة الإلكترونية.", "الامتثال", "الامتثال/هيئة الزكاة والضريبة والجمارك", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"memo", "zatca", "tax"}, "Memo summarizing integration, cryptographic stamp, and reporting obligations under the ZATCA Phase 2 e-invoicing regime.", "tax-records-6y", due(15), 0},
		{"سياسة حفظ السجلات - هيئة الزكاة والضريبة والجمارك", model.DocumentTypePolicy, "سياسة داخلية تربط متطلبات حفظ السجلات لدى هيئة الزكاة والضريبة والجمارك بجداول الاحتفاظ.", "الامتثال", "الامتثال/هيئة الزكاة والضريبة والجمارك", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"policy", "zatca", "retention"}, "Policy mapping invoice, credit-note, and audit-log records to the mandated six-year retention period and disposition controls.", "tax-records-6y", nil, 0},
		{"سجل أنشطة معالجة البيانات الشخصية (نظام حماية البيانات الشخصية)", model.DocumentTypePolicy, "سجل أنشطة معالجة البيانات الشخصية المعد بموجب نظام حماية البيانات الشخصية.", "الامتثال", "الامتثال/نظام حماية البيانات الشخصية", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"pdpl", "privacy", "register"}, "ROPA-style register recording processing purposes, legal basis, retention, cross-border transfers, and processor oversight.", "privacy-records-5y", due(5), 0},

		// Governance / Board / Minutes
		{"محضر اجتماع مجلس الإدارة - الربع الأول 2026", model.DocumentTypeResolution, "المحضر المعتمد لاجتماع مجلس الإدارة للربع الأول.", "الحوكمة", "الحوكمة/مجلس الإدارة/المحاضر", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"minutes", "board"}, "Minutes recording attendance, quorum, resolutions passed, and matters reserved for the board across the first quarter.", "board-records-10y", nil, 1},
		{"قرار لجنة الشركاء - حفظ المستندات", model.DocumentTypeResolution, "قرار لجنة الشركاء باعتماد إجراءات الحفظ لأغراض التقاضي وحفظ سجلات العملاء على مستوى الشركة.", "الحوكمة", "الحوكمة/مجلس الإدارة/المحاضر", model.DocumentConfidentialityPrivileged, model.DocumentStatusActive, -1, []string{"resolution", "committee"}, "Resolved that the firm shall maintain documented litigation hold workflows across client files, evidence repositories, and regulated records.", "board-records-10y", nil, 0},
		{"ميثاق مجلس الإدارة ومصفوفة تفويض الصلاحيات", model.DocumentTypePolicy, "ميثاق حوكمة يحدد صلاحيات المجلس ولجانه وحدود الصلاحيات المفوضة.", "الحوكمة", "الحوكمة/المواثيق", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"charter", "governance", "doa"}, "Charter setting out board composition, committee mandates, reserved matters, and financial delegation thresholds.", "board-records-10y", nil, 0},

		// Client Intake / Engagement Letters
		{"قالب خطاب التكليف القانوني 2026", model.DocumentTypeTemplate, "قالب معتمد لخطاب تكليف العملاء في الملفات النزاعية والاستشارية.", "استقبال العملاء", "استقبال العملاء/خطابات التكليف", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"template", "engagement"}, "This template covers scope, responsible partner, fee basis, conflicts clearance, confidentiality, and client authority instructions.", "templates-3y", nil, 2},
		{"سياسة استقبال الملفات القانونية وفحص تعارض المصالح", model.DocumentTypePolicy, "سياسة فتح الملفات القانونية وإخلاء تعارض المصالح وتوثيق تخويل العميل.", "استقبال العملاء", "استقبال العملاء/السياسات", model.DocumentConfidentialityInternal, model.DocumentStatusActive, -1, []string{"policy", "conflicts"}, "Every new matter requires client identity verification, related-party checks, adverse-party screening, and written approval from the responsible partner.", "policy-records-5y", nil, 0},
		{"خطاب تكليف - استحواذ في القطاع الصحي (مسودة)", model.DocumentTypeCorrespondence, "مسودة خطاب تكليف بانتظار اعتماد الشريك المسؤول لمهمة استحواذ في القطاع الصحي.", "استقبال العملاء", "استقبال العملاء/خطابات التكليف", model.DocumentConfidentialityConfidential, model.DocumentStatusDraft, -1, []string{"engagement", "draft"}, "Draft engagement letter scoping the buy-side advisory mandate, fee basis, and conflicts clearance, pending responsible-partner approval.", "", nil, 0},

		// Real Estate / Leases
		{"عقد إيجار مكاتب - المقر الرئيسي بالرياض", model.DocumentTypeOther, "عقد الإيجار الموقع لمقر الشركة الرئيسي في الرياض.", "العقارات", "العقارات/عقود الإيجار", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"lease", "real-estate", "contract"}, "Lease covering term, rent escalation, service charges, fit-out obligations, and renewal options for the headquarters premises.", "property-records-10y", nil, 0},
		{"عقد إيجار تجزئة - فرع سابق (مؤرشف)", model.DocumentTypeOther, "عقد إيجار تجزئة منتهٍ محفوظ في السجلات وللرجوع إليه عند النزاع.", "العقارات", "العقارات/عقود الإيجار", model.DocumentConfidentialityInternal, model.DocumentStatusArchived, -1, []string{"lease", "real-estate", "archived"}, "Expired branch lease retained for limitation-period reference, recording rent history and end-of-term reinstatement obligations.", "property-records-10y", due(-30), 0},

		// Regulatory
		{"مستجدات تنظيمية - البيانات والذكاء الاصطناعي في المملكة - الربع الأول", model.DocumentTypeMemo, "تحديث قانوني ربع سنوي للملفات المتعلقة بالخصوصية وحوكمة الذكاء الاصطناعي واستضافة البيانات.", "الشؤون التنظيمية", "الشؤون التنظيمية/التحديثات/2026", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, -1, []string{"memo", "regulatory", "data"}, "Recent guidance tightened requirements for breach notice timing, processor oversight, model-governance evidence, and cross-border transfer records.", "policy-records-5y", nil, 0},
		{"إحاطة للعملاء - تعديلات نظام الشركات الجديدة", model.DocumentTypeOpinion, "إحاطة عامة للعملاء تلخص أحدث تعديلات نظام الشركات.", "الشؤون التنظيمية", "الشؤون التنظيمية/الإحاطات", model.DocumentConfidentialityPublic, model.DocumentStatusActive, -1, []string{"briefing", "regulatory", "public"}, "Client-facing briefing summarising governance, capital, and disclosure changes introduced by the latest companies-law amendments.", "", nil, 0},

		// Litigation support (vendor policy)
		{"سياسة العناية الواجبة لموردي الاستخلاص الإلكتروني للأدلة", model.DocumentTypePolicy, "سياسة تأهيل موردي استضافة الأدلة ومنصات المراجعة وخدمات دعم التقاضي.", "دعم التقاضي", "التقاضي/الموردون", model.DocumentConfidentialityConfidential, model.DocumentStatusActive, 12, []string{"policy", "vendor", "ediscovery"}, "Critical litigation vendors require audit rights, cyber insurance, chain-of-custody procedures, and personal data processing controls before activation.", "policy-records-5y", nil, 0},
	}

	for idx, spec := range specs {
		var contractID *uuid.UUID
		if spec.ContractIndex >= 0 && spec.ContractIndex < len(contracts) {
			contractID = &contracts[spec.ContractIndex].ID
		}
		fileName := slugify(spec.Title) + ".txt"

		metadata := map[string]any{
			"seeded":         true,
			"document_index": idx + 1,
			"folder_path":    spec.FolderPath,
		}
		if spec.RetentionPolicy != "" {
			metadata["retention_policy"] = spec.RetentionPolicy
		}
		if spec.DispositionOffsetDays != nil {
			disposition := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, *spec.DispositionOffsetDays))
			metadata["disposition_date"] = disposition.Format("2006-01-02")
		}

		req := dto.CreateLegalDocumentRequest{
			Title:           spec.Title,
			Type:            spec.Type,
			Description:     spec.Description,
			Category:        ptrString(spec.Category),
			Confidentiality: spec.Confidentiality,
			ContractID:      contractID,
			Tags:            spec.Tags,
			Metadata:        metadata,
			Document: &dto.FileReference{
				FileID:        uuid.NewSHA1(seed.tenantID, []byte("seed-doc-"+fileName)),
				FileName:      fileName,
				FileSizeBytes: int64(len(spec.Content)),
				ContentHash:   contentHash(spec.Content),
				ChangeSummary: "النسخة الأولى من المستند.",
			},
		}
		document, err := app.DocumentService.Create(ctx, seed.tenantID, userID, req)
		if err != nil {
			return err
		}

		// Seed extra version history for selected documents.
		for v := 0; v < spec.ExtraVersions; v++ {
			updated := fmt.Sprintf("%s\nالمراجعة رقم %d بتاريخ %s بعد مراجعة لجنة الشركاء.", spec.Content, v+2, seed.referenceAt.AddDate(0, 0, -7*(spec.ExtraVersions-v)).Format("2006-01-02"))
			suffix := fmt.Sprintf("-v%d", v+2)
			if _, err := app.DocumentService.UploadVersion(ctx, seed.tenantID, userID, document.ID, dto.UploadDocumentVersionRequest{
				FileReference: dto.FileReference{
					FileID:        uuid.NewSHA1(seed.tenantID, []byte("seed-doc"+suffix+"-"+fileName)),
					FileName:      strings.TrimSuffix(fileName, ".txt") + suffix + ".txt",
					FileSizeBytes: int64(len(updated)),
					ContentHash:   contentHash(updated),
					ChangeSummary: fmt.Sprintf("النسخة %d بعد مراجعة لجنة الشركاء.", v+2),
				},
			}); err != nil {
				return err
			}
		}

		// Documents default to active on creation; apply non-active lifecycle
		// states so the repository shows draft/archived/superseded coverage.
		if spec.Status != "" && spec.Status != model.DocumentStatusActive {
			status := spec.Status
			if _, err := app.DocumentService.Update(ctx, seed.tenantID, document.ID, dto.UpdateLegalDocumentRequest{
				Status: &status,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (seed seedDataset) seedComplianceAlerts(ctx context.Context, app *Application, contracts []*model.Contract, rules []model.ComplianceRule, userID uuid.UUID) error {
	statuses := []model.ComplianceAlertStatus{
		model.ComplianceAlertOpen,
		model.ComplianceAlertAcknowledged,
		model.ComplianceAlertInvestigating,
		model.ComplianceAlertResolved,
		model.ComplianceAlertOpen,
		model.ComplianceAlertAcknowledged,
		model.ComplianceAlertInvestigating,
		model.ComplianceAlertResolved,
		model.ComplianceAlertResolved,
		model.ComplianceAlertResolved,
	}
	severities := []model.ComplianceSeverity{
		model.ComplianceSeverityHigh,
		model.ComplianceSeverityCritical,
		model.ComplianceSeverityMedium,
		model.ComplianceSeverityHigh,
		model.ComplianceSeverityMedium,
		model.ComplianceSeverityLow,
		model.ComplianceSeverityHigh,
		model.ComplianceSeverityCritical,
		model.ComplianceSeverityMedium,
		model.ComplianceSeverityLow,
	}
	titles := []string{
		"اقتراب انتهاء تكليف تحكيم البحر الأحمر",
		"مورد الاستخلاص الإلكتروني للأدلة دون أدلة على حق التدقيق",
		"ملف استشارات التقنية المالية يتطلب مراجعة خصوصية",
		"ترخيص نظام إدارة الملفات القانونية يتجاوز حد الاعتماد",
		"مطلوب إشعار تجديد اتفاقية عدم الإفصاح لاستحواذ القطاع الصحي",
		"تكليف الخبير الشاهد يفتقر إلى مذكرة السرية المهنية",
		"تأخر مراجعة مورد إيداع المستندات القضائية",
		"إغلاق ملاحظة اتفاقية عدم الإفصاح لعقد إيجار التجزئة المؤرشف",
		"اكتمال إغلاق اتفاقية خدمات الترجمة السابقة",
		"تسوية تعارض ربط حفظ المستندات",
	}

	for idx := range titles {
		var ruleID *uuid.UUID
		if len(rules) > 0 {
			value := rules[idx%len(rules)].ID
			ruleID = &value
		}
		contractID := contracts[idx%len(contracts)].ID
		alert := &model.ComplianceAlert{
			ID:          uuid.NewSHA1(seed.tenantID, []byte(fmt.Sprintf("seed-alert-%02d", idx+1))),
			TenantID:    seed.tenantID,
			RuleID:      ruleID,
			ContractID:  &contractID,
			Title:       titles[idx],
			Description: fmt.Sprintf("تنبيه امتثال رقم %d ضمن محفظة العقود لأغراض تقارير العمليات القانونية.", idx+1),
			Severity:    severities[idx],
			Status:      statuses[idx],
			Evidence: map[string]any{
				"seeded":      true,
				"contract_id": contractID,
				"alert_index": idx + 1,
			},
		}
		if statuses[idx] == model.ComplianceAlertResolved {
			alert.ResolvedBy = &userID
			resolvedAt := seed.referenceAt.Add(time.Duration(idx+1) * time.Hour)
			alert.ResolvedAt = &resolvedAt
			notes := "تمت المعالجة خلال فرز تنبيهات الامتثال."
			alert.ResolutionNotes = &notes
		}
		if err := app.Store.Alerts.Create(ctx, app.Store.DB(), alert); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) ensureClauseLibrary(ctx context.Context, app *Application, userID uuid.UUID) ([]model.ClauseLibraryItem, error) {
	if ok, err := seed.hasRows(ctx, app, "clause_library_items", true); err != nil {
		return nil, err
	} else if ok {
		items, _, err := app.LibraryService.ListClauses(ctx, seed.tenantID, model.ClauseLibraryListFilters{Page: 1, PerPage: 100})
		return items, err
	}
	return seed.seedClauseLibrary(ctx, app, userID)
}

func (seed seedDataset) seedClauseLibrary(ctx context.Context, app *Application, userID uuid.UUID) ([]model.ClauseLibraryItem, error) {
	requests := []dto.CreateClauseLibraryItemRequest{
		{
			Code:             "CL-DP-PDPL-001",
			TitleEN:          "Personal Data Processing and PDPL Controls",
			TitleAR:          "معالجة البيانات الشخصية وضوابط نظام حماية البيانات الشخصية",
			TextEN:           "The supplier may process client or matter personal data only on documented instructions, must keep processing records, notify Apex Legal Partners of suspected breaches within 24 hours, and must not transfer regulated data outside approved hosting locations without prior written approval.",
			TextAR:           "لا يجوز للمورد معالجة البيانات الشخصية الخاصة بالعملاء أو الملفات إلا بموجب تعليمات موثقة، وعليه الاحتفاظ بسجلات المعالجة، وإخطار الشركة بأي اشتباه في اختراق خلال 24 ساعة، وعدم نقل البيانات الخاضعة للتنظيم خارج مواقع الاستضافة المعتمدة دون موافقة كتابية مسبقة.",
			ClauseType:       model.ClauseTypeDataProtection,
			Category:         "privacy",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"pdpl", "processor", "cross-border"},
			Metadata:         map[string]any{"risk_level": "critical", "control_family": "privacy"},
		},
		{
			Code:             "CL-AUDIT-001",
			TitleEN:          "Regulatory and Customer Audit Rights",
			TitleAR:          "حقوق التدقيق للجهات التنظيمية والعملاء",
			TextEN:           "Apex Legal Partners, its auditors, and competent regulators may review relevant records, security evidence, and subcontractor controls on reasonable notice, including urgent access after a material incident.",
			TextAR:           "يجوز للشركة ولمدققيها وللجهات التنظيمية المختصة الاطلاع على السجلات ذات الصلة وأدلة الأمن وضوابط المقاولين من الباطن بموجب إشعار معقول، بما في ذلك الوصول العاجل بعد أي حادثة جوهرية.",
			ClauseType:       model.ClauseTypeAuditRights,
			Category:         "governance",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"audit", "regulator", "evidence"},
			Metadata:         map[string]any{"risk_level": "high", "control_family": "third_party"},
		},
		{
			Code:             "CL-SLA-001",
			TitleEN:          "Critical Service Levels and Credits",
			TitleAR:          "مستويات الخدمة الحرجة والتعويضات",
			TextEN:           "Critical production services must meet 99.9 percent monthly availability, priority-one response within 30 minutes, root cause analysis within five business days, and service credits for missed commitments.",
			TextAR:           "يجب أن تحقق الخدمات الإنتاجية الحرجة نسبة إتاحة شهرية لا تقل عن 99.9%، والاستجابة للحالات من الدرجة الأولى خلال 30 دقيقة، وتحليل السبب الجذري خلال خمسة أيام عمل، مع تعويضات خدمة عند الإخلال بالالتزامات.",
			ClauseType:       model.ClauseTypeSLA,
			Category:         "operations",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"sla", "availability", "service-credit"},
			Metadata:         map[string]any{"risk_level": "high", "control_family": "resilience"},
		},
		{
			Code:             "CL-LIAB-CAP-001",
			TitleEN:          "Liability Cap with Carve-Outs",
			TitleAR:          "سقف المسؤولية مع الاستثناءات",
			TextEN:           "Aggregate liability is capped at fees paid in the prior twelve months, except for confidentiality breach, data protection breach, fraud, willful misconduct, IP infringement, and unpaid fees.",
			TextAR:           "يُحدد إجمالي المسؤولية بما لا يتجاوز الأتعاب المدفوعة خلال الاثني عشر شهراً السابقة، باستثناء الإخلال بالسرية، والإخلال بحماية البيانات، والاحتيال، وسوء التصرف المتعمد، والتعدي على الملكية الفكرية، والأتعاب غير المسددة.",
			ClauseType:       model.ClauseTypeLimitationOfLiability,
			Category:         "commercial",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"liability", "carve-out", "commercial"},
			Metadata:         map[string]any{"risk_level": "medium", "control_family": "commercial"},
		},
		{
			Code:             "CL-TERM-001",
			TitleEN:          "Termination for Cause and Regulatory Direction",
			TitleAR:          "الإنهاء للإخلال أو بتوجيه تنظيمي",
			TextEN:           "Either party may terminate for uncured material breach after written notice and a 30 day cure period. Apex Legal Partners may terminate immediately where required by court order, client instruction, regulator direction, or unresolved critical security risk.",
			TextAR:           "يجوز لأي من الطرفين إنهاء الاتفاقية عند وقوع إخلال جوهري لم يُعالج بعد إشعار كتابي ومهلة معالجة مدتها 30 يوماً. ويجوز للشركة الإنهاء الفوري متى اقتضى ذلك أمر قضائي أو تعليمات العميل أو توجيه من جهة تنظيمية أو خطر أمني حرج لم تتم معالجته.",
			ClauseType:       model.ClauseTypeTermination,
			Category:         "lifecycle",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"termination", "regulatory", "cure-period"},
			Metadata:         map[string]any{"risk_level": "medium", "control_family": "lifecycle"},
		},
		{
			Code:             "CL-GOVLAW-SA-001",
			TitleEN:          "Saudi Governing Law and Riyadh Venue",
			TitleAR:          "النظام الواجب التطبيق في المملكة والاختصاص في الرياض",
			TextEN:           "This agreement is governed by the laws of the Kingdom of Saudi Arabia. Disputes are escalated to executive sponsors before arbitration or competent courts in Riyadh, unless mandatory law requires another forum.",
			TextAR:           "تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية. وتُصعَّد المنازعات إلى الرعاة التنفيذيين قبل اللجوء إلى التحكيم أو المحاكم المختصة في الرياض، ما لم تقضِ الأنظمة الآمرة باختصاص آخر.",
			ClauseType:       model.ClauseTypeGoverningLaw,
			Category:         "disputes",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"governing-law", "riyadh", "dispute"},
			Metadata:         map[string]any{"risk_level": "medium", "control_family": "legal"},
		},
		{
			Code:             "CL-AUTORENEW-001",
			TitleEN:          "Controlled Auto-Renewal Notice",
			TitleAR:          "ضوابط إشعار التجديد التلقائي",
			TextEN:           "Automatic renewal is permitted only where the supplier gives written renewal notice at least 60 days before expiry, with pricing, service changes, and exit assistance options clearly stated.",
			TextAR:           "لا يُسمح بالتجديد التلقائي إلا إذا وجّه المورد إشعار تجديد كتابياً قبل 60 يوماً على الأقل من تاريخ الانتهاء، مبيناً فيه بوضوح الأسعار وتغييرات الخدمة وخيارات المساندة عند الخروج.",
			ClauseType:       model.ClauseTypeAutoRenewal,
			Category:         "lifecycle",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"renewal", "notice", "pricing"},
			Metadata:         map[string]any{"risk_level": "medium", "control_family": "lifecycle"},
		},
		{
			Code:             "CL-INS-CYBER-001",
			TitleEN:          "Cyber and Professional Insurance",
			TitleAR:          "التأمين السيبراني والمهني",
			TextEN:           "The supplier must maintain cyber liability, professional indemnity, and commercial general liability insurance appropriate to the service risk and provide certificates on request.",
			TextAR:           "يلتزم المورد بالاحتفاظ بتأمين المسؤولية السيبرانية وتأمين التعويض المهني وتأمين المسؤولية العامة التجارية بما يتناسب مع مخاطر الخدمة، وتقديم الشهادات عند الطلب.",
			ClauseType:       model.ClauseTypeInsurance,
			Category:         "risk_transfer",
			Jurisdiction:     "SA",
			Source:           "مكتبة البنود المعتمدة للإدارة القانونية",
			Version:          1,
			Status:           model.ClauseLibraryStatusActive,
			GovernanceStatus: model.ClauseGovernanceApproved,
			Tags:             []string{"insurance", "cyber", "risk-transfer"},
			Metadata:         map[string]any{"risk_level": "high", "control_family": "risk_transfer"},
		},
	}

	items := make([]model.ClauseLibraryItem, 0, len(requests))
	for _, req := range requests {
		item, err := app.LibraryService.CreateClause(ctx, seed.tenantID, userID, req)
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, nil
}

func (seed seedDataset) ensureRegulations(ctx context.Context, app *Application, clauses []model.ClauseLibraryItem, userID uuid.UUID) error {
	if ok, err := seed.hasRows(ctx, app, "regulation_library_items", true); err != nil {
		return err
	} else if ok {
		return nil
	}
	if len(clauses) == 0 {
		items, _, err := app.LibraryService.ListClauses(ctx, seed.tenantID, model.ClauseLibraryListFilters{Page: 1, PerPage: 100})
		if err != nil {
			return err
		}
		clauses = items
	}
	return seed.seedRegulations(ctx, app, clauses, userID)
}

func (seed seedDataset) seedRegulations(ctx context.Context, app *Application, clauses []model.ClauseLibraryItem, userID uuid.UUID) error {
	clauseByCode := map[string]uuid.UUID{}
	for _, clause := range clauses {
		clauseByCode[clause.Code] = clause.ID
	}
	effectiveDate := func(y int, m time.Month, d int) *time.Time {
		value := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
		return &value
	}
	type regulationSpec struct {
		req        dto.CreateRegulationLibraryItemRequest
		references []string
	}
	specs := []regulationSpec{
		{
			req: dto.CreateRegulationLibraryItemRequest{
				Code:           "KSA-PDPL-2021",
				TitleEN:        "Personal Data Protection Law",
				TitleAR:        "نظام حماية البيانات الشخصية",
				DescriptionEN:  "Core privacy obligations covering lawful processing, controller instructions, breach handling, transfer controls, and data subject rights.",
				DescriptionAR:  "الالتزامات الأساسية للخصوصية وتشمل مشروعية المعالجة وتعليمات المتحكم ومعالجة الاختراقات وضوابط النقل وحقوق أصحاب البيانات الشخصية.",
				Jurisdiction:   "SA",
				Authority:      "SDAIA",
				Source:         "Royal Decree and Implementing Regulation",
				RegulationType: model.RegulationTypeLaw,
				EffectiveDate:  effectiveDate(2024, time.September, 14),
				Version:        1,
				Status:         model.RegulationStatusActive,
				Tags:           []string{"privacy", "pdpl", "data-protection"},
				Metadata:       map[string]any{"risk_level": "critical", "review_cycle": "quarterly"},
			},
			references: []string{"CL-DP-PDPL-001"},
		},
		{
			req: dto.CreateRegulationLibraryItemRequest{
				Code:           "NCA-ECC-2018",
				TitleEN:        "Essential Cybersecurity Controls",
				TitleAR:        "الضوابط الأساسية للأمن السيبراني",
				DescriptionEN:  "Baseline cybersecurity controls relevant to client data rooms, evidence repositories, incident handling, business continuity, and third-party cybersecurity.",
				DescriptionAR:  "الضوابط الأساسية للأمن السيبراني ذات الصلة بغرف بيانات العملاء ومستودعات الأدلة ومعالجة الحوادث واستمرارية الأعمال والأمن السيبراني للأطراف الثالثة.",
				Jurisdiction:   "SA",
				Authority:      "National Cybersecurity Authority",
				Source:         "NCA ECC control set",
				RegulationType: model.RegulationTypeStandard,
				EffectiveDate:  effectiveDate(2018, time.January, 1),
				Version:        1,
				Status:         model.RegulationStatusActive,
				Tags:           []string{"cybersecurity", "nca", "third-party"},
				Metadata:       map[string]any{"risk_level": "high", "review_cycle": "semiannual"},
			},
			references: []string{"CL-AUDIT-001", "CL-SLA-001", "CL-INS-CYBER-001"},
		},
		{
			req: dto.CreateRegulationLibraryItemRequest{
				Code:           "KSA-ARB-2012",
				TitleEN:        "Saudi Arbitration Law",
				TitleAR:        "نظام التحكيم",
				DescriptionEN:  "Arbitration framework relevant to dispute clauses, interim relief strategy, award enforcement, and Riyadh-seated arbitration matters.",
				DescriptionAR:  "إطار التحكيم ذو الصلة بشروط تسوية المنازعات واستراتيجية التدابير المؤقتة وتنفيذ أحكام التحكيم والقضايا التحكيمية التي مقرها الرياض.",
				Jurisdiction:   "SA",
				Authority:      "Bureau of Experts",
				Source:         "Royal Decree arbitration law",
				RegulationType: model.RegulationTypeLaw,
				EffectiveDate:  effectiveDate(2012, time.April, 16),
				Version:        1,
				Status:         model.RegulationStatusActive,
				Tags:           []string{"arbitration", "disputes", "riyadh"},
				Metadata:       map[string]any{"risk_level": "critical", "review_cycle": "quarterly"},
			},
			references: []string{"CL-GOVLAW-SA-001", "CL-TERM-001"},
		},
		{
			req: dto.CreateRegulationLibraryItemRequest{
				Code:           "KSA-ETRANS-2007",
				TitleEN:        "Electronic Transactions Law",
				TitleAR:        "نظام التعاملات الإلكترونية",
				DescriptionEN:  "Electronic transaction and signature rules relevant to native signature envelopes, electronic records, and client authorization evidence.",
				DescriptionAR:  "قواعد التعاملات والتوقيعات الإلكترونية ذات الصلة بمظاريف التوقيع الأصلية والسجلات الإلكترونية وأدلة تخويل العملاء.",
				Jurisdiction:   "SA",
				Authority:      "Communications, Space and Technology Commission",
				Source:         "Electronic transactions framework",
				RegulationType: model.RegulationTypeLaw,
				EffectiveDate:  effectiveDate(2007, time.March, 26),
				Version:        1,
				Status:         model.RegulationStatusActive,
				Tags:           []string{"electronic-signature", "records", "evidence"},
				Metadata:       map[string]any{"risk_level": "high", "review_cycle": "quarterly"},
			},
			references: []string{"CL-GOVLAW-SA-001"},
		},
		{
			req: dto.CreateRegulationLibraryItemRequest{
				Code:           "ZATCA-EINV-2023",
				TitleEN:        "Electronic Invoicing Requirements",
				TitleAR:        "متطلبات الفوترة الإلكترونية",
				DescriptionEN:  "Electronic invoicing controls affecting client billing records, retention, auditability, and finance-system evidence.",
				DescriptionAR:  "ضوابط الفوترة الإلكترونية المؤثرة في سجلات فوترة العملاء والاحتفاظ بها وقابليتها للتدقيق وأدلة الأنظمة المالية.",
				Jurisdiction:   "SA",
				Authority:      "ZATCA",
				Source:         "E-invoicing implementation requirements",
				RegulationType: model.RegulationTypeRegulation,
				EffectiveDate:  effectiveDate(2023, time.January, 1),
				Version:        1,
				Status:         model.RegulationStatusActive,
				Tags:           []string{"tax", "e-invoicing", "retention"},
				Metadata:       map[string]any{"risk_level": "medium", "review_cycle": "annual"},
			},
			references: []string{"CL-AUDIT-001"},
		},
	}

	for _, spec := range specs {
		regulation, err := app.LibraryService.CreateRegulation(ctx, seed.tenantID, userID, spec.req)
		if err != nil {
			return err
		}
		for _, clauseCode := range spec.references {
			clauseID, ok := clauseByCode[clauseCode]
			if !ok {
				continue
			}
			if _, err := app.LibraryService.LinkRegulationClause(ctx, seed.tenantID, userID, regulation.ID, dto.CreateRegulationClauseReferenceRequest{
				ClauseID:      clauseID,
				ReferenceType: model.RegulationClauseReferenceRecommendedBy,
				Notes:         "رُبط أثناء تهيئة المحفظة القانونية لإظهار إمكانية التتبع بين البنود والأنظمة.",
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (seed seedDataset) ensureClausePlaybooks(ctx context.Context, app *Application, userID uuid.UUID) error {
	if ok, err := seed.hasRows(ctx, app, "lex_clause_playbooks", true); err != nil {
		return err
	} else if ok {
		return nil
	}
	playbooks := []dto.CreatePlaybookRequest{
		seed.playbookRequest("النموذج المرجعي لاتفاقية الخدمات", model.ContractTypeServiceAgreement, []model.ClauseType{model.ClauseTypeSLA, model.ClauseTypeDataProtection, model.ClauseTypeAuditRights, model.ClauseTypeLimitationOfLiability, model.ClauseTypeTermination}),
		seed.playbookRequest("النموذج المرجعي لاتفاقية الموردين الرئيسية", model.ContractTypeVendor, []model.ClauseType{model.ClauseTypeDataProtection, model.ClauseTypeAuditRights, model.ClauseTypeInsurance, model.ClauseTypeSLA, model.ClauseTypeAutoRenewal}),
		seed.playbookRequest("النموذج المرجعي لاتفاقية عدم الإفصاح المتبادلة", model.ContractTypeNDA, []model.ClauseType{model.ClauseTypeConfidentiality, model.ClauseTypeDataProtection, model.ClauseTypeGoverningLaw, model.ClauseTypeTermination}),
		seed.playbookRequest("النموذج المرجعي لترخيص البرمجيات", model.ContractTypeLicense, []model.ClauseType{model.ClauseTypeIPOwnership, model.ClauseTypeLimitationOfLiability, model.ClauseTypeWarranty, model.ClauseTypeSLA, model.ClauseTypeAuditRights}),
		seed.playbookRequest("النموذج المرجعي لعقد العمل", model.ContractTypeEmployment, []model.ClauseType{model.ClauseTypeConfidentiality, model.ClauseTypeNonSolicitation, model.ClauseTypeNonCompete, model.ClauseTypeGoverningLaw}),
		seed.playbookRequest("النموذج المرجعي للاتفاقية الاستشارية", model.ContractTypeConsulting, []model.ClauseType{model.ClauseTypeSLA, model.ClauseTypeIPOwnership, model.ClauseTypePaymentTerms, model.ClauseTypeConfidentiality}),
	}
	for _, req := range playbooks {
		if _, err := app.PlaybookService.Create(ctx, seed.tenantID, userID, req); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) playbookRequest(name string, contractType model.ContractType, clauseTypes []model.ClauseType) dto.CreatePlaybookRequest {
	clauses := make([]dto.PlaybookClauseRequest, 0, len(clauseTypes))
	for idx, clauseType := range clauseTypes {
		clauses = append(clauses, dto.PlaybookClauseRequest{
			ClauseType:          clauseType,
			Title:               blueprintTitle(clauseType),
			StandardText:        seed.standardClauseText(clauseType),
			Required:            true,
			RiskWeight:          []float64{1, 0.9, 0.85, 0.75, 0.7}[idx%5],
			SimilarityThreshold: 0.72,
		})
	}
	return dto.CreatePlaybookRequest{
		Name:         name,
		Description:  "النموذج المرجعي المعتمد للبنود يُستخدم لكشف الانحرافات في محفظة العقود القانونية.",
		ContractType: contractType,
		Status:       model.PlaybookStatusActive,
		Clauses:      clauses,
		Metadata:     map[string]any{"seeded": true, "jurisdiction": "SA"},
	}
}

func (seed seedDataset) standardClauseText(clauseType model.ClauseType) string {
	for _, blueprint := range seedClauseBlueprints() {
		if blueprint.ClauseType == clauseType {
			return blueprint.Trigger + " " + blueprint.SafeBody
		}
	}
	return "The parties will comply with the firm's approved standard for this clause."
}

func (seed seedDataset) ensureApprovalPolicies(ctx context.Context, app *Application, users []seedUser) error {
	if ok, err := seed.hasRows(ctx, app, "lex_approval_policies", true); err != nil {
		return err
	} else if ok {
		return nil
	}
	falseValue := false
	minHigh := 1000000.0
	minBoard := 3000000.0
	serviceAgreement := model.ContractTypeServiceAgreement
	vendor := model.ContractTypeVendor
	policies := []dto.CreateApprovalPolicyRequest{
		{
			Name:                     "مراجعة تكليفات العملاء عالية القيمة",
			Description:              "إحالة تكليفات العملاء الجوهرية إلى اعتماد الشريك المسؤول ولجنة المخاطر.",
			Status:                   model.ApprovalPolicyStatusActive,
			Priority:                 100,
			ContractType:             &serviceAgreement,
			Department:               ptrString("التقاضي"),
			MinValue:                 &minHigh,
			Currency:                 "SAR",
			Mode:                     "parallel",
			Quorum:                   "all",
			Approvers:                []dto.ApprovalPolicyApprover{{Type: "user", Ref: users[1].ID.String(), Label: users[1].Name}, {Type: "user", Ref: users[2].ID.String(), Label: users[2].Name}},
			FormFields:               seed.approvalFormFields(),
			RequireAuthorityEvidence: &falseValue,
			Metadata:                 map[string]any{"seeded": true, "scenario": "client_engagement"},
		},
		{
			Name:                     "مراجعة موردي غرف بيانات العملاء",
			Description:              "إحالة الموردين الذين يستضيفون ملفات العملاء أو الأدلة إلى مراجعة التقنية القانونية وحماية البيانات.",
			Status:                   model.ApprovalPolicyStatusActive,
			Priority:                 90,
			ContractType:             &vendor,
			Department:               ptrString("دعم التقاضي"),
			Currency:                 "SAR",
			Mode:                     "parallel",
			Quorum:                   "all",
			Approvers:                []dto.ApprovalPolicyApprover{{Type: "user", Ref: users[1].ID.String(), Label: users[1].Name}, {Type: "user", Ref: users[5].ID.String(), Label: users[5].Name}},
			FormFields:               seed.approvalFormFields(),
			RequireAuthorityEvidence: &falseValue,
			Metadata:                 map[string]any{"seeded": true, "scenario": "privacy"},
		},
		{
			Name:                     "الصلاحيات المحجوزة للجنة الشركاء",
			Description:              "إحالة الالتزامات الجوهرية التي تتجاوز حد صلاحيات لجنة الشركاء إلى اعتماد قيادة الشركة.",
			Status:                   model.ApprovalPolicyStatusActive,
			Priority:                 80,
			MinValue:                 &minBoard,
			Currency:                 "SAR",
			Mode:                     "sequential",
			Quorum:                   "all",
			Approvers:                []dto.ApprovalPolicyApprover{{Type: "user", Ref: users[3].ID.String(), Label: users[3].Name}, {Type: "user", Ref: users[2].ID.String(), Label: users[2].Name}},
			FormFields:               seed.approvalFormFields(),
			RequireAuthorityEvidence: &falseValue,
			Metadata:                 map[string]any{"seeded": true, "scenario": "partner_committee"},
		},
	}
	for _, req := range policies {
		if _, err := app.WorkflowService.CreateApprovalPolicy(ctx, seed.tenantID, seed.systemUser, req); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) approvalFormFields() []dto.ApprovalFormFieldRequest {
	return []dto.ApprovalFormFieldRequest{
		{Name: "risk_rating", Type: "select", Label: "تقييم المخاطر المتبقية", Required: true, Options: []string{"low", "medium", "high", "critical"}},
		{Name: "responsible_partner", Type: "text", Label: "إقرار الشريك المسؤول", Required: true},
	}
}

// ensureRequestApprovalPolicyTemplates seeds a handful of starter reusable
// request-approval policy templates so the templates admin surface is not empty
// out of the box. It is idempotent: it lists existing templates first and skips
// any whose name already exists for the tenant (the service-layer unique guard
// on (tenant, name) is a second line of defence on re-seed).
func (seed seedDataset) ensureRequestApprovalPolicyTemplates(ctx context.Context, app *Application) error {
	existing, err := app.RequestApprovalPolicyService.ListTemplates(ctx, seed.tenantID)
	if err != nil {
		return err
	}
	byName := make(map[string]struct{}, len(existing))
	for _, t := range existing {
		byName[t.Name] = struct{}{}
	}

	templates := seedRequestApprovalPolicyTemplates()
	for _, req := range templates {
		if _, seeded := byName[req.Name]; seeded {
			continue
		}
		if _, err := app.RequestApprovalPolicyService.CreateTemplate(ctx, seed.tenantID, seed.systemUser, req); err != nil {
			return fmt.Errorf("seed request approval policy template %q: %w", req.Name, err)
		}
	}
	return nil
}

// ensureServiceCatalog publishes the legal department's service catalogue
// (CAP-001). The entries mirror the Al Othaim Legal Affairs catalogue in
// docs/client_requirement_must/Legal System Capabilities.xlsx: bilingual
// (AR/EN) names and descriptions, published audience, requester/provider
// approval gating, the inbound mailbox each request type routes to, and the
// urgent/normal SLA windows (working days) with their acknowledgement targets.
//
// Catalogue services expose both intake channels required by the PRD. Shared
// departmental mailboxes (contract-legal@, case-legal@, am@) are set as the
// per-service intake_email (bare PRD address) AND mirrored in metadata, then
// wired through the intake-mailbox subsystem (CAP-002). intake_email is no longer
// unique (migration 000094), so several services can advertise the same bare
// shared address; one mailbox at that address serves them all. Eligibility rules
// enforce the published audience.
//
// Idempotent: services already present (matched by code) are left untouched, so
// re-seeding and admin edits are never clobbered.
func (seed seedDataset) ensureServiceCatalog(ctx context.Context, app *Application) error {
	if app.ServiceCatalogService == nil {
		return nil
	}
	existing, _, err := app.ServiceCatalogService.List(ctx, seed.tenantID, model.ServiceCatalogListFilters{Page: 1, PerPage: 200})
	if err != nil {
		return err
	}
	byCode := make(map[string]struct{}, len(existing))
	for _, svc := range existing {
		byCode[svc.Code] = struct{}{}
	}
	for _, req := range legalServiceCatalogSeed() {
		if _, seeded := byCode[req.Code]; seeded {
			continue
		}
		if _, err := app.ServiceCatalogService.Create(ctx, seed.tenantID, seed.systemUser, req); err != nil {
			return fmt.Errorf("seed service catalog %q: %w", req.Code, err)
		}
	}
	return nil
}

// legalServiceCatalogSeed returns the eight published legal services from the
// client requirements catalogue (Service Catalog & SLA sheet). request_type
// values use the platform's canonical lowercase keys so created requests route
// to the correct legal domain (consultations, contracts, litigation,
// investigations, etc.).
func legalServiceCatalogSeed() []dto.CreateServiceCatalogRequest {
	bilingual := func(en, ar string) forms.LocalizedText { return forms.LocalizedText{EN: en, AR: ar} }
	openRule := []dto.ServiceEligibilityRuleRequest{{RuleType: model.EligibilityRuleAll, Value: ""}}
	managerRule := []dto.ServiceEligibilityRuleRequest{{
		RuleType: model.EligibilityRuleRole,
		Value:    string(model.OrgRoleDepartmentManager),
	}}

	const (
		audienceAll          = "all_employees"
		audienceDeptManagers = "department_managers"
	)

	// sla builds the working-day SLA window block for a service. Acknowledgement
	// targets are constant across the catalogue per the requirements footnote
	// (normal: 0–1 working day, urgent: 0–4 working hours).
	sla := func(urgentFrom, urgentTo, normalFrom, normalTo int) map[string]any {
		return map[string]any{
			"unit":   "working_days",
			"urgent": map[string]any{"from": urgentFrom, "to": urgentTo},
			"normal": map[string]any{"from": normalFrom, "to": normalTo},
			"acknowledgement": map[string]any{
				"normal_working_days":  "0-1",
				"urgent_working_hours": "0-4",
			},
		}
	}

	return []dto.CreateServiceCatalogRequest{
		{
			Code:        model.ServiceCodeLegalConsultation,
			IntakeEmail: seedPtr("contract-legal@othaim.com"),
			RequestType: "consultation",
			Name:        bilingual("Legal Consultations", "الاستشارات القانونية"),
			Description: bilingual(
				"Providing preliminary legal advice and consultation to various departments regarding legal and regulatory matters, ensuring compliance with relevant laws and regulations.",
				"طلب مشورة قانونية أو رأي مكتوب من الإدارة القانونية بشأن مسألة تتعلق بالعمل أو التشغيل.",
			),
			AvailableTo:           []string{audienceDeptManagers},
			RequesterApprovalReqd: true,
			ProviderApprovalReqd:  false,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      managerRule,
			Metadata: map[string]any{
				"prd_baseline":       "othaim-2026-07-14",
				"available_to_label": "Department Managers",
				"intake_mailbox":     "contract-legal@othaim.com",
				"sla":                sla(3, 4, 5, 6),
			},
		},
		{
			Code:        model.ServiceCodeContractReview,
			IntakeEmail: seedPtr("contract-legal@othaim.com"),
			RequestType: "contract_review",
			Name:        bilingual("Review of Contracts and Agreements", "مراجعة العقود والاتفاقيات"),
			Description: bilingual(
				"Reviewing contracts and agreements to verify their compliance with applicable laws and regulations.",
				"تقديم عقد أو اتفاقية لمراجعتها قانونياً وإبداء الملاحظات وتقييم المخاطر قبل التوقيع.",
			),
			AvailableTo:           []string{audienceAll},
			RequesterApprovalReqd: false,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      openRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "All Employees",
				"requester_approval_route": "BU CEO / Departments",
				"intake_mailbox":           "contract-legal@othaim.com",
				"sla":                      sla(2, 3, 4, 5),
			},
		},
		{
			Code:        model.ServiceCodeLegalOpinion,
			IntakeEmail: seedPtr("case-legal@othaim.com"),
			RequestType: "legal_opinion",
			Name:        bilingual("Providing Preliminary Legal Study", "تقديم دراسة قانونية أولية"),
			Description: bilingual(
				"Preparing a preliminary legal study to determine the company's legal position, assess risks, and identify available options for appropriate decision-making.",
				"طلب دراسة قانونية أولية تبيّن موقف الشركة والخيارات المتاحة بشأن مسألة معينة.",
			),
			AvailableTo:           []string{audienceDeptManagers},
			RequesterApprovalReqd: true,
			ProviderApprovalReqd:  false,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      managerRule,
			Metadata: map[string]any{
				"prd_baseline":       "othaim-2026-07-14",
				"available_to_label": "Department Managers",
				"intake_mailbox":     "case-legal@othaim.com",
				"sla":                sla(3, 5, 10, 15),
			},
		},
		{
			Code:        model.ServiceCodeLitigationSupport,
			IntakeEmail: seedPtr("case-legal@othaim.com"),
			RequestType: "litigation",
			Name:        bilingual("Judicial Case Study", "دراسة حالة قضائية"),
			Description: bilingual(
				"Studying and preparing a judicial case, filing a lawsuit before the competent judicial authorities, and following up on its procedures to ensure the protection of the company's rights and interests.",
				"طلب دراسة حالة قضائية ورفع الدعوى أمام الجهة القضائية أو المختصة.",
			),
			AvailableTo:           []string{audienceAll},
			RequesterApprovalReqd: true,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      openRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "All Employees",
				"requester_approval_route": "Per DoA matrix",
				"intake_mailbox":           "case-legal@othaim.com",
				"reference_mailbox":        "ref@othaim.com",
				"sla":                      sla(5, 10, 20, 30),
			},
		},
		{
			Code:        model.ServiceCodeEnforcementRequest,
			IntakeEmail: seedPtr("case-legal@othaim.com"),
			RequestType: "enforcement",
			Name:        bilingual("Submission of Execution Request", "تقديم طلب تنفيذ"),
			Description: bilingual(
				"Preparing and submitting an execution request to the competent authorities to initiate the judgment execution procedures.",
				"طلب قيام الإدارة القانونية بتقديم ومتابعة طلب تنفيذ حكم أو سند تنفيذي.",
			),
			AvailableTo:           []string{audienceAll},
			RequesterApprovalReqd: false,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      openRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "All Employees",
				"requester_approval_route": "BU CEO / Departments",
				"intake_mailbox":           "case-legal@othaim.com",
				"sla":                      sla(5, 10, 15, 20),
			},
		},
		{
			Code:        model.ServiceCodeViolationStudy,
			IntakeEmail: seedPtr("case-legal@othaim.com"),
			RequestType: "investigation",
			Name:        bilingual("Investigation of Violation or Breach", "دراسة مخالفة أو تجاوز"),
			Description: bilingual(
				"Studying suspected violations and breaches, collecting and analyzing evidence to determine responsibilities, and providing recommendations for appropriate legal actions.",
				"طلب دراسة قانونية لمخالفة أو تجاوز، تشمل النتائج والإجراء الموصى به.",
			),
			AvailableTo:           []string{audienceDeptManagers},
			RequesterApprovalReqd: false,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      managerRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "Department Managers",
				"requester_approval_route": "BU CEO / Departments",
				"intake_mailbox":           "case-legal@othaim.com",
				"sla":                      sla(5, 10, 15, 20),
			},
		},
		{
			Code:        model.ServiceCodeFieldInspection,
			IntakeEmail: seedPtr("case-legal@othaim.com"),
			RequestType: "inspection",
			Name:        bilingual("Field Inspection and Incident Documentation", "المعاينة الميدانية وتوثيق الحوادث"),
			Description: bilingual(
				"Immediate response to cases requiring site visits to conduct field inspections and accurately document facts and damages.",
				"طلب معاينة قانونية ميدانية وتوثيق حادثة لأغراض الإثبات.",
			),
			AvailableTo:           []string{audienceDeptManagers},
			RequesterApprovalReqd: false,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      managerRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "Department Managers",
				"requester_approval_route": "BU CEO / Departments",
				"intake_mailbox":           "case-legal@othaim.com",
				"sla":                      sla(5, 10, 15, 20),
			},
		},
		{
			Code:        model.ServiceCodePowerOfAttorney,
			IntakeEmail: seedPtr("am@othaim.com"),
			RequestType: "power_of_attorney",
			Name:        bilingual("Issuing Power of Attorney and Delegations", "إصدار الوكالات والتفاويض"),
			Description: bilingual(
				"Preparing, drafting, reviewing, and issuing necessary Powers of Attorney (PoAs) and delegations to enable company representatives to exercise specific powers on its behalf, whether before government, judicial, or private entities.",
				"طلب إعداد وإصدار وكالة أو تفويض نيابة عن الشركة.",
			),
			AvailableTo:           []string{audienceDeptManagers},
			RequesterApprovalReqd: false,
			ProviderApprovalReqd:  true,
			Channel:               model.ServiceChannelBoth,
			EligibilityRules:      managerRule,
			Metadata: map[string]any{
				"prd_baseline":             "othaim-2026-07-14",
				"available_to_label":       "Department Managers",
				"requester_approval_route": "BU CEO / Departments",
				"intake_mailbox":           "am@othaim.com",
				"sla":                      sla(5, 10, 15, 20),
			},
		},
	}
}

// seedRequestApprovalPolicyTemplates returns the starter request-approval policy
// templates. Each Definition document conforms to the policy shape
// (dto.CreateRequestApprovalPolicyRequest) and is validated by the service when
// the template is created.
func seedRequestApprovalPolicyTemplates() []dto.CreateRequestApprovalPolicyTemplateRequest {
	requesterStage := string(model.RequestApprovalStageRequester)
	providerStage := string(model.RequestApprovalStageProvider)
	requestFormFields := []map[string]any{
		{"name": "request_summary", "type": "text", "label": "ملخص الطلب", "required": true},
		{"name": "business_justification", "type": "text", "label": "المبرر التشغيلي", "required": true},
	}

	return []dto.CreateRequestApprovalPolicyTemplateRequest{
		{
			Name:        "Single approver",
			Description: "بوابة اعتماد مبسّطة: يعتمد الطلب مستشار قانوني واحد. خيار افتراضي مناسب للطلبات منخفضة المخاطر.",
			Category:    "general",
			Definition: map[string]any{
				"name":        "اعتماد بمستشار واحد",
				"description": "اعتماد الطلبات منخفضة المخاطر من مستشار قانوني واحد.",
				"priority":    10,
				"stage":       requesterStage,
				"currency":    "SAR",
				"mode":        "parallel",
				"quorum":      "all",
				"approvers": []map[string]any{
					// F15: bound to a real 14-role-matrix slug that holds
					// lex:request:approve (auth.LegalAffairsRoleDefs) so the
					// instantiated policy is actually approvable.
					{"type": "role", "ref": "legal-director", "label": "مدير الإدارة القانونية"},
				},
				"form_fields": requestFormFields,
				"metadata":    map[string]any{"seeded": true, "starter_template": true},
			},
		},
		{
			Name:        "Two-stage requester to provider",
			Description: "بوابة اعتماد في مرحلة تقديم الخدمة تُوجَّه إلى المستشار القانوني ورئيس الإدارة عند وصول الطلب إلى الفريق القانوني.",
			Category:    "general",
			Definition: map[string]any{
				"name":        "اعتماد من مرحلتين: مقدم الطلب إلى مقدم الخدمة",
				"description": "اعتماد في مرحلة تقديم الخدمة من المستشار القانوني ورئيس الإدارة.",
				"priority":    20,
				"stage":       providerStage,
				"currency":    "SAR",
				"mode":        "parallel",
				"quorum":      "all",
				"approvers": []map[string]any{
					// F15: real 14-role-matrix slugs (auth.LegalAffairsRoleDefs), both
					// holding lex:request:approve — the former "legal-counsel" /
					// "department-head" refs resolved to no seeded role.
					{"type": "role", "ref": "legal-contracts-manager", "label": "مدير قسم العقود"},
					{"type": "role", "ref": "legal-director", "label": "مدير الإدارة القانونية"},
				},
				"form_fields": requestFormFields,
				"metadata":    map[string]any{"seeded": true, "starter_template": true},
			},
		},
		{
			Name:        "Finance n-of-m (3 of 5)",
			Description: "بوابة نصاب للطلبات عالية القيمة ضمن نطاق قيمي: يلزم اعتماد أي 3 من 5 من أصحاب صلاحيات الاعتماد (DoA).",
			Category:    "finance",
			Definition: map[string]any{
				"name":        "نصاب اعتماد (3 من 5)",
				"description": "اعتماد ثلاثة من خمسة من أصحاب صلاحيات الاعتماد للطلبات متوسطة القيمة.",
				"priority":    30,
				"stage":       requesterStage,
				"department":  "الشؤون المالية",
				"min_value":   100000.0,
				"max_value":   5000000.0,
				"currency":    "SAR",
				"mode":        "parallel",
				"quorum":      "n_of_m",
				"quorum_n":    3,
				"approvers": []map[string]any{
					// F15: the finance role slugs (finance-controller/manager,
					// treasury-lead, procurement-lead, cfo) exist in no seeder — a
					// Watheeq-only tenant has none of them. Mapped to five distinct
					// delegation-of-authority holders from the 14-role matrix, each
					// carrying lex:request:approve, so the n-of-m quorum can clear.
					{"type": "role", "ref": "legal-dept-manager", "label": "مدير الإدارة الطالبة"},
					{"type": "role", "ref": "legal-bu-ceo", "label": "الرئيس التنفيذي للقطاع"},
					{"type": "role", "ref": "legal-cases-manager", "label": "مدير قسم القضايا والتحقيقات"},
					{"type": "role", "ref": "legal-contracts-manager", "label": "مدير قسم العقود"},
					{"type": "role", "ref": "legal-director", "label": "مدير الإدارة القانونية"},
				},
				"form_fields": []map[string]any{
					{"name": "estimated_value", "type": "number", "label": "القيمة التقديرية (ريال سعودي)", "required": true},
					{"name": "budget_line", "type": "text", "label": "بند الميزانية", "required": true},
				},
				"metadata": map[string]any{"seeded": true, "starter_template": true},
			},
		},
		{
			Name:        "Sequential legal review",
			Description: "مراجعة تسلسلية في مرحلة تقديم الخدمة: يراجع المستشار القانوني أولاً ثم يعتمد المستشار العام.",
			Category:    "legal",
			Definition: map[string]any{
				"name":        "مراجعة قانونية تسلسلية",
				"description": "مراجعة مرتّبة من المستشار القانوني ثم المستشار العام.",
				"priority":    40,
				"stage":       providerStage,
				"currency":    "SAR",
				"mode":        "sequential",
				"quorum":      "all",
				"approvers": []map[string]any{
					// F15: real 14-role-matrix slugs — the former "legal-counsel" /
					// "general-counsel" refs matched no seeded role. First-tier review
					// then the Legal Director, both holding lex:request:approve.
					{"type": "role", "ref": "legal-contracts-supervisor", "label": "مشرف العقود"},
					{"type": "role", "ref": "legal-director", "label": "مدير الإدارة القانونية"},
				},
				"form_fields": requestFormFields,
				"metadata":    map[string]any{"seeded": true, "starter_template": true},
			},
		},
	}
}

func (seed seedDataset) ensureWorkflows(ctx context.Context, app *Application, contracts []*model.Contract, users []seedUser) error {
	if ok, err := seed.hasRows(ctx, app, "workflow_instances", false); err != nil {
		return err
	} else if ok {
		return nil
	}
	targetTitles := []string{
		"اتفاقية خدمات مدارة للاستخلاص الإلكتروني للأدلة",
		"تكليف استشاري تنظيمي - البيئة التجريبية للتقنية المالية",
		"مذكرة تفاهم مع العيادة القانونية التطوعية بكلية الأنظمة",
	}
	for idx, title := range targetTitles {
		contract := contractByTitle(contracts, title)
		if contract == nil {
			continue
		}
		if _, err := app.WorkflowService.StartContractReview(ctx, seed.tenantID, seed.systemUser, contract.ID, dto.ReviewContractRequest{
			ApproverUserID: &users[1].ID,
			ApproverRole:   ptrString("legal-manager"),
			SLAHours:       []int{24, 48, 72}[idx],
			Description:    "مسار اعتماد ضمن قائمة المراجعة القانونية لمحفظة العقود.",
			FormFields:     seed.approvalFormFields(),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) ensureMatters(ctx context.Context, app *Application, contracts []*model.Contract, users []seedUser) ([]model.Matter, error) {
	if ok, err := seed.hasRows(ctx, app, "legal_matters", true); err != nil {
		return nil, err
	} else if ok {
		matters, _, err := app.MatterService.List(ctx, seed.tenantID, model.MatterListFilters{Page: 1, PerPage: 100})
		return matters, err
	}
	return seed.seedMatters(ctx, app, contracts, users)
}

func (seed seedDataset) seedMatters(ctx context.Context, app *Application, contracts []*model.Contract, users []seedUser) ([]model.Matter, error) {
	type matterSpec struct {
		Number         string
		Title          string
		Description    string
		Type           model.MatterType
		Status         model.MatterStatus
		Priority       model.LegalPriority
		Owner          seedUser
		Requester      seedUser
		Department     string
		DueOffset      int
		Tags           []string
		ContractTitles []string
	}
	specs := []matterSpec{
		{"MAT-LEX-2026-001", "تحكيم البحر الأحمر للخدمات اللوجستية - مرحلة الأمر الوقتي", "استراتيجية التدابير المؤقتة وحفظ المستندات وإفادات الشهود والجدول الزمني للإيداع أمام هيئة التحكيم.", model.MatterTypeDispute, model.MatterStatusInReview, model.LegalPriorityCritical, users[1], users[3], "التقاضي", 112, []string{"arbitration", "injunction", "critical-client"}, []string{"خطاب تكليف قانوني - تحكيم البحر الأحمر للخدمات اللوجستية", "اتفاقية موردين رئيسية - استضافة الاستخلاص الإلكتروني للأدلة"}},
		{"MAT-LEX-2026-002", "المراجعة التنظيمية لمشاركة البيانات - مجموعة الخليج الصحية", "تقييم تنظيمي لمشاركة بيانات المرضى وضمانات معالجي البيانات وأدلة الاستضافة داخل المملكة.", model.MatterTypeRegulatory, model.MatterStatusOpen, model.LegalPriorityHigh, users[5], users[1], "الشؤون التنظيمية", 118, []string{"pdpl", "healthcare", "privacy"}, []string{"اتفاقية أتعاب استشارية - مجموعة الخليج الصحية", "تكليف استشاري تنظيمي - البيئة التجريبية للتقنية المالية"}},
		{"MAT-LEX-2026-003", "فحص تعارض المصالح والعناية الواجبة لاستحواذ القطاع الصحي", "إخلاء تعارض المصالح وضوابط اتفاقيات عدم الإفصاح للمتقدمين وتقييم أدوات الذكاء الاصطناعي القانونية وقيود غرفة الفحص.", model.MatterTypeContract, model.MatterStatusWaitingOnBusiness, model.LegalPriorityHigh, users[2], users[0], "الشؤون المؤسسية", 126, []string{"m-and-a", "conflicts", "diligence"}, []string{"اتفاقية عدم إفصاح متبادلة - استحواذ في القطاع الصحي", "اتفاقية عدم إفصاح لتقييم منتج - أدوات الذكاء الاصطناعي القانونية"}},
		{"MAT-LEX-2026-004", "نزاع اتفاقية مستوى الخدمة (SLA) لمورد إيداع المستندات القضائية", "مراجعة مطالبة محتملة والتعويضات بعد تأخر حزمة إيداع وتباين أزمنة استجابة مورد التوصيل.", model.MatterTypeDispute, model.MatterStatusOpen, model.LegalPriorityMedium, users[1], users[3], "دعم التقاضي", 140, []string{"claim", "court-filing", "sla"}, []string{"اتفاقية مورد - خدمات نقل وإيداع المستندات القضائية"}},
		{"MAT-LEX-2026-005", "استقطاب شريك أول وإجراءات انضمامه", "مشورة بشأن انتقال العملاء والقيود التعاقدية والسرية واعتمادات انضمام الشريك المستقطب.", model.MatterTypeEmployment, model.MatterStatusInReview, model.LegalPriorityMedium, users[0], users[3], "الموارد البشرية", 150, []string{"employment", "partner", "onboarding"}, []string{"عقد عمل - استقطاب شريك أول", "عقد عمل - مستشار قانوني إقليمي"}},
		{"MAT-LEX-2026-006", "مذكرة الخبير الشاهد في الأضرار الضريبية", "مذكرة استشارية مغلقة تؤكد النطاق ومعالجة السرية المهنية والافتراضات وسجلات الفوترة لخبير تقدير الأضرار.", model.MatterTypeAdvisory, model.MatterStatusClosed, model.LegalPriorityLow, users[6], users[1], "التقاضي", 92, []string{"expert-witness", "privilege", "closed"}, []string{"اتفاقية استشارات - خبير تقدير الأضرار الضريبية", "اتفاقية ترخيص برمجيات - إدارة الملفات القانونية"}},
	}

	matters := make([]model.Matter, 0, len(specs))
	for _, spec := range specs {
		dueDate := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, spec.DueOffset))
		contractIDs := make([]uuid.UUID, 0, len(spec.ContractTitles))
		for _, title := range spec.ContractTitles {
			if contract := contractByTitle(contracts, title); contract != nil {
				contractIDs = append(contractIDs, contract.ID)
			}
		}
		requesterName := spec.Requester.Name
		req := dto.CreateMatterRequest{
			MatterNumber:    ptrString(spec.Number),
			Title:           spec.Title,
			Description:     spec.Description,
			Type:            spec.Type,
			Status:          spec.Status,
			Priority:        spec.Priority,
			OwnerUserID:     spec.Owner.ID,
			OwnerName:       spec.Owner.Name,
			RequesterUserID: &spec.Requester.ID,
			RequesterName:   &requesterName,
			Department:      ptrString(spec.Department),
			DueDate:         &dueDate,
			Tags:            spec.Tags,
			Metadata:        map[string]any{"seeded": true, "owner_title": spec.Owner.Title},
			ContractIDs:     contractIDs,
		}
		matter, err := app.MatterService.Create(ctx, seed.tenantID, seed.systemUser, req)
		if err != nil {
			return nil, err
		}
		matters = append(matters, *matter)
	}
	return matters, nil
}

func (seed seedDataset) ensureObligations(ctx context.Context, app *Application, contracts []*model.Contract, matters []model.Matter, users []seedUser) error {
	if ok, err := seed.hasRows(ctx, app, "legal_obligations", true); err != nil {
		return err
	} else if ok {
		return nil
	}
	return seed.seedObligations(ctx, app, contracts, matters, users)
}

func (seed seedDataset) seedObligations(ctx context.Context, app *Application, contracts []*model.Contract, matters []model.Matter, users []seedUser) error {
	type obligationSpec struct {
		Title         string
		Description   string
		Type          model.ObligationType
		Status        model.ObligationStatus
		Priority      model.LegalPriority
		Owner         seedUser
		DueOffset     int
		ContractTitle string
		MatterNumber  string
		Tags          []string
	}
	specs := []obligationSpec{
		{"إصدار إشعار تجديد تكليف التحكيم", "تأكيد تمديد النطاق وإرسال الإشعار الرسمي قبل إغلاق نافذة تجديد تكليف تحكيم البحر الأحمر.", model.ObligationTypeRenewal, model.ObligationStatusOpen, model.LegalPriorityCritical, users[1], 110, "خطاب تكليف قانوني - تحكيم البحر الأحمر للخدمات اللوجستية", "MAT-LEX-2026-001", []string{"renewal", "arbitration"}},
		{"استكمال مراجعة نقل بيانات العملاء وفق نظام حماية البيانات الشخصية", "توثيق أساس النقل وموقع الاستضافة وضمانات معالج البيانات لبيانات ملف مجموعة الخليج الصحية.", model.ObligationTypeCompliance, model.ObligationStatusInProgress, model.LegalPriorityCritical, users[5], 116, "اتفاقية أتعاب استشارية - مجموعة الخليج الصحية", "MAT-LEX-2026-002", []string{"pdpl", "privacy"}},
		{"الحصول على شهادة التأمين السيبراني لمورد الاستخلاص الإلكتروني", "الحصول على أدلة سارية للتأمين السيبراني وتأمين التعويض المهني من مورد استضافة الأدلة.", model.ObligationTypeReporting, model.ObligationStatusOpen, model.LegalPriorityHigh, users[4], 121, "اتفاقية موردين رئيسية - استضافة الاستخلاص الإلكتروني للأدلة", "MAT-LEX-2026-001", []string{"insurance", "ediscovery"}},
		{"جدولة تمرين تدقيق سلسلة العهدة", "تنسيق طلب عينة أدلة يشمل تقارير SOC وسجلات الوصول وسجلات الجمع وقائمة المقاولين من الباطن.", model.ObligationTypeCompliance, model.ObligationStatusOpen, model.LegalPriorityHigh, users[6], 128, "اتفاقية موردين رئيسية - استضافة الاستخلاص الإلكتروني للأدلة", "MAT-LEX-2026-001", []string{"audit", "chain-of-custody"}},
		{"اعتماد تسعير تجديد منصة البحث القانوني", "تأكيد التسعير المعدل وعدد المقاعد وسقف الزيادة قبل التجديد التلقائي لمنصة البحث القانوني.", model.ObligationTypePayment, model.ObligationStatusBlocked, model.LegalPriorityHigh, users[4], 105, "اتفاقية ترخيص برمجيات - منصة البحث القانوني", "MAT-LEX-2026-003", []string{"pricing", "blocked"}},
		{"إيداع إشعار حادثة مورد التوصيل", "حفظ إشعار المطالبة والجدول الزمني المؤيد لواقعة تأخر إيداع المستندات القضائية محل النزاع.", model.ObligationTypeNotice, model.ObligationStatusInProgress, model.LegalPriorityMedium, users[1], 119, "اتفاقية مورد - خدمات نقل وإيداع المستندات القضائية", "MAT-LEX-2026-004", []string{"claim", "notice"}},
		{"تحديث مذكرة القيود التعاقدية للشريك المستقطب", "تحديث مذكرة المشورة بشأن قابلية الإنفاذ وانتقال العملاء والمسوغ التجاري لقيود الشريك.", model.ObligationTypeContractual, model.ObligationStatusOpen, model.LegalPriorityMedium, users[0], 136, "عقد عمل - استقطاب شريك أول", "MAT-LEX-2026-005", []string{"employment", "memo"}},
		{"تأكيد مواءمة حفظ سجلات فوترة العملاء", "التحقق من سجلات إدارة الملفات القانونية والسجلات المالية مقابل متطلبات الفوترة الإلكترونية لهيئة الزكاة والضريبة والجمارك.", model.ObligationTypeRegulatory, model.ObligationStatusCompleted, model.LegalPriorityLow, users[6], 98, "اتفاقية ترخيص برمجيات - إدارة الملفات القانونية", "MAT-LEX-2026-006", []string{"zatca", "completed"}},
		{"مراجعة تعويضات مستوى الخدمة لمنصة البحث القانوني", "فحص تقرير الدعم الشهري واحتساب أي تعويضات عن تجاوز أهداف الاستجابة.", model.ObligationTypeReporting, model.ObligationStatusOpen, model.LegalPriorityMedium, users[5], 132, "اتفاقية ترخيص برمجيات - منصة البحث القانوني", "", []string{"sla", "research"}},
		{"تأكيد شهادة إتلاف مواد اتفاقية عدم الإفصاح للاستحواذ الصحي", "طلب شهادة إتلاف لمواد الفحص النافي للجهالة الخاصة بالاستحواذ الصحي.", model.ObligationTypeDelivery, model.ObligationStatusOpen, model.LegalPriorityLow, users[1], 144, "اتفاقية عدم إفصاح متبادلة - استحواذ في القطاع الصحي", "", []string{"nda", "destruction"}},
		{"التحقق من خطة الخروج لاستضافة الأدلة", "تأكيد جهات اتصال المساندة عند الخروج ونافذة الترحيل وصيغة شهادة حذف الأدلة.", model.ObligationTypeCovenant, model.ObligationStatusInProgress, model.LegalPriorityHigh, users[4], 152, "اتفاقية موردين رئيسية - استضافة الاستخلاص الإلكتروني للأدلة", "MAT-LEX-2026-001", []string{"exit", "ediscovery"}},
		{"إعداد مذكرة حدود صلاحيات لجنة الشركاء", "إعداد مذكرة الصلاحيات المحجوزة للملفات والالتزامات التي تتجاوز حد صلاحيات لجنة الشركاء.", model.ObligationTypeConditionPrecedent, model.ObligationStatusOpen, model.LegalPriorityMedium, users[2], 160, "خطاب تكليف قانوني - تحكيم البحر الأحمر للخدمات اللوجستية", "", []string{"committee", "approval"}},
	}

	for _, spec := range specs {
		var contractID *uuid.UUID
		if contract := contractByTitle(contracts, spec.ContractTitle); contract != nil {
			contractID = &contract.ID
		}
		var matterID *uuid.UUID
		if matter := matterByNumber(matters, spec.MatterNumber); matter != nil {
			matterID = &matter.ID
		}
		if contractID == nil && matterID == nil {
			continue
		}
		dueDate := normalizeSeedDate(seed.referenceAt.AddDate(0, 0, spec.DueOffset))
		if _, err := app.ObligationService.Create(ctx, seed.tenantID, seed.systemUser, dto.CreateObligationRequest{
			Title:              spec.Title,
			Description:        spec.Description,
			Type:               spec.Type,
			Status:             spec.Status,
			Priority:           spec.Priority,
			ContractID:         contractID,
			MatterID:           matterID,
			OwnerUserID:        spec.Owner.ID,
			OwnerName:          spec.Owner.Name,
			DueDate:            dueDate,
			ReminderEnabled:    true,
			ReminderLeadDays:   []int{30, 7, 1},
			EscalationEnabled:  spec.Priority == model.LegalPriorityCritical || spec.Priority == model.LegalPriorityHigh,
			EscalationLeadDays: []int{7, 1},
			EscalationTarget:   ptrString("legal-ops@apexlegal.example"),
			Tags:               spec.Tags,
			Metadata:           map[string]any{"seeded": true, "owner_title": spec.Owner.Title},
		}); err != nil {
			return err
		}
	}
	return nil
}

func (seed seedDataset) ensureSignatures(ctx context.Context, app *Application, contracts []*model.Contract, documents []model.LegalDocument, users []seedUser) error {
	return seed.seedSignatures(ctx, app, contracts, documents, users)
}

func (seed seedDataset) seedSignatures(ctx context.Context, app *Application, contracts []*model.Contract, documents []model.LegalDocument, users []seedUser) error {
	policyDoc := documentByTitle(documents, "قالب خطاب التكليف القانوني 2026")
	resolutionDoc := documentByTitle(documents, "قرار لجنة الشركاء - حفظ المستندات")
	ndaDoc := documentByTitle(documents, "قالب اتفاقية عدم الإفصاح المتبادلة 2026")
	arbitrationContract := contractByTitle(contracts, "خطاب تكليف قانوني - تحكيم البحر الأحمر للخدمات اللوجستية")
	researchContract := contractByTitle(contracts, "اتفاقية ترخيص برمجيات - منصة البحث القانوني")

	envelopes := []struct {
		req    dto.CreateSignatureEnvelopeRequest
		action string
	}{
		{seed.signatureEnvelopeForDocument(policyDoc, "اعتماد قالب - خطاب التكليف القانوني", users[1], users[2]), "signed"},
		{seed.signatureEnvelopeForDocument(resolutionDoc, "توقيع قرار لجنة الشركاء", users[2], users[3]), "sent"},
		{seed.signatureEnvelopeForDocument(ndaDoc, "التأكيد السنوي لقالب اتفاقية عدم الإفصاح", users[1], users[0]), "cancelled"},
		{seed.signatureEnvelopeForContract(arbitrationContract, "حزمة توقيع تكليف تحكيم البحر الأحمر", users[1], users[3]), "draft"},
		{seed.signatureEnvelopeForContract(researchContract, "مظروف توقيع تجديد منصة البحث القانوني", users[1], users[4]), "draft"},
	}

	for _, spec := range envelopes {
		if spec.req.ContractID == nil && spec.req.DocumentID == nil {
			continue
		}
		exists, err := seed.signatureEnvelopeExists(ctx, app, spec.req.Title)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		envelope, err := app.SignatureService.Create(ctx, seed.tenantID, seed.systemUser, spec.req)
		if err != nil {
			return err
		}
		switch spec.action {
		case "sent":
			if _, err := app.SignatureService.Send(ctx, seed.tenantID, seed.systemUser, envelope.ID, dto.SendSignatureEnvelopeRequest{
				EvidenceMetadata: map[string]any{"seeded": true, "dispatch_reason": "portfolio sent envelope"},
			}); err != nil {
				return err
			}
		case "signed":
			sent, err := app.SignatureService.Send(ctx, seed.tenantID, seed.systemUser, envelope.ID, dto.SendSignatureEnvelopeRequest{
				EvidenceMetadata: map[string]any{"seeded": true, "dispatch_reason": "portfolio completed envelope"},
			})
			if err != nil {
				return err
			}
			for _, recipient := range sent.Recipients {
				if recipient.Role == model.SignatureRecipientCarbonCopy {
					continue
				}
				if _, err := app.SignatureService.RecipientAction(ctx, seed.tenantID, seed.systemUser, sent.ID, recipient.ID, dto.SignatureRecipientActionRequest{
					Action:           dto.SignatureRecipientActionSign,
					ActorName:        ptrString(recipient.Name),
					ActorEmail:       recipient.Email,
					EvidenceHash:     ptrString(contentHash(sent.ID.String() + recipient.ID.String())),
					EvidenceMetadata: map[string]any{"seeded": true, "signature_method": "deterministic"},
				}, ptrString("127.0.0.1"), ptrString("clario360-legal-seed")); err != nil {
					return err
				}
			}
			if _, err := app.SignatureService.RecordCustody(ctx, seed.tenantID, seed.systemUser, sent.ID, dto.RecordSignatureCustodyRequest{
				FileID:            "seed-signed-" + sent.ID.String(),
				FileName:          slugify(sent.Title) + "-signed.pdf",
				FileSizeBytes:     248000,
				ContentHash:       contentHash(sent.ID.String() + ":signed-file"),
				EvidenceHash:      ptrString("sha256:" + contentHash(sent.ID.String()+":custody-evidence")),
				Provider:          model.SignatureProviderNative,
				RetentionMetadata: map[string]any{"retention_class": "legal_record", "seeded": true},
				CustodyMetadata:   map[string]any{"source": "deterministic_signature_seed"},
			}, ptrString("127.0.0.1"), ptrString("clario360-legal-seed")); err != nil {
				return err
			}
		case "cancelled":
			if _, err := app.SignatureService.Cancel(ctx, seed.tenantID, seed.systemUser, envelope.ID, dto.CancelSignatureEnvelopeRequest{
				Reason:           "استُبدل ضمن التحديث السنوي للقالب.",
				EvidenceMetadata: map[string]any{"seeded": true},
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (seed seedDataset) signatureEnvelopeExists(ctx context.Context, app *Application, title string) (bool, error) {
	var exists bool
	if err := app.Store.DB().QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM signature_envelopes
			WHERE tenant_id = $1 AND title = $2 AND deleted_at IS NULL
		)`, seed.tenantID, title).Scan(&exists); err != nil {
		return false, fmt.Errorf("check seeded signature envelope %q: %w", title, err)
	}
	return exists, nil
}

func (seed seedDataset) signatureEnvelopeForDocument(document *model.LegalDocument, title string, owner, signer seedUser) dto.CreateSignatureEnvelopeRequest {
	var documentID *uuid.UUID
	if document != nil {
		documentID = &document.ID
	}
	return seed.signatureEnvelope(title, nil, documentID, owner, signer)
}

func (seed seedDataset) signatureEnvelopeForContract(contract *model.Contract, title string, owner, signer seedUser) dto.CreateSignatureEnvelopeRequest {
	var contractID *uuid.UUID
	if contract != nil {
		contractID = &contract.ID
	}
	return seed.signatureEnvelope(title, contractID, nil, owner, signer)
}

func (seed seedDataset) signatureEnvelope(title string, contractID, documentID *uuid.UUID, owner, signer seedUser) dto.CreateSignatureEnvelopeRequest {
	dueAt := seed.referenceAt.AddDate(0, 3, 24)
	expiresAt := dueAt.AddDate(0, 0, 14)
	return dto.CreateSignatureEnvelopeRequest{
		ContractID:       contractID,
		DocumentID:       documentID,
		Title:            title,
		Subject:          title,
		Message:          "Please review and complete the legal department's signature request.",
		Language:         model.SignatureLanguageBilingual,
		SubjectAr:        title,
		MessageAr:        "يرجى مراجعة طلب التوقيع الوارد من الإدارة القانونية واستكماله عبر المنصة.",
		LegalConsentEn:   model.DefaultSignatureConsentEN,
		LegalConsentAr:   model.DefaultSignatureConsentAR,
		Provider:         model.SignatureProviderNative,
		Method:           model.SignatureMethodOTP,
		DueAt:            &dueAt,
		ExpiresAt:        &expiresAt,
		EvidenceMetadata: map[string]any{"seeded": true, "owner": owner.Name},
		Recipients: []dto.CreateSignatureRecipientRequest{
			{
				Name:             signer.Name,
				Email:            ptrString(strings.ToLower(strings.ReplaceAll(signer.Name, " ", ".")) + "@apexlegal.example"),
				Role:             model.SignatureRecipientSigner,
				SigningOrder:     1,
				Language:         ptrSignatureLanguage(model.SignatureLanguageBilingual),
				EvidenceMetadata: map[string]any{"seeded": true, "title": signer.Title},
			},
			{
				Name:             owner.Name,
				Email:            ptrString(strings.ToLower(strings.ReplaceAll(owner.Name, " ", ".")) + "@apexlegal.example"),
				Role:             model.SignatureRecipientCarbonCopy,
				SigningOrder:     2,
				Language:         ptrSignatureLanguage(model.SignatureLanguageEN),
				EvidenceMetadata: map[string]any{"seeded": true, "title": owner.Title},
			},
		},
	}
}

func buildSeedClauses(contract *model.Contract, spec seedContractSpec, index int, blueprints []seedClauseBlueprint, recommendations *analyzer.RecommendationEngine) ([]model.ExtractedClause, string) {
	textParts := []string{
		fmt.Sprintf("This agreement is entered into between %s and %s effective as of %s.", contract.PartyAName, contract.PartyBName, contract.EffectiveDate.UTC().Format("January 2, 2006")),
		fmt.Sprintf("Party A: %s", contract.PartyAName),
		fmt.Sprintf("Party B: %s", contract.PartyBName),
		fmt.Sprintf("The total value of %s %.2f applies under this contract.", contract.Currency, *contract.TotalValue),
		fmt.Sprintf("Expiry date is %s.", contract.ExpiryDate.UTC().Format("January 2, 2006")),
	}
	if contract.RenewalDate != nil {
		textParts = append(textParts, fmt.Sprintf("Renewal date is %s.", contract.RenewalDate.UTC().Format("January 2, 2006")))
	}
	if spec.ContainsPII {
		textParts = append(textParts, "The parties may process personal data, client-file identifiers, and matter records while performing the services.")
	}

	slotStart := index * 3
	clauses := make([]model.ExtractedClause, 0, 3)
	for sectionIndex := 0; sectionIndex < 3; sectionIndex++ {
		blueprint := blueprints[(slotStart+sectionIndex)%len(blueprints)]
		riskLevel, keywords := seedClauseRiskProfile(blueprint, slotStart+sectionIndex)
		content := renderSeedClauseContent(blueprint, riskLevel, keywords)
		sectionReference := fmt.Sprintf("القسم %d", sectionIndex+1)
		recs := recommendations.Recommend(blueprint.ClauseType, riskLevel, keywords, content)
		clauses = append(clauses, model.ExtractedClause{
			ClauseType:           blueprint.ClauseType,
			PrimaryType:          blueprint.ClauseType,
			MatchedTypes:         []model.ClauseType{blueprint.ClauseType},
			Title:                blueprint.Title,
			Content:              content,
			SectionReference:     sectionReference,
			PageNumber:           1,
			RiskLevel:            riskLevel,
			RiskScore:            riskLevel.Score(),
			RiskKeywords:         keywords,
			AnalysisSummary:      fmt.Sprintf("يتناول %s بند %s وصُنّف ضمن مستوى مخاطر %s.", sectionReference, arabicClauseTypeName(blueprint.ClauseType), arabicRiskLevel(riskLevel)),
			Recommendations:      recs,
			ComplianceFlags:      seedClauseComplianceFlags(blueprint.ClauseType, keywords, content),
			ExtractionConfidence: seedConfidence(riskLevel),
			PatternHits:          1,
			FirstMatchOffset:     sectionIndex * 80,
		})
		textParts = append(textParts, fmt.Sprintf("%s %s\n%s", sectionReference, blueprint.Title, content))
	}
	return clauses, strings.Join(textParts, "\n\n")
}

func buildSeedFindings(clauses []model.ExtractedClause, missing []model.ClauseType, complianceFlags []model.ComplianceFlag) []model.RiskFinding {
	findings := make([]model.RiskFinding, 0, len(clauses)+len(missing)+len(complianceFlags))
	for _, clause := range clauses {
		if clause.RiskLevel == model.RiskLevelNone {
			continue
		}
		clauseType := clause.ClauseType
		ref := clause.SectionReference
		findings = append(findings, model.RiskFinding{
			Title:           fmt.Sprintf("بند %s يتطلب المراجعة", arabicClauseTypeName(clause.ClauseType)),
			Description:     clause.AnalysisSummary,
			Severity:        clause.RiskLevel,
			ClauseReference: &ref,
			Recommendation:  strings.Join(clause.Recommendations, " "),
			ClauseType:      &clauseType,
		})
	}
	for _, clauseType := range missing {
		missingType := clauseType
		findings = append(findings, model.RiskFinding{
			Title:          fmt.Sprintf("غياب بند %s", arabicClauseTypeName(clauseType)),
			Description:    "البند المعياري المطلوب غير مدرج في نص العقد.",
			Severity:       model.RiskLevelHigh,
			Recommendation: "أضِف البند المفقود قبل الاعتماد.",
			ClauseType:     &missingType,
		})
	}
	for _, flag := range complianceFlags {
		findings = append(findings, model.RiskFinding{
			Title:           flag.Title,
			Description:     flag.Description,
			Severity:        flag.Severity,
			ClauseReference: flag.ClauseReference,
			Recommendation:  flag.Description,
		})
	}
	sort.SliceStable(findings, func(i, j int) bool {
		if findings[i].Severity.Weight() != findings[j].Severity.Weight() {
			return findings[i].Severity.Weight() > findings[j].Severity.Weight()
		}
		return findings[i].Title < findings[j].Title
	})
	return findings
}

func collectSeedRecommendations(clauses []model.ExtractedClause, missing []model.ClauseType, complianceFlags []model.ComplianceFlag) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(clauses)+len(missing)+len(complianceFlags))
	appendUnique := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	for _, clause := range clauses {
		appendUnique(clause.Recommendations...)
	}
	for _, clauseType := range missing {
		appendUnique("Insert a standard " + blueprintTitle(clauseType) + " clause before approval.")
	}
	for _, flag := range complianceFlags {
		appendUnique(flag.Description)
	}
	sort.Strings(out)
	return out
}

func seedUsersForTenant(tenantID uuid.UUID) []seedUser {
	if tenantID == apexLegalTenantID {
		return []seedUser{
			{apexLegalAdminUserID, "Ada Okafor", "الشريك المدير"},
			{apexLegalLeadUserID, "Lara Bamidele", "رئيس التقاضي"},
			{apexLegalBoardUserID, "Tade Akinola", "شريك المخاطر وتعارض المصالح"},
			{apexLegalOpsUserID, "Chika Nwachukwu", "الرئيس التنفيذي للعمليات"},
			{apexLegalTechUserID, "Musa Adebayo", "مدير التقنية القانونية"},
			{apexLegalDataUserID, "Ifeoma Nwosu", "مستشار حماية البيانات"},
			{apexLegalRiskUserID, "Emeka Daniels", "مدير الامتثال"},
		}
	}
	return []seedUser{
		{mustUUID("22222222-2222-2222-2222-222222222301"), "Aisha Rahman", "مدير الإدارة القانونية للمجموعة"},
		{mustUUID("22222222-2222-2222-2222-222222222302"), "Omar Haddad", "مستشار قانوني أول"},
		{mustUUID("22222222-2222-2222-2222-222222222303"), "Leila Faris", "مدير المشتريات"},
		{mustUUID("22222222-2222-2222-2222-222222222304"), "Noura Saleh", "مدير الموارد البشرية"},
		{mustUUID("22222222-2222-2222-2222-222222222305"), "Tariq Malik", "مدير تقنية المعلومات"},
		{mustUUID("22222222-2222-2222-2222-222222222306"), "Rana Kassem", "المراقب المالي"},
		{mustUUID("22222222-2222-2222-2222-222222222307"), "Yusuf Mansour", "مدير الامتثال"},
	}
}

func (seed seedDataset) partyAName() string {
	if seed.tenantID == apexLegalTenantID {
		return "شركة عبدالله العثيم للاستثمار"
	}
	return "Clario Holdings Limited"
}

func (seed seedDataset) hasRows(ctx context.Context, app *Application, table string, withDeletedAt bool) (bool, error) {
	where := "tenant_id = $1"
	if withDeletedAt {
		where += " AND deleted_at IS NULL"
	}
	var count int
	if err := app.Store.DB().QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s", table, where), seed.tenantID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func seedContractSpecs(users []seedUser) []seedContractSpec {
	return []seedContractSpec{
		{"خطاب تكليف قانوني - تحكيم البحر الأحمر للخدمات اللوجستية", model.ContractTypeServiceAgreement, "تكليف قانوني بإجراءات الأمر الوقتي ومذكرات التحكيم وحفظ الأدلة.", "شركة البحر الأحمر للخدمات اللوجستية", "شركة البحر الأحمر للخدمات اللوجستية (مساهمة مقفلة)", "gc@redsealogistics.example", "التقاضي", []string{"client-engagement", "arbitration", "injunction"}, 2400000, "SAR", "monthly", -180, 20, 30, false, model.ContractStatusActive, users[1], users[0], true},
		{"اتفاقية أتعاب استشارية - مجموعة الخليج الصحية", model.ContractTypeServiceAgreement, "اتفاقية أتعاب دائمة للاستشارات المؤسسية والتنظيمية لمجموعة رعاية صحية إقليمية.", "مجموعة الخليج الصحية", "شركة مجموعة الخليج الصحية المحدودة", "legal@gulfhealth.example", "الشؤون المؤسسية", []string{"retainer", "healthcare", "regulatory"}, 850000, "SAR", "monthly", -300, 95, 30, false, model.ContractStatusActive, users[0], users[5], true},
		{"اتفاقية خدمات مدارة للاستخلاص الإلكتروني للأدلة", model.ContractTypeServiceAgreement, "منصة مراجعة مدارة وجمع أدلة جنائية رقمية واستضافة ودعم إنتاج المستندات لملفات التقاضي.", "شركة الجزيرة للأدلة الرقمية", "شركة الجزيرة للأدلة الرقمية المحدودة", "contracts@forensicdiscovery.example", "دعم التقاضي", []string{"ediscovery", "forensics", "hosting"}, 1420000, "SAR", "milestone", -10, 120, 30, false, model.ContractStatusInternalReview, users[4], users[1], true},
		{"تكليف استشاري تنظيمي - البيئة التجريبية للتقنية المالية", model.ContractTypeServiceAgreement, "تكليف استشاري متخصص في الترخيص ونظام حماية البيانات الشخصية وحوكمة الذكاء الاصطناعي ضمن طلب البيئة التجريبية للتقنية المالية.", "شركة نجد باي للتقنية", "شركة نجد باي للتقنية المالية", "founders@najdpay.example", "الشؤون التنظيمية", []string{"fintech", "pdpl", "ai-governance"}, 1300000, "SAR", "milestone", -30, 220, 30, false, model.ContractStatusNegotiation, users[5], users[0], true},
		{"اتفاقية محاماة مشتركة سابقة مع مكتب خارجي", model.ContractTypeServiceAgreement, "اتفاقية محاماة مشتركة منتهية محفوظة للسوابق والسرية المهنية ومراجعة الأتعاب.", "مكتب منصور وشركاه للمحاماة", "مكتب منصور وشركاه للمحاماة والاستشارات القانونية", "managing.partner@mansouradvocates.example", "المنازعات", []string{"co-counsel", "legacy", "privilege"}, 610000, "SAR", "net_30", -400, -15, 30, false, model.ContractStatusExpired, users[1], users[0], false},
		{"اتفاقية عدم إفصاح متبادلة - استحواذ في القطاع الصحي", model.ContractTypeNDA, "ترتيبات سرية متبادلة لأغراض الفحص النافي للجهالة في استحواذ يشمل أصولاً صحية.", "شركة بلسم الطبية القابضة", "شركة بلسم الطبية القابضة", "dealteam@balsammedical.example", "الشؤون المؤسسية", []string{"nda", "m-and-a", "healthcare"}, 25000, "SAR", "n/a", -60, 15, 30, false, model.ContractStatusActive, users[2], users[0], true},
		{"اتفاقية عدم إفصاح للمستثمرين - تسهيلات تمويل التقاضي", model.ContractTypeNDA, "اتفاقية سرية لتقييم شروط تمويل التقاضي وملخصات القضايا المشمولة بالسرية المهنية.", "سيدار كابيتال", "شركاء سيدار كابيتال", "dealteam@cedar.example", "التقاضي", []string{"nda", "litigation-funding"}, 15000, "SAR", "n/a", -90, 180, 30, false, model.ContractStatusActive, users[1], users[0], false},
		{"اتفاقية عدم إفصاح لتقييم منتج - أدوات الذكاء الاصطناعي القانونية", model.ContractTypeNDA, "اتفاقية عدم إفصاح لتقييم أدوات الصياغة المدعومة بالذكاء الاصطناعي وتحليل البنود.", "هيليكس لابس", "شركة هيليكس لابس", "contracts@helix.example", "التقنية القانونية", []string{"nda", "legal-ai", "evaluation"}, 12000, "SAR", "n/a", -45, 210, 30, false, model.ContractStatusActive, users[4], users[5], true},
		{"اتفاقية عدم إفصاح مؤرشفة - محفظة عقود إيجار التجزئة", model.ContractTypeNDA, "اتفاقية سرية سابقة محفوظة لعملية فحص مغلقة لمحفظة عقود إيجار.", "شركة أطلس للتجزئة", "مجموعة أطلس للتجزئة", "legal@atlas.example", "العقارات", []string{"nda", "archive", "lease"}, 18000, "SAR", "n/a", -500, -60, 30, false, model.ContractStatusExpired, users[0], users[1], false},
		{"عقد عمل - استقطاب شريك أول", model.ContractTypeEmployment, "شروط استقطاب شريك أول تشمل انتقال العملاء والسرية والقيود التعاقدية.", "د. ليث حمدان", "ليث حمدان", "layth.hamdan@example", "الموارد البشرية", []string{"employment", "partner", "lateral"}, 1100000, "SAR", "monthly", -300, 400, 30, false, model.ContractStatusActive, users[3], users[0], false},
		{"عقد عمل - مستشار قانوني إقليمي", model.ContractTypeEmployment, "شروط توظيف مستشار قانوني إقليمي والتزامات السرية.", "مايا قريشي", "مايا قريشي", "maya.qureshi@example", "الموارد البشرية", []string{"employment", "legal-counsel"}, 900000, "SAR", "monthly", -240, 30, 30, false, model.ContractStatusActive, users[3], users[0], false},
		{"عقد عمل - مدير دعم التقاضي", model.ContractTypeEmployment, "عقد قيادة دعم التقاضي يغطي مسارات الأدلة والسرية وضمانات بيانات العملاء.", "كريم نجار", "كريم نجار", "karim.najjar@example", "الموارد البشرية", []string{"employment", "litigation-support"}, 700000, "SAR", "monthly", -120, 600, 30, false, model.ContractStatusActive, users[3], users[0], false},
		{"اتفاقية موردين رئيسية - استضافة الاستخلاص الإلكتروني للأدلة", model.ContractTypeVendor, "اتفاقية المورد الرئيسية لمساحات المراجعة المستضافة والنسخ الاحتياطية وإنتاج المستندات وسجلات سلسلة العهدة.", "شركة المرفأ الأزرق للأدلة الرقمية", "شركة المرفأ الأزرق للأدلة الرقمية", "contracts@blueharbordiscovery.example", "دعم التقاضي", []string{"vendor", "ediscovery", "hosting"}, 3800000, "SAR", "net_30", -330, 10, 20, true, model.ContractStatusActive, users[4], users[1], true},
		{"اتفاقية مورد - خدمات نقل وإيداع المستندات القضائية", model.ContractTypeVendor, "خدمات إيداع المستندات القضائية وتجهيز ملفات الجلسات والتوصيل في اليوم نفسه لفرق التقاضي.", "شركة الهلال لخدمات التوصيل القانوني", "شركة الهلال لخدمات التوصيل القانوني", "legal@crescentcouriers.example", "دعم التقاضي", []string{"vendor", "court-filing", "courier"}, 540000, "SAR", "net_45", -150, 25, 30, false, model.ContractStatusActive, users[1], users[2], false},
		{"اتفاقية مورد سابقة - خدمات الترجمة القانونية", model.ContractTypeVendor, "اتفاقية سابقة لخدمات الترجمة القانونية والتوثيق محفوظة لمتابعة الإغلاق.", "الشركة الأولى للترجمة القانونية", "الشركة الأولى لخدمات الترجمة القانونية", "support@primelegaltranslation.example", "التشغيل", []string{"vendor", "translation", "legacy"}, 110000, "SAR", "net_30", -540, 60, 30, false, model.ContractStatusTerminated, users[3], users[1], false},
		{"اتفاقية ترخيص برمجيات - إدارة الملفات القانونية", model.ContractTypeLicense, "ترخيص برمجيات لإدارة الملفات القانونية والمواعيد وتعارض المصالح ومسارات الفوترة.", "نورثقيت للأنظمة القانونية", "شركة نورثقيت للأنظمة القانونية المحدودة", "licensing@northgatelegal.example", "التقنية القانونية", []string{"license", "matter-management"}, 4600000, "SAR", "annual", -270, 200, 45, false, model.ContractStatusActive, users[4], users[0], true},
		{"اتفاقية ترخيص برمجيات - منصة البحث القانوني", model.ContractTypeLicense, "ترخيص ودعم منصة البحث القانوني والبحث في السوابق والتنبيهات التنظيمية.", "سنتينل للأبحاث القانونية", "شركة سنتينل للأبحاث القانونية", "contracts@sentinelresearch.example", "إدارة المعرفة", []string{"license", "legal-research"}, 2200000, "SAR", "annual", -120, 25, 45, true, model.ContractStatusActive, users[4], users[0], false},
		{"مذكرة تفاهم مع مركز الرياض للتحكيم التجاري", model.ContractTypeMOU, "مذكرة تفاهم للتدريب واستخدام قاعات الجلسات وبرامج مجتمع التحكيم.", "مركز الرياض للتحكيم التجاري", "مركز الرياض للتحكيم التجاري", "office@riyadharbitration.example", "المنازعات", []string{"mou", "arbitration", "training"}, 75000, "SAR", "n/a", -40, 5, 30, false, model.ContractStatusActive, users[0], users[1], false},
		{"مذكرة تفاهم مع العيادة القانونية التطوعية بكلية الأنظمة", model.ContractTypeMOU, "مسودة مذكرة تفاهم للعيادات القانونية التطوعية المشرَف عليها وتدريب الطلاب والتثقيف القانوني المجتمعي.", "كلية الأنظمة بجامعة الملك سلمان", "كلية الأنظمة بجامعة الملك سلمان", "clinic@kslawfaculty.example", "العمل القانوني التطوعي", []string{"mou", "pro-bono", "clinic"}, 55000, "SAR", "n/a", 5, 365, 30, false, model.ContractStatusDraft, users[0], users[1], false},
		{"اتفاقية استشارات - خبير تقدير الأضرار الضريبية", model.ContractTypeConsulting, "تكليف استشاري لخبير شاهد في نمذجة الأضرار الضريبية ضمن تحكيم تجاري.", "شركة القمة لاستشارات التقييم", "شركة القمة لاستشارات التقييم المهنية", "engagements@apexvaluation.example", "التقاضي", []string{"consulting", "expert-witness", "tax-damages"}, 380000, "SAR", "net_30", -45, 28, 25, true, model.ContractStatusActive, users[1], users[0], false},
	}
}

func seedClauseBlueprints() []seedClauseBlueprint {
	return []seedClauseBlueprint{
		{model.ClauseTypeIndemnification, "Indemnification", "The indemnification clause requires the supplier to indemnify the firm and its client where applicable.", "Liability is limited to direct third-party claims caused by breach.", []string{"unlimited", "uncapped", "sole expense", "first dollar", "all claims", "regardless of fault", "broadly defined losses"}},
		{model.ClauseTypeTermination, "Termination", "The termination clause describes when either party may terminate the agreement.", "Termination requires material breach, notice, and a cure period.", []string{"without cause", "immediate", "no notice", "at will", "unilateral", "no cure period", "automatic termination"}},
		{model.ClauseTypeLimitationOfLiability, "Limitation of Liability", "The limitation of liability clause caps aggregate liability.", "Aggregate liability is capped at fees paid in the prior contract year.", []string{"unlimited", "no cap", "no limitation", "excluding consequential", "excluding indirect", "waiver of liability"}},
		{model.ClauseTypeConfidentiality, "Confidentiality", "The confidentiality clause protects proprietary information.", "Confidential information may be used only to perform the agreement and must be returned on request.", []string{"perpetual", "no exceptions", "residual knowledge", "unrestricted use"}},
		{model.ClauseTypeIPOwnership, "IP Ownership", "The intellectual property clause allocates ownership of work product.", "Matter-specific work product created for the firm is assigned to the firm or client as instructed upon payment.", []string{"vendor retains", "shared ownership", "license back", "non-exclusive", "pre-existing IP", "joint ownership"}},
		{model.ClauseTypeNonCompete, "Non-Compete", "The non-compete clause restricts competitive activity.", "Restrictions apply only to directly competing services in agreed territories for a limited term.", []string{"worldwide", "perpetual", "all industries", "no geographic limit"}},
		{model.ClauseTypePaymentTerms, "Payment Terms", "The payment clause governs invoicing and fees.", "Invoices are payable within thirty days after receipt of an undisputed invoice.", []string{"net 90", "net 120", "upon completion only", "milestone-based only", "no penalty for late payment"}},
		{model.ClauseTypeWarranty, "Warranty", "The warranty clause provides service and compliance assurances.", "Each party warrants it has authority to enter the agreement and will perform services professionally.", []string{"as-is", "no warranty", "disclaims all", "implied warranties excluded"}},
		{model.ClauseTypeForceMajeure, "Force Majeure", "The force majeure clause addresses extraordinary events beyond control.", "Affected obligations are suspended only while the force majeure event continues.", []string{"pandemic excluded", "economic downturn excluded", "no termination right"}},
		{model.ClauseTypeDisputeResolution, "Dispute Resolution", "The dispute resolution clause describes escalation and arbitration.", "The parties will attempt executive escalation before commencing arbitration in Riyadh.", []string{"foreign jurisdiction", "binding arbitration only", "waive right to trial", "vendor's jurisdiction"}},
		{model.ClauseTypeDataProtection, "Data Protection", "The data protection clause governs processing of personal data.", "The processor must notify the firm of breaches, delete data on request, and limit transfers.", []string{"no breach notification", "unlimited processing", "no data deletion", "cross-border transfer unrestricted"}},
		{model.ClauseTypeGoverningLaw, "Governing Law", "The governing law clause states which laws apply.", "This agreement is governed by the laws of the Kingdom of Saudi Arabia.", []string{"foreign law", "vendor's jurisdiction", "new york", "england"}},
		{model.ClauseTypeAssignment, "Assignment", "The assignment clause controls transfers and novation.", "Neither party may assign the agreement without prior written consent except for internal reorganizations.", []string{"freely assignable", "no consent required", "to any affiliate"}},
		{model.ClauseTypeInsurance, "Insurance", "The insurance clause defines minimum coverage requirements.", "The supplier must maintain professional liability and cyber insurance with evidence on request.", []string{"no insurance requirement", "minimum not specified", "coverage not evidenced"}},
		{model.ClauseTypeAuditRights, "Audit Rights", "The audit rights clause grants inspection of records.", "The firm may audit relevant records annually on reasonable notice.", []string{"no audit right", "only with consent", "limited frequency"}},
		{model.ClauseTypeSLA, "Service Levels", "The service level clause sets uptime and response expectations.", "Service levels include uptime targets, response times, and service credits for failures.", []string{"best effort", "no penalty", "no credit", "commercially reasonable"}},
		{model.ClauseTypeAutoRenewal, "Auto Renewal", "The auto renewal clause describes renewal mechanics.", "Renewal requires prior written notice and preserves current commercial terms unless agreed otherwise.", []string{"without notice", "annual renewal", "opt-out only", "price increase on renewal"}},
		{model.ClauseTypeRepresentations, "Representations", "The representations clause captures statements and undertakings.", "Each party represents that its statements are accurate as of signing and during performance.", []string{"unilateral representations", "perpetual", "survive termination indefinitely"}},
		{model.ClauseTypeNonSolicitation, "Non-Solicitation", "The non-solicitation clause restricts poaching of personnel.", "Neither party may solicit the other party's named project staff during the term and for twelve months after.", []string{"perpetual", "worldwide", "all employees", "includes independent contractors"}},
	}
}

func seedStatusPath(target model.ContractStatus) []model.ContractStatus {
	switch target {
	case model.ContractStatusDraft:
		return nil
	case model.ContractStatusInternalReview:
		return []model.ContractStatus{model.ContractStatusInternalReview}
	case model.ContractStatusLegalReview:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview}
	case model.ContractStatusNegotiation:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview, model.ContractStatusNegotiation}
	case model.ContractStatusPendingSignature:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview, model.ContractStatusNegotiation, model.ContractStatusPendingSignature}
	case model.ContractStatusActive:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview, model.ContractStatusNegotiation, model.ContractStatusPendingSignature}
	case model.ContractStatusExpired:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview, model.ContractStatusNegotiation, model.ContractStatusPendingSignature}
	case model.ContractStatusTerminated:
		return []model.ContractStatus{model.ContractStatusInternalReview, model.ContractStatusLegalReview, model.ContractStatusNegotiation, model.ContractStatusPendingSignature}
	default:
		return nil
	}
}

func seedClauseRiskProfile(blueprint seedClauseBlueprint, slot int) (model.RiskLevel, []string) {
	switch {
	case slot < 8:
		keywords := append([]string(nil), blueprint.RiskKeywords...)
		if len(keywords) > 5 {
			keywords = keywords[:5]
		}
		if blueprint.ClauseType == model.ClauseTypeLimitationOfLiability && len(keywords) > 0 {
			return model.RiskLevelCritical, keywords
		}
		return model.RiskLevelHigh, keywords
	case slot < 23:
		return model.RiskLevelMedium, firstKeywords(blueprint.RiskKeywords, 3)
	case slot < 40:
		return model.RiskLevelLow, firstKeywords(blueprint.RiskKeywords, 1)
	default:
		return model.RiskLevelNone, nil
	}
}

func renderSeedClauseContent(blueprint seedClauseBlueprint, riskLevel model.RiskLevel, keywords []string) string {
	if len(keywords) == 0 {
		return blueprint.Trigger + " " + blueprint.SafeBody
	}
	return fmt.Sprintf("%s %s Risk considerations include %s.", blueprint.Trigger, blueprint.SafeBody, strings.Join(keywords, ", "))
}

func seedClauseComplianceFlags(clauseType model.ClauseType, keywords []string, content string) []string {
	lower := strings.ToLower(strings.Join(keywords, " ")) + " " + strings.ToLower(content)
	flags := []string{}
	if clauseType == model.ClauseTypeDataProtection && strings.Contains(lower, "cross-border transfer unrestricted") {
		flags = append(flags, "cross_border_transfer_unrestricted")
	}
	if clauseType == model.ClauseTypeGoverningLaw && strings.Contains(lower, "foreign law") {
		flags = append(flags, "foreign_governing_law")
	}
	if clauseType == model.ClauseTypeAutoRenewal && strings.Contains(lower, "price increase on renewal") {
		flags = append(flags, "auto_renewal_notice")
	}
	return flags
}

func seedConfidence(level model.RiskLevel) float64 {
	switch level {
	case model.RiskLevelCritical, model.RiskLevelHigh:
		return 0.95
	case model.RiskLevelMedium:
		return 0.85
	case model.RiskLevelLow:
		return 0.70
	default:
		return 0.70
	}
}

func firstKeywords(values []string, limit int) []string {
	if len(values) == 0 || limit <= 0 {
		return nil
	}
	if len(values) < limit {
		limit = len(values)
	}
	out := make([]string, 0, limit)
	for _, value := range values[:limit] {
		out = append(out, value)
	}
	return out
}

func blueprintTitle(clauseType model.ClauseType) string {
	return strings.ReplaceAll(string(clauseType), "_", " ")
}

// arabicClauseTypeName renders a clause type as a natural Saudi legal Arabic
// noun phrase for baking into display-facing finding titles and summaries.
func arabicClauseTypeName(clauseType model.ClauseType) string {
	switch clauseType {
	case model.ClauseTypeIndemnification:
		return "التعويض"
	case model.ClauseTypeTermination:
		return "الإنهاء"
	case model.ClauseTypeLimitationOfLiability:
		return "تحديد المسؤولية"
	case model.ClauseTypeConfidentiality:
		return "السرية"
	case model.ClauseTypeIPOwnership:
		return "ملكية الملكية الفكرية"
	case model.ClauseTypeNonCompete:
		return "عدم المنافسة"
	case model.ClauseTypePaymentTerms:
		return "شروط الدفع"
	case model.ClauseTypeWarranty:
		return "الضمان"
	case model.ClauseTypeForceMajeure:
		return "القوة القاهرة"
	case model.ClauseTypeDisputeResolution:
		return "تسوية المنازعات"
	case model.ClauseTypeDataProtection:
		return "حماية البيانات"
	case model.ClauseTypeGoverningLaw:
		return "النظام الواجب التطبيق"
	case model.ClauseTypeAssignment:
		return "التنازل"
	case model.ClauseTypeInsurance:
		return "التأمين"
	case model.ClauseTypeAuditRights:
		return "حقوق التدقيق"
	case model.ClauseTypeSLA:
		return "مستوى الخدمة"
	case model.ClauseTypeAutoRenewal:
		return "التجديد التلقائي"
	case model.ClauseTypeRepresentations:
		return "الإقرارات"
	case model.ClauseTypeNonSolicitation:
		return "عدم استقطاب الموظفين"
	default:
		return "أخرى"
	}
}

// arabicRiskLevel renders a risk level as Saudi Arabic for baking into
// display-facing analysis summaries.
func arabicRiskLevel(level model.RiskLevel) string {
	switch level {
	case model.RiskLevelCritical:
		return "حرجة"
	case model.RiskLevelHigh:
		return "عالية"
	case model.RiskLevelMedium:
		return "متوسطة"
	case model.RiskLevelLow:
		return "منخفضة"
	default:
		return "غير محدَّدة"
	}
}

func contentHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func slugify(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(" ", "-", "/", "-", "&", "and", ",", "", ".", "", "'", "")
	value = replacer.Replace(value)
	for strings.Contains(value, "--") {
		value = strings.ReplaceAll(value, "--", "-")
	}
	return strings.Trim(value, "-")
}

func ptrString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func ptrFloat(value float64) *float64 {
	return &value
}

func ptrSignatureLanguage(value model.SignatureLanguage) *model.SignatureLanguage {
	return &value
}

func contractByTitle(contracts []*model.Contract, title string) *model.Contract {
	for _, contract := range contracts {
		if contract != nil && contract.Title == title {
			return contract
		}
	}
	return nil
}

func matterByNumber(matters []model.Matter, number string) *model.Matter {
	number = strings.TrimSpace(number)
	if number == "" {
		return nil
	}
	for idx := range matters {
		if matters[idx].MatterNumber == number {
			return &matters[idx]
		}
	}
	return nil
}

func documentByTitle(documents []model.LegalDocument, title string) *model.LegalDocument {
	for idx := range documents {
		if documents[idx].Title == title {
			return &documents[idx]
		}
	}
	return nil
}

func normalizeSeedDate(value time.Time) time.Time {
	utc := value.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func clampSeedScore(score float64) float64 {
	switch {
	case score < 0:
		return 0
	case score > 100:
		return 100
	default:
		return score
	}
}
