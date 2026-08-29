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

	"github.com/clario360/platform/internal/lex/analyzer"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// clauseExtractor is the subset of analyzer.ClauseExtractor the playbook service
// needs. Declared as an interface so the service is testable without the full
// analyzer wiring.
type clauseExtractor interface {
	ExtractClauses(text string) ([]model.ExtractedClause, error)
}

// PlaybookService (WTQ-RSK-02) manages clause playbooks and runs clause-level
// deviation detection of a contract against its applicable playbook.
type PlaybookService struct {
	db        *pgxpool.Pool
	playbooks *repository.PlaybookRepository
	contracts *repository.ContractRepository
	clauses   *repository.ClauseRepository
	extractor clauseExtractor
	detector  *analyzer.DeviationDetector
	publisher Publisher
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewPlaybookService(
	db *pgxpool.Pool,
	playbooks *repository.PlaybookRepository,
	contracts *repository.ContractRepository,
	clauses *repository.ClauseRepository,
	extractor clauseExtractor,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *PlaybookService {
	return &PlaybookService{
		db:        db,
		playbooks: playbooks,
		contracts: contracts,
		clauses:   clauses,
		extractor: extractor,
		detector:  analyzer.NewDeviationDetector(),
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-playbooks").Logger(),
		now:       time.Now,
	}
}

func (s *PlaybookService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreatePlaybookRequest) (*model.ClausePlaybook, error) {
	req.Normalize()
	playbook, err := playbookFromRequest(tenantID, userID, req.Name, req.Description, req.ContractType, req.Status, req.Clauses, req.Metadata)
	if err != nil {
		return nil, err
	}
	if err := s.playbooks.Create(ctx, s.db, playbook); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a playbook with this name or active contract type already exists")
		}
		return nil, internalError("create clause playbook", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.created", tenantID, &userID, map[string]any{
		"id":            playbook.ID,
		"name":          playbook.Name,
		"contract_type": playbook.ContractType,
		"status":        playbook.Status,
	}, s.logger)
	return playbook, nil
}

func (s *PlaybookService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdatePlaybookRequest) (*model.ClausePlaybook, error) {
	req.Normalize()
	existing, err := s.playbooks.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load clause playbook", err)
	}
	updated, err := playbookFromRequest(tenantID, existing.CreatedBy, req.Name, req.Description, req.ContractType, req.Status, req.Clauses, req.Metadata)
	if err != nil {
		return nil, err
	}
	updated.ID = existing.ID
	if err := s.playbooks.Update(ctx, s.db, updated, userID); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a playbook with this name or active contract type already exists")
		}
		return nil, internalError("update clause playbook", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.updated", tenantID, &userID, map[string]any{
		"id":            updated.ID,
		"contract_type": updated.ContractType,
		"status":        updated.Status,
	}, s.logger)
	return updated, nil
}

func (s *PlaybookService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ClausePlaybook, error) {
	playbook, err := s.playbooks.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause playbook not found")
		}
		return nil, internalError("load clause playbook", err)
	}
	return playbook, nil
}

func (s *PlaybookService) List(ctx context.Context, tenantID uuid.UUID, filters model.PlaybookListFilters) ([]model.ClausePlaybook, int, error) {
	// Validate optional exact-match filters: an invalid contract_type/status is a
	// 400 rather than silently returning everything.
	if filters.ContractType != nil && !validContractType(*filters.ContractType) {
		return nil, 0, validationError("invalid contract_type filter", map[string]string{"contract_type": "invalid"})
	}
	if filters.Status != nil {
		switch *filters.Status {
		case model.PlaybookStatusDraft, model.PlaybookStatusActive, model.PlaybookStatusArchived:
		default:
			return nil, 0, validationError("invalid status filter", map[string]string{"status": "invalid"})
		}
	}
	items, total, err := s.playbooks.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list clause playbooks", err)
	}
	return items, total, nil
}

func (s *PlaybookService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.playbooks.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("clause playbook not found")
		}
		return internalError("delete clause playbook", err)
	}
	return nil
}

// DetectClauseDeviations compares a contract's clauses against the active
// playbook for its contract type and returns a deviation report. It prefers the
// contract's already-analyzed/stored clauses; if none exist it extracts clauses
// from the contract document text on the fly.
func (s *PlaybookService) DetectClauseDeviations(ctx context.Context, tenantID, contractID uuid.UUID) (*model.ClauseDeviationReport, error) {
	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}

	extracted, err := s.resolveContractClauses(ctx, tenantID, contract)
	if err != nil {
		return nil, err
	}

	playbook, err := s.playbooks.GetActiveByContractType(ctx, tenantID, contract.Type)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No applicable playbook: return an unmatched report rather than an error
			// so callers can render "no playbook configured for this contract type".
			report := s.detector.Detect(contractID, extracted, nil, s.now().UTC())
			report.ContractType = contract.Type
			return report, nil
		}
		return nil, internalError("load applicable playbook", err)
	}

	report := s.detector.Detect(contractID, extracted, playbook, s.now().UTC())
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.playbook.deviations_detected", tenantID, nil, deviationsDetectedPayload(contractID, playbook, report), s.logger)
	return report, nil
}

// DryRunDeviations runs the deviation detector against a contract using a
// SUPPLIED (unsaved/draft) playbook clause set rather than the stored active
// playbook for the contract type (WTQ-RSK-02 #8). This lets a playbook author test
// edited clauses before saving/activating. It does NOT persist anything and does
// NOT emit the deviations_detected event (it is a non-authoritative preview). The
// supplied clauses are validated exactly like a Create/Update request. When
// playbookID is non-nil, the stored draft/any playbook with that id is loaded and
// its clauses are used instead of the supplied list.
func (s *PlaybookService) DryRunDeviations(ctx context.Context, tenantID uuid.UUID, req dto.PlaybookDryRunRequest) (*model.ClauseDeviationReport, error) {
	if req.ContractID == uuid.Nil {
		return nil, validationError("contract_id is required", map[string]string{"contract_id": "required"})
	}
	contract, err := s.contracts.Get(ctx, tenantID, req.ContractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	extracted, err := s.resolveContractClauses(ctx, tenantID, contract)
	if err != nil {
		return nil, err
	}

	// Build the in-memory playbook to test against: either a stored playbook (by id)
	// or the supplied draft clause set.
	var playbook *model.ClausePlaybook
	if req.PlaybookID != nil {
		stored, err := s.playbooks.Get(ctx, tenantID, *req.PlaybookID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("clause playbook not found")
			}
			return nil, internalError("load clause playbook", err)
		}
		playbook = stored
	} else {
		contractType := req.ContractType
		if strings.TrimSpace(string(contractType)) == "" {
			contractType = contract.Type
		}
		// Reuse the canonical request validation; status is irrelevant for a dry-run so
		// default it to draft.
		built, err := playbookFromRequest(tenantID, uuid.Nil, "Dry-run playbook", "", contractType, model.PlaybookStatusDraft, req.Clauses, nil)
		if err != nil {
			return nil, err
		}
		playbook = built
	}

	detector := s.detector
	if req.Threshold > 0 && req.Threshold <= 1 {
		detector = analyzer.NewDeviationDetector(analyzer.WithDeviationThreshold(req.Threshold))
	}
	report := detector.Detect(contract.ID, extracted, playbook, s.now().UTC())
	return report, nil
}

// deviationsDetectedPayload builds the CloudEvent payload for a deviations_detected
// emission. It carries enough for downstream rules (#10): contract_id, playbook
// id/name, per-kind counts, compliance score, total standard clauses, the count of
// missing REQUIRED clauses, and the max deviation severity present.
func deviationsDetectedPayload(contractID uuid.UUID, playbook *model.ClausePlaybook, report *model.ClauseDeviationReport) map[string]any {
	missingRequired := 0
	maxSeverity := ""
	for _, d := range report.Deviations {
		if d.Kind == model.ClauseDeviationMissing && d.Required {
			missingRequired++
		}
		if severityRank(string(d.Severity)) > severityRank(maxSeverity) {
			maxSeverity = string(d.Severity)
		}
	}
	payload := map[string]any{
		"contract_id":            contractID,
		"playbook_id":            playbook.ID,
		"playbook_name":          playbook.Name,
		"contract_type":          string(report.ContractType),
		"total_standard_clauses": report.TotalStandard,
		"missing_count":          report.MissingCount,
		"missing_required_count": missingRequired,
		"altered_count":          report.AlteredCount,
		"extra_count":            report.ExtraCount,
		"compliance_score":       report.ComplianceScore,
		"max_severity":           maxSeverity,
	}
	return payload
}

// severityRank orders severities for max-severity computation (#10 / events).
func severityRank(s string) int {
	switch model.RiskLevel(strings.ToLower(strings.TrimSpace(s))) {
	case model.RiskLevelCritical:
		return 4
	case model.RiskLevelHigh:
		return 3
	case model.RiskLevelMedium:
		return 2
	case model.RiskLevelLow:
		return 1
	default:
		return 0
	}
}

// PortfolioMaxScan caps how many contracts the live portfolio aggregate will scan
// per request. Computing deviations is O(clauses) per contract, so the aggregate
// computes live within a bounded candidate set rather than across the whole tenant.
// COST NOTE: this is a synchronous, live computation — see Portfolio doc comment.
const PortfolioMaxScan = 200

// Portfolio computes a per-contract compliance summary against each contract's
// matched ACTIVE playbook (WTQ-RSK-02 #2). Only contracts whose contract type has a
// matched active playbook are returned. Filters: contract_type narrows the scan;
// min_score/max_score filter the returned rows by compliance_score (max_score is the
// "below X% compliance" triage knob); results are sorted by compliance_score
// (default ascending so the worst offenders surface first) and paginated.
//
// COST: deviations are computed LIVE per contract (no cached score store yet), so
// the aggregate scans at most PortfolioMaxScan contracts of the requested type per
// request and reports `scanned`/`truncated` so the caller can page the candidate
// set. Active playbooks are cached per contract type within the call. A future
// optimisation could persist the last computed score on a deviations_detected
// event and read it here instead of recomputing.
func (s *PlaybookService) Portfolio(ctx context.Context, tenantID uuid.UUID, filters model.PlaybookPortfolioFilters) ([]model.PlaybookComplianceRow, int, bool, error) {
	if filters.ContractType != nil && !validContractType(*filters.ContractType) {
		return nil, 0, false, validationError("invalid contract_type filter", map[string]string{"contract_type": "invalid"})
	}
	// Pull a bounded candidate set of contracts (newest first). We over-scan relative
	// to the requested page so score filters can drop non-qualifying rows.
	listFilters := model.ContractListFilters{Page: 1, PerPage: PortfolioMaxScan}
	if filters.ContractType != nil {
		ct := *filters.ContractType
		listFilters.Type = &ct
	}
	contracts, totalContracts, err := s.contracts.List(ctx, tenantID, listFilters)
	if err != nil {
		return nil, 0, false, internalError("list contracts for portfolio", err)
	}
	truncated := totalContracts > len(contracts)

	now := s.now().UTC()
	playbookCache := map[model.ContractType]*model.ClausePlaybook{}
	rows := make([]model.PlaybookComplianceRow, 0, len(contracts))
	for i := range contracts {
		contract := contracts[i]
		playbook, ok := playbookCache[contract.Type]
		if !ok {
			loaded, err := s.playbooks.GetActiveByContractType(ctx, tenantID, contract.Type)
			if err != nil && err != pgx.ErrNoRows {
				return nil, 0, false, internalError("load applicable playbook", err)
			}
			playbook = loaded // nil when none
			playbookCache[contract.Type] = playbook
		}
		if playbook == nil {
			continue // no matched active playbook -> excluded from the portfolio
		}
		extracted, err := s.resolveContractClausesForPortfolio(ctx, tenantID, &contract)
		if err != nil {
			// A contract with no analyzable clauses simply yields an all-missing report;
			// resolveContractClausesForPortfolio returns nil clauses for that case.
			return nil, 0, false, err
		}
		report := s.detector.Detect(contract.ID, extracted, playbook, now)
		if filters.MinScore != nil && report.ComplianceScore < *filters.MinScore {
			continue
		}
		if filters.MaxScore != nil && report.ComplianceScore > *filters.MaxScore {
			continue
		}
		rows = append(rows, model.PlaybookComplianceRow{
			ContractID:      contract.ID,
			ContractTitle:   contract.Title,
			ContractType:    contract.Type,
			PlaybookID:      playbook.ID,
			PlaybookName:    playbook.Name,
			ComplianceScore: report.ComplianceScore,
			MissingCount:    report.MissingCount,
			AlteredCount:    report.AlteredCount,
			ExtraCount:      report.ExtraCount,
			GeneratedAt:     report.GeneratedAt,
		})
	}

	// Sort by compliance_score; default ascending (worst first).
	desc := strings.EqualFold(filters.SortDirection, "desc")
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].ComplianceScore != rows[j].ComplianceScore {
			if desc {
				return rows[i].ComplianceScore > rows[j].ComplianceScore
			}
			return rows[i].ComplianceScore < rows[j].ComplianceScore
		}
		return rows[i].ContractID.String() < rows[j].ContractID.String()
	})

	total := len(rows)
	page := filters.Page
	if page < 1 {
		page = 1
	}
	perPage := filters.PerPage
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 100 {
		perPage = 100
	}
	start := (page - 1) * perPage
	if start >= total {
		return []model.PlaybookComplianceRow{}, total, truncated, nil
	}
	end := start + perPage
	if end > total {
		end = total
	}
	return rows[start:end], total, truncated, nil
}

// resolveContractClausesForPortfolio is a non-fatal variant of resolveContractClauses:
// a contract with neither stored clauses nor document text yields an empty clause set
// (so its report flags all required clauses missing) rather than a validation error.
func (s *PlaybookService) resolveContractClausesForPortfolio(ctx context.Context, tenantID uuid.UUID, contract *model.Contract) ([]model.ExtractedClause, error) {
	stored, err := s.clauses.ListByContract(ctx, tenantID, contract.ID)
	if err != nil {
		return nil, internalError("load contract clauses", err)
	}
	if len(stored) > 0 {
		return clausesToExtracted(stored), nil
	}
	if strings.TrimSpace(contract.DocumentText) == "" || s.extractor == nil {
		return []model.ExtractedClause{}, nil
	}
	extracted, err := s.extractor.ExtractClauses(contract.DocumentText)
	if err != nil {
		// Extraction failure on one contract shouldn't fail the whole portfolio; treat
		// as no clauses (all-missing report).
		s.logger.Warn().Err(err).Str("contract_id", contract.ID.String()).Msg("portfolio clause extraction failed; treating as no clauses")
		return []model.ExtractedClause{}, nil
	}
	return extracted, nil
}

// ListDeviationReviews returns the triage review rows for a contract (WTQ-RSK-02
// #3). It validates the contract exists in the tenant first so a bad id is a 404.
func (s *PlaybookService) ListDeviationReviews(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractClauseDeviationReview, error) {
	if _, err := s.contracts.Get(ctx, tenantID, contractID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	reviews, err := s.playbooks.ListDeviationReviews(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("list deviation reviews", err)
	}
	return reviews, nil
}

// UpsertDeviationReview records (insert-or-update) a reviewer's triage disposition
// of a per-clause-type deviation on a contract (WTQ-RSK-02 #3).
func (s *PlaybookService) UpsertDeviationReview(ctx context.Context, tenantID, userID, contractID uuid.UUID, clauseType string, req dto.DeviationReviewRequest) (*model.ContractClauseDeviationReview, error) {
	if _, err := s.contracts.Get(ctx, tenantID, contractID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	ct, ok := model.ParseClauseType(clauseType)
	if !ok {
		return nil, validationError("invalid clause_type", map[string]string{"clause_type": "invalid"})
	}
	status := model.DeviationReviewStatus(strings.TrimSpace(string(req.Status)))
	switch status {
	case model.DeviationReviewOpen, model.DeviationReviewAccepted, model.DeviationReviewRejected, model.DeviationReviewNeedsFix:
	default:
		return nil, validationError("invalid status", map[string]string{"status": "must be one of open|accepted|rejected|needs_fix"})
	}
	now := s.now().UTC()
	review := &model.ContractClauseDeviationReview{
		TenantID:   tenantID,
		ContractID: contractID,
		ClauseType: ct,
		Status:     status,
		Note:       strings.TrimSpace(req.Note),
		ReviewedBy: &userID,
		ReviewedAt: &now,
	}
	saved, err := s.playbooks.UpsertDeviationReview(ctx, review)
	if err != nil {
		return nil, internalError("upsert deviation review", err)
	}
	return saved, nil
}

// DeviationReportFilters narrows the deviations list returned for a contract's
// clause-deviation report (WTQ-RSK-02 #4). The whole-report counts and compliance
// score are computed against the FULL set first; these filters only restrict the
// returned `deviations` slice, so totals stay representative of the whole report.
type DeviationReportFilters struct {
	// Severities, when non-empty, keeps only deviations whose severity is in the set
	// (low|medium|high|critical).
	Severities []model.RiskLevel
	// Kinds, when non-empty, keeps only deviations whose kind is in the set
	// (missing|altered|extra).
	Kinds []model.ClauseDeviationKind
	// RequiredOnly keeps only deviations on required standard clauses.
	RequiredOnly bool
}

// HasAny reports whether any filter is active.
func (f DeviationReportFilters) HasAny() bool {
	return len(f.Severities) > 0 || len(f.Kinds) > 0 || f.RequiredOnly
}

// FilterReportDeviations returns a shallow copy of report with its Deviations slice
// filtered per f. The whole-report counts/score on the copy are left untouched
// (they describe the full report); only the deviations list is narrowed. A report
// with no filters active is returned unchanged.
func FilterReportDeviations(report *model.ClauseDeviationReport, f DeviationReportFilters) *model.ClauseDeviationReport {
	if report == nil || !f.HasAny() {
		return report
	}
	sevSet := map[model.RiskLevel]bool{}
	for _, s := range f.Severities {
		sevSet[s] = true
	}
	kindSet := map[model.ClauseDeviationKind]bool{}
	for _, k := range f.Kinds {
		kindSet[k] = true
	}
	filtered := make([]model.ClauseDeviation, 0, len(report.Deviations))
	for _, d := range report.Deviations {
		if len(sevSet) > 0 && !sevSet[d.Severity] {
			continue
		}
		if len(kindSet) > 0 && !kindSet[d.Kind] {
			continue
		}
		if f.RequiredOnly && !d.Required {
			continue
		}
		filtered = append(filtered, d)
	}
	out := *report
	out.Deviations = filtered
	return &out
}

// resolveContractClauses returns the contract's extracted clauses: stored
// analyzed clauses when present, otherwise a live extraction from document text.
func (s *PlaybookService) resolveContractClauses(ctx context.Context, tenantID uuid.UUID, contract *model.Contract) ([]model.ExtractedClause, error) {
	stored, err := s.clauses.ListByContract(ctx, tenantID, contract.ID)
	if err != nil {
		return nil, internalError("load contract clauses", err)
	}
	if len(stored) > 0 {
		return clausesToExtracted(stored), nil
	}
	if strings.TrimSpace(contract.DocumentText) == "" {
		return nil, validationError("contract has no analyzed clauses and no document text to extract from", map[string]string{"document_text": "missing"})
	}
	if s.extractor == nil {
		return nil, internalError("extract contract clauses", fmt.Errorf("no clause extractor configured"))
	}
	extracted, err := s.extractor.ExtractClauses(contract.DocumentText)
	if err != nil {
		return nil, internalError("extract contract clauses", err)
	}
	return extracted, nil
}

// clausesToExtracted converts stored clauses into the ExtractedClause shape the
// deviation detector consumes.
func clausesToExtracted(clauses []model.Clause) []model.ExtractedClause {
	out := make([]model.ExtractedClause, 0, len(clauses))
	for _, clause := range clauses {
		section := ""
		if clause.SectionReference != nil {
			section = *clause.SectionReference
		}
		out = append(out, model.ExtractedClause{
			ContractClauseID: clause.ID,
			ClauseType:       clause.ClauseType,
			PrimaryType:      clause.ClauseType,
			Title:            clause.Title,
			Content:          clause.Content,
			SectionReference: section,
			RiskLevel:        clause.RiskLevel,
			RiskScore:        clause.RiskScore,
			RiskKeywords:     clause.RiskKeywords,
		})
	}
	return out
}

func playbookFromRequest(tenantID, createdBy uuid.UUID, name, description string, contractType model.ContractType, status model.PlaybookStatus, clauses []dto.PlaybookClauseRequest, metadata map[string]any) (*model.ClausePlaybook, error) {
	fields := map[string]string{}
	if strings.TrimSpace(name) == "" {
		fields["name"] = "required"
	}
	if strings.TrimSpace(string(contractType)) == "" {
		fields["contract_type"] = "required"
	} else if !validContractType(contractType) {
		fields["contract_type"] = "invalid"
	}
	switch status {
	case model.PlaybookStatusDraft, model.PlaybookStatusActive, model.PlaybookStatusArchived:
	default:
		fields["status"] = "invalid"
	}
	if len(clauses) == 0 {
		fields["clauses"] = "at least one standard clause is required"
	}
	modelClauses := make([]model.PlaybookClause, 0, len(clauses))
	seen := map[model.ClauseType]bool{}
	for i, clause := range clauses {
		prefix := fmt.Sprintf("clauses.%d", i)
		if _, ok := model.ParseClauseType(string(clause.ClauseType)); !ok || clause.ClauseType == "" {
			fields[prefix+".clause_type"] = "invalid"
		}
		if seen[clause.ClauseType] {
			fields[prefix+".clause_type"] = "duplicate"
		}
		seen[clause.ClauseType] = true
		if clause.Required && strings.TrimSpace(clause.StandardText) == "" {
			fields[prefix+".standard_text"] = "required for a required clause"
		}
		if clause.RiskWeight < 0 || clause.RiskWeight > 1 {
			fields[prefix+".risk_weight"] = "must be between 0 and 1"
		}
		if clause.SimilarityThreshold < 0 || clause.SimilarityThreshold > 1 {
			fields[prefix+".similarity_threshold"] = "must be between 0 and 1"
		}
		weight := clause.RiskWeight
		if weight == 0 {
			weight = 1.0
		}
		modelClauses = append(modelClauses, model.PlaybookClause{
			ClauseType:          clause.ClauseType,
			Title:               clause.Title,
			StandardText:        clause.StandardText,
			Required:            clause.Required,
			RiskWeight:          weight,
			SimilarityThreshold: clause.SimilarityThreshold,
		})
	}
	if len(fields) > 0 {
		return nil, validationError("invalid clause playbook", fields)
	}
	return &model.ClausePlaybook{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Name:         name,
		Description:  description,
		ContractType: contractType,
		Status:       status,
		Clauses:      modelClauses,
		Metadata:     metadata,
		CreatedBy:    createdBy,
	}, nil
}

func validContractType(ct model.ContractType) bool {
	_, ok := allowedContractTypes[ct]
	return ok
}
