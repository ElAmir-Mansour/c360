package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type LibraryService struct {
	libraries *repository.LibraryRepository
	publisher Publisher
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewLibraryService(libraries *repository.LibraryRepository, publisher Publisher, topic string, logger zerolog.Logger) *LibraryService {
	return &LibraryService{
		libraries: libraries,
		publisher: publisherOrNoop(publisher),
		topic:     topic,
		logger:    logger.With().Str("service", "lex-libraries").Logger(),
		now:       time.Now,
	}
}

func (s *LibraryService) ListClauses(ctx context.Context, tenantID uuid.UUID, filters model.ClauseLibraryListFilters) ([]model.ClauseLibraryItem, int, error) {
	return s.libraries.ListClauses(ctx, tenantID, filters)
}

func (s *LibraryService) SearchClauses(ctx context.Context, tenantID uuid.UUID, filters model.ClauseLibrarySearchFilters) ([]model.ClauseLibrarySearchResult, int, error) {
	candidates, err := s.libraries.SearchClauseCandidates(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("search clause library", err)
	}
	results := rankClauseLibraryCandidates(candidates, filters)
	total := len(results)
	page, perPage := normalizeSearchPagination(filters.Page, filters.PerPage)
	return paginateClauseSearchResults(results, page, perPage), total, nil
}

func (s *LibraryService) GetClause(ctx context.Context, tenantID, id uuid.UUID) (*model.ClauseLibraryItem, error) {
	item, err := s.libraries.GetClause(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("clause library item not found")
		}
		return nil, internalError("get clause library item", err)
	}
	return item, nil
}

func (s *LibraryService) CreateClause(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateClauseLibraryItemRequest) (*model.ClauseLibraryItem, error) {
	req.Normalize()
	if err := validateCreateClauseLibraryRequest(req); err != nil {
		return nil, err
	}
	item := &model.ClauseLibraryItem{
		ID:               uuid.New(),
		TenantID:         tenantID,
		Code:             req.Code,
		TitleEN:          req.TitleEN,
		TitleAR:          req.TitleAR,
		TextEN:           req.TextEN,
		TextAR:           req.TextAR,
		ClauseType:       req.ClauseType,
		Category:         req.Category,
		Jurisdiction:     req.Jurisdiction,
		Source:           req.Source,
		SourceURL:        nonEmptyStringPtr(req.SourceURL),
		Version:          req.Version,
		Status:           req.Status,
		GovernanceStatus: req.GovernanceStatus,
		SupersedesID:     req.SupersedesID,
		DeprecatedByID:   req.DeprecatedByID,
		Tags:             req.Tags,
		Metadata:         req.Metadata,
		CreatedBy:        userID,
		UpdatedBy:        &userID,
	}
	if item.Status == model.ClauseLibraryStatusDeprecated {
		now := s.now().UTC()
		item.DeprecatedAt = &now
	}
	if err := s.libraries.CreateClause(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("create clause library item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause_library.created", tenantID, &userID, map[string]any{
		"id":                item.ID,
		"code":              item.Code,
		"version":           item.Version,
		"governance_status": item.GovernanceStatus,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) UpdateClause(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateClauseLibraryItemRequest) (*model.ClauseLibraryItem, error) {
	item, err := s.GetClause(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	applyClauseLibraryUpdate(item, req)
	item.UpdatedBy = &userID
	if err := validateClauseLibraryItem(item); err != nil {
		return nil, err
	}
	if item.Status == model.ClauseLibraryStatusDeprecated && item.DeprecatedAt == nil {
		now := s.now().UTC()
		item.DeprecatedAt = &now
	}
	if item.Status != model.ClauseLibraryStatusDeprecated {
		item.DeprecatedAt = nil
	}
	if err := s.libraries.UpdateClause(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("update clause library item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause_library.updated", tenantID, &userID, map[string]any{
		"id":                item.ID,
		"code":              item.Code,
		"version":           item.Version,
		"status":            item.Status,
		"governance_status": item.GovernanceStatus,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) DecideClauseGovernance(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.LibraryGovernanceDecisionRequest) (*model.ClauseLibraryItem, error) {
	req.Normalize()
	if err := validateLibraryGovernanceDecision(req); err != nil {
		return nil, err
	}
	item, err := s.GetClause(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}

	decidedAt := s.now().UTC()
	previousStatus := item.Status
	previousGovernanceStatus := item.GovernanceStatus
	switch req.Decision {
	case "submit_review":
		item.GovernanceStatus = model.ClauseGovernancePendingReview
		if item.Status == model.ClauseLibraryStatusActive {
			item.Status = model.ClauseLibraryStatusDraft
		}
	case "approve":
		item.GovernanceStatus = model.ClauseGovernanceApproved
		if req.Activate {
			item.Status = model.ClauseLibraryStatusActive
		}
	case "reject":
		item.GovernanceStatus = model.ClauseGovernanceRejected
		if item.Status == model.ClauseLibraryStatusActive {
			item.Status = model.ClauseLibraryStatusDraft
		}
	}
	item.Metadata = appendLibraryGovernanceMetadata(item.Metadata, "clause_library", req, userID, decidedAt, map[string]any{
		"previous_status":            previousStatus,
		"status":                     item.Status,
		"previous_governance_status": previousGovernanceStatus,
		"governance_status":          item.GovernanceStatus,
	})
	item.UpdatedBy = &userID
	if err := validateClauseLibraryItem(item); err != nil {
		return nil, err
	}
	if err := s.libraries.UpdateClause(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("decide clause library governance", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.clause_library.governance_decided", tenantID, &userID, map[string]any{
		"id":                         item.ID,
		"code":                       item.Code,
		"decision":                   req.Decision,
		"previous_status":            previousStatus,
		"status":                     item.Status,
		"previous_governance_status": previousGovernanceStatus,
		"governance_status":          item.GovernanceStatus,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) DeleteClause(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.libraries.SoftDeleteClause(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("clause library item not found")
		}
		return internalError("delete clause library item", err)
	}
	return nil
}

func (s *LibraryService) ListRegulations(ctx context.Context, tenantID uuid.UUID, filters model.RegulationLibraryListFilters) ([]model.RegulationLibraryItem, int, error) {
	return s.libraries.ListRegulations(ctx, tenantID, filters)
}

func (s *LibraryService) SearchRegulations(ctx context.Context, tenantID uuid.UUID, filters model.RegulationLibrarySearchFilters) ([]model.RegulationLibrarySearchResult, int, error) {
	candidates, err := s.libraries.SearchRegulationCandidates(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("search regulation library", err)
	}
	results := rankRegulationLibraryCandidates(candidates, filters)
	total := len(results)
	page, perPage := normalizeSearchPagination(filters.Page, filters.PerPage)
	return paginateRegulationSearchResults(results, page, perPage), total, nil
}

func (s *LibraryService) GetRegulation(ctx context.Context, tenantID, id uuid.UUID) (*model.RegulationLibraryItem, error) {
	item, err := s.libraries.GetRegulation(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("regulation library item not found")
		}
		return nil, internalError("get regulation library item", err)
	}
	return item, nil
}

func (s *LibraryService) CreateRegulation(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateRegulationLibraryItemRequest) (*model.RegulationLibraryItem, error) {
	req.Normalize()
	if err := validateCreateRegulationLibraryRequest(req); err != nil {
		return nil, err
	}
	item := &model.RegulationLibraryItem{
		ID:             uuid.New(),
		TenantID:       tenantID,
		Code:           req.Code,
		TitleEN:        req.TitleEN,
		TitleAR:        req.TitleAR,
		DescriptionEN:  req.DescriptionEN,
		DescriptionAR:  req.DescriptionAR,
		Jurisdiction:   req.Jurisdiction,
		Authority:      req.Authority,
		Source:         req.Source,
		SourceURL:      nonEmptyStringPtr(req.SourceURL),
		RegulationType: req.RegulationType,
		EffectiveDate:  req.EffectiveDate,
		Version:        req.Version,
		Status:         req.Status,
		Tags:           req.Tags,
		Metadata:       req.Metadata,
		CreatedBy:      userID,
		UpdatedBy:      &userID,
	}
	if err := s.libraries.CreateRegulation(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("create regulation library item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.regulation_library.created", tenantID, &userID, map[string]any{
		"id":           item.ID,
		"code":         item.Code,
		"jurisdiction": item.Jurisdiction,
		"status":       item.Status,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) UpdateRegulation(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateRegulationLibraryItemRequest) (*model.RegulationLibraryItem, error) {
	item, err := s.GetRegulation(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	applyRegulationLibraryUpdate(item, req)
	item.UpdatedBy = &userID
	if err := validateRegulationLibraryItem(item); err != nil {
		return nil, err
	}
	if err := s.libraries.UpdateRegulation(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("update regulation library item", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.regulation_library.updated", tenantID, &userID, map[string]any{
		"id":           item.ID,
		"code":         item.Code,
		"jurisdiction": item.Jurisdiction,
		"status":       item.Status,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) DecideRegulationGovernance(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.LibraryGovernanceDecisionRequest) (*model.RegulationLibraryItem, error) {
	req.Normalize()
	if err := validateLibraryGovernanceDecision(req); err != nil {
		return nil, err
	}
	item, err := s.GetRegulation(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}

	decidedAt := s.now().UTC()
	previousStatus := item.Status
	switch req.Decision {
	case "submit_review":
		if item.Status == "" {
			item.Status = model.RegulationStatusDraft
		}
	case "approve":
		if req.Activate || item.Status == model.RegulationStatusDraft {
			item.Status = model.RegulationStatusActive
		}
	case "reject":
		if item.Status == model.RegulationStatusActive {
			item.Status = model.RegulationStatusDraft
		}
	}
	item.Metadata = appendLibraryGovernanceMetadata(item.Metadata, "regulation_library", req, userID, decidedAt, map[string]any{
		"previous_status": previousStatus,
		"status":          item.Status,
	})
	item.UpdatedBy = &userID
	if err := validateRegulationLibraryItem(item); err != nil {
		return nil, err
	}
	if err := s.libraries.UpdateRegulation(ctx, s.libraries.DB(), item); err != nil {
		return nil, internalError("decide regulation library governance", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.regulation_library.governance_decided", tenantID, &userID, map[string]any{
		"id":              item.ID,
		"code":            item.Code,
		"decision":        req.Decision,
		"previous_status": previousStatus,
		"status":          item.Status,
	}, s.logger)
	return item, nil
}

func (s *LibraryService) DeleteRegulation(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.libraries.SoftDeleteRegulation(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("regulation library item not found")
		}
		return internalError("delete regulation library item", err)
	}
	return nil
}

func (s *LibraryService) LinkRegulationClause(ctx context.Context, tenantID, userID, regulationID uuid.UUID, req dto.CreateRegulationClauseReferenceRequest) (*model.RegulationClauseReference, error) {
	req.Normalize()
	if req.ClauseID == uuid.Nil {
		return nil, validationError("clause_id is required", map[string]string{"clause_id": "required"})
	}
	if !validReferenceType(req.ReferenceType) {
		return nil, validationError("invalid regulation clause reference type", map[string]string{"reference_type": "invalid"})
	}
	if _, err := s.GetRegulation(ctx, tenantID, regulationID); err != nil {
		return nil, err
	}
	if _, err := s.GetClause(ctx, tenantID, req.ClauseID); err != nil {
		return nil, err
	}
	ref := &model.RegulationClauseReference{
		ID:            uuid.New(),
		TenantID:      tenantID,
		RegulationID:  regulationID,
		ClauseID:      req.ClauseID,
		ReferenceType: req.ReferenceType,
		Notes:         req.Notes,
		CreatedBy:     userID,
	}
	if err := s.libraries.UpsertRegulationClauseReference(ctx, s.libraries.DB(), ref); err != nil {
		return nil, internalError("link regulation clause reference", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.regulation_clause_reference.linked", tenantID, &userID, map[string]any{
		"regulation_id":  regulationID,
		"clause_id":      req.ClauseID,
		"reference_type": req.ReferenceType,
	}, s.logger)
	return ref, nil
}

func (s *LibraryService) UnlinkRegulationClause(ctx context.Context, tenantID, regulationID, clauseID uuid.UUID, referenceType model.RegulationClauseReferenceType) error {
	if referenceType == "" {
		referenceType = model.RegulationClauseReferenceImplements
	}
	if !validReferenceType(referenceType) {
		return validationError("invalid regulation clause reference type", map[string]string{"reference_type": "invalid"})
	}
	if err := s.libraries.DeleteRegulationClauseReference(ctx, tenantID, regulationID, clauseID, referenceType); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("regulation clause reference not found")
		}
		return internalError("unlink regulation clause reference", err)
	}
	return nil
}

func validateCreateClauseLibraryRequest(req dto.CreateClauseLibraryItemRequest) error {
	item := &model.ClauseLibraryItem{
		Code:             req.Code,
		TitleEN:          req.TitleEN,
		TitleAR:          req.TitleAR,
		TextEN:           req.TextEN,
		TextAR:           req.TextAR,
		ClauseType:       req.ClauseType,
		Category:         req.Category,
		Jurisdiction:     req.Jurisdiction,
		Version:          req.Version,
		Status:           req.Status,
		GovernanceStatus: req.GovernanceStatus,
	}
	return validateClauseLibraryItem(item)
}

func validateClauseLibraryItem(item *model.ClauseLibraryItem) error {
	fields := map[string]string{}
	required(fields, "code", item.Code)
	required(fields, "title_en", item.TitleEN)
	required(fields, "title_ar", item.TitleAR)
	required(fields, "text_en", item.TextEN)
	required(fields, "text_ar", item.TextAR)
	required(fields, "jurisdiction", item.Jurisdiction)
	if !validClauseType(item.ClauseType) {
		fields["clause_type"] = "invalid"
	}
	if item.Version < 1 {
		fields["version"] = "must be greater than zero"
	}
	if !validClauseLibraryStatus(item.Status) {
		fields["status"] = "invalid"
	}
	if !validClauseGovernanceStatus(item.GovernanceStatus) {
		fields["governance_status"] = "invalid"
	}
	if item.Status == model.ClauseLibraryStatusActive && item.GovernanceStatus != model.ClauseGovernanceApproved {
		fields["governance_status"] = "active clauses must be approved"
	}
	if len(fields) > 0 {
		return validationError("invalid clause library item", fields)
	}
	return nil
}

func validateCreateRegulationLibraryRequest(req dto.CreateRegulationLibraryItemRequest) error {
	item := &model.RegulationLibraryItem{
		Code:           req.Code,
		TitleEN:        req.TitleEN,
		TitleAR:        req.TitleAR,
		Jurisdiction:   req.Jurisdiction,
		RegulationType: req.RegulationType,
		Version:        req.Version,
		Status:         req.Status,
	}
	return validateRegulationLibraryItem(item)
}

func validateRegulationLibraryItem(item *model.RegulationLibraryItem) error {
	fields := map[string]string{}
	required(fields, "code", item.Code)
	required(fields, "title_en", item.TitleEN)
	required(fields, "title_ar", item.TitleAR)
	required(fields, "jurisdiction", item.Jurisdiction)
	if !validRegulationType(item.RegulationType) {
		fields["regulation_type"] = "invalid"
	}
	if item.Version < 1 {
		fields["version"] = "must be greater than zero"
	}
	if !validRegulationStatus(item.Status) {
		fields["status"] = "invalid"
	}
	if len(fields) > 0 {
		return validationError("invalid regulation library item", fields)
	}
	return nil
}

func validateLibraryGovernanceDecision(req dto.LibraryGovernanceDecisionRequest) error {
	switch req.Decision {
	case "submit_review", "approve", "reject":
		return nil
	default:
		return validationError("invalid library governance decision", map[string]string{"decision": "must be submit_review, approve, or reject"})
	}
}

func applyClauseLibraryUpdate(item *model.ClauseLibraryItem, req dto.UpdateClauseLibraryItemRequest) {
	if req.Code != nil {
		item.Code = strings.TrimSpace(*req.Code)
	}
	if req.TitleEN != nil {
		item.TitleEN = strings.TrimSpace(*req.TitleEN)
	}
	if req.TitleAR != nil {
		item.TitleAR = strings.TrimSpace(*req.TitleAR)
	}
	if req.TextEN != nil {
		item.TextEN = strings.TrimSpace(*req.TextEN)
	}
	if req.TextAR != nil {
		item.TextAR = strings.TrimSpace(*req.TextAR)
	}
	if req.ClauseType != nil {
		item.ClauseType = *req.ClauseType
	}
	if req.Category != nil {
		item.Category = strings.TrimSpace(*req.Category)
	}
	if req.Jurisdiction != nil {
		item.Jurisdiction = strings.ToUpper(strings.TrimSpace(*req.Jurisdiction))
	}
	if req.Source != nil {
		item.Source = strings.TrimSpace(*req.Source)
	}
	if req.SourceURL != nil {
		item.SourceURL = nonEmptyStringPtr(*req.SourceURL)
	}
	if req.Version != nil {
		item.Version = *req.Version
	}
	if req.Status != nil {
		item.Status = *req.Status
	}
	if req.GovernanceStatus != nil {
		item.GovernanceStatus = *req.GovernanceStatus
	}
	if req.SupersedesID != nil {
		item.SupersedesID = req.SupersedesID
	}
	if req.DeprecatedByID != nil {
		item.DeprecatedByID = req.DeprecatedByID
	}
	if req.Tags != nil {
		item.Tags = normalizeServiceStrings(req.Tags)
	}
	if req.Metadata != nil {
		item.Metadata = req.Metadata
	}
}

func applyRegulationLibraryUpdate(item *model.RegulationLibraryItem, req dto.UpdateRegulationLibraryItemRequest) {
	if req.Code != nil {
		item.Code = strings.TrimSpace(*req.Code)
	}
	if req.TitleEN != nil {
		item.TitleEN = strings.TrimSpace(*req.TitleEN)
	}
	if req.TitleAR != nil {
		item.TitleAR = strings.TrimSpace(*req.TitleAR)
	}
	if req.DescriptionEN != nil {
		item.DescriptionEN = strings.TrimSpace(*req.DescriptionEN)
	}
	if req.DescriptionAR != nil {
		item.DescriptionAR = strings.TrimSpace(*req.DescriptionAR)
	}
	if req.Jurisdiction != nil {
		item.Jurisdiction = strings.ToUpper(strings.TrimSpace(*req.Jurisdiction))
	}
	if req.Authority != nil {
		item.Authority = strings.TrimSpace(*req.Authority)
	}
	if req.Source != nil {
		item.Source = strings.TrimSpace(*req.Source)
	}
	if req.SourceURL != nil {
		item.SourceURL = nonEmptyStringPtr(*req.SourceURL)
	}
	if req.RegulationType != nil {
		item.RegulationType = *req.RegulationType
	}
	if req.EffectiveDate != nil {
		item.EffectiveDate = req.EffectiveDate
	}
	if req.Version != nil {
		item.Version = *req.Version
	}
	if req.Status != nil {
		item.Status = *req.Status
	}
	if req.Tags != nil {
		item.Tags = normalizeServiceStrings(req.Tags)
	}
	if req.Metadata != nil {
		item.Metadata = req.Metadata
	}
}

func required(fields map[string]string, key, value string) {
	if strings.TrimSpace(value) == "" {
		fields[key] = "required"
	}
}

func nonEmptyStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func normalizeServiceStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func appendLibraryGovernanceMetadata(metadata map[string]any, resource string, req dto.LibraryGovernanceDecisionRequest, userID uuid.UUID, decidedAt time.Time, status map[string]any) map[string]any {
	out := cloneLibraryMetadata(metadata)
	entry := map[string]any{
		"resource":   resource,
		"decision":   req.Decision,
		"activate":   req.Activate,
		"decided_by": userID.String(),
		"decided_at": decidedAt.Format(time.RFC3339),
	}
	if req.Notes != "" {
		entry["notes"] = req.Notes
	}
	if len(req.Evidence) > 0 {
		entry["evidence"] = cloneLibraryMetadata(req.Evidence)
	}
	for key, value := range status {
		entry[key] = value
	}
	out["governance"] = entry
	history := make([]any, 0)
	if raw, ok := out["governance_history"].([]any); ok {
		history = append(history, raw...)
	}
	history = append(history, entry)
	out["governance_history"] = history
	return out
}

func cloneLibraryMetadata(metadata map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range metadata {
		out[key] = value
	}
	return out
}

func validClauseType(value model.ClauseType) bool {
	for _, clauseType := range model.AllClauseTypes() {
		if value == clauseType {
			return true
		}
	}
	return value == model.ClauseTypeOther
}

func validClauseLibraryStatus(value model.ClauseLibraryStatus) bool {
	switch value {
	case model.ClauseLibraryStatusDraft, model.ClauseLibraryStatusActive, model.ClauseLibraryStatusDeprecated, model.ClauseLibraryStatusArchived:
		return true
	default:
		return false
	}
}

func validClauseGovernanceStatus(value model.ClauseGovernanceStatus) bool {
	switch value {
	case model.ClauseGovernancePendingReview, model.ClauseGovernanceApproved, model.ClauseGovernanceRejected:
		return true
	default:
		return false
	}
}

func validRegulationStatus(value model.RegulationStatus) bool {
	switch value {
	case model.RegulationStatusDraft, model.RegulationStatusActive, model.RegulationStatusSuperseded, model.RegulationStatusDeprecated, model.RegulationStatusArchived:
		return true
	default:
		return false
	}
}

func validRegulationType(value model.RegulationType) bool {
	switch value {
	case model.RegulationTypeLaw, model.RegulationTypeRegulation, model.RegulationTypeCircular, model.RegulationTypeGuidance, model.RegulationTypeStandard, model.RegulationTypePolicy, model.RegulationTypeOther:
		return true
	default:
		return false
	}
}

func validReferenceType(value model.RegulationClauseReferenceType) bool {
	switch value {
	case model.RegulationClauseReferenceImplements, model.RegulationClauseReferenceRequiredBy, model.RegulationClauseReferenceRecommendedBy, model.RegulationClauseReferenceImpactedBy, model.RegulationClauseReferenceRelated:
		return true
	default:
		return false
	}
}

type librarySearchField struct {
	name     string
	value    string
	weight   float64
	language string
}

func rankClauseLibraryCandidates(candidates []model.ClauseLibrarySearchCandidate, filters model.ClauseLibrarySearchFilters) []model.ClauseLibrarySearchResult {
	query := strings.TrimSpace(filters.Query)
	results := make([]model.ClauseLibrarySearchResult, 0, len(candidates))
	for _, candidate := range candidates {
		score, matchedFields, snippets, metadata := scoreLibrarySearchFields(query, filters.Language, filters.Semantic, clauseLibrarySearchFields(candidate))
		if query != "" && score == 0 {
			continue
		}
		results = append(results, model.ClauseLibrarySearchResult{
			Item:          candidate.Item,
			Score:         score,
			MatchedFields: matchedFields,
			Snippets:      snippets,
			Metadata:      metadata,
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		if !results[i].Item.UpdatedAt.Equal(results[j].Item.UpdatedAt) {
			return results[i].Item.UpdatedAt.After(results[j].Item.UpdatedAt)
		}
		return results[i].Item.Code < results[j].Item.Code
	})
	return results
}

func rankRegulationLibraryCandidates(candidates []model.RegulationLibrarySearchCandidate, filters model.RegulationLibrarySearchFilters) []model.RegulationLibrarySearchResult {
	query := strings.TrimSpace(filters.Query)
	results := make([]model.RegulationLibrarySearchResult, 0, len(candidates))
	for _, candidate := range candidates {
		score, matchedFields, snippets, metadata := scoreLibrarySearchFields(query, filters.Language, filters.Semantic, regulationLibrarySearchFields(candidate))
		if query != "" && score == 0 {
			continue
		}
		results = append(results, model.RegulationLibrarySearchResult{
			Item:          candidate.Item,
			Score:         score,
			MatchedFields: matchedFields,
			Snippets:      snippets,
			Metadata:      metadata,
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		if !results[i].Item.UpdatedAt.Equal(results[j].Item.UpdatedAt) {
			return results[i].Item.UpdatedAt.After(results[j].Item.UpdatedAt)
		}
		return results[i].Item.Code < results[j].Item.Code
	})
	return results
}

func clauseLibrarySearchFields(candidate model.ClauseLibrarySearchCandidate) []librarySearchField {
	item := candidate.Item
	return []librarySearchField{
		{name: "code", value: item.Code, weight: 8},
		{name: "title_en", value: item.TitleEN, weight: 7, language: "en"},
		{name: "title_ar", value: item.TitleAR, weight: 7, language: "ar"},
		{name: "text_en", value: item.TextEN, weight: 4, language: "en"},
		{name: "text_ar", value: item.TextAR, weight: 4, language: "ar"},
		{name: "tags", value: strings.Join(item.Tags, " "), weight: 5},
		{name: "jurisdiction", value: item.Jurisdiction, weight: 2.5},
		{name: "category", value: item.Category, weight: 3.5},
		{name: "clause_type", value: string(item.ClauseType), weight: 3},
		{name: "status", value: string(item.Status), weight: 1.5},
		{name: "governance_status", value: string(item.GovernanceStatus), weight: 1.5},
		{name: "risk_level", value: libraryRiskLevel(item.Metadata), weight: 4},
		{name: "regulation_mappings", value: candidate.RegulationText, weight: 4.5},
	}
}

func regulationLibrarySearchFields(candidate model.RegulationLibrarySearchCandidate) []librarySearchField {
	item := candidate.Item
	return []librarySearchField{
		{name: "code", value: item.Code, weight: 8},
		{name: "title_en", value: item.TitleEN, weight: 7, language: "en"},
		{name: "title_ar", value: item.TitleAR, weight: 7, language: "ar"},
		{name: "description_en", value: item.DescriptionEN, weight: 4, language: "en"},
		{name: "description_ar", value: item.DescriptionAR, weight: 4, language: "ar"},
		{name: "tags", value: strings.Join(item.Tags, " "), weight: 5},
		{name: "jurisdiction", value: item.Jurisdiction, weight: 2.5},
		{name: "authority", value: item.Authority, weight: 4},
		{name: "regulation_type", value: string(item.RegulationType), weight: 3},
		{name: "status", value: string(item.Status), weight: 1.5},
		{name: "risk_level", value: libraryRiskLevel(item.Metadata), weight: 4},
		{name: "clause_mappings", value: candidate.ClauseText, weight: 4.5},
	}
}

func scoreLibrarySearchFields(query, language string, semantic bool, fields []librarySearchField) (float64, []string, map[string]string, map[string]any) {
	query = strings.TrimSpace(query)
	if query == "" {
		return 0, nil, nil, nil
	}
	tokens := searchTokens(query)
	if len(tokens) == 0 {
		return 0, nil, nil, nil
	}
	language = normalizeSearchLanguage(language)
	normalizedQuery := normalizeSearchText(query)
	semanticQueryVector := map[string]float64(nil)
	if semantic {
		semanticQueryVector = librarySemanticVector(tokens)
	}
	totalScore := 0.0
	lexicalScore := 0.0
	semanticScore := 0.0
	fieldScores := map[string]float64{}
	semanticFieldScores := map[string]float64{}
	semanticDimensions := map[string]struct{}{}
	snippets := map[string]string{}
	for _, field := range fields {
		if !librarySearchLanguageAllowed(field.language, language) {
			continue
		}
		fieldLexicalScore := scoreLibrarySearchField(normalizedQuery, tokens, field.value, field.weight)
		fieldSemanticScore := 0.0
		semanticSnippetTokens := []string(nil)
		if semantic {
			var matchedDimensions []string
			fieldSemanticScore, semanticSnippetTokens, matchedDimensions = scoreLibrarySemanticField(semanticQueryVector, field.value, field.weight)
			if fieldSemanticScore > 0 {
				semanticFieldScores[field.name] += fieldSemanticScore
				for _, dimension := range matchedDimensions {
					semanticDimensions[dimension] = struct{}{}
				}
			}
		}
		fieldScore := fieldLexicalScore + fieldSemanticScore
		if fieldScore == 0 {
			continue
		}
		totalScore += fieldScore
		lexicalScore += fieldLexicalScore
		semanticScore += fieldSemanticScore
		fieldScores[field.name] += fieldScore
		if strings.TrimSpace(field.value) != "" {
			snippets[field.name] = librarySearchSnippet(field.value, query, append(tokens, semanticSnippetTokens...))
		}
	}
	if totalScore == 0 {
		return 0, nil, nil, nil
	}
	matchedFields := make([]string, 0, len(fieldScores))
	for field := range fieldScores {
		matchedFields = append(matchedFields, field)
	}
	sort.Slice(matchedFields, func(i, j int) bool {
		left, right := matchedFields[i], matchedFields[j]
		if fieldScores[left] != fieldScores[right] {
			return fieldScores[left] > fieldScores[right]
		}
		return left < right
	})
	metadata := map[string]any(nil)
	if semantic {
		metadata = librarySemanticSearchMetadata(semanticQueryVector, lexicalScore, semanticScore, semanticFieldScores, semanticDimensions)
	}
	return totalScore, matchedFields, snippets, metadata
}

func scoreLibrarySearchField(normalizedQuery string, tokens []string, value string, weight float64) float64 {
	normalizedValue := normalizeSearchText(value)
	if normalizedValue == "" {
		return 0
	}
	score := 0.0
	if normalizedQuery != "" && strings.Contains(normalizedValue, normalizedQuery) {
		score += weight * 3
		if strings.HasPrefix(normalizedValue, normalizedQuery) {
			score += weight
		}
	}
	matchedTokens := 0
	for _, token := range tokens {
		if strings.Contains(normalizedValue, token) {
			matchedTokens++
			score += weight
		}
	}
	if matchedTokens == len(tokens) && len(tokens) > 1 {
		score += weight * 1.5
	}
	return score
}

func scoreLibrarySemanticField(queryVector map[string]float64, value string, weight float64) (float64, []string, []string) {
	if len(queryVector) == 0 || strings.TrimSpace(value) == "" {
		return 0, nil, nil
	}
	fieldTokens := searchTokens(value)
	fieldVector := librarySemanticVector(fieldTokens)
	if len(fieldVector) == 0 {
		return 0, nil, nil
	}
	matchedDimensions := commonSemanticDimensions(queryVector, fieldVector)
	if !hasMeaningfulSemanticDimension(matchedDimensions) {
		return 0, nil, nil
	}
	similarity := cosineLibraryVectorSimilarity(queryVector, fieldVector)
	if similarity < 0.12 {
		return 0, nil, nil
	}
	score := similarity * weight * 5
	return score, semanticSnippetTokens(fieldTokens, matchedDimensions), matchedDimensions
}

func librarySemanticSearchMetadata(queryVector map[string]float64, lexicalScore, semanticScore float64, semanticFieldScores map[string]float64, semanticDimensions map[string]struct{}) map[string]any {
	matchedFields := make([]string, 0, len(semanticFieldScores))
	for field := range semanticFieldScores {
		matchedFields = append(matchedFields, field)
	}
	sort.Slice(matchedFields, func(i, j int) bool {
		left, right := matchedFields[i], matchedFields[j]
		if semanticFieldScores[left] != semanticFieldScores[right] {
			return semanticFieldScores[left] > semanticFieldScores[right]
		}
		return left < right
	})

	matchedDimensions := make([]string, 0, len(semanticDimensions))
	for dimension := range semanticDimensions {
		matchedDimensions = append(matchedDimensions, dimension)
	}
	sort.Strings(matchedDimensions)

	return map[string]any{
		"search_mode":                 "semantic",
		"semantic_backend":            "deterministic_local_vector",
		"lexical_score":               roundLibrarySearchScore(lexicalScore),
		"semantic_score":              roundLibrarySearchScore(semanticScore),
		"query_vector_dimensions":     len(queryVector),
		"matched_semantic_dimensions": matchedDimensions,
		"matched_semantic_fields":     matchedFields,
	}
}

func roundLibrarySearchScore(score float64) float64 {
	return math.Round(score*1000) / 1000
}

var librarySemanticConceptTerms = map[string][]string{
	"audit": {
		"audit", "inspect", "inspection", "record", "records", "evidence", "verify", "verification", "review",
	},
	"breach_notice": {
		"breach", "incident", "notify", "notification", "notice", "disclosure", "compromise", "leak",
	},
	"confidentiality": {
		"confidential", "confidentiality", "secret", "secrecy", "proprietary", "nda", "nondisclosure", "disclosure",
	},
	"data_privacy": {
		"data", "privacy", "private", "personal", "personally", "pii", "pdpl", "gdpr", "processing", "processor", "controller", "consent", "subject", "safeguard", "safeguards", "protect", "protection",
	},
	"dispute_resolution": {
		"dispute", "arbitration", "litigation", "court", "courts", "mediation", "claim", "claims", "forum",
	},
	"force_majeure": {
		"force", "majeure", "unavoidable", "disaster", "pandemic", "emergency", "war", "strike",
	},
	"governing_law": {
		"governing", "law", "laws", "jurisdiction", "venue", "applicable", "country", "state",
	},
	"indemnity_liability": {
		"indemnity", "indemnify", "liability", "liable", "limitation", "damages", "loss", "losses", "cap",
	},
	"intellectual_property": {
		"ip", "intellectual", "property", "copyright", "patent", "trademark", "license", "ownership", "invention", "work", "works",
	},
	"obligation": {
		"must", "shall", "required", "require", "requires", "obligation", "obligations", "duty", "duties", "responsibility", "responsibilities", "commitment",
	},
	"payment": {
		"payment", "pay", "fee", "fees", "invoice", "invoices", "tax", "taxes", "billing", "price", "consideration",
	},
	"regulatory_compliance": {
		"regulatory", "regulation", "regulations", "law", "laws", "legal", "compliance", "authority", "authorities", "cma", "sama", "pdpl",
	},
	"retention": {
		"retention", "retain", "archive", "deletion", "delete", "destroy", "destruction", "preserve", "storage",
	},
	"risk": {
		"risk", "critical", "high", "medium", "low", "material", "exposure", "impact",
	},
	"service_level": {
		"sla", "service", "availability", "uptime", "downtime", "performance", "support", "response", "resolution",
	},
	"termination": {
		"terminate", "termination", "expiry", "expiration", "renewal", "breach", "default", "convenience", "cause",
	},
	"warranty": {
		"warranty", "warranties", "representation", "representations", "guarantee", "merchantability", "fitness", "defect", "defects",
	},
}

var libraryGenericSemanticConcepts = map[string]struct{}{
	"obligation":            {},
	"regulatory_compliance": {},
	"risk":                  {},
}

var librarySemanticConceptIndex = buildLibrarySemanticConceptIndex()

func buildLibrarySemanticConceptIndex() map[string][]string {
	index := map[string][]string{}
	for concept, terms := range librarySemanticConceptTerms {
		for _, term := range terms {
			for _, variant := range librarySemanticTokenVariants(term) {
				if variant == "" {
					continue
				}
				index[variant] = append(index[variant], concept)
			}
		}
	}
	for term, concepts := range index {
		sort.Strings(concepts)
		index[term] = compactSortedStrings(concepts)
	}
	return index
}

func librarySemanticVector(tokens []string) map[string]float64 {
	vector := map[string]float64{}
	for _, token := range tokens {
		seenVariants := map[string]struct{}{}
		for _, variant := range librarySemanticTokenVariants(token) {
			if variant == "" {
				continue
			}
			if _, ok := seenVariants[variant]; ok {
				continue
			}
			seenVariants[variant] = struct{}{}
			vector["token:"+variant] += 0.2
			for _, concept := range librarySemanticConceptIndex[variant] {
				vector["concept:"+concept] += librarySemanticConceptWeight(concept)
			}
		}
	}
	return vector
}

func librarySemanticTokenVariants(token string) []string {
	token = strings.ToLower(strings.TrimSpace(token))
	if token == "" {
		return nil
	}
	variants := []string{token}
	if strings.HasSuffix(token, "ies") && len(token) > 4 {
		variants = append(variants, strings.TrimSuffix(token, "ies")+"y")
	}
	for _, suffix := range []string{"ing", "ed", "es", "s"} {
		if strings.HasSuffix(token, suffix) && len(token) > len(suffix)+3 {
			variants = append(variants, strings.TrimSuffix(token, suffix))
		}
	}
	sort.Strings(variants)
	return compactSortedStrings(variants)
}

func librarySemanticConceptWeight(concept string) float64 {
	if _, ok := libraryGenericSemanticConcepts[concept]; ok {
		return 0.45
	}
	return 1
}

func commonSemanticDimensions(left, right map[string]float64) []string {
	dimensions := make([]string, 0)
	for dimension := range left {
		if _, ok := right[dimension]; ok {
			dimensions = append(dimensions, dimension)
		}
	}
	sort.Strings(dimensions)
	return dimensions
}

func hasMeaningfulSemanticDimension(dimensions []string) bool {
	for _, dimension := range dimensions {
		concept, ok := strings.CutPrefix(dimension, "concept:")
		if !ok {
			continue
		}
		if _, generic := libraryGenericSemanticConcepts[concept]; !generic {
			return true
		}
	}
	return false
}

func cosineLibraryVectorSimilarity(left, right map[string]float64) float64 {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	dot := 0.0
	leftNorm := 0.0
	rightNorm := 0.0
	for dimension, value := range left {
		leftNorm += value * value
		if rightValue, ok := right[dimension]; ok {
			dot += value * rightValue
		}
	}
	for _, value := range right {
		rightNorm += value * value
	}
	if leftNorm == 0 || rightNorm == 0 || dot == 0 {
		return 0
	}
	return dot / (math.Sqrt(leftNorm) * math.Sqrt(rightNorm))
}

func semanticSnippetTokens(fieldTokens []string, dimensions []string) []string {
	if len(fieldTokens) == 0 || len(dimensions) == 0 {
		return nil
	}
	dimensionSet := map[string]struct{}{}
	for _, dimension := range dimensions {
		dimensionSet[dimension] = struct{}{}
	}
	out := make([]string, 0)
	seen := map[string]struct{}{}
	for _, token := range fieldTokens {
		for _, variant := range librarySemanticTokenVariants(token) {
			if _, ok := dimensionSet["token:"+variant]; ok {
				if _, exists := seen[token]; !exists {
					seen[token] = struct{}{}
					out = append(out, token)
				}
				continue
			}
			for _, concept := range librarySemanticConceptIndex[variant] {
				if _, ok := dimensionSet["concept:"+concept]; ok {
					if _, exists := seen[token]; !exists {
						seen[token] = struct{}{}
						out = append(out, token)
					}
				}
			}
		}
	}
	return out
}

func compactSortedStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := values[:0]
	var previous string
	for idx, value := range values {
		if idx > 0 && value == previous {
			continue
		}
		out = append(out, value)
		previous = value
	}
	return out
}

func searchTokens(query string) []string {
	normalized := normalizeSearchText(query)
	if normalized == "" {
		return nil
	}
	seen := map[string]struct{}{}
	tokens := make([]string, 0)
	for _, token := range strings.Fields(normalized) {
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		tokens = append(tokens, token)
	}
	return tokens
}

func normalizeSearchText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	return strings.Join(parts, " ")
}

func normalizeSearchLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "ar", "arabic":
		return "ar"
	case "en", "eng", "english":
		return "en"
	default:
		return "all"
	}
}

func librarySearchLanguageAllowed(fieldLanguage, requestedLanguage string) bool {
	return fieldLanguage == "" || requestedLanguage == "all" || fieldLanguage == requestedLanguage
}

func librarySearchSnippet(value, query string, tokens []string) string {
	text := strings.Join(strings.Fields(value), " ")
	if text == "" {
		return ""
	}
	const maxRunes = 180
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	lowerText := strings.ToLower(text)
	needle := strings.ToLower(strings.TrimSpace(query))
	index := strings.Index(lowerText, needle)
	if index < 0 {
		for _, token := range tokens {
			index = strings.Index(lowerText, token)
			if index >= 0 {
				break
			}
		}
	}
	runeIndex := 0
	if index >= 0 {
		runeIndex = utf8.RuneCountInString(lowerText[:index])
	}
	start := runeIndex - 70
	if start < 0 {
		start = 0
	}
	end := start + maxRunes
	if end > len(runes) {
		end = len(runes)
		start = end - maxRunes
		if start < 0 {
			start = 0
		}
	}
	snippet := string(runes[start:end])
	if start > 0 {
		snippet = "..." + snippet
	}
	if end < len(runes) {
		snippet += "..."
	}
	return snippet
}

func libraryRiskLevel(metadata map[string]any) string {
	for _, key := range []string{"risk_level", "riskLevel", "risk_tier", "riskTier", "risk"} {
		value, ok := metadata[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		default:
			rendered := strings.TrimSpace(fmt.Sprint(typed))
			if rendered != "" {
				return rendered
			}
		}
	}
	return ""
}

func normalizeSearchPagination(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	return page, perPage
}

func paginateClauseSearchResults(results []model.ClauseLibrarySearchResult, page, perPage int) []model.ClauseLibrarySearchResult {
	start := (page - 1) * perPage
	if start >= len(results) {
		return []model.ClauseLibrarySearchResult{}
	}
	end := start + perPage
	if end > len(results) {
		end = len(results)
	}
	return results[start:end]
}

func paginateRegulationSearchResults(results []model.RegulationLibrarySearchResult, page, perPage int) []model.RegulationLibrarySearchResult {
	start := (page - 1) * perPage
	if start >= len(results) {
		return []model.RegulationLibrarySearchResult{}
	}
	end := start + perPage
	if end > len(results) {
		end = len(results)
	}
	return results[start:end]
}
