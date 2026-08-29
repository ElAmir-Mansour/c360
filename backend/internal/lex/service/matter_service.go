package service

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedMatterTypes = map[model.MatterType]struct{}{
	model.MatterTypeGeneral:    {},
	model.MatterTypeContract:   {},
	model.MatterTypeLitigation: {},
	model.MatterTypeRegulatory: {},
	model.MatterTypeEmployment: {},
	model.MatterTypeDispute:    {},
	model.MatterTypeAdvisory:   {},
	model.MatterTypeOther:      {},
}

var allowedMatterStatuses = map[model.MatterStatus]struct{}{
	model.MatterStatusIntake:            {},
	model.MatterStatusOpen:              {},
	model.MatterStatusInReview:          {},
	model.MatterStatusWaitingOnBusiness: {},
	model.MatterStatusOnHold:            {},
	model.MatterStatusClosed:            {},
	model.MatterStatusCancelled:         {},
}

// matterStatusTransitions is the allowed FSM edge set a status change may take
// (mirrors caseStatusTransitions in legal_case_service.go). intake and the
// operational states precede the two terminal states (closed, cancelled), which
// have NO outgoing edges — so a terminal matter cannot silently re-open. Triage
// (Triage/validateMatterTriage) drives the intake -> in_review/waiting/on_hold
// edges via its own precondition and is NOT gated here; only UpdateStatus is.
var matterStatusTransitions = map[model.MatterStatus]map[model.MatterStatus]struct{}{
	model.MatterStatusIntake: {
		model.MatterStatusOpen:      {},
		model.MatterStatusCancelled: {},
	},
	model.MatterStatusOpen: {
		model.MatterStatusInReview:          {},
		model.MatterStatusWaitingOnBusiness: {},
		model.MatterStatusOnHold:            {},
		model.MatterStatusClosed:            {},
		model.MatterStatusCancelled:         {},
	},
	model.MatterStatusInReview: {
		model.MatterStatusOpen:              {},
		model.MatterStatusWaitingOnBusiness: {},
		model.MatterStatusOnHold:            {},
		model.MatterStatusClosed:            {},
		model.MatterStatusCancelled:         {},
	},
	model.MatterStatusWaitingOnBusiness: {
		model.MatterStatusOpen:      {},
		model.MatterStatusInReview:  {},
		model.MatterStatusOnHold:    {},
		model.MatterStatusClosed:    {},
		model.MatterStatusCancelled: {},
	},
	model.MatterStatusOnHold: {
		model.MatterStatusOpen:      {},
		model.MatterStatusInReview:  {},
		model.MatterStatusClosed:    {},
		model.MatterStatusCancelled: {},
	},
	// closed and cancelled are terminal — no outgoing edges.
}

// matterTransitionAllowed reports whether a status may move from -> to under the
// matter FSM (mirrors caseTransitionAllowed).
func matterTransitionAllowed(from, to model.MatterStatus) bool {
	targets, ok := matterStatusTransitions[from]
	if !ok {
		return false
	}
	_, ok = targets[to]
	return ok
}

var allowedLegalPriorities = map[model.LegalPriority]struct{}{
	model.LegalPriorityCritical: {},
	model.LegalPriorityHigh:     {},
	model.LegalPriorityMedium:   {},
	model.LegalPriorityLow:      {},
}

var matterConflictTokenPattern = regexp.MustCompile(`[a-z0-9]+`)

type MatterService struct {
	db        *pgxpool.Pool
	matters   *repository.MatterRepository
	contracts *repository.ContractRepository
	audit     *repository.MatterAuditRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
	// legalHolds enforces FR-WATHEEQ-005: a matter under an active legal hold
	// cannot be deleted or closed/cancelled. Nil => no hold enforcement.
	legalHolds LegalHoldGuard
}

// WithLegalHoldGuard wires the legal-hold enforcement guard. Returns the
// receiver for chaining.
func (s *MatterService) WithLegalHoldGuard(guard LegalHoldGuard) *MatterService {
	s.legalHolds = guard
	return s
}

func NewMatterService(db *pgxpool.Pool, matters *repository.MatterRepository, contracts *repository.ContractRepository, audit *repository.MatterAuditRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *MatterService {
	return &MatterService{
		db:        db,
		matters:   matters,
		contracts: contracts,
		audit:     audit,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-matters").Logger(),
		now:       time.Now,
	}
}

// appendAudit appends one immutable matter governance audit row inside q (a tx
// when the mutation is transactional, the pool otherwise). The audit row and
// the mutation then commit/roll back atomically. Mirrors the settlement/case
// audit pattern: a failure is surfaced (wrapped) so it cannot silently corrupt
// the trail. A nil audit repo is a no-op so the constructor stays optional in
// tests that do not wire it.
func (s *MatterService) appendAudit(ctx context.Context, q repository.Queryer, tenantID, matterID, userID uuid.UUID, action string, fromStatus, toStatus *string, detail map[string]any) error {
	if s.audit == nil {
		return nil
	}
	entry := &model.MatterAuditEntry{
		ID:          uuid.New(),
		TenantID:    tenantID,
		MatterID:    matterID,
		Action:      action,
		FromStatus:  fromStatus,
		ToStatus:    toStatus,
		Detail:      detail,
		ActorUserID: userID,
	}
	if err := s.audit.AppendAudit(ctx, q, entry); err != nil {
		return internalError("append matter audit", err)
	}
	return nil
}

func (s *MatterService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateMatterRequest) (*model.Matter, error) {
	req.Normalize()
	if err := validateMatterCreate(req); err != nil {
		return nil, err
	}
	for _, contractID := range req.ContractIDs {
		if _, err := s.contracts.Get(ctx, tenantID, contractID); err != nil {
			if err == pgx.ErrNoRows {
				return nil, validationError("linked contract not found", map[string]string{"contract_ids": "not found"})
			}
			return nil, internalError("load linked contract", err)
		}
	}
	matterNumber := normalizeOptionalString(req.MatterNumber)
	if matterNumber == nil {
		generated := fmt.Sprintf("MAT-%s-%s", s.now().UTC().Format("20060102"), strings.ToUpper(uuid.NewString()[:8]))
		matterNumber = &generated
	}
	matter := &model.Matter{
		ID:              uuid.New(),
		TenantID:        tenantID,
		MatterNumber:    *matterNumber,
		Title:           req.Title,
		Description:     req.Description,
		Type:            req.Type,
		Status:          req.Status,
		Priority:        req.Priority,
		OwnerUserID:     req.OwnerUserID,
		OwnerName:       req.OwnerName,
		RequesterUserID: req.RequesterUserID,
		RequesterName:   normalizeOptionalString(req.RequesterName),
		Department:      normalizeOptionalString(req.Department),
		OpenedAt:        s.now().UTC(),
		DueDate:         req.DueDate,
		Tags:            req.Tags,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
	}
	if matter.Status == model.MatterStatusClosed || matter.Status == model.MatterStatusCancelled {
		closedAt := s.now().UTC()
		matter.ClosedAt = &closedAt
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.matters.Create(ctx, tx, matter); err != nil {
		return nil, internalError("create matter", err)
	}
	for _, contractID := range req.ContractIDs {
		link := &model.MatterContract{
			ID:           uuid.New(),
			TenantID:     tenantID,
			MatterID:     matter.ID,
			ContractID:   contractID,
			Relationship: "related",
			CreatedBy:    userID,
		}
		if err := s.matters.LinkContract(ctx, tx, link); err != nil {
			return nil, internalError("link matter contract", err)
		}
	}
	if err := s.appendAudit(ctx, tx, tenantID, matter.ID, userID, "matter.created", nil, ptrString(string(matter.Status)), map[string]any{
		"matter_number": matter.MatterNumber,
		"title":         matter.Title,
		"type":          string(matter.Type),
		"priority":      string(matter.Priority),
		"owner_user_id": matter.OwnerUserID.String(),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter create", err)
	}
	matter.Contracts, _ = s.matters.ListContracts(ctx, tenantID, matter.ID)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.created", tenantID, &userID, map[string]any{
		"id":            matter.ID,
		"matter_number": matter.MatterNumber,
		"title":         matter.Title,
		"status":        matter.Status,
		"owner_user_id": matter.OwnerUserID,
	}, s.logger)
	return matter, nil
}

func (s *MatterService) List(ctx context.Context, tenantID uuid.UUID, filters model.MatterListFilters) ([]model.Matter, int, error) {
	return s.matters.List(ctx, tenantID, filters)
}

func (s *MatterService) ConflictCheck(ctx context.Context, tenantID uuid.UUID, req dto.MatterConflictCheckRequest) (*dto.MatterConflictCheckResult, error) {
	req.Normalize()
	if err := validateMatterConflictCheck(req); err != nil {
		return nil, err
	}
	matters, _, err := s.matters.List(ctx, tenantID, model.MatterListFilters{
		Page:          1,
		PerPage:       200,
		SortColumn:    "m.updated_at",
		SortDirection: "desc",
	})
	if err != nil {
		return nil, internalError("list matters for conflict check", err)
	}
	contracts, _, err := s.contracts.List(ctx, tenantID, model.ContractListFilters{
		Page:          1,
		PerPage:       200,
		SortDirection: "desc",
	})
	if err != nil {
		return nil, internalError("list contracts for conflict check", err)
	}
	result := buildMatterConflictCheckResult(req, matters, contracts, s.now().UTC())
	return &result, nil
}

func (s *MatterService) MatterReport(ctx context.Context, tenantID uuid.UUID, filters model.MatterListFilters) (*model.MatterReport, error) {
	filters.Page = 1
	if filters.PerPage <= 0 || filters.PerPage > 1000 {
		filters.PerPage = 1000
	}
	items, total, err := s.matters.List(ctx, tenantID, filters)
	if err != nil {
		return nil, internalError("list report matters", err)
	}
	return buildMatterReport(items, total, filters, s.now().UTC()), nil
}

func (s *MatterService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Matter, error) {
	matter, err := s.matters.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	links, err := s.matters.ListContracts(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load matter contracts", err)
	}
	matter.Contracts = links
	return matter, nil
}

func (s *MatterService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateMatterRequest) (*model.Matter, error) {
	matter, err := s.matters.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	previousStatus := matter.Status
	applyMatterUpdate(matter, req, s.now().UTC())
	if err := validateMatter(matter); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter update transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.matters.Update(ctx, tx, matter); err != nil {
		return nil, internalError("update matter", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, matter.ID, userID, "matter.updated", ptrString(string(previousStatus)), ptrString(string(matter.Status)), map[string]any{
		"title":    matter.Title,
		"type":     string(matter.Type),
		"priority": string(matter.Priority),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.updated", tenantID, &userID, map[string]any{
		"id":     matter.ID,
		"status": matter.Status,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *MatterService) UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.MatterStatus) (*model.Matter, error) {
	if _, ok := allowedMatterStatuses[status]; !ok {
		return nil, validationError("invalid matter status", map[string]string{"status": "invalid"})
	}
	existing, err := s.matters.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	previousStatus := existing.Status
	if previousStatus != status && !matterTransitionAllowed(previousStatus, status) {
		return nil, conflictError(fmt.Sprintf("illegal matter transition %s -> %s", previousStatus, status))
	}
	var closedAt *time.Time
	if status == model.MatterStatusClosed || status == model.MatterStatusCancelled {
		// FR-WATHEEQ-005: a held matter cannot be closed or cancelled while the
		// preservation requirement is in force.
		if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectMatter, id); err != nil {
			return nil, err
		}
		value := s.now().UTC()
		closedAt = &value
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter status transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.matters.UpdateStatus(ctx, tx, tenantID, id, status, closedAt); err != nil {
		return nil, internalError("update matter status", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, id, userID, "matter.status_changed", ptrString(string(previousStatus)), ptrString(string(status)), map[string]any{
		"from": string(previousStatus),
		"to":   string(status),
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter status", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.status_changed", tenantID, &userID, map[string]any{
		"id":     id,
		"status": status,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *MatterService) Triage(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.TriageMatterRequest) (*model.Matter, error) {
	req.Normalize()
	matter, err := s.matters.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	if err := validateMatterTriage(matter, req); err != nil {
		return nil, err
	}
	previousStatus := matter.Status
	applyMatterTriage(matter, req, userID, s.now().UTC())

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter triage transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.matters.Update(ctx, tx, matter); err != nil {
		return nil, internalError("triage matter", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, matter.ID, userID, "matter.triaged", ptrString(string(previousStatus)), ptrString(string(matter.Status)), map[string]any{
		"priority":      string(matter.Priority),
		"owner_user_id": matter.OwnerUserID.String(),
		"notes":         req.Notes,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter triage", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.triaged", tenantID, &userID, map[string]any{
		"id":              matter.ID,
		"previous_status": previousStatus,
		"status":          matter.Status,
		"priority":        matter.Priority,
		"owner_user_id":   matter.OwnerUserID,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *MatterService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	// FR-WATHEEQ-005: refuse deletion while the matter is under an active hold.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectMatter, id); err != nil {
		return err
	}
	if err := s.matters.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter not found")
		}
		return internalError("delete matter", err)
	}
	return nil
}

func (s *MatterService) LinkContract(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.LinkMatterContractRequest) (*model.Matter, error) {
	if req.ContractID == uuid.Nil {
		return nil, validationError("contract_id is required", map[string]string{"contract_id": "required"})
	}
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter", err)
	}
	if _, err := s.contracts.Get(ctx, tenantID, req.ContractID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, validationError("linked contract not found", map[string]string{"contract_id": "not found"})
		}
		return nil, internalError("load linked contract", err)
	}
	relationship := strings.TrimSpace(req.Relationship)
	if relationship == "" {
		relationship = "related"
	}
	link := &model.MatterContract{
		ID:           uuid.New(),
		TenantID:     tenantID,
		MatterID:     matterID,
		ContractID:   req.ContractID,
		Relationship: relationship,
		CreatedBy:    userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start matter link transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.matters.LinkContract(ctx, tx, link); err != nil {
		return nil, internalError("link matter contract", err)
	}
	if err := s.appendAudit(ctx, tx, tenantID, matterID, userID, "matter.contract_linked", nil, nil, map[string]any{
		"contract_id":  req.ContractID.String(),
		"relationship": relationship,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit matter link", err)
	}
	return s.Get(ctx, tenantID, matterID)
}

func (s *MatterService) UnlinkContract(ctx context.Context, tenantID, matterID, contractID uuid.UUID) error {
	if err := s.matters.UnlinkContract(ctx, tenantID, matterID, contractID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter contract link not found")
		}
		return internalError("unlink matter contract", err)
	}
	return nil
}

func validateMatterCreate(req dto.CreateMatterRequest) error {
	if req.Title == "" {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if req.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if req.OwnerName == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	if _, ok := allowedMatterTypes[req.Type]; !ok {
		return validationError("invalid matter type", map[string]string{"type": "invalid"})
	}
	if _, ok := allowedMatterStatuses[req.Status]; !ok {
		return validationError("invalid matter status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func validateMatterConflictCheck(req dto.MatterConflictCheckRequest) error {
	if req.MatterID != nil && *req.MatterID == uuid.Nil {
		return validationError("matter_id is invalid", map[string]string{"matter_id": "invalid"})
	}
	if req.ContractID != nil && *req.ContractID == uuid.Nil {
		return validationError("contract_id is invalid", map[string]string{"contract_id": "invalid"})
	}
	if strings.TrimSpace(req.Title) == "" &&
		strings.TrimSpace(req.Description) == "" &&
		strings.TrimSpace(req.Counterparty) == "" &&
		strings.TrimSpace(req.ContractTitle) == "" &&
		strings.TrimSpace(req.ContractContext) == "" {
		return validationError("at least one matter or contract signal is required", map[string]string{"title": "required_without_context"})
	}
	return nil
}

func validateMatter(matter *model.Matter) error {
	if strings.TrimSpace(matter.Title) == "" {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if matter.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if strings.TrimSpace(matter.OwnerName) == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	if _, ok := allowedMatterTypes[matter.Type]; !ok {
		return validationError("invalid matter type", map[string]string{"type": "invalid"})
	}
	if _, ok := allowedMatterStatuses[matter.Status]; !ok {
		return validationError("invalid matter status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[matter.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return nil
}

func validateMatterTriage(matter *model.Matter, req dto.TriageMatterRequest) error {
	if matter.Status != model.MatterStatusIntake && matter.Status != model.MatterStatusOpen {
		return validationError("only intake or open matters can be triaged", map[string]string{"status": "invalid_current_status"})
	}
	switch req.Status {
	case model.MatterStatusInReview, model.MatterStatusOpen, model.MatterStatusWaitingOnBusiness, model.MatterStatusOnHold:
	default:
		return validationError("invalid triage target status", map[string]string{"status": "invalid"})
	}
	if req.Priority != nil {
		if _, ok := allowedLegalPriorities[*req.Priority]; !ok {
			return validationError("invalid priority", map[string]string{"priority": "invalid"})
		}
	}
	if req.OwnerUserID != nil && *req.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if req.OwnerName != nil && strings.TrimSpace(*req.OwnerName) == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	return nil
}

func applyMatterUpdate(matter *model.Matter, req dto.UpdateMatterRequest, now time.Time) {
	if req.MatterNumber != nil {
		matter.MatterNumber = strings.TrimSpace(*req.MatterNumber)
	}
	if req.Title != nil {
		matter.Title = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		matter.Description = strings.TrimSpace(*req.Description)
	}
	if req.Type != nil {
		matter.Type = *req.Type
	}
	if req.Status != nil {
		matter.Status = *req.Status
		if matter.Status == model.MatterStatusClosed || matter.Status == model.MatterStatusCancelled {
			matter.ClosedAt = &now
		} else {
			matter.ClosedAt = nil
		}
	}
	if req.Priority != nil {
		matter.Priority = *req.Priority
	}
	if req.OwnerUserID != nil {
		matter.OwnerUserID = *req.OwnerUserID
	}
	if req.OwnerName != nil {
		matter.OwnerName = strings.TrimSpace(*req.OwnerName)
	}
	if req.RequesterUserID != nil {
		// The nil UUID sentinel clears an existing requester (mirrors the
		// contract legal_reviewer_id / org_entity_id convention); a real UUID
		// assigns it. An absent key leaves the requester unchanged.
		matter.RequesterUserID = normalizeOptionalUUID(req.RequesterUserID)
	}
	if req.RequesterName != nil {
		matter.RequesterName = normalizeOptionalString(req.RequesterName)
	}
	if req.Department != nil {
		matter.Department = normalizeOptionalString(req.Department)
	}
	if req.DueDate != nil {
		matter.DueDate = req.DueDate
	}
	if req.Tags != nil {
		matter.Tags = dto.NormalizeTags(req.Tags)
	}
	if req.Metadata != nil {
		matter.Metadata = req.Metadata
	}
}

func applyMatterTriage(matter *model.Matter, req dto.TriageMatterRequest, userID uuid.UUID, now time.Time) {
	previousStatus := matter.Status
	matter.Status = req.Status
	if req.Priority != nil {
		matter.Priority = *req.Priority
	}
	if req.OwnerUserID != nil {
		matter.OwnerUserID = *req.OwnerUserID
	}
	if req.OwnerName != nil {
		matter.OwnerName = strings.TrimSpace(*req.OwnerName)
	}
	if req.DueDate != nil {
		normalized := normalizeDate(*req.DueDate)
		matter.DueDate = &normalized
	}
	if matter.Metadata == nil {
		matter.Metadata = map[string]any{}
	}
	for key, value := range req.Metadata {
		matter.Metadata[key] = value
	}
	matter.Metadata["intake_triage"] = map[string]any{
		"triaged_at":      now.UTC(),
		"triaged_by":      userID.String(),
		"previous_status": previousStatus,
		"target_status":   req.Status,
		"notes":           req.Notes,
	}
	matter.ClosedAt = nil
}

func buildMatterConflictCheckResult(req dto.MatterConflictCheckRequest, matters []model.Matter, contracts []model.Contract, checkedAt time.Time) dto.MatterConflictCheckResult {
	req.Normalize()
	proposed := normalizedMatterConflictSignals(req)
	conflicts := []dto.MatterConflictIssue{}
	warnings := []dto.MatterConflictIssue{}

	for _, matter := range matters {
		if req.MatterID != nil && matter.ID == *req.MatterID {
			continue
		}
		issue, ok := matterConflictIssueForMatter(req, proposed, matter)
		if !ok {
			continue
		}
		if issue.Severity == dto.MatterConflictSeverityConflict {
			conflicts = append(conflicts, issue)
		} else {
			warnings = append(warnings, issue)
		}
	}
	for _, contract := range contracts {
		if req.ContractID != nil && contract.ID == *req.ContractID {
			continue
		}
		issue, ok := matterConflictIssueForContract(proposed, contract)
		if !ok {
			continue
		}
		if issue.Severity == dto.MatterConflictSeverityConflict {
			conflicts = append(conflicts, issue)
		} else {
			warnings = append(warnings, issue)
		}
	}
	sortMatterConflictIssues(conflicts)
	sortMatterConflictIssues(warnings)
	return dto.MatterConflictCheckResult{
		CheckedAt: checkedAt.UTC(),
		Conflicts: conflicts,
		Warnings:  warnings,
	}
}

type matterConflictSignals struct {
	Title           string
	Description     string
	Counterparty    string
	ContractTitle   string
	ContractContext string
	Tokens          map[string]struct{}
}

func normalizedMatterConflictSignals(req dto.MatterConflictCheckRequest) matterConflictSignals {
	fields := []string{req.Title, req.Description, req.Counterparty, req.ContractTitle, req.ContractContext}
	tokens := map[string]struct{}{}
	for _, field := range fields {
		for _, token := range matterConflictTokens(field) {
			tokens[token] = struct{}{}
		}
	}
	return matterConflictSignals{
		Title:           normalizeMatterConflictText(req.Title),
		Description:     normalizeMatterConflictText(req.Description),
		Counterparty:    normalizeMatterConflictText(req.Counterparty),
		ContractTitle:   normalizeMatterConflictText(req.ContractTitle),
		ContractContext: normalizeMatterConflictText(req.ContractContext),
		Tokens:          tokens,
	}
}

func matterConflictIssueForMatter(req dto.MatterConflictCheckRequest, proposed matterConflictSignals, matter model.Matter) (dto.MatterConflictIssue, bool) {
	matterTitle := normalizeMatterConflictText(matter.Title)
	matterDescription := normalizeMatterConflictText(matter.Description)
	matterCounterparty := normalizeMatterConflictText(matterConflictMetadataString(matter.Metadata, "counterparty", "counterparty_name", "party_b_name"))

	var reasons []string
	var severity dto.MatterConflictSeverity
	if proposed.Title != "" && proposed.Title == matterTitle {
		severity = dto.MatterConflictSeverityConflict
		reasons = append(reasons, "matter_title_exact_match")
	}
	if proposed.Counterparty != "" && proposed.Counterparty == matterCounterparty {
		severity = dto.MatterConflictSeverityConflict
		reasons = append(reasons, "matter_counterparty_exact_match")
	}
	if proposed.Description != "" && proposed.Description == matterDescription && severity == "" {
		severity = dto.MatterConflictSeverityWarning
		reasons = append(reasons, "matter_description_exact_match")
	}
	matchedTerms := sharedMatterConflictTerms(proposed.Tokens, matter.Title, matter.Description, matterCounterparty)
	if severity == "" && len(matchedTerms) >= 3 {
		severity = dto.MatterConflictSeverityWarning
		reasons = append(reasons, "matter_context_overlap")
	}
	if severity == "" {
		return dto.MatterConflictIssue{}, false
	}
	if severity == dto.MatterConflictSeverityConflict && len(matchedTerms) == 0 {
		matchedTerms = exactMatchedMatterTerms(req, matter)
	}
	title := matter.Title
	return dto.MatterConflictIssue{
		Severity:     severity,
		Reasons:      uniqueStrings(reasons),
		MatterID:     &matter.ID,
		MatterTitle:  &title,
		MatchedTerms: matchedTerms,
	}, true
}

func matterConflictIssueForContract(proposed matterConflictSignals, contract model.Contract) (dto.MatterConflictIssue, bool) {
	contractTitle := normalizeMatterConflictText(contract.Title)
	partyA := normalizeMatterConflictText(contract.PartyAName)
	partyB := normalizeMatterConflictText(contract.PartyBName)

	var reasons []string
	var severity dto.MatterConflictSeverity
	if proposed.ContractTitle != "" && proposed.ContractTitle == contractTitle {
		severity = dto.MatterConflictSeverityConflict
		reasons = append(reasons, "contract_title_exact_match")
	}
	if proposed.Title != "" && proposed.Title == contractTitle {
		severity = dto.MatterConflictSeverityConflict
		reasons = append(reasons, "matter_title_matches_contract_title")
	}
	if proposed.Counterparty != "" && (proposed.Counterparty == partyA || proposed.Counterparty == partyB) {
		severity = dto.MatterConflictSeverityConflict
		reasons = append(reasons, "counterparty_exact_match")
	}
	matchedTerms := sharedMatterConflictTerms(proposed.Tokens, contract.Title, contract.Description, contract.PartyAName, contract.PartyBName, contract.DocumentText)
	if severity == "" && len(matchedTerms) >= 3 {
		severity = dto.MatterConflictSeverityWarning
		reasons = append(reasons, "contract_context_overlap")
	}
	if severity == "" {
		return dto.MatterConflictIssue{}, false
	}
	title := contract.Title
	return dto.MatterConflictIssue{
		Severity:      severity,
		Reasons:       uniqueStrings(reasons),
		ContractID:    &contract.ID,
		ContractTitle: &title,
		MatchedTerms:  matchedTerms,
	}, true
}

func normalizeMatterConflictText(value string) string {
	tokens := matterConflictTokens(value)
	if len(tokens) == 0 {
		return ""
	}
	return strings.Join(tokens, " ")
}

func matterConflictTokens(value string) []string {
	raw := matterConflictTokenPattern.FindAllString(strings.ToLower(value), -1)
	tokens := make([]string, 0, len(raw))
	for _, token := range raw {
		if len(token) < 3 || matterConflictStopWords[token] {
			continue
		}
		tokens = append(tokens, token)
	}
	return tokens
}

var matterConflictStopWords = map[string]bool{
	"and": true, "are": true, "but": true, "for": true, "from": true, "has": true, "into": true,
	"not": true, "the": true, "this": true, "that": true, "with": true, "will": true, "shall": true,
	"matter": true, "contract": true, "agreement": true, "services": true, "service": true,
	"legal": true, "review": true,
}

func sharedMatterConflictTerms(proposed map[string]struct{}, fields ...string) []string {
	if len(proposed) == 0 {
		return nil
	}
	matched := map[string]struct{}{}
	for _, field := range fields {
		for _, token := range matterConflictTokens(field) {
			if _, ok := proposed[token]; ok {
				matched[token] = struct{}{}
			}
		}
	}
	return sortedMatterConflictTerms(matched)
}

func sortedMatterConflictTerms(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func exactMatchedMatterTerms(req dto.MatterConflictCheckRequest, matter model.Matter) []string {
	terms := map[string]struct{}{}
	reqTitle := normalizeMatterConflictText(req.Title)
	if reqTitle != "" && reqTitle == normalizeMatterConflictText(matter.Title) {
		terms[reqTitle] = struct{}{}
	}
	reqCounterparty := normalizeMatterConflictText(req.Counterparty)
	matterCounterparty := matterConflictMetadataString(matter.Metadata, "counterparty", "counterparty_name", "party_b_name")
	if reqCounterparty != "" && reqCounterparty == normalizeMatterConflictText(matterCounterparty) {
		terms[reqCounterparty] = struct{}{}
	}
	return sortedMatterConflictTerms(terms)
}

func matterConflictMetadataString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := metadata[key]; ok {
			if text, ok := value.(string); ok {
				return text
			}
		}
	}
	return ""
}

func sortMatterConflictIssues(issues []dto.MatterConflictIssue) {
	sort.SliceStable(issues, func(i, j int) bool {
		return matterConflictIssueSortKey(issues[i]) < matterConflictIssueSortKey(issues[j])
	})
}

func matterConflictIssueSortKey(issue dto.MatterConflictIssue) string {
	if issue.MatterTitle != nil {
		return "matter:" + *issue.MatterTitle
	}
	if issue.ContractTitle != nil {
		return "contract:" + *issue.ContractTitle
	}
	return strings.Join(issue.Reasons, ",")
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func buildMatterReport(items []model.Matter, total int, filters model.MatterListFilters, generatedAt time.Time) *model.MatterReport {
	report := &model.MatterReport{
		GeneratedAt: generatedAt.UTC(),
		Total:       total,
		Filters:     matterReportFilters(filters),
		Matters:     make([]model.MatterSummary, 0, len(items)),
		ByStatus:    map[string]int{},
		ByType:      map[string]int{},
		ByPriority:  map[string]int{},
	}
	for _, item := range items {
		report.Matters = append(report.Matters, matterReportSummary(item))
		report.ByStatus[string(item.Status)]++
		report.ByType[string(item.Type)]++
		report.ByPriority[string(item.Priority)]++
	}
	return report
}

func matterReportSummary(matter model.Matter) model.MatterSummary {
	return model.MatterSummary{
		ID:           matter.ID,
		MatterNumber: matter.MatterNumber,
		Title:        matter.Title,
		Type:         matter.Type,
		Status:       matter.Status,
		Priority:     matter.Priority,
		OwnerUserID:  matter.OwnerUserID,
		OwnerName:    matter.OwnerName,
		Department:   matter.Department,
		OpenedAt:     matter.OpenedAt,
		DueDate:      matter.DueDate,
		ClosedAt:     matter.ClosedAt,
		CreatedAt:    matter.CreatedAt,
	}
}

func matterReportFilters(filters model.MatterListFilters) map[string]string {
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
	if filters.Priority != nil {
		out["priority"] = string(*filters.Priority)
	}
	if filters.OwnerUserID != nil {
		out["owner_user_id"] = filters.OwnerUserID.String()
	}
	if filters.ContractID != nil {
		out["contract_id"] = filters.ContractID.String()
	}
	if filters.Department != "" {
		out["department"] = filters.Department
	}
	if filters.DueBefore != nil {
		out["due_before"] = normalizeDate(*filters.DueBefore).Format("2006-01-02")
	}
	if filters.DueAfter != nil {
		out["due_after"] = normalizeDate(*filters.DueAfter).Format("2006-01-02")
	}
	if filters.Tag != "" {
		out["tag"] = filters.Tag
	}
	return out
}
