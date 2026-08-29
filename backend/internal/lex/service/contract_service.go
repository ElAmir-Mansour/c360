package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/aigovernance"
	aigovmiddleware "github.com/clario360/platform/internal/aigovernance/middleware"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedContractTypes = map[model.ContractType]struct{}{
	model.ContractTypeServiceAgreement: {},
	model.ContractTypeNDA:              {},
	model.ContractTypeEmployment:       {},
	model.ContractTypeVendor:           {},
	model.ContractTypeLicense:          {},
	model.ContractTypeLease:            {},
	model.ContractTypePartnership:      {},
	model.ContractTypeConsulting:       {},
	model.ContractTypeProcurement:      {},
	model.ContractTypeSLA:              {},
	model.ContractTypeMOU:              {},
	model.ContractTypeAmendment:        {},
	model.ContractTypeRenewal:          {},
	model.ContractTypeOther:            {},
}

var validTransitions = map[model.ContractStatus]map[model.ContractStatus]struct{}{
	model.ContractStatusDraft: {
		model.ContractStatusInternalReview: {},
		model.ContractStatusCancelled:      {},
	},
	model.ContractStatusInternalReview: {
		model.ContractStatusLegalReview: {},
		model.ContractStatusDraft:       {},
	},
	model.ContractStatusLegalReview: {
		model.ContractStatusNegotiation:    {},
		model.ContractStatusInternalReview: {},
		model.ContractStatusDraft:          {},
	},
	model.ContractStatusNegotiation: {
		model.ContractStatusPendingSignature: {},
		model.ContractStatusCancelled:        {},
		model.ContractStatusDraft:            {},
	},
	model.ContractStatusPendingSignature: {
		model.ContractStatusCancelled: {},
	},
	model.ContractStatusActive: {
		model.ContractStatusSuspended:  {},
		model.ContractStatusTerminated: {},
		model.ContractStatusExpired:    {},
		model.ContractStatusRenewed:    {},
	},
	model.ContractStatusSuspended: {
		model.ContractStatusActive:     {},
		model.ContractStatusTerminated: {},
	},
	model.ContractStatusExpired: {
		model.ContractStatusRenewed: {},
	},
}

const maxRedlineLines = 3000

type ContractService struct {
	db         *pgxpool.Pool
	contracts  *repository.ContractRepository
	clauses    *repository.ClauseRepository
	documents  *repository.DocumentRepository
	compliance *repository.ComplianceRepository
	alerts     *repository.AlertRepository
	workflow   *WorkflowService
	analyzer   interface {
		AnalyzeDetailed(contract *model.Contract, text string) (*model.AnalysisResult, error)
	}
	publisher        Publisher
	metrics          *metrics.Metrics
	topic            string
	logger           zerolog.Logger
	now              func() time.Time
	predictionLogger *aigovmiddleware.PredictionLogger
	// legalHolds enforces FR-WATHEEQ-005: a contract under an active legal hold
	// cannot be deleted, cancelled, or terminated. Nil => no hold enforcement
	// (backward compatible).
	legalHolds LegalHoldGuard
}

// WithLegalHoldGuard wires the legal-hold enforcement guard. Returns the
// receiver for chaining.
func (s *ContractService) WithLegalHoldGuard(guard LegalHoldGuard) *ContractService {
	s.legalHolds = guard
	return s
}

func NewContractService(
	db *pgxpool.Pool,
	contracts *repository.ContractRepository,
	clauses *repository.ClauseRepository,
	documents *repository.DocumentRepository,
	compliance *repository.ComplianceRepository,
	alerts *repository.AlertRepository,
	workflow *WorkflowService,
	analyzer interface {
		AnalyzeDetailed(contract *model.Contract, text string) (*model.AnalysisResult, error)
	},
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
	predictionLogger *aigovmiddleware.PredictionLogger,
) *ContractService {
	return &ContractService{
		db:               db,
		contracts:        contracts,
		clauses:          clauses,
		documents:        documents,
		compliance:       compliance,
		alerts:           alerts,
		workflow:         workflow,
		analyzer:         analyzer,
		publisher:        publisherOrNoop(publisher),
		metrics:          appMetrics,
		topic:            topic,
		logger:           logger.With().Str("service", "lex-contracts").Logger(),
		now:              time.Now,
		predictionLogger: predictionLogger,
	}
}

func ValidateContractTransition(currentStatus, newStatus string) error {
	current := model.ContractStatus(strings.TrimSpace(currentStatus))
	next := model.ContractStatus(strings.TrimSpace(newStatus))
	allowed, ok := validTransitions[current]
	if !ok {
		return fmt.Errorf("unsupported current status %q", currentStatus)
	}
	if _, ok := allowed[next]; !ok {
		return fmt.Errorf("invalid contract transition from %s to %s", current, next)
	}
	return nil
}

// validateContractWorkflowTransition admits the approval-only promotion that
// must never be exposed by the generic contract status endpoint. The workflow
// decision path applies assignee, separation-of-duties, quorum, and authority
// checks before calling this validator.
func validateContractWorkflowTransition(currentStatus, newStatus string) error {
	current := model.ContractStatus(strings.TrimSpace(currentStatus))
	next := model.ContractStatus(strings.TrimSpace(newStatus))
	if current == model.ContractStatusInternalReview && next == model.ContractStatusPendingSignature {
		return nil
	}
	return ValidateContractTransition(currentStatus, newStatus)
}

// validateContractSignatureTransition is deliberately separate from the public
// contract FSM. A contract may become active only when SignatureService has
// completed every required recipient and is persisting that evidence in the
// same transaction.
func validateContractSignatureTransition(currentStatus, newStatus string) error {
	current := model.ContractStatus(strings.TrimSpace(currentStatus))
	next := model.ContractStatus(strings.TrimSpace(newStatus))
	if current == model.ContractStatusPendingSignature && next == model.ContractStatusActive {
		return nil
	}
	return fmt.Errorf("invalid signature contract transition from %s to %s", current, next)
}

func (s *ContractService) CreateContract(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateContractRequest) (*model.Contract, error) {
	req.Normalize()
	if err := validateContractCreate(req); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start contract transaction", err)
	}
	defer tx.Rollback(ctx)

	// A form-created contract may consume an approved service-desk request.
	// Locking the request and linking it in this transaction prevents two
	// managers from creating different contracts from the same approval.
	if req.LegalRequestID != nil && *req.LegalRequestID != uuid.Nil {
		var requestNumber, requestType string
		var requestStatus model.RequestStatus
		var subjectID *uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT request_number, request_type, status, subject_id
			FROM legal_requests
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
			FOR UPDATE`, tenantID, *req.LegalRequestID,
		).Scan(&requestNumber, &requestType, &requestStatus, &subjectID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("approved legal request not found")
			}
			return nil, internalError("load contract source request", err)
		}
		if requestStatus != model.RequestStatusApproved {
			return nil, conflictError("only an approved legal request can create a contract")
		}
		if subjectID != nil && *subjectID != uuid.Nil {
			return nil, conflictError("the approved legal request is already linked to a legal work item")
		}
		req.Metadata = normalizeContractMetadata(req.Metadata)
		req.Metadata["legal_request_id"] = req.LegalRequestID.String()
		req.Metadata["spawned_from_request"] = requestNumber
		req.Metadata["intake_request_type"] = requestType
	}

	contractNumber := normalizeOptionalString(req.ContractNumber)
	if contractNumber == nil {
		generated := fmt.Sprintf("LEX-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		contractNumber = &generated
	}

	contract := &model.Contract{
		ID:                uuid.New(),
		TenantID:          tenantID,
		Title:             req.Title,
		ContractNumber:    contractNumber,
		Type:              req.Type,
		Description:       req.Description,
		PartyAName:        req.PartyAName,
		PartyAEntity:      normalizeOptionalString(req.PartyAEntity),
		PartyBName:        req.PartyBName,
		PartyBEntity:      normalizeOptionalString(req.PartyBEntity),
		PartyBContact:     normalizeOptionalString(req.PartyBContact),
		TotalValue:        req.TotalValue,
		Currency:          req.Currency,
		PaymentTerms:      normalizeOptionalString(req.PaymentTerms),
		EffectiveDate:     req.EffectiveDate,
		ExpiryDate:        req.ExpiryDate,
		RenewalDate:       req.RenewalDate,
		AutoRenew:         req.AutoRenew,
		RenewalNoticeDays: req.RenewalNoticeDays,
		Status:            model.ContractStatusDraft,
		OwnerUserID:       req.OwnerUserID,
		OwnerName:         req.OwnerName,
		LegalReviewerID:   req.LegalReviewerID,
		LegalReviewerName: normalizeOptionalString(req.LegalReviewerName),
		RiskLevel:         model.RiskLevelNone,
		AnalysisStatus:    model.AnalysisStatusPending,
		CurrentVersion:    1,
		OrgEntityID:       normalizeOptionalUUID(req.OrgEntityID),
		Department:        normalizeOptionalString(req.Department),
		Tags:              req.Tags,
		Metadata:          req.Metadata,
		CreatedBy:         userID,
	}

	if err := s.contracts.Create(ctx, tx, contract); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a contract with this contract number already exists")
		}
		return nil, internalError("create contract", err)
	}
	if req.Document != nil {
		version := &model.ContractVersion{
			ID:            uuid.New(),
			TenantID:      tenantID,
			ContractID:    contract.ID,
			Version:       1,
			FileID:        req.Document.FileID,
			FileName:      req.Document.FileName,
			FileSizeBytes: req.Document.FileSizeBytes,
			ContentHash:   req.Document.ContentHash,
			ExtractedText: &req.Document.ExtractedText,
			ChangeSummary: normalizeOptionalString(&req.Document.ChangeSummary),
			UploadedBy:    userID,
		}
		if err := s.contracts.InsertVersion(ctx, tx, version); err != nil {
			return nil, internalError("create contract version", err)
		}
		if err := s.contracts.UpdateDocument(ctx, tx, tenantID, contract.ID, req.Document.FileID, req.Document.ExtractedText, 1); err != nil {
			return nil, internalError("attach contract document", err)
		}
		contract.DocumentFileID = &req.Document.FileID
		contract.DocumentText = req.Document.ExtractedText
	}
	if req.LegalRequestID != nil && *req.LegalRequestID != uuid.Nil {
		result, linkErr := tx.Exec(ctx, `
			UPDATE legal_requests
			SET status = $3,
			    subject_type = 'contract',
			    subject_id = $4,
			    updated_at = now()
			WHERE tenant_id = $1
			  AND id = $2
			  AND status = $5
			  AND subject_id IS NULL`,
			tenantID, *req.LegalRequestID, model.RequestStatusRouted,
			contract.ID, model.RequestStatusApproved,
		)
		if linkErr != nil {
			return nil, internalError("link contract source request", linkErr)
		}
		if result.RowsAffected() != 1 {
			return nil, conflictError("the approved legal request was already consumed")
		}
		_, auditErr := tx.Exec(ctx, `
			INSERT INTO legal_request_audit_log (
				id, tenant_id, request_id, action, from_status, to_status,
				detail, actor_user_id
			) VALUES ($1,$2,$3,'routed',$4,$5,$6,$7)`,
			uuid.New(), tenantID, *req.LegalRequestID,
			model.RequestStatusApproved, model.RequestStatusRouted,
			map[string]any{"subject_type": "contract", "subject_id": contract.ID}, userID,
		)
		if auditErr != nil {
			return nil, internalError("audit contract source request", auditErr)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a contract with this contract number already exists")
		}
		return nil, internalError("commit contract create", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.created", tenantID, &userID, map[string]any{
		"id":                contract.ID,
		"title":             contract.Title,
		"type":              contract.Type,
		"party_b_name":      contract.PartyBName,
		"value":             contract.TotalValue,
		"owner_user_id":     contract.OwnerUserID,
		"legal_reviewer_id": contract.LegalReviewerID,
		"created_by":        contract.CreatedBy,
		"legal_request_id":  req.LegalRequestID,
	}, s.logger)
	return contract, nil
}

func (s *ContractService) ListContracts(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) ([]model.Contract, int, error) {
	return s.contracts.List(ctx, tenantID, filters)
}

func (s *ContractService) GetContract(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractDetail, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	clauses, err := s.clauses.ListByContract(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load clauses", err)
	}
	analysis, err := s.contracts.GetLatestAnalysis(ctx, tenantID, id)
	if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load analysis", err)
	}
	versions, err := s.contracts.ListVersions(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load versions", err)
	}
	return &model.ContractDetail{
		Contract:       contract,
		Clauses:        clauses,
		LatestAnalysis: analysis,
		VersionCount:   len(versions),
	}, nil
}

func (s *ContractService) GetContractBrief(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractBrief, error) {
	detail, err := s.GetContract(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	return buildContractBrief(detail, s.now().UTC()), nil
}

func (s *ContractService) UpdateContract(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateContractRequest) (*model.Contract, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	before := map[string]any{
		"title":         contract.Title,
		"type":          contract.Type,
		"description":   contract.Description,
		"owner_name":    contract.OwnerName,
		"status":        contract.Status,
		"org_entity_id": contract.OrgEntityID,
	}
	applyContractUpdate(contract, req)
	if err := validateContractForUpdate(contract); err != nil {
		return nil, err
	}
	if err := s.contracts.Update(ctx, s.db, contract); err != nil {
		return nil, internalError("update contract", err)
	}
	after := map[string]any{
		"title":         contract.Title,
		"type":          contract.Type,
		"description":   contract.Description,
		"owner_name":    contract.OwnerName,
		"status":        contract.Status,
		"org_entity_id": contract.OrgEntityID,
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.updated", tenantID, &userID, map[string]any{
		"id":             contract.ID,
		"changed_fields": changedFields(before, after),
	}, s.logger)
	return contract, nil
}

func (s *ContractService) DeleteContract(ctx context.Context, tenantID uuid.UUID, id uuid.UUID) error {
	// FR-WATHEEQ-005: refuse deletion while the contract is under an active hold.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectContract, id); err != nil {
		return err
	}
	if err := s.contracts.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("contract not found")
		}
		return internalError("delete contract", err)
	}
	return nil
}

// destructiveContractStatuses are terminal/removal transitions that destroy the
// contract's live state. They are refused while the contract is under hold.
var destructiveContractStatuses = map[model.ContractStatus]struct{}{
	model.ContractStatusCancelled:  {},
	model.ContractStatusTerminated: {},
}

func (s *ContractService) UploadDocument(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UploadContractDocumentRequest) ([]model.ContractVersion, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	if req.FileID == uuid.Nil || strings.TrimSpace(req.ContentHash) == "" || strings.TrimSpace(req.FileName) == "" {
		return nil, validationError("file_id, file_name, and content_hash are required", map[string]string{
			"file_id":      "required",
			"file_name":    "required",
			"content_hash": "required",
		})
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start upload transaction", err)
	}
	defer tx.Rollback(ctx)

	version := &model.ContractVersion{
		ID:            uuid.New(),
		TenantID:      tenantID,
		ContractID:    contract.ID,
		Version:       contract.CurrentVersion + 1,
		FileID:        req.FileID,
		FileName:      req.FileName,
		FileSizeBytes: req.FileSizeBytes,
		ContentHash:   req.ContentHash,
		ExtractedText: &req.ExtractedText,
		ChangeSummary: normalizeOptionalString(&req.ChangeSummary),
		UploadedBy:    userID,
	}
	if err := s.contracts.InsertVersion(ctx, tx, version); err != nil {
		return nil, internalError("insert contract version", err)
	}
	if err := s.contracts.UpdateDocument(ctx, tx, tenantID, contract.ID, req.FileID, req.ExtractedText, version.Version); err != nil {
		return nil, internalError("update current contract document", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit upload transaction", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.document_uploaded", tenantID, &userID, map[string]any{
		"id":           contract.ID,
		"version":      version.Version,
		"file_id":      req.FileID,
		"content_hash": req.ContentHash,
	}, s.logger)
	return s.contracts.ListVersions(ctx, tenantID, contract.ID)
}

func (s *ContractService) AnalyzeContract(ctx context.Context, tenantID, id uuid.UUID) (*model.AnalysisResult, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	if strings.TrimSpace(contract.DocumentText) == "" {
		return nil, validationError("contract document text is required for analysis", map[string]string{"document_text": "missing"})
	}
	if err := s.contracts.SetAnalysisStatus(ctx, tenantID, id, model.AnalysisStatusAnalyzing); err != nil {
		return nil, internalError("mark contract analyzing", err)
	}

	var result *model.AnalysisResult
	if ca, ok := s.analyzer.(interface {
		AnalyzeDetailedCtx(context.Context, *model.Contract, string) (*model.AnalysisResult, error)
	}); ok {
		// Hybrid analyzer: thread the request ctx (timeout/cancellation) into the
		// governed LLM enrichment without changing the legacy interface.
		result, err = ca.AnalyzeDetailedCtx(ctx, contract, contract.DocumentText)
	} else {
		result, err = s.analyzer.AnalyzeDetailed(contract, contract.DocumentText)
	}
	if err != nil {
		_ = s.contracts.SetAnalysisStatus(ctx, tenantID, id, model.AnalysisStatusFailed)
		return nil, internalError("analyze contract", err)
	}
	s.recordGovernedPredictions(ctx, contract, result)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start analysis transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.contracts.InsertAnalysis(ctx, tx, result.Analysis); err != nil {
		return nil, internalError("store contract analysis", err)
	}
	if err := s.clauses.ReplaceForContract(ctx, tx, tenantID, id, result.Clauses); err != nil {
		return nil, internalError("store extracted clauses", err)
	}
	if err := s.contracts.UpdateAnalysisFields(ctx, tx, tenantID, id, result.Analysis.RiskScore, result.Analysis.OverallRisk, model.AnalysisStatusCompleted, result.Analysis.AnalyzedAt); err != nil {
		return nil, internalError("update contract risk fields", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit analysis transaction", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.analyzed", tenantID, nil, map[string]any{
		"id":                contract.ID,
		"risk_level":        result.Analysis.OverallRisk,
		"risk_score":        result.Analysis.RiskScore,
		"clause_count":      result.Analysis.ClauseCount,
		"missing_count":     len(result.Analysis.MissingClauses),
		"created_by":        contract.CreatedBy,
		"owner_user_id":     contract.OwnerUserID,
		"legal_reviewer_id": contract.LegalReviewerID,
	}, s.logger)
	for _, clause := range result.Clauses {
		if clause.RiskLevel != model.RiskLevelCritical && clause.RiskLevel != model.RiskLevelHigh {
			continue
		}
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause.risk_flagged", tenantID, nil, map[string]any{
			"contract_id":   contract.ID,
			"clause_type":   clause.ClauseType,
			"risk_level":    clause.RiskLevel,
			"section_ref":   clause.SectionReference,
			"risk_keywords": clause.RiskKeywords,
			"owner_user_id": contract.OwnerUserID,
		}, s.logger)
	}
	return result, nil
}

func (s *ContractService) recordGovernedPredictions(ctx context.Context, contract *model.Contract, result *model.AnalysisResult) {
	if s.predictionLogger == nil || contract == nil || result == nil || result.Analysis == nil {
		return
	}
	contractID := contract.ID
	input := map[string]any{
		"contract_id":     contract.ID.String(),
		"contract_type":   contract.Type,
		"document_length": len(contract.DocumentText),
		"current_version": contract.CurrentVersion,
	}
	_, _ = s.predictionLogger.Predict(ctx, aigovernance.PredictParams{
		TenantID:     contract.TenantID,
		ModelSlug:    "lex-clause-extractor",
		UseCase:      "clause_extraction",
		EntityType:   "contract",
		EntityID:     &contractID,
		Input:        input,
		InputSummary: input,
		ModelFunc: func(context.Context, any) (*aigovernance.ModelOutput, error) {
			return &aigovernance.ModelOutput{
				Output:     result.Clauses,
				Confidence: clauseExtractionConfidence(result.Clauses),
				Metadata: map[string]any{
					"matched_rules": clauseTypes(result.Clauses),
					"clause_count":  len(result.Clauses),
					"high_risk":     result.Analysis.HighRiskClauseCount,
				},
			}, nil
		},
	})
	componentScores, componentWeights := lexRiskComponents(contract, result.Analysis)
	_, _ = s.predictionLogger.Predict(ctx, aigovernance.PredictParams{
		TenantID:     contract.TenantID,
		ModelSlug:    "lex-risk-analyzer",
		UseCase:      "contract_risk_analysis",
		EntityType:   "contract",
		EntityID:     &contractID,
		Input:        input,
		InputSummary: input,
		ModelFunc: func(context.Context, any) (*aigovernance.ModelOutput, error) {
			return &aigovernance.ModelOutput{
				Output:     result.Analysis,
				Confidence: riskAnalysisConfidence(result.Analysis),
				Metadata: map[string]any{
					"component_scores":  componentScores,
					"component_weights": componentWeights,
					"overall_score":     result.Analysis.RiskScore,
				},
			}, nil
		},
	})
}

func clauseExtractionConfidence(clauses []model.ExtractedClause) float64 {
	if len(clauses) == 0 {
		return 0.65
	}
	total := 0.0
	for _, item := range clauses {
		total += item.ExtractionConfidence
	}
	return total / float64(len(clauses))
}

func clauseTypes(clauses []model.ExtractedClause) []string {
	out := make([]string, 0, len(clauses))
	seen := make(map[string]struct{}, len(clauses))
	for _, item := range clauses {
		key := string(item.ClauseType)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func lexRiskComponents(contract *model.Contract, analysis *model.ContractRiskAnalysis) (map[string]any, map[string]any) {
	componentScores := map[string]any{
		"clause_risk":    float64(analysis.HighRiskClauseCount) * 10,
		"missing_clause": float64(len(analysis.MissingClauses) * 8),
		"compliance":     float64(len(analysis.ComplianceFlags) * 5),
	}
	valueFactor := 0.0
	if contract.TotalValue != nil {
		switch {
		case *contract.TotalValue > 10_000_000:
			valueFactor = 15
		case *contract.TotalValue > 1_000_000:
			valueFactor = 10
		}
	}
	componentScores["value"] = valueFactor
	expiryFactor := 0.0
	if contract.ExpiryDate != nil {
		days := int(contract.ExpiryDate.UTC().Sub(time.Now().UTC()).Hours() / 24)
		switch {
		case days <= 7:
			expiryFactor = 20
		case days <= 30:
			expiryFactor = 10
		}
	}
	componentScores["expiry"] = expiryFactor
	componentWeights := map[string]any{
		"clause_risk":    1.0,
		"missing_clause": 1.0,
		"value":          1.0,
		"expiry":         1.0,
		"compliance":     1.0,
	}
	return componentScores, componentWeights
}

func riskAnalysisConfidence(analysis *model.ContractRiskAnalysis) float64 {
	if analysis == nil {
		return 0.5
	}
	switch analysis.OverallRisk {
	case model.RiskLevelCritical:
		return 0.95
	case model.RiskLevelHigh:
		return 0.90
	case model.RiskLevelMedium:
		return 0.82
	default:
		return 0.75
	}
}

func (s *ContractService) GetAnalysis(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractRiskAnalysis, error) {
	analysis, err := s.contracts.GetLatestAnalysis(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("analysis not found")
		}
		return nil, internalError("get analysis", err)
	}
	return analysis, nil
}

func (s *ContractService) UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.ContractStatus) (*model.Contract, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	// A linked review owns the internal-review lifecycle. Letting the generic
	// status endpoint move the contract would allow callers to route around the
	// workflow's assignee, quorum, authority-evidence, and SoD checks (including
	// by taking the longer internal_review -> legal_review -> negotiation path).
	if contract.WorkflowInstanceID != nil && contract.Status == model.ContractStatusInternalReview {
		return nil, conflictError("contract status is controlled by its review workflow")
	}
	if err := ValidateContractTransition(string(contract.Status), string(status)); err != nil {
		return nil, validationError(err.Error(), map[string]string{"status": "invalid transition"})
	}
	// FR-WATHEEQ-005: a held contract cannot be transitioned to a terminal
	// removal state (cancelled/terminated) that would take it out of the active
	// estate; the hold must be released first.
	if _, destructive := destructiveContractStatuses[status]; destructive {
		if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectContract, id); err != nil {
			return nil, err
		}
	}
	prev := contract.Status
	now := s.now().UTC()
	var signedDate *time.Time
	if status == model.ContractStatusActive && contract.SignedDate == nil {
		value := normalizeDate(now)
		signedDate = &value
	}
	if err := s.contracts.UpdateStatus(ctx, s.db, tenantID, id, &prev, status, &userID, now, signedDate); err != nil {
		return nil, internalError("update contract status", err)
	}
	updated, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("reload contract", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.status_changed", tenantID, &userID, map[string]any{
		"id":         updated.ID,
		"old_status": prev,
		"new_status": status,
		"changed_by": userID,
	}, s.logger)
	return updated, nil
}

func (s *ContractService) ListVersions(ctx context.Context, tenantID, id uuid.UUID) ([]model.ContractVersion, error) {
	return s.contracts.ListVersions(ctx, tenantID, id)
}

func (s *ContractService) GetRedline(ctx context.Context, tenantID, id uuid.UUID, baseVersion, targetVersion int) (*model.ContractRedline, error) {
	if _, err := s.contracts.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}

	if baseVersion < 0 || targetVersion < 0 {
		return nil, validationError("version numbers must be positive", map[string]string{"version": "invalid"})
	}

	if baseVersion == 0 || targetVersion == 0 {
		versions, err := s.contracts.ListVersions(ctx, tenantID, id)
		if err != nil {
			return nil, internalError("list contract versions", err)
		}
		if len(versions) < 2 {
			return nil, validationError("redline requires at least two contract versions", map[string]string{"versions": "insufficient"})
		}
		if targetVersion == 0 {
			targetVersion = versions[0].Version
		}
		if baseVersion == 0 {
			for _, version := range versions {
				if version.Version < targetVersion {
					baseVersion = version.Version
					break
				}
			}
		}
	}
	if baseVersion <= 0 || targetVersion <= 0 || baseVersion == targetVersion {
		return nil, validationError("redline requires two different contract versions", map[string]string{"version": "invalid"})
	}
	if baseVersion > targetVersion {
		return nil, validationError("base_version must be older than target_version", map[string]string{"base_version": "invalid"})
	}

	base, err := s.contracts.GetVersion(ctx, tenantID, id, baseVersion)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("base version not found")
		}
		return nil, internalError("load base version", err)
	}
	target, err := s.contracts.GetVersion(ctx, tenantID, id, targetVersion)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("target version not found")
		}
		return nil, internalError("load target version", err)
	}

	baseText := textOrEmpty(base.ExtractedText)
	targetText := textOrEmpty(target.ExtractedText)
	if redlineLineCount(baseText) > maxRedlineLines || redlineLineCount(targetText) > maxRedlineLines {
		return nil, validationError("redline input exceeds maximum supported line count", map[string]string{"document": "too_large"})
	}
	segments, added, removed := diffContractText(baseText, targetText)
	return &model.ContractRedline{
		ContractID:     id,
		BaseVersion:    base.Version,
		TargetVersion:  target.Version,
		BaseFileName:   base.FileName,
		TargetFileName: target.FileName,
		ChangeSummary:  target.ChangeSummary,
		Segments:       segments,
		AddedLines:     added,
		RemovedLines:   removed,
		GeneratedAt:    s.now().UTC(),
	}, nil
}

func (s *ContractService) ContractReport(ctx context.Context, tenantID uuid.UUID, filters model.ContractListFilters) (*model.ContractReport, error) {
	filters.Page = 1
	if filters.PerPage <= 0 || filters.PerPage > 1000 {
		filters.PerPage = 1000
	}
	items, total, err := s.contracts.List(ctx, tenantID, filters)
	if err != nil {
		return nil, internalError("list report contracts", err)
	}
	report := &model.ContractReport{
		GeneratedAt: s.now().UTC(),
		Total:       total,
		Filters:     contractReportFilters(filters),
		Contracts:   make([]model.ContractSummary, 0, len(items)),
		ByStatus:    map[string]int{},
		ByType:      map[string]int{},
		ByRiskLevel: map[string]int{},
	}
	for _, item := range items {
		report.Contracts = append(report.Contracts, reportSummary(item))
		report.ByStatus[string(item.Status)]++
		report.ByType[string(item.Type)]++
		report.ByRiskLevel[string(item.RiskLevel)]++
	}
	return report, nil
}

func (s *ContractService) RenewContract(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.RenewContractRequest) (*model.Contract, error) {
	original, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	if original.Status != model.ContractStatusActive && original.Status != model.ContractStatusExpired {
		return nil, validationError("only active or expired contracts can be renewed", map[string]string{"status": "invalid"})
	}
	startDate := req.NewEffectiveDate
	if startDate == nil {
		if original.ExpiryDate != nil {
			value := normalizeDate(original.ExpiryDate.AddDate(0, 0, 1))
			startDate = &value
		} else {
			value := normalizeDate(s.now())
			startDate = &value
		}
	}
	value := original.TotalValue
	if req.NewValue != nil {
		value = req.NewValue
	}

	contractNumber := fmt.Sprintf("LEX-RNW-%s", strings.ToUpper(uuid.NewString()[:8]))
	renewal := &model.Contract{
		ID:                uuid.New(),
		TenantID:          tenantID,
		Title:             original.Title + " (Renewal)",
		ContractNumber:    &contractNumber,
		Type:              original.Type,
		Description:       original.Description,
		PartyAName:        original.PartyAName,
		PartyAEntity:      original.PartyAEntity,
		PartyBName:        original.PartyBName,
		PartyBEntity:      original.PartyBEntity,
		PartyBContact:     original.PartyBContact,
		TotalValue:        value,
		Currency:          original.Currency,
		PaymentTerms:      original.PaymentTerms,
		EffectiveDate:     startDate,
		ExpiryDate:        &req.NewExpiryDate,
		RenewalDate:       nil,
		AutoRenew:         original.AutoRenew,
		RenewalNoticeDays: original.RenewalNoticeDays,
		Status:            model.ContractStatusDraft,
		OwnerUserID:       original.OwnerUserID,
		OwnerName:         original.OwnerName,
		LegalReviewerID:   original.LegalReviewerID,
		LegalReviewerName: original.LegalReviewerName,
		RiskLevel:         model.RiskLevelNone,
		AnalysisStatus:    model.AnalysisStatusPending,
		CurrentVersion:    1,
		ParentContractID:  &original.ID,
		Department:        original.Department,
		Tags:              dto.NormalizeTags(original.Tags),
		Metadata:          normalizeContractMetadata(original.Metadata),
		CreatedBy:         userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start renewal transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.contracts.Create(ctx, tx, renewal); err != nil {
		return nil, internalError("create renewal contract", err)
	}
	latestVersion, err := s.contracts.GetLatestVersion(ctx, tenantID, original.ID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load original version", err)
	}
	if latestVersion != nil {
		newVersion := &model.ContractVersion{
			ID:            uuid.New(),
			TenantID:      tenantID,
			ContractID:    renewal.ID,
			Version:       1,
			FileID:        latestVersion.FileID,
			FileName:      latestVersion.FileName,
			FileSizeBytes: latestVersion.FileSizeBytes,
			ContentHash:   latestVersion.ContentHash,
			ExtractedText: latestVersion.ExtractedText,
			ChangeSummary: normalizeOptionalString(&req.ChangeSummary),
			UploadedBy:    userID,
		}
		if err := s.contracts.InsertVersion(ctx, tx, newVersion); err != nil {
			return nil, internalError("copy renewal version", err)
		}
		text := ""
		if latestVersion.ExtractedText != nil {
			text = *latestVersion.ExtractedText
		}
		if err := s.contracts.UpdateDocument(ctx, tx, tenantID, renewal.ID, latestVersion.FileID, text, 1); err != nil {
			return nil, internalError("attach renewal document", err)
		}
	}
	prev := original.Status
	now := s.now().UTC()
	if err := s.contracts.UpdateStatus(ctx, tx, tenantID, original.ID, &prev, model.ContractStatusRenewed, &userID, now, nil); err != nil {
		return nil, internalError("mark original renewed", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit renewal", err)
	}

	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.renewed", tenantID, &userID, map[string]any{
		"original_id":     original.ID,
		"new_id":          renewal.ID,
		"new_expiry_date": req.NewExpiryDate,
	}, s.logger)
	return renewal, nil
}

func (s *ContractService) ListExpiring(ctx context.Context, tenantID uuid.UUID, horizonDays int) ([]model.ExpiringContractSummary, error) {
	return s.contracts.ListExpiring(ctx, tenantID, horizonDays)
}

func (s *ContractService) RenewalWarnings(ctx context.Context, tenantID uuid.UUID, horizonDays, leadDays int) (*model.ContractRenewalWarningSummary, error) {
	now := s.now().UTC()
	if horizonDays <= 0 {
		horizonDays = 60
	}
	if horizonDays > 365 {
		horizonDays = 365
	}
	if leadDays <= 0 {
		leadDays = 30
	}
	if leadDays > 365 {
		leadDays = 365
	}
	items, err := s.contracts.ListRenewalWarningCandidates(ctx, tenantID, horizonDays, leadDays)
	if err != nil {
		return nil, internalError("list renewal warning contracts", err)
	}
	return buildContractRenewalWarningSummary(tenantID, items, now, horizonDays, leadDays), nil
}

func (s *ContractService) Stats(ctx context.Context, tenantID uuid.UUID) (*model.ContractStats, error) {
	return s.contracts.Stats(ctx, tenantID)
}

func (s *ContractService) SearchContracts(ctx context.Context, tenantID uuid.UUID, query string, page, perPage int) ([]model.ContractSummary, int, error) {
	return s.contracts.Search(ctx, tenantID, query, page, perPage)
}

func (s *ContractService) ClassifyContract(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.ClassifyContractRequest) (*model.ContractClassificationResult, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	if req.OverrideType != nil {
		if _, ok := allowedContractTypes[*req.OverrideType]; !ok {
			return nil, validationError("override_type is invalid", map[string]string{"override_type": "invalid"})
		}
	}
	result := classifyContract(contract, req, s.now().UTC())
	if req.Apply {
		contract.Type = result.RecommendedType
		contract.Metadata = normalizeContractMetadata(contract.Metadata)
		contract.Metadata["classification"] = map[string]any{
			"recommended_type": result.RecommendedType,
			"previous_type":    result.PreviousType,
			"confidence":       result.Confidence,
			"matched_terms":    result.MatchedTerms,
			"rationale":        result.Rationale,
			"classified_at":    result.ClassifiedAt.Format(time.RFC3339Nano),
			"applied_by":       userID.String(),
		}
		if err := s.contracts.Update(ctx, s.db, contract); err != nil {
			return nil, internalError("apply contract classification", err)
		}
		result.Applied = true
		result.AppliedType = result.RecommendedType
		result.Metadata = contract.Metadata
		writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.classified", tenantID, &userID, map[string]any{
			"id":               contract.ID,
			"previous_type":    result.PreviousType,
			"recommended_type": result.RecommendedType,
			"confidence":       result.Confidence,
			"matched_terms":    result.MatchedTerms,
		}, s.logger)
	}
	return result, nil
}

func (s *ContractService) Timeline(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractTimeline, error) {
	contract, err := s.contracts.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	versions, err := s.contracts.ListVersions(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("list contract versions", err)
	}
	return buildContractTimeline(contract, versions, s.now().UTC()), nil
}

func buildContractRenewalWarningSummary(tenantID uuid.UUID, contracts []model.Contract, generatedAt time.Time, horizonDays, leadDays int) *model.ContractRenewalWarningSummary {
	summary := &model.ContractRenewalWarningSummary{
		TenantID:    tenantID,
		GeneratedAt: generatedAt,
		HorizonDays: horizonDays,
		LeadDays:    leadDays,
		Items:       []model.ContractRenewalWarning{},
	}
	asOf := normalizeDate(generatedAt)
	for _, contract := range contracts {
		warning, ok := contractRenewalWarning(contract, asOf, horizonDays, leadDays)
		if !ok {
			continue
		}
		summary.Items = append(summary.Items, warning)
		switch warning.Severity {
		case model.ContractRenewalWarningSeverityUrgent:
			summary.Urgent++
		default:
			summary.Warning++
		}
	}
	sort.SliceStable(summary.Items, func(i, j int) bool {
		left := summary.Items[i]
		right := summary.Items[j]
		if left.DaysUntilTrigger != right.DaysUntilTrigger {
			return left.DaysUntilTrigger < right.DaysUntilTrigger
		}
		return left.Title < right.Title
	})
	summary.Total = len(summary.Items)
	return summary
}

func contractRenewalWarning(contract model.Contract, asOf time.Time, horizonDays, leadDays int) (model.ContractRenewalWarning, bool) {
	if contract.ExpiryDate == nil && contract.RenewalDate == nil {
		return model.ContractRenewalWarning{}, false
	}
	configuredLead := leadDays
	if contract.RenewalNoticeDays > configuredLead {
		configuredLead = contract.RenewalNoticeDays
	}
	var trigger *time.Time
	var reason string
	if contract.RenewalDate != nil {
		value := normalizeDate(*contract.RenewalDate)
		trigger = &value
		reason = "renewal_date"
	} else if contract.ExpiryDate != nil {
		value := normalizeDate(contract.ExpiryDate.AddDate(0, 0, -configuredLead))
		trigger = &value
		reason = "expiry_minus_lead"
	}
	if trigger == nil {
		return model.ContractRenewalWarning{}, false
	}
	daysUntilTrigger := daysBetween(asOf, *trigger)
	if daysUntilTrigger > horizonDays {
		return model.ContractRenewalWarning{}, false
	}
	daysUntilExpiry := 0
	if contract.ExpiryDate != nil {
		daysUntilExpiry = daysBetween(asOf, *contract.ExpiryDate)
	}
	severity := model.ContractRenewalWarningSeverityWarning
	if daysUntilTrigger <= 7 || (contract.ExpiryDate != nil && daysUntilExpiry <= 7) {
		severity = model.ContractRenewalWarningSeverityUrgent
	}
	return model.ContractRenewalWarning{
		ContractID:         contract.ID,
		Title:              contract.Title,
		Status:             contract.Status,
		Counterparty:       contract.PartyBName,
		Owner:              contract.OwnerName,
		ExpiryDate:         contract.ExpiryDate,
		RenewalDate:        contract.RenewalDate,
		AutoRenew:          contract.AutoRenew,
		RenewalNoticeDays:  contract.RenewalNoticeDays,
		ConfiguredLeadDays: configuredLead,
		TriggerDate:        trigger,
		DaysUntilTrigger:   daysUntilTrigger,
		DaysUntilExpiry:    daysUntilExpiry,
		Severity:           severity,
		Reason:             reason,
	}, true
}

func classifyContract(contract *model.Contract, req dto.ClassifyContractRequest, classifiedAt time.Time) *model.ContractClassificationResult {
	text := classificationText(contract, req.CandidateText)
	recommended, confidence, matchedTerms, rationale := recommendContractType(text, contract.Type)
	if req.OverrideType != nil {
		recommended = *req.OverrideType
		confidence = 1
		matchedTerms = []string{"override_type:" + string(*req.OverrideType)}
		rationale = "Classification overridden by operator request."
	}
	return &model.ContractClassificationResult{
		ContractID:      contract.ID,
		PreviousType:    contract.Type,
		RecommendedType: recommended,
		AppliedType:     contract.Type,
		Applied:         false,
		Confidence:      confidence,
		MatchedTerms:    matchedTerms,
		Rationale:       rationale,
		ClassifiedAt:    classifiedAt,
		Metadata: map[string]any{
			"source":         "deterministic_classifier",
			"text_available": strings.TrimSpace(text) != "",
		},
	}
}

func classificationText(contract *model.Contract, candidateText string) string {
	if strings.TrimSpace(candidateText) != "" {
		return strings.ToLower(candidateText)
	}
	parts := []string{
		contract.Title,
		contract.Description,
		contract.PartyBName,
		contract.DocumentText,
		strings.Join(contract.Tags, " "),
	}
	return strings.ToLower(strings.Join(parts, " "))
}

func recommendContractType(text string, fallback model.ContractType) (model.ContractType, float64, []string, string) {
	type candidate struct {
		contractType model.ContractType
		terms        []string
	}
	candidates := []candidate{
		{model.ContractTypeNDA, []string{"non-disclosure", "nondisclosure", "confidentiality agreement", "nda"}},
		{model.ContractTypeEmployment, []string{"employment", "employee", "salary", "compensation", "termination of employment"}},
		{model.ContractTypeSLA, []string{"service level", "uptime", "availability", "service credit", "sla"}},
		{model.ContractTypeLicense, []string{"license", "licence", "software", "subscription", "user seat"}},
		{model.ContractTypeLease, []string{"lease", "rent", "premises", "landlord", "tenant"}},
		{model.ContractTypePartnership, []string{"partnership", "joint venture", "profit share", "strategic alliance"}},
		{model.ContractTypeConsulting, []string{"consulting", "consultant", "statement of work", "professional services"}},
		{model.ContractTypeProcurement, []string{"procurement", "purchase order", "tender", "rfp", "supply of goods"}},
		{model.ContractTypeVendor, []string{"vendor", "supplier", "master services", "msa", "purchase"}},
		{model.ContractTypeMOU, []string{"memorandum of understanding", "mou"}},
		{model.ContractTypeAmendment, []string{"amendment", "addendum", "variation"}},
		{model.ContractTypeRenewal, []string{"renewal", "extension", "extend the term"}},
		{model.ContractTypeServiceAgreement, []string{"service agreement", "services agreement", "scope of services", "managed services"}},
	}
	bestType := fallback
	bestMatches := []string{}
	for _, item := range candidates {
		matches := []string{}
		for _, term := range item.terms {
			if strings.Contains(text, term) {
				matches = append(matches, term)
			}
		}
		if len(matches) > len(bestMatches) {
			bestType = item.contractType
			bestMatches = matches
		}
	}
	if len(bestMatches) == 0 {
		return fallback, 0.35, []string{}, "No strong contract-type terms were found; retaining the current type."
	}
	confidence := 0.55 + float64(len(bestMatches))*0.12
	if confidence > 0.95 {
		confidence = 0.95
	}
	return bestType, confidence, bestMatches, fmt.Sprintf("Matched %d term(s) associated with %s.", len(bestMatches), bestType)
}

func buildContractTimeline(contract *model.Contract, versions []model.ContractVersion, generatedAt time.Time) *model.ContractTimeline {
	events := []model.ContractTimelineEvent{}
	if !contract.CreatedAt.IsZero() {
		actor := contract.CreatedBy.String()
		events = append(events, model.ContractTimelineEvent{
			ID:          "contract-created",
			EventType:   "contract_created",
			Title:       "تم إنشاء العقد",
			Description: fmt.Sprintf("تم إنشاء العقد «%s» بحالة %s.", contract.Title, contractStatusAR(contract.Status)),
			OccurredAt:  contract.CreatedAt,
			Actor:       &actor,
			Source:      "contracts.created_at",
			Metadata: map[string]any{
				"status": contract.Status,
				"type":   contract.Type,
			},
		})
	}
	if contract.StatusChangedAt != nil {
		var actor *string
		if contract.StatusChangedBy != nil {
			value := contract.StatusChangedBy.String()
			actor = &value
		}
		events = append(events, model.ContractTimelineEvent{
			ID:          "status-" + string(contract.Status),
			EventType:   "status_changed",
			Title:       "تغيّرت الحالة",
			Description: fmt.Sprintf("انتقل العقد إلى حالة %s.", contractStatusAR(contract.Status)),
			OccurredAt:  *contract.StatusChangedAt,
			Actor:       actor,
			Source:      "contracts.status_changed_at",
			Metadata: map[string]any{
				"previous_status": contract.PreviousStatus,
				"status":          contract.Status,
			},
		})
	}
	if contract.LastAnalyzedAt != nil {
		events = append(events, model.ContractTimelineEvent{
			ID:          "analysis-latest",
			EventType:   "analysis_completed",
			Title:       "اكتمل التحليل",
			Description: fmt.Sprintf("حدّد أحدث تحليل مستوى الخطورة إلى %s.", riskLevelAR(contract.RiskLevel)),
			OccurredAt:  *contract.LastAnalyzedAt,
			Source:      "contracts.last_analyzed_at",
			Metadata: map[string]any{
				"risk_level": contract.RiskLevel,
				"risk_score": contract.RiskScore,
			},
		})
	}
	if contract.WorkflowInstanceID != nil {
		events = append(events, model.ContractTimelineEvent{
			ID:          "workflow-" + contract.WorkflowInstanceID.String(),
			EventType:   "workflow_linked",
			Title:       "تم ربط سير العمل",
			Description: "تم ربط سير عمل مراجعة العقد بهذا العقد.",
			OccurredAt:  contract.UpdatedAt,
			Source:      "contracts.workflow_instance_id",
			Metadata: map[string]any{
				"workflow_instance_id": contract.WorkflowInstanceID.String(),
			},
		})
	}
	for _, version := range versions {
		actor := version.UploadedBy.String()
		events = append(events, model.ContractTimelineEvent{
			ID:          fmt.Sprintf("version-%d", version.Version),
			EventType:   "version_uploaded",
			Title:       fmt.Sprintf("تم رفع النسخة %d", version.Version),
			Description: version.FileName,
			OccurredAt:  version.UploadedAt,
			Actor:       &actor,
			Source:      "contract_versions.uploaded_at",
			Metadata: map[string]any{
				"version":         version.Version,
				"file_id":         version.FileID.String(),
				"content_hash":    version.ContentHash,
				"change_summary":  version.ChangeSummary,
				"file_size_bytes": version.FileSizeBytes,
			},
		})
	}
	events = append(events, metadataTimelineEvents(contract.Metadata)...)
	sort.SliceStable(events, func(i, j int) bool {
		if !events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].OccurredAt.After(events[j].OccurredAt)
		}
		return events[i].ID < events[j].ID
	})
	return &model.ContractTimeline{
		ContractID:  contract.ID,
		GeneratedAt: generatedAt,
		Events:      events,
	}
}

func metadataTimelineEvents(metadata map[string]any) []model.ContractTimelineEvent {
	raw, ok := metadata["timeline"]
	if !ok || raw == nil {
		return []model.ContractTimelineEvent{}
	}
	items, ok := raw.([]any)
	if !ok {
		return []model.ContractTimelineEvent{}
	}
	events := make([]model.ContractTimelineEvent, 0, len(items))
	for index, item := range items {
		value, ok := item.(map[string]any)
		if !ok {
			continue
		}
		occurredAt := metadataTimeValue(value, "occurred_at", "at", "created_at")
		if occurredAt == nil {
			continue
		}
		id := firstMetadataString(value, "id")
		if id == "" {
			id = fmt.Sprintf("metadata-%d", index)
		}
		eventType := firstMetadataString(value, "event_type", "type")
		if eventType == "" {
			eventType = "metadata_event"
		}
		title := firstMetadataString(value, "title", "label")
		if title == "" {
			title = eventType
		}
		description := firstMetadataString(value, "description", "summary")
		actorValue := firstMetadataString(value, "actor", "actor_name", "user")
		var actor *string
		if actorValue != "" {
			actor = &actorValue
		}
		events = append(events, model.ContractTimelineEvent{
			ID:          id,
			EventType:   eventType,
			Title:       title,
			Description: description,
			OccurredAt:  *occurredAt,
			Actor:       actor,
			Source:      "contract.metadata.timeline",
			Metadata:    value,
		})
	}
	return events
}

func metadataTimeValue(metadata map[string]any, keys ...string) *time.Time {
	for _, key := range keys {
		raw, ok := metadata[key]
		if !ok || raw == nil {
			continue
		}
		switch typed := raw.(type) {
		case time.Time:
			value := typed.UTC()
			return &value
		case string:
			for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
				parsed, err := time.Parse(layout, strings.TrimSpace(typed))
				if err == nil {
					value := parsed.UTC()
					return &value
				}
			}
		}
	}
	return nil
}

func buildContractBrief(detail *model.ContractDetail, generatedAt time.Time) *model.ContractBrief {
	if detail == nil || detail.Contract == nil {
		return nil
	}
	contract := detail.Contract
	riskLevel := contract.RiskLevel
	riskScore := contract.RiskScore
	if detail.LatestAnalysis != nil {
		riskLevel = detail.LatestAnalysis.OverallRisk
		score := detail.LatestAnalysis.RiskScore
		riskScore = &score
	}
	return &model.ContractBrief{
		ContractID:       contract.ID,
		Title:            contract.Title,
		Type:             contract.Type,
		Status:           contract.Status,
		Counterparty:     contract.PartyBName,
		Owner:            contract.OwnerName,
		Value:            contract.TotalValue,
		Currency:         contract.Currency,
		EffectiveDate:    contract.EffectiveDate,
		ExpiryDate:       contract.ExpiryDate,
		RenewalDate:      contract.RenewalDate,
		ExecutiveSummary: contractExecutiveSummary(contract),
		RiskSummary:      contractRiskSummary(contract, detail.LatestAnalysis),
		RiskLevel:        riskLevel,
		RiskScore:        riskScore,
		TopClauses:       contractBriefClauses(detail.Clauses),
		TopRisks:         contractBriefRisks(detail.LatestAnalysis),
		Obligations:      contractBriefObligations(contract),
		RenewalSignals:   contractBriefRenewalSignals(contract),
		Metadata:         briefMetadata(contract.Metadata),
		GeneratedAt:      generatedAt,
	}
}

// contractStatusAR / contractTypeAR / riskLevelAR map contract enum slugs to
// Saudi-Arabic labels for the single-string timeline/summary prose surfaced in
// the (Arabic-default) UI. The slug itself remains authoritative in metadata and
// is handled by the frontend label maps; these helpers only localize free text.
func contractStatusAR(s model.ContractStatus) string {
	switch s {
	case model.ContractStatusDraft:
		return "مسودة"
	case model.ContractStatusInternalReview:
		return "مراجعة داخلية"
	case model.ContractStatusLegalReview:
		return "مراجعة قانونية"
	case model.ContractStatusNegotiation:
		return "تفاوض"
	case model.ContractStatusPendingSignature:
		return "بانتظار التوقيع"
	case model.ContractStatusActive:
		return "نافذ"
	case model.ContractStatusSuspended:
		return "موقوف"
	case model.ContractStatusExpired:
		return "منتهي المدة"
	case model.ContractStatusTerminated:
		return "منهى"
	case model.ContractStatusRenewed:
		return "مُجدَّد"
	case model.ContractStatusCancelled:
		return "ملغى"
	default:
		return string(s)
	}
}

func contractTypeAR(t model.ContractType) string {
	switch t {
	case model.ContractTypeServiceAgreement:
		return "اتفاقية خدمات"
	case model.ContractTypeNDA:
		return "اتفاقية عدم إفصاح"
	case model.ContractTypeEmployment:
		return "عقد عمل"
	case model.ContractTypeVendor:
		return "عقد مورّد"
	case model.ContractTypeLicense:
		return "عقد ترخيص"
	case model.ContractTypeLease:
		return "عقد إيجار"
	case model.ContractTypePartnership:
		return "عقد شراكة"
	case model.ContractTypeConsulting:
		return "عقد استشارات"
	case model.ContractTypeProcurement:
		return "عقد توريد"
	case model.ContractTypeSLA:
		return "اتفاقية مستوى خدمة"
	case model.ContractTypeMOU:
		return "مذكرة تفاهم"
	case model.ContractTypeAmendment:
		return "ملحق تعديلي"
	case model.ContractTypeRenewal:
		return "عقد تجديد"
	case model.ContractTypeOther:
		return "عقد آخر"
	default:
		return string(t)
	}
}

func riskLevelAR(r model.RiskLevel) string {
	switch r {
	case model.RiskLevelCritical:
		return "حرجة"
	case model.RiskLevelHigh:
		return "عالية"
	case model.RiskLevelMedium:
		return "متوسطة"
	case model.RiskLevelLow:
		return "منخفضة"
	case model.RiskLevelNone:
		return "بلا خطورة"
	default:
		return string(r)
	}
}

func contractExecutiveSummary(contract *model.Contract) string {
	parts := []string{fmt.Sprintf("«%s» عقد من نوع %s مع %s", contract.Title, contractTypeAR(contract.Type), contract.PartyBName)}
	if contract.OwnerName != "" {
		parts = append(parts, fmt.Sprintf("بعهدة %s", contract.OwnerName))
	}
	parts = append(parts, fmt.Sprintf("وحالته الحالية %s", contractStatusAR(contract.Status)))
	if contract.TotalValue != nil {
		parts = append(parts, fmt.Sprintf("بقيمة %.2f %s", *contract.TotalValue, contract.Currency))
	}
	if contract.EffectiveDate != nil || contract.ExpiryDate != nil {
		parts = append(parts, briefDateRange(contract.EffectiveDate, contract.ExpiryDate))
	}
	return strings.Join(parts, "، ") + "."
}

func contractRiskSummary(contract *model.Contract, analysis *model.ContractRiskAnalysis) string {
	if analysis == nil {
		return fmt.Sprintf("Risk analysis is %s; current contract risk is %s.", contract.AnalysisStatus, contract.RiskLevel)
	}
	parts := []string{fmt.Sprintf("Overall risk is %s with score %.2f", analysis.OverallRisk, analysis.RiskScore)}
	if analysis.ClauseCount > 0 {
		parts = append(parts, fmt.Sprintf("%d clauses reviewed", analysis.ClauseCount))
	}
	if analysis.HighRiskClauseCount > 0 {
		parts = append(parts, fmt.Sprintf("%d high-risk clauses", analysis.HighRiskClauseCount))
	}
	if len(analysis.MissingClauses) > 0 {
		parts = append(parts, fmt.Sprintf("%d missing clauses", len(analysis.MissingClauses)))
	}
	if len(analysis.ComplianceFlags) > 0 {
		parts = append(parts, fmt.Sprintf("%d compliance flags", len(analysis.ComplianceFlags)))
	}
	return strings.Join(parts, "; ") + "."
}

func contractBriefClauses(clauses []model.Clause) []model.ContractBriefClause {
	items := append([]model.Clause(nil), clauses...)
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].RiskLevel.Weight() != items[j].RiskLevel.Weight() {
			return items[i].RiskLevel.Weight() > items[j].RiskLevel.Weight()
		}
		if items[i].RiskScore != items[j].RiskScore {
			return items[i].RiskScore > items[j].RiskScore
		}
		if items[i].Title != items[j].Title {
			return items[i].Title < items[j].Title
		}
		return items[i].ID.String() < items[j].ID.String()
	})
	limit := minInt(len(items), 5)
	out := make([]model.ContractBriefClause, 0, limit)
	for _, clause := range items[:limit] {
		out = append(out, model.ContractBriefClause{
			ID:               clause.ID,
			Title:            clause.Title,
			ClauseType:       clause.ClauseType,
			SectionReference: clause.SectionReference,
			RiskLevel:        clause.RiskLevel,
			RiskScore:        clause.RiskScore,
			Summary:          briefClauseSummary(clause),
		})
	}
	return out
}

func briefClauseSummary(clause model.Clause) string {
	if clause.AnalysisSummary != nil && strings.TrimSpace(*clause.AnalysisSummary) != "" {
		return strings.TrimSpace(*clause.AnalysisSummary)
	}
	content := strings.Join(strings.Fields(clause.Content), " ")
	if len(content) > 240 {
		return strings.TrimSpace(content[:240]) + "..."
	}
	return content
}

func contractBriefRisks(analysis *model.ContractRiskAnalysis) []model.ContractBriefRisk {
	if analysis == nil {
		return []model.ContractBriefRisk{}
	}
	out := make([]model.ContractBriefRisk, 0, 5)
	for _, finding := range analysis.KeyFindings {
		if len(out) >= 5 {
			break
		}
		out = append(out, model.ContractBriefRisk{
			Title:           finding.Title,
			Description:     finding.Description,
			Severity:        finding.Severity,
			ClauseReference: finding.ClauseReference,
			Recommendation:  finding.Recommendation,
			ClauseType:      finding.ClauseType,
		})
	}
	for _, flag := range analysis.ComplianceFlags {
		if len(out) >= 5 {
			break
		}
		out = append(out, model.ContractBriefRisk{
			Title:           flag.Title,
			Description:     flag.Description,
			Severity:        flag.Severity,
			ClauseReference: flag.ClauseReference,
		})
	}
	for _, missing := range analysis.MissingClauses {
		if len(out) >= 5 {
			break
		}
		clauseType := missing
		out = append(out, model.ContractBriefRisk{
			Title:          "Missing " + string(missing) + " clause",
			Description:    "Expected clause was not identified in the latest analysis.",
			Severity:       model.RiskLevelMedium,
			Recommendation: "Review whether this clause is required for the contract type.",
			ClauseType:     &clauseType,
		})
	}
	return out
}

func contractBriefObligations(contract *model.Contract) []model.ContractBriefSignal {
	signals := metadataSignals(contract.Metadata, "obligations")
	if contract.PaymentTerms != nil && strings.TrimSpace(*contract.PaymentTerms) != "" {
		signals = append(signals, model.ContractBriefSignal{
			Label:  "Payment terms",
			Value:  strings.TrimSpace(*contract.PaymentTerms),
			Source: "contract.payment_terms",
		})
	}
	return capSignals(signals, 5)
}

func contractBriefRenewalSignals(contract *model.Contract) []model.ContractBriefSignal {
	signals := metadataSignals(contract.Metadata, "renewal_signals")
	if contract.AutoRenew {
		signals = append(signals, model.ContractBriefSignal{Label: "Auto renew", Value: "enabled", Source: "contract.auto_renew"})
	}
	if contract.RenewalDate != nil {
		signals = append(signals, model.ContractBriefSignal{Label: "Renewal date", Value: contract.RenewalDate.UTC().Format("2006-01-02"), Source: "contract.renewal_date"})
	}
	if contract.ExpiryDate != nil {
		signals = append(signals, model.ContractBriefSignal{Label: "Expiry date", Value: contract.ExpiryDate.UTC().Format("2006-01-02"), Source: "contract.expiry_date"})
	}
	if contract.RenewalNoticeDays > 0 {
		signals = append(signals, model.ContractBriefSignal{Label: "Renewal notice", Value: fmt.Sprintf("%d days", contract.RenewalNoticeDays), Source: "contract.renewal_notice_days"})
	}
	return capSignals(signals, 5)
}

func metadataSignals(metadata map[string]any, key string) []model.ContractBriefSignal {
	raw, ok := metadata[key]
	if !ok || raw == nil {
		return []model.ContractBriefSignal{}
	}
	switch value := raw.(type) {
	case []string:
		out := make([]model.ContractBriefSignal, 0, len(value))
		for _, item := range value {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				out = append(out, model.ContractBriefSignal{Label: strings.TrimSuffix(key, "s"), Value: trimmed, Source: "contract.metadata." + key})
			}
		}
		return out
	case []any:
		out := make([]model.ContractBriefSignal, 0, len(value))
		for _, item := range value {
			out = append(out, metadataSignalFromAny(item, key)...)
		}
		return out
	default:
		return metadataSignalFromAny(value, key)
	}
}

func metadataSignalFromAny(value any, key string) []model.ContractBriefSignal {
	switch typed := value.(type) {
	case string:
		if trimmed := strings.TrimSpace(typed); trimmed != "" {
			return []model.ContractBriefSignal{{Label: strings.TrimSuffix(key, "s"), Value: trimmed, Source: "contract.metadata." + key}}
		}
	case map[string]any:
		label := firstMetadataString(typed, "label", "title", "name")
		value := firstMetadataString(typed, "value", "description", "summary", "due_date")
		if value != "" {
			if label == "" {
				label = strings.TrimSuffix(key, "s")
			}
			source := firstMetadataString(typed, "source")
			if source == "" {
				source = "contract.metadata." + key
			}
			return []model.ContractBriefSignal{{Label: label, Value: value, Source: source}}
		}
	}
	return []model.ContractBriefSignal{}
}

func firstMetadataString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := metadata[key].(string); ok {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

func briefMetadata(metadata map[string]any) map[string]any {
	out := map[string]any{}
	for _, key := range []string{"brief_summary", "obligations", "renewal_signals"} {
		if value, ok := metadata[key]; ok {
			out[key] = value
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func briefDateRange(effectiveDate, expiryDate *time.Time) string {
	switch {
	case effectiveDate != nil && expiryDate != nil:
		return fmt.Sprintf("يسري من %s حتى %s", effectiveDate.UTC().Format("2006-01-02"), expiryDate.UTC().Format("2006-01-02"))
	case effectiveDate != nil:
		return fmt.Sprintf("يسري من %s", effectiveDate.UTC().Format("2006-01-02"))
	case expiryDate != nil:
		return fmt.Sprintf("تنتهي مدته في %s", expiryDate.UTC().Format("2006-01-02"))
	default:
		return ""
	}
}

func capSignals(items []model.ContractBriefSignal, limit int) []model.ContractBriefSignal {
	if len(items) <= limit {
		return items
	}
	return items[:limit]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func validateContractCreate(req dto.CreateContractRequest) error {
	fields := map[string]string{}
	if req.Title == "" {
		fields["title"] = "required"
	}
	if _, ok := allowedContractTypes[req.Type]; !ok {
		fields["type"] = "invalid"
	}
	if req.PartyAName == "" {
		fields["party_a_name"] = "required"
	}
	if req.PartyBName == "" {
		fields["party_b_name"] = "required"
	}
	if req.OwnerUserID == uuid.Nil {
		fields["owner_user_id"] = "required"
	}
	if req.OwnerName == "" {
		fields["owner_name"] = "required"
	}
	if req.RenewalNoticeDays < 0 {
		fields["renewal_notice_days"] = "must be >= 0"
	}
	if len(fields) > 0 {
		return validationError("invalid contract request", fields)
	}
	return nil
}

func normalizeContractMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(metadata))
	for key, value := range metadata {
		out[key] = value
	}
	return out
}

func validateContractForUpdate(contract *model.Contract) error {
	if contract == nil {
		return validationError("contract is required", map[string]string{"contract": "required"})
	}
	if strings.TrimSpace(contract.Title) == "" {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if _, ok := allowedContractTypes[contract.Type]; !ok {
		return validationError("type is invalid", map[string]string{"type": "invalid"})
	}
	return nil
}

func applyContractUpdate(contract *model.Contract, req dto.UpdateContractRequest) {
	if req.Title != nil {
		contract.Title = strings.TrimSpace(*req.Title)
	}
	if req.ContractNumber != nil {
		contract.ContractNumber = normalizeOptionalString(req.ContractNumber)
	}
	if req.Type != nil {
		contract.Type = *req.Type
	}
	if req.Description != nil {
		contract.Description = strings.TrimSpace(*req.Description)
	}
	if req.PartyAName != nil {
		contract.PartyAName = strings.TrimSpace(*req.PartyAName)
	}
	if req.PartyAEntity != nil {
		contract.PartyAEntity = normalizeOptionalString(req.PartyAEntity)
	}
	if req.PartyBName != nil {
		contract.PartyBName = strings.TrimSpace(*req.PartyBName)
	}
	if req.PartyBEntity != nil {
		contract.PartyBEntity = normalizeOptionalString(req.PartyBEntity)
	}
	if req.PartyBContact != nil {
		contract.PartyBContact = normalizeOptionalString(req.PartyBContact)
	}
	if req.TotalValue != nil {
		contract.TotalValue = req.TotalValue
	} else if req.ShouldClear("total_value") {
		contract.TotalValue = nil
	}
	if req.Currency != nil {
		trimmed := strings.ToUpper(strings.TrimSpace(*req.Currency))
		if trimmed != "" {
			contract.Currency = trimmed
		}
	}
	if req.PaymentTerms != nil {
		contract.PaymentTerms = normalizeOptionalString(req.PaymentTerms)
	}
	if req.EffectiveDate != nil {
		contract.EffectiveDate = req.EffectiveDate
	} else if req.ShouldClear("effective_date") {
		contract.EffectiveDate = nil
	}
	if req.ExpiryDate != nil {
		contract.ExpiryDate = req.ExpiryDate
	} else if req.ShouldClear("expiry_date") {
		contract.ExpiryDate = nil
	}
	if req.RenewalDate != nil {
		contract.RenewalDate = req.RenewalDate
	} else if req.ShouldClear("renewal_date") {
		contract.RenewalDate = nil
	}
	if req.AutoRenew != nil {
		contract.AutoRenew = *req.AutoRenew
	}
	if req.RenewalNoticeDays != nil {
		contract.RenewalNoticeDays = *req.RenewalNoticeDays
	}
	if req.SignedDate != nil {
		contract.SignedDate = req.SignedDate
	} else if req.ShouldClear("signed_date") {
		contract.SignedDate = nil
	}
	if req.OwnerUserID != nil {
		contract.OwnerUserID = *req.OwnerUserID
	}
	if req.OwnerName != nil {
		contract.OwnerName = strings.TrimSpace(*req.OwnerName)
	}
	if req.LegalReviewerID != nil {
		if *req.LegalReviewerID == uuid.Nil {
			contract.LegalReviewerID = nil
		} else {
			contract.LegalReviewerID = req.LegalReviewerID
		}
	}
	if req.LegalReviewerName != nil {
		contract.LegalReviewerName = normalizeOptionalString(req.LegalReviewerName)
	}
	if req.Department != nil {
		contract.Department = normalizeOptionalString(req.Department)
	}
	if req.OrgEntityID != nil {
		// Zero UUID unlinks, mirroring the LegalReviewerID convention.
		contract.OrgEntityID = normalizeOptionalUUID(req.OrgEntityID)
	} else if req.ShouldClear("org_entity_id") {
		contract.OrgEntityID = nil
	}
	if req.Tags != nil {
		contract.Tags = dto.NormalizeTags(req.Tags)
	}
	if req.Metadata != nil {
		contract.Metadata = req.Metadata
	}
}

func textOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func diffContractText(baseText, targetText string) ([]model.ContractRedlineSegment, int, int) {
	baseLines := splitRedlineLines(baseText)
	targetLines := splitRedlineLines(targetText)
	lcs := make([][]int, len(baseLines)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(targetLines)+1)
	}
	for i := len(baseLines) - 1; i >= 0; i-- {
		for j := len(targetLines) - 1; j >= 0; j-- {
			if baseLines[i] == targetLines[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
				continue
			}
			if lcs[i+1][j] >= lcs[i][j+1] {
				lcs[i][j] = lcs[i+1][j]
			} else {
				lcs[i][j] = lcs[i][j+1]
			}
		}
	}

	segments := make([]model.ContractRedlineSegment, 0, len(baseLines)+len(targetLines))
	added := 0
	removed := 0
	i, j := 0, 0
	for i < len(baseLines) && j < len(targetLines) {
		baseLine := i + 1
		targetLine := j + 1
		switch {
		case baseLines[i] == targetLines[j]:
			segments = append(segments, model.ContractRedlineSegment{
				Operation:  model.RedlineOperationEqual,
				BaseLine:   &baseLine,
				TargetLine: &targetLine,
				Text:       baseLines[i],
			})
			i++
			j++
		case lcs[i+1][j] >= lcs[i][j+1]:
			segments = append(segments, model.ContractRedlineSegment{
				Operation: model.RedlineOperationRemoved,
				BaseLine:  &baseLine,
				Text:      baseLines[i],
			})
			removed++
			i++
		default:
			segments = append(segments, model.ContractRedlineSegment{
				Operation:  model.RedlineOperationAdded,
				TargetLine: &targetLine,
				Text:       targetLines[j],
			})
			added++
			j++
		}
	}
	for i < len(baseLines) {
		baseLine := i + 1
		segments = append(segments, model.ContractRedlineSegment{
			Operation: model.RedlineOperationRemoved,
			BaseLine:  &baseLine,
			Text:      baseLines[i],
		})
		removed++
		i++
	}
	for j < len(targetLines) {
		targetLine := j + 1
		segments = append(segments, model.ContractRedlineSegment{
			Operation:  model.RedlineOperationAdded,
			TargetLine: &targetLine,
			Text:       targetLines[j],
		})
		added++
		j++
	}
	return segments, added, removed
}

func splitRedlineLines(text string) []string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return []string{}
	}
	return strings.Split(text, "\n")
}

func redlineLineCount(text string) int {
	return len(splitRedlineLines(text))
}

func reportSummary(contract model.Contract) model.ContractSummary {
	return model.ContractSummary{
		ID:         contract.ID,
		Title:      contract.Title,
		Type:       contract.Type,
		Status:     contract.Status,
		PartyBName: contract.PartyBName,
		// Financial fields feed the verb-gated report export; the handler
		// strips/masks them for callers without lex:contract:approve.
		TotalValue:     contract.TotalValue,
		Currency:       contract.Currency,
		RiskLevel:      contract.RiskLevel,
		RiskScore:      contract.RiskScore,
		ExpiryDate:     contract.ExpiryDate,
		CurrentVersion: contract.CurrentVersion,
		CreatedAt:      contract.CreatedAt,
	}
}

func contractReportFilters(filters model.ContractListFilters) map[string]string {
	out := map[string]string{}
	if filters.Search != "" {
		out["search"] = filters.Search
	}
	if filters.Status != nil {
		out["status"] = string(*filters.Status)
	}
	if filters.Type != nil {
		out["type"] = string(*filters.Type)
	}
	if filters.OwnerUserID != nil {
		out["owner_user_id"] = filters.OwnerUserID.String()
	}
	if filters.RiskLevel != nil {
		out["risk_level"] = string(*filters.RiskLevel)
	}
	if filters.Department != "" {
		out["department"] = filters.Department
	}
	if filters.Tag != "" {
		out["tag"] = filters.Tag
	}
	if filters.OrgEntityID != nil {
		out["org_entity_id"] = filters.OrgEntityID.String()
	}
	if filters.ExpiringInDays != nil {
		out["expiring_in_days"] = fmt.Sprintf("%d", *filters.ExpiringInDays)
	}
	return out
}
