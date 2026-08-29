package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// distributionRoles are the authorized roles that may distribute / route a
// review-desk file to legal and record the final recommendation (CAP-106). The
// guard matches case-insensitively against the JWT claim roles passed by the
// handler; an empty role set means the desk is open to any lex:write holder (the
// route RBAC gate still applies).
var distributionRoles = map[string]struct{}{
	"legal_director":    {},
	"legal-director":    {},
	"contracts_manager": {},
	"contracts-manager": {},
	"supervisor":        {},
	"lex_supervisor":    {},
}

// contractAttachmentSlotSeeds is the canonical seed order for the Othaim PRD §9.1
// required-document set (CAP-099). Opening an intake seeds one requirement row per
// slot; the completeness gate (CAP-103) then verifies every required slot carries a
// live attachment. Labels are bilingual-friendly plain strings; the frontend
// localizes them (review-desk-labels.ts).
//
// Required vs optional follows PRD §9.1: the foundation document, statement of
// purpose, and authorized-person identity are always required; the power of
// attorney (only when the signatory acts by delegation) and the addendum / prior
// documents (only for amendments or renewals) are optional and an intake toggles
// them required per case via SetRequirement.
var contractAttachmentSlotSeeds = []struct {
	Slot      model.ContractAttachmentSlot
	Label     string
	Required  bool
	SortOrder int
}{
	{model.ContractAttachmentSlotFoundationDocument, "Foundation document", true, 10},
	{model.ContractAttachmentSlotPurposeOfContract, "Purpose of contract", true, 20},
	{model.ContractAttachmentSlotAuthorizedPersonID, "Authorized person ID", true, 30},
	{model.ContractAttachmentSlotPowerOfAttorney, "Power of attorney", false, 40},
	{model.ContractAttachmentSlotAddendumPriorDocs, "Addendum / prior documents", false, 50},
}

// legacyContractAttachmentSlotSeeds are the original review-desk slots retained so
// requirement rows created before the PRD §9.1 set landed keep a human label and a
// stable sort order (they render after the PRD slots). They are NOT seeded on new
// intakes — completeContractAttachmentRequirements unions any that were stored on a
// pre-existing intake so historical files never lose a slot.
var legacyContractAttachmentSlotSeeds = []struct {
	Slot      model.ContractAttachmentSlot
	Label     string
	Required  bool
	SortOrder int
}{
	{model.ContractAttachmentSlotDraft, "Draft contract", true, 110},
	{model.ContractAttachmentSlotQuotation, "Quotation", true, 120},
	{model.ContractAttachmentSlotCommercialRegistration, "Commercial registration", true, 130},
	{model.ContractAttachmentSlotCommitteeDecision, "Committee decision", true, 140},
}

// ContractReviewDeskService re-baselines the contract review desk (CAP-094..125)
// WITHOUT touching the existing contract module: it references contracts by id and
// adds the administrative intake funnel (reference number, receipt-ack, route,
// completeness gate, return/deficiency), the named-slot attachment registry, the
// append-only correspondence thread, and the final recommendation that hands an
// approved file to the existing WorkflowService.StartContractReview + approval
// engine (CAP-120). Every mutation appends an immutable desk-audit row in the SAME
// transaction and emits a CloudEvent. LegalHold preservation is enforced on
// destructive desk mutations (attachment delete / return) via ensureMutable.
type ContractReviewDeskService struct {
	db              *pgxpool.Pool
	contracts       *repository.ContractRepository
	intakes         *repository.ContractIntakeRepository
	attachments     *repository.ContractAttachmentRepository
	correspondence  *repository.ContractCorrespondenceRepository
	recommendations *repository.ContractRecommendationRepository
	workflows       *WorkflowService
	publisher       Publisher
	metrics         *metrics.Metrics
	topic           string
	logger          zerolog.Logger
	now             func() time.Time
	legalHolds      LegalHoldGuard
}

func NewContractReviewDeskService(
	db *pgxpool.Pool,
	contracts *repository.ContractRepository,
	intakes *repository.ContractIntakeRepository,
	attachments *repository.ContractAttachmentRepository,
	correspondence *repository.ContractCorrespondenceRepository,
	recommendations *repository.ContractRecommendationRepository,
	workflows *WorkflowService,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *ContractReviewDeskService {
	return &ContractReviewDeskService{
		db:              db,
		contracts:       contracts,
		intakes:         intakes,
		attachments:     attachments,
		correspondence:  correspondence,
		recommendations: recommendations,
		workflows:       workflows,
		publisher:       publisherOrNoop(publisher),
		metrics:         appMetrics,
		topic:           topic,
		logger:          logger.With().Str("service", "lex-contract-review-desk").Logger(),
		now:             time.Now,
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard. Returns the receiver
// for chaining, mirroring MatterService.WithLegalHoldGuard.
func (s *ContractReviewDeskService) WithLegalHoldGuard(guard LegalHoldGuard) *ContractReviewDeskService {
	s.legalHolds = guard
	return s
}

// EnsureContract loads + validates the referenced contract, translating a missing
// row into a 404. Returned so callers can read contract data without re-querying.
func (s *ContractReviewDeskService) ensureContract(ctx context.Context, tenantID, contractID uuid.UUID) (*model.Contract, error) {
	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}
	return contract, nil
}

// canPrepareContractReview keeps the creator path least-privileged: an actor
// with only lex:contract:add may prepare attachments for the draft they created,
// while contract editors and coarse-write compatibility roles retain the
// existing cross-record workflow.
func canPrepareContractReview(ctx context.Context, roles []string, actorID uuid.UUID, contract *model.Contract) bool {
	if auth.HasAnyPermissionCtx(ctx, roles, auth.PermLexContractEdit, auth.PermLexWrite) {
		return true
	}
	return auth.HasPermissionCtx(ctx, roles, auth.PermLexContractAdd) &&
		contract != nil &&
		contract.CreatedBy == actorID &&
		contract.Status == model.ContractStatusDraft
}

// --- Intake (CAP-100..105) --------------------------------------------------

// OpenIntake opens the review-desk intake for a contract (CAP-100..102). It is
// idempotent: if an intake already exists it is returned unchanged. On first open
// it assigns the desk reference number (CAP-100), seeds the PRD §9.1 named-slot
// requirements (CAP-099), and records an audit row — all in one transaction.
func (s *ContractReviewDeskService) OpenIntake(ctx context.Context, tenantID, userID, contractID uuid.UUID, roles []string, req dto.OpenContractIntakeRequest) (*model.ContractIntake, error) {
	req.Normalize()
	contract, err := s.ensureContract(ctx, tenantID, contractID)
	if err != nil {
		return nil, err
	}
	if !canPrepareContractReview(ctx, roles, userID, contract) {
		return nil, forbiddenError("an add-only requester may prepare only their own draft contract")
	}
	if existing, err := s.intakes.GetByContract(ctx, tenantID, contractID); err == nil {
		return existing, nil
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load contract intake", err)
	}

	now := s.now().UTC()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start intake transaction", err)
	}
	defer tx.Rollback(ctx)

	seq, err := s.intakes.NextReferenceSequence(ctx, tx, tenantID, now.Year())
	if err != nil {
		return nil, internalError("compute intake reference", err)
	}
	reference := fmt.Sprintf("CRD-%d-%06d", now.Year(), seq)
	intake := &model.ContractIntake{
		ID:                   uuid.New(),
		TenantID:             tenantID,
		ContractID:           contractID,
		ReferenceNumber:      reference,
		Status:               model.ContractIntakeStatusReceived,
		ReceivedAt:           now,
		AssignedReviewerID:   req.AssignedReviewerID,
		AssignedReviewerName: req.AssignedReviewerName,
		Metadata:             map[string]any{},
	}
	if err := s.intakes.Create(ctx, tx, intake); err != nil {
		return nil, internalError("create contract intake", err)
	}
	// Seed the PRD §9.1 named attachment-requirement slots (CAP-099). These five
	// slot values (foundation_document, purpose_of_contract, authorized_person_id,
	// power_of_attorney, addendum_prior_docs) are only accepted by the
	// lex_contract_attachment_requirements.slot CHECK constraint after migration
	// 000097 widens it from the original four legacy slots — before that widening
	// this UpsertRequirement raised a check_violation that aborted the intake
	// transaction (the latent OpenIntake seed defect).
	for _, seed := range contractAttachmentSlotSeeds {
		requirement := &model.ContractAttachmentRequirement{
			ID:         uuid.New(),
			TenantID:   tenantID,
			ContractID: contractID,
			Slot:       seed.Slot,
			Required:   seed.Required,
			Label:      seed.Label,
			SortOrder:  seed.SortOrder,
			CreatedBy:  userID,
		}
		if err := s.attachments.UpsertRequirement(ctx, tx, requirement); err != nil {
			return nil, internalError("seed attachment requirement", err)
		}
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, intake.ID, userID, "intake.opened", map[string]any{
		"reference_number": reference,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit open intake", err)
	}
	openPayload := map[string]any{
		"contract_id":      contractID,
		"intake_id":        intake.ID,
		"reference_number": reference,
		"status":           intake.Status,
		"received_at":      intake.ReceivedAt,
		"created_at":       intake.ReceivedAt,
	}
	// PRD §9.1 receipt: carry the requester (contract owner) identity so the
	// notification consumer routes the receipt in-app row + email to the requester.
	for k, v := range contractRequesterFields(contract) {
		openPayload[k] = v
	}
	s.emit(ctx, "com.clario360.lex.contract_review_desk.intake_opened", tenantID, userID, openPayload)
	return intake, nil
}

// Acknowledge records the receipt acknowledgement (CAP-101).
func (s *ContractReviewDeskService) Acknowledge(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.AcknowledgeContractIntakeRequest) (*model.ContractIntake, error) {
	// Load the contract so the acknowledgement event can carry the requester
	// (owner) identity for the PRD §9.1 receipt notification + email.
	contract, err := s.ensureContract(ctx, tenantID, contractID)
	if err != nil {
		return nil, err
	}
	return s.transitionIntake(ctx, tenantID, userID, contractID, "intake.acknowledged",
		"com.clario360.lex.contract_review_desk.intake_acknowledged",
		func(intake *model.ContractIntake, now time.Time) error {
			if intake.Status != model.ContractIntakeStatusReceived {
				return validationError("intake must be in received state to acknowledge", map[string]string{"status": "invalid_current_status"})
			}
			intake.Status = model.ContractIntakeStatusAcknowledged
			intake.AcknowledgedAt = &now
			intake.AcknowledgedBy = &userID
			return nil
		}, nil, contractRequesterFields(contract))
}

// RouteToLegal routes the intake to the legal desk (CAP-102), optionally
// (re)assigning the reviewer.
func (s *ContractReviewDeskService) RouteToLegal(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.RouteContractIntakeRequest) (*model.ContractIntake, error) {
	req.Normalize()
	return s.transitionIntake(ctx, tenantID, userID, contractID, "intake.routed_to_legal",
		"com.clario360.lex.contract_review_desk.intake_routed",
		func(intake *model.ContractIntake, now time.Time) error {
			switch intake.Status {
			case model.ContractIntakeStatusAcknowledged, model.ContractIntakeStatusReceived,
				model.ContractIntakeStatusReturned:
			default:
				return validationError("intake cannot be routed from its current state", map[string]string{"status": "invalid_current_status"})
			}
			intake.Status = model.ContractIntakeStatusRoutedToLegal
			intake.RoutedToLegalAt = &now
			intake.RoutedToLegalBy = &userID
			if req.AssignedReviewerID != nil {
				intake.AssignedReviewerID = req.AssignedReviewerID
			}
			if req.AssignedReviewerName != nil {
				intake.AssignedReviewerName = req.AssignedReviewerName
			}
			return nil
		}, nil, nil)
}

// Return returns the file to the requester (CAP-104) with a deficiency notice
// (CAP-105). It records an auto-return correspondence entry (CAP-116) in the same
// transaction. Refuses while the contract is under an active legal hold.
func (s *ContractReviewDeskService) Return(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.ReturnContractIntakeRequest) (*model.ContractIntake, error) {
	req.Normalize()
	if req.Reason == "" {
		return nil, validationError("reason is required", map[string]string{"reason": "required"})
	}
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectContract, contractID); err != nil {
		return nil, err
	}
	autoReturn := func(ctx context.Context, tx pgx.Tx, intake *model.ContractIntake, now time.Time) error {
		body := req.Reason
		if req.DeficiencyNotice != nil {
			body = body + "\n\n" + *req.DeficiencyNotice
		}
		entry := &model.ContractCorrespondence{
			ID:         uuid.New(),
			TenantID:   tenantID,
			ContractID: contractID,
			IntakeID:   &intake.ID,
			Kind:       model.ContractCorrespondenceKindAutoReturn,
			Direction:  model.ContractCorrespondenceDirectionOutbound,
			Subject:    "Contract returned to requester",
			Body:       body,
			Metadata:   map[string]any{"reference_number": intake.ReferenceNumber},
			CreatedBy:  userID,
		}
		return s.correspondence.Create(ctx, tx, entry)
	}
	return s.transitionIntake(ctx, tenantID, userID, contractID, "intake.returned",
		"com.clario360.lex.contract_review_desk.intake_returned",
		func(intake *model.ContractIntake, now time.Time) error {
			if !contractIntakeReturnAllowed(intake.Status) {
				return validationError("intake cannot be returned from its current state", map[string]string{"status": "invalid_current_status"})
			}
			intake.Status = model.ContractIntakeStatusReturned
			intake.ReturnedAt = &now
			intake.ReturnedBy = &userID
			intake.ReturnReason = &req.Reason
			intake.DeficiencyNotice = req.DeficiencyNotice
			return nil
		}, autoReturn, nil)
}

// transitionIntake loads the intake, applies a mutator, persists it, appends an
// audit row, optionally runs an extra in-transaction side effect, then emits an
// event. It is the shared spine for the desk's intake state machine.
func (s *ContractReviewDeskService) transitionIntake(
	ctx context.Context,
	tenantID, userID, contractID uuid.UUID,
	auditAction, eventType string,
	mutate func(intake *model.ContractIntake, now time.Time) error,
	sideEffect func(ctx context.Context, tx pgx.Tx, intake *model.ContractIntake, now time.Time) error,
	extra map[string]any,
) (*model.ContractIntake, error) {
	intake, err := s.intakes.GetByContract(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract intake not found")
		}
		return nil, internalError("load contract intake", err)
	}
	fromStatus := string(intake.Status)
	now := s.now().UTC()
	if err := mutate(intake, now); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start intake transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.intakes.Update(ctx, tx, intake); err != nil {
		return nil, internalError("update contract intake", err)
	}
	if sideEffect != nil {
		if err := sideEffect(ctx, tx, intake, now); err != nil {
			return nil, internalError("apply intake side effect", err)
		}
	}
	if err := s.appendDeskAuditTransition(ctx, tx, tenantID, contractID, intake.ID, userID, auditAction, fromStatus, string(intake.Status), nil); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit intake transition", err)
	}
	payload := map[string]any{
		"contract_id":        contractID,
		"intake_id":          intake.ID,
		"reference_number":   intake.ReferenceNumber,
		"previous_status":    fromStatus,
		"status":             intake.Status,
		"status_changed_at":  now,
		"received_at":        intake.ReceivedAt,
		"acknowledged_at":    intake.AcknowledgedAt,
		"routed_to_legal_at": intake.RoutedToLegalAt,
		"returned_at":        intake.ReturnedAt,
	}
	// extra carries per-transition payload enrichment (e.g. the requester identity
	// on the acknowledgement receipt, PRD §9.1); other transitions pass nil.
	for k, v := range extra {
		payload[k] = v
	}
	s.emit(ctx, eventType, tenantID, userID, payload)
	return intake, nil
}

// --- Attachments (CAP-099 / CAP-115) ----------------------------------------

// UploadAttachment registers a review-desk attachment in a named slot (CAP-099).
// Uploading into an occupied slot supersedes the prior attachment and increments
// the slot version (re-upload, CAP-115).
func (s *ContractReviewDeskService) UploadAttachment(ctx context.Context, tenantID, userID, contractID uuid.UUID, roles []string, req dto.UploadContractAttachmentRequest) (*model.ContractAttachment, error) {
	req.Normalize()
	if !req.Slot.Valid() {
		return nil, validationError("invalid attachment slot", map[string]string{"slot": "invalid"})
	}
	if req.FileName == "" {
		return nil, validationError("file_name is required", map[string]string{"file_name": "required"})
	}
	contract, err := s.ensureContract(ctx, tenantID, contractID)
	if err != nil {
		return nil, err
	}
	if !canPrepareContractReview(ctx, roles, userID, contract) {
		return nil, forbiddenError("an add-only requester may prepare only their own draft contract")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start attachment transaction", err)
	}
	defer tx.Rollback(ctx)

	maxVersion, err := s.attachments.MaxSlotVersion(ctx, tx, tenantID, contractID, req.Slot)
	if err != nil {
		return nil, internalError("compute attachment version", err)
	}
	if maxVersion > 0 {
		if err := s.attachments.SupersedeSlot(ctx, tx, tenantID, contractID, req.Slot); err != nil {
			return nil, internalError("supersede prior attachment", err)
		}
	}
	att := &model.ContractAttachment{
		ID:            uuid.New(),
		TenantID:      tenantID,
		ContractID:    contractID,
		Slot:          req.Slot,
		FileID:        req.FileID,
		FileName:      req.FileName,
		FileSizeBytes: req.FileSizeBytes,
		ContentHash:   req.ContentHash,
		Version:       maxVersion + 1,
		Superseded:    false,
		Notes:         req.Notes,
		Metadata:      req.Metadata,
		UploadedBy:    userID,
	}
	if err := s.attachments.Create(ctx, tx, att); err != nil {
		return nil, internalError("create attachment", err)
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, att.ID, userID, "attachment.uploaded", map[string]any{
		"slot":    att.Slot,
		"version": att.Version,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit attachment upload", err)
	}
	s.emit(ctx, "com.clario360.lex.contract_review_desk.attachment_uploaded", tenantID, userID, map[string]any{
		"contract_id": contractID,
		"id":          att.ID,
		"slot":        att.Slot,
		"version":     att.Version,
	})
	return att, nil
}

// SetRequirement toggles a named slot required/optional or relabels it (CAP-099).
func (s *ContractReviewDeskService) SetRequirement(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.SetAttachmentRequirementRequest) (*model.ContractAttachmentRequirement, error) {
	req.Normalize()
	if !req.Slot.Valid() {
		return nil, validationError("invalid attachment slot", map[string]string{"slot": "invalid"})
	}
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	label := strings.TrimSpace(deref(req.Label))
	if label == "" {
		label = defaultSlotLabel(req.Slot)
	}
	sortOrder := defaultSlotSortOrder(req.Slot)
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	requirement := &model.ContractAttachmentRequirement{
		ID:         uuid.New(),
		TenantID:   tenantID,
		ContractID: contractID,
		Slot:       req.Slot,
		Required:   req.Required,
		Label:      label,
		SortOrder:  sortOrder,
		CreatedBy:  userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start requirement transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.attachments.UpsertRequirement(ctx, tx, requirement); err != nil {
		return nil, internalError("upsert attachment requirement", err)
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, requirement.ID, userID, "requirement.set", map[string]any{
		"slot":     requirement.Slot,
		"required": requirement.Required,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit requirement set", err)
	}
	return requirement, nil
}

// DeleteAttachment soft-deletes a review-desk attachment. Refuses while the
// contract is under an active legal hold (preservation, CAP guard).
func (s *ContractReviewDeskService) DeleteAttachment(ctx context.Context, tenantID, userID, contractID, attachmentID uuid.UUID, roles []string) error {
	contract, err := s.ensureContract(ctx, tenantID, contractID)
	if err != nil {
		return err
	}
	if !canPrepareContractReview(ctx, roles, userID, contract) {
		return forbiddenError("an add-only requester may prepare only their own draft contract")
	}
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectContract, contractID); err != nil {
		return err
	}
	att, err := s.attachments.Get(ctx, tenantID, attachmentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("attachment not found")
		}
		return internalError("load attachment", err)
	}
	if att.ContractID != contractID {
		return notFoundError("attachment not found")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start attachment transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.attachments.SoftDelete(ctx, tx, tenantID, attachmentID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("attachment not found")
		}
		return internalError("delete attachment", err)
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, attachmentID, userID, "attachment.deleted", map[string]any{
		"slot": att.Slot,
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit attachment delete", err)
	}
	return nil
}

// --- Completeness (CAP-103 / CAP-116) ---------------------------------------

// CheckCompleteness computes the named-slot completeness for a contract (CAP-103)
// and persists the snapshot onto the intake. When complete it advances the intake
// to under_review; when incomplete (and autoReturn) it returns the file with a
// generated deficiency notice (CAP-116). The snapshot + transition are recorded in
// one transaction with an audit row.
func (s *ContractReviewDeskService) CheckCompleteness(ctx context.Context, tenantID, userID, contractID uuid.UUID) (*model.ContractCompletenessResult, error) {
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	requirements, err := s.attachments.ListRequirements(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("load attachment requirements", err)
	}
	requirements = completeContractAttachmentRequirements(contractID, requirements)
	live, err := s.attachments.LiveSlots(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("load live attachments", err)
	}
	result := buildCompletenessResult(contractID, requirements, live, s.now().UTC())

	intake, err := s.intakes.GetByContract(ctx, tenantID, contractID)
	if err != nil && err != pgx.ErrNoRows {
		return nil, internalError("load contract intake", err)
	}
	if intake != nil {
		now := s.now().UTC()
		tx, err := s.db.Begin(ctx)
		if err != nil {
			return nil, internalError("start completeness transaction", err)
		}
		defer tx.Rollback(ctx)
		intake.CompletenessChecked = true
		intake.CompletenessPassed = result.Complete
		intake.LastCheckedAt = &now
		if result.Complete && intake.Status == model.ContractIntakeStatusRoutedToLegal {
			intake.Status = model.ContractIntakeStatusUnderReview
		}
		if err := s.intakes.Update(ctx, tx, intake); err != nil {
			return nil, internalError("update intake completeness", err)
		}
		if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, intake.ID, userID, "completeness.checked", map[string]any{
			"complete":      result.Complete,
			"missing_slots": result.MissingSlots,
		}); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError("commit completeness", err)
		}
	}
	s.emit(ctx, "com.clario360.lex.contract_review_desk.completeness_checked", tenantID, userID, map[string]any{
		"contract_id": contractID,
		"complete":    result.Complete,
	})
	return &result, nil
}

// --- Correspondence (CAP-113 / CAP-114) -------------------------------------

// AddCorrespondence appends an internal or clarification entry to the desk thread
// (CAP-113/CAP-114). Append-only: the entry is immutable once written.
func (s *ContractReviewDeskService) AddCorrespondence(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.AddContractCorrespondenceRequest) (*model.ContractCorrespondence, error) {
	req.Normalize()
	if !req.Kind.Valid() || req.Kind == model.ContractCorrespondenceKindAutoReturn {
		return nil, validationError("invalid correspondence kind", map[string]string{"kind": "invalid"})
	}
	if req.Body == "" {
		return nil, validationError("body is required", map[string]string{"body": "required"})
	}
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	direction := model.ContractCorrespondenceDirectionInternal
	if req.Direction != nil {
		direction = *req.Direction
	} else if req.Kind == model.ContractCorrespondenceKindClarification {
		direction = model.ContractCorrespondenceDirectionOutbound
	}
	if !direction.Valid() {
		return nil, validationError("invalid correspondence direction", map[string]string{"direction": "invalid"})
	}
	var intakeID *uuid.UUID
	if intake, err := s.intakes.GetByContract(ctx, tenantID, contractID); err == nil {
		intakeID = &intake.ID
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load contract intake", err)
	}
	entry := &model.ContractCorrespondence{
		ID:         uuid.New(),
		TenantID:   tenantID,
		ContractID: contractID,
		IntakeID:   intakeID,
		Kind:       req.Kind,
		Direction:  direction,
		Subject:    req.Subject,
		Body:       req.Body,
		Metadata:   req.Metadata,
		CreatedBy:  userID,
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start correspondence transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.correspondence.Create(ctx, tx, entry); err != nil {
		return nil, internalError("create correspondence", err)
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, entry.ID, userID, "correspondence.added", map[string]any{
		"kind": entry.Kind,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit correspondence", err)
	}
	s.emit(ctx, "com.clario360.lex.contract_review_desk.correspondence_added", tenantID, userID, map[string]any{
		"contract_id": contractID,
		"id":          entry.ID,
		"kind":        entry.Kind,
	})
	return entry, nil
}

func (s *ContractReviewDeskService) ListCorrespondence(ctx context.Context, tenantID, contractID uuid.UUID, filters model.ContractCorrespondenceListFilters) ([]model.ContractCorrespondence, int, error) {
	return s.correspondence.ListByContract(ctx, tenantID, contractID, filters)
}

// --- Distribution (CAP-106) -------------------------------------------------

// Distribute routes the file to legal and is restricted to authorized roles
// (CAP-106). roles is the caller's JWT role set (handler passes ClaimsFromContext
// roles). It reuses RouteToLegal for the state transition but enforces the
// role guard up front.
func (s *ContractReviewDeskService) Distribute(ctx context.Context, tenantID, userID, contractID uuid.UUID, roles []string, req dto.RouteContractIntakeRequest) (*model.ContractIntake, error) {
	if !hasDistributionRole(roles) {
		return nil, forbiddenError("distribution is restricted to Legal Director, Contracts Manager, or Supervisor roles")
	}
	return s.RouteToLegal(ctx, tenantID, userID, contractID, req)
}

// --- Recommendation (CAP-118..120) ------------------------------------------

// RecordRecommendation records the final review-desk recommendation (CAP-118),
// requiring an amendment reason for needs_amendment and a rejection reason for
// rejected (CAP-119). Restricted to authorized roles (CAP-106 distribution
// authority also gates the final recommendation). When the outcome is approved
// and start_approval is set, it hands the file to the existing contract-review
// workflow + approval-policy engine for the Contracts-Manager approval (CAP-120)
// and stores the resulting workflow instance id back on the recommendation.
func (s *ContractReviewDeskService) RecordRecommendation(ctx context.Context, tenantID, userID, contractID uuid.UUID, roles []string, req dto.RecordContractRecommendationRequest) (*model.ContractRecommendation, error) {
	req.Normalize()
	if !hasDistributionRole(roles) {
		return nil, forbiddenError("recording a final recommendation is restricted to Legal Director, Contracts Manager, or Supervisor roles")
	}
	if err := validateRecommendationRequest(req); err != nil {
		return nil, err
	}
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}

	intake, err := s.intakes.GetByContract(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("contract intake must be opened and pass completeness before recording a final recommendation")
		}
		return nil, internalError("load contract intake", err)
	}
	if err := validateRecommendationGate(intake); err != nil {
		return nil, err
	}
	if req.Outcome == model.ContractRecommendationOutcomeApproved && s.workflows == nil {
		return nil, internalError("approval workflow not configured", fmt.Errorf("nil workflow service"))
	}
	intakeID := &intake.ID

	rec := &model.ContractRecommendation{
		ID:              uuid.New(),
		TenantID:        tenantID,
		ContractID:      contractID,
		IntakeID:        intakeID,
		Outcome:         req.Outcome,
		Summary:         req.Summary,
		AmendmentReason: req.AmendmentReason,
		RejectionReason: req.RejectionReason,
		Metadata:        req.Metadata,
		CreatedBy:       userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start recommendation transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.recommendations.SupersedeActive(ctx, tx, tenantID, contractID); err != nil {
		return nil, internalError("supersede prior recommendation", err)
	}
	if err := s.recommendations.Create(ctx, tx, rec); err != nil {
		return nil, internalError("create recommendation", err)
	}
	if intake.Status != model.ContractIntakeStatusCompleted {
		intake.Status = model.ContractIntakeStatusCompleted
		if err := s.intakes.Update(ctx, tx, intake); err != nil {
			return nil, internalError("complete intake", err)
		}
	}
	if err := s.appendDeskAudit(ctx, tx, tenantID, contractID, rec.ID, userID, "recommendation.recorded", map[string]any{
		"outcome":          rec.Outcome,
		"intake_id":        intake.ID.String(),
		"reference_number": intake.ReferenceNumber,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit recommendation", err)
	}

	// CAP-117/CAP-120: an approved recommendation hands the file to the existing
	// contract-review workflow + approval-policy engine for the Contracts-Manager
	// approval. This reuses WorkflowService.StartContractReview unchanged; the
	// resulting instance id is recorded back on the recommendation (best-effort:
	// a workflow failure is surfaced to the caller after the recommendation is
	// durably stored).
	if req.Outcome == model.ContractRecommendationOutcomeApproved && req.StartApproval {
		if s.workflows == nil {
			return nil, internalError("approval workflow not configured", fmt.Errorf("nil workflow service"))
		}
		reviewReq := dto.ReviewContractRequest{}
		if req.Review != nil {
			reviewReq = *req.Review
		}
		summary, err := s.workflows.StartContractReview(ctx, tenantID, userID, contractID, reviewReq)
		if err != nil {
			return nil, err
		}
		if summary != nil && summary.WorkflowInstanceID != uuid.Nil {
			instanceID := summary.WorkflowInstanceID
			rec.WorkflowInstanceID = &instanceID
			if err := s.recommendations.SetWorkflowInstance(ctx, s.db, tenantID, rec.ID, instanceID); err != nil {
				s.logger.Error().Err(err).Str("recommendation_id", rec.ID.String()).Msg("record approval workflow instance")
			}
		}
		s.emit(ctx, "com.clario360.lex.contract_review_desk.approval_started", tenantID, userID, map[string]any{
			"contract_id": contractID,
			"id":          rec.ID,
		})
	}

	s.emit(ctx, "com.clario360.lex.contract_review_desk.recommendation_recorded", tenantID, userID, map[string]any{
		"contract_id":      contractID,
		"id":               rec.ID,
		"intake_id":        intake.ID,
		"reference_number": intake.ReferenceNumber,
		"outcome":          rec.Outcome,
		"started_at":       intake.ReceivedAt,
		"completed_at":     rec.CreatedAt,
	})
	return rec, nil
}

// --- Read model -------------------------------------------------------------

// Overview assembles the aggregate desk read model (CAP-094..098/CAP-103/CAP-121).
func (s *ContractReviewDeskService) Overview(ctx context.Context, tenantID, contractID uuid.UUID) (*dto.ContractReviewDeskView, error) {
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	view := &dto.ContractReviewDeskView{ContractID: contractID}
	if intake, err := s.intakes.GetByContract(ctx, tenantID, contractID); err == nil {
		view.Intake = intake
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load contract intake", err)
	}
	requirements, err := s.attachments.ListRequirements(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("load attachment requirements", err)
	}
	view.Requirements = completeContractAttachmentRequirements(contractID, requirements)
	attachments, err := s.attachments.ListByContract(ctx, tenantID, contractID, false)
	if err != nil {
		return nil, internalError("load attachments", err)
	}
	view.Attachments = attachments
	live, err := s.attachments.LiveSlots(ctx, tenantID, contractID)
	if err != nil {
		return nil, internalError("load live attachments", err)
	}
	completeness := buildCompletenessResult(contractID, view.Requirements, live, s.now().UTC())
	view.Completeness = &completeness
	if rec, err := s.recommendations.GetActive(ctx, tenantID, contractID); err == nil {
		view.Recommendation = rec
	} else if err != pgx.ErrNoRows {
		return nil, internalError("load active recommendation", err)
	}
	return view, nil
}

func (s *ContractReviewDeskService) ListAttachments(ctx context.Context, tenantID, contractID uuid.UUID, includeSuperseded bool) ([]model.ContractAttachment, error) {
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	return s.attachments.ListByContract(ctx, tenantID, contractID, includeSuperseded)
}

func (s *ContractReviewDeskService) ListRecommendations(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractRecommendation, error) {
	if _, err := s.ensureContract(ctx, tenantID, contractID); err != nil {
		return nil, err
	}
	return s.recommendations.ListByContract(ctx, tenantID, contractID)
}

// --- Helpers ----------------------------------------------------------------

// appendDeskAudit writes one immutable desk-audit row (no from/to status).
func (s *ContractReviewDeskService) appendDeskAudit(ctx context.Context, q repository.Queryer, tenantID, contractID, subjectID, userID uuid.UUID, action string, detail map[string]any) error {
	return s.appendDeskAuditTransition(ctx, q, tenantID, contractID, subjectID, userID, action, "", "", detail)
}

// appendDeskAuditTransition writes one immutable desk-audit row capturing an
// optional from/to status. Empty status strings are stored as SQL NULL.
func (s *ContractReviewDeskService) appendDeskAuditTransition(ctx context.Context, q repository.Queryer, tenantID, contractID, subjectID, userID uuid.UUID, action, fromStatus, toStatus string, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return internalError("marshal desk audit detail", err)
	}
	var fromPtr, toPtr *string
	if fromStatus != "" {
		fromPtr = &fromStatus
	}
	if toStatus != "" {
		toPtr = &toStatus
	}
	_, err = q.Exec(ctx, `
		INSERT INTO lex_contract_review_desk_audit (
			id, tenant_id, contract_id, subject_id, action, from_status, to_status, detail, actor_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
		uuid.New(), tenantID, contractID, subjectID, action, fromPtr, toPtr, detailJSON, userID,
	)
	if err != nil {
		return internalError("append desk audit", err)
	}
	return nil
}

func (s *ContractReviewDeskService) emit(ctx context.Context, eventType string, tenantID, userID uuid.UUID, payload map[string]any) {
	uid := userID
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &uid, payload, s.logger)
}

// contractRequesterFields carries the contract requester (owner) identity on the
// review-desk intake receipt events (PRD §9.1) so the notification consumer routes
// the receipt / acknowledgement in-app row + email to the requester rather than the
// desk clerk who processed the intake. A nil contract yields an empty map, in which
// case the consumer skips the receipt (best-effort, never fatal).
func contractRequesterFields(contract *model.Contract) map[string]any {
	if contract == nil {
		return map[string]any{}
	}
	return map[string]any{
		"requester_user_id": contract.OwnerUserID,
		"requester_name":    contract.OwnerName,
		"contract_title":    contract.Title,
	}
}

func hasDistributionRole(roles []string) bool {
	for _, role := range roles {
		if _, ok := distributionRoles[strings.ToLower(strings.TrimSpace(role))]; ok {
			return true
		}
	}
	return false
}

func contractIntakeReturnAllowed(status model.ContractIntakeStatus) bool {
	switch status {
	case model.ContractIntakeStatusRoutedToLegal, model.ContractIntakeStatusUnderReview:
		return true
	default:
		return false
	}
}

func validateRecommendationGate(intake *model.ContractIntake) error {
	if intake == nil {
		return conflictError("contract intake must be opened before recording a final recommendation")
	}
	if !intake.CompletenessChecked || !intake.CompletenessPassed {
		return conflictError("contract intake must pass completeness before recording a final recommendation")
	}
	switch intake.Status {
	case model.ContractIntakeStatusUnderReview, model.ContractIntakeStatusCompleted:
		return nil
	default:
		return conflictError("contract intake must be under review before recording a final recommendation")
	}
}

func validateRecommendationRequest(req dto.RecordContractRecommendationRequest) error {
	if !req.Outcome.Valid() {
		return validationError("invalid recommendation outcome", map[string]string{"outcome": "invalid"})
	}
	if req.Summary == "" {
		return validationError("summary is required", map[string]string{"summary": "required"})
	}
	switch req.Outcome {
	case model.ContractRecommendationOutcomeApproved:
		if !req.StartApproval {
			return validationError("approved recommendations must start the manager approval workflow", map[string]string{"start_approval": "required"})
		}
	case model.ContractRecommendationOutcomeNeedsAmendment:
		if req.AmendmentReason == nil {
			return validationError("amendment_reason is required for needs_amendment", map[string]string{"amendment_reason": "required"})
		}
	case model.ContractRecommendationOutcomeRejected:
		if req.RejectionReason == nil {
			return validationError("rejection_reason is required for rejected", map[string]string{"rejection_reason": "required"})
		}
	}
	return nil
}

// completeContractAttachmentRequirements returns the full ordered requirement set
// for a contract: the canonical PRD §9.1 seeds first (a stored requirement row wins
// over the seed default so per-intake required/optional/label overrides are
// preserved, otherwise the seed default is synthesized), followed by any stored
// requirement rows on a slot outside the seed set (legacy pre-PRD intakes). This
// mirrors the frontend's PRD-first union so new intakes gate on the five PRD slots
// while historical in-flight intakes never lose their legacy slots ("widen, never
// narrow").
func completeContractAttachmentRequirements(contractID uuid.UUID, requirements []model.ContractAttachmentRequirement) []model.ContractAttachmentRequirement {
	bySlot := make(map[model.ContractAttachmentSlot]model.ContractAttachmentRequirement, len(requirements))
	for _, requirement := range requirements {
		bySlot[requirement.Slot] = requirement
	}
	seen := make(map[model.ContractAttachmentSlot]struct{}, len(contractAttachmentSlotSeeds))
	out := make([]model.ContractAttachmentRequirement, 0, len(contractAttachmentSlotSeeds)+len(requirements))
	for _, seed := range contractAttachmentSlotSeeds {
		seen[seed.Slot] = struct{}{}
		if existing, ok := bySlot[seed.Slot]; ok {
			out = append(out, existing)
			continue
		}
		out = append(out, model.ContractAttachmentRequirement{
			ID:         uuid.Nil,
			ContractID: contractID,
			Slot:       seed.Slot,
			Required:   seed.Required,
			Label:      seed.Label,
			SortOrder:  seed.SortOrder,
		})
	}
	// Preserve any stored requirement rows on non-PRD slots (legacy intakes),
	// keeping their stored order.
	for _, requirement := range requirements {
		if _, ok := seen[requirement.Slot]; ok {
			continue
		}
		seen[requirement.Slot] = struct{}{}
		out = append(out, requirement)
	}
	return out
}

// completenessSlotAliases maps a PRD §9.1 requirement slot onto the legacy slots
// whose live attachment also satisfies it (CAP-103). A contract draft produced by
// the drafting workspace, created through the contract form dialog, or backfilled
// from a historical contract version lands in the legacy 'draft' slot; the PRD
// intake seeds no 'draft' requirement (contractAttachmentSlotSeeds), so without an
// alias a linked draft would never satisfy completeness. The draft IS the
// foundation contract document under review, so it fulfils the foundation_document
// requirement — the direct slot attachment always wins, the alias only fills a gap.
var completenessSlotAliases = map[model.ContractAttachmentSlot][]model.ContractAttachmentSlot{
	model.ContractAttachmentSlotFoundationDocument: {model.ContractAttachmentSlotDraft},
}

// liveSlotAttachment resolves the live attachment that satisfies a requirement
// slot: the direct slot attachment first, then any aliased legacy slot.
func liveSlotAttachment(slot model.ContractAttachmentSlot, live map[model.ContractAttachmentSlot]model.ContractAttachment) (model.ContractAttachment, bool) {
	if att, ok := live[slot]; ok {
		return att, true
	}
	for _, alias := range completenessSlotAliases[slot] {
		if att, ok := live[alias]; ok {
			return att, true
		}
	}
	return model.ContractAttachment{}, false
}

func buildCompletenessResult(contractID uuid.UUID, requirements []model.ContractAttachmentRequirement, live map[model.ContractAttachmentSlot]model.ContractAttachment, checkedAt time.Time) model.ContractCompletenessResult {
	requirements = completeContractAttachmentRequirements(contractID, requirements)
	result := model.ContractCompletenessResult{
		ContractID:   contractID,
		Complete:     true,
		MissingSlots: []model.ContractAttachmentSlot{},
		Slots:        make([]model.ContractCompletenessSlot, 0, len(requirements)),
		CheckedAt:    checkedAt.UTC(),
	}
	for _, requirement := range requirements {
		slot := model.ContractCompletenessSlot{
			Slot:     requirement.Slot,
			Label:    requirement.Label,
			Required: requirement.Required,
		}
		if att, ok := liveSlotAttachment(requirement.Slot, live); ok {
			slot.Satisfied = true
			id := att.ID
			name := att.FileName
			slot.AttachmentID = &id
			slot.FileName = &name
		}
		if requirement.Required && !slot.Satisfied {
			result.Complete = false
			result.MissingSlots = append(result.MissingSlots, requirement.Slot)
		}
		result.Slots = append(result.Slots, slot)
	}
	return result
}

func defaultSlotLabel(slot model.ContractAttachmentSlot) string {
	for _, seed := range contractAttachmentSlotSeeds {
		if seed.Slot == slot {
			return seed.Label
		}
	}
	for _, seed := range legacyContractAttachmentSlotSeeds {
		if seed.Slot == slot {
			return seed.Label
		}
	}
	return string(slot)
}

func defaultSlotSortOrder(slot model.ContractAttachmentSlot) int {
	for _, seed := range contractAttachmentSlotSeeds {
		if seed.Slot == slot {
			return seed.SortOrder
		}
	}
	for _, seed := range legacyContractAttachmentSlotSeeds {
		if seed.Slot == slot {
			return seed.SortOrder
		}
	}
	return 200
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
