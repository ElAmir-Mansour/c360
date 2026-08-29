package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// legalHoldConflictError reports that the subject already has an active hold.
// It carries the existing hold so callers can surface the blocking reference.
func legalHoldConflictError(message string) error {
	return apperrors.NewConflict("LEGAL_HOLD_ACTIVE", message)
}

// legalHoldEnforcementError is the domain error returned by the destructive-op
// guard. It is a 409 (the request is well-formed but conflicts with an active
// preservation requirement) and names the subject under hold. Other lex
// services use enforceNotUnderLegalHold to produce it.
func legalHoldEnforcementError(subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) error {
	return apperrors.NewConflict(
		"LEGAL_HOLD_ACTIVE",
		fmt.Sprintf("%s %s is under an active legal hold and cannot be deleted, archived, or modified", subjectType, subjectID),
	)
}

// LegalHoldService implements FR-WATHEEQ-005: placing, listing, and releasing
// litigation/regulatory holds, plus the enforcement primitives that let other
// lex services refuse destructive operations on a held subject.
type LegalHoldService struct {
	db        *pgxpool.Pool
	holds     *repository.LegalHoldRepository
	contracts *repository.ContractRepository
	matters   *repository.MatterRepository
	documents *repository.DocumentRepository
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewLegalHoldService(
	db *pgxpool.Pool,
	holds *repository.LegalHoldRepository,
	contracts *repository.ContractRepository,
	matters *repository.MatterRepository,
	documents *repository.DocumentRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *LegalHoldService {
	return &LegalHoldService{
		db:        db,
		holds:     holds,
		contracts: contracts,
		matters:   matters,
		documents: documents,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-legal-holds").Logger(),
		now:       time.Now,
	}
}

// ApplyHold places a new active legal hold on a contract, matter, or document.
// The subject must exist within the tenant and must not already have an active
// hold. On success it emits a CloudEvents domain event (which the audit
// consumer records) and returns the persisted hold.
func (s *LegalHoldService) ApplyHold(ctx context.Context, tenantID, userID uuid.UUID, req dto.ApplyLegalHoldRequest) (*model.LegalHold, error) {
	req.Normalize()
	if err := validateApplyLegalHold(req); err != nil {
		return nil, err
	}

	// Confirm the subject exists in this tenant. This both prevents holds on
	// phantom ids and surfaces the underlying file object for the file-service
	// preservation hook.
	fileID, err := s.resolveSubjectFileID(ctx, tenantID, req.SubjectType, req.SubjectID)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	hold := &model.LegalHold{
		ID:          uuid.New(),
		TenantID:    tenantID,
		SubjectType: req.SubjectType,
		SubjectID:   req.SubjectID,
		Reason:      req.Reason,
		Reference:   req.Reference,
		Status:      model.LegalHoldStatusActive,
		Custodian:   req.Custodian,
		Notes:       req.Notes,
		AppliedBy:   userID,
		AppliedAt:   now,
		Metadata:    req.Metadata,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start legal hold transaction", err)
	}
	defer tx.Rollback(ctx)

	if err := s.holds.Create(ctx, tx, hold); err != nil {
		if isUniqueViolation(err) {
			return nil, legalHoldConflictError(fmt.Sprintf("%s %s already has an active legal hold", req.SubjectType, req.SubjectID))
		}
		return nil, internalError("create legal hold", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit legal hold", err)
	}

	// FILE-SERVICE HOOK POINT (SRS "apply legal hold to documents via the File
	// service"): the platform File service (internal/filemanager) currently
	// exposes only TTL lifecycle + soft delete and NO retention/legal-hold/WORM
	// endpoint. We therefore persist and enforce the hold authoritatively in lex
	// and publish the domain event below; when the File service grows a
	// freeze/retain API, call it here with fileID before commit. We do NOT
	// fabricate a file-service endpoint.
	s.recordHoldMetric(req.SubjectType, "applied")

	payload := map[string]any{
		"id":           hold.ID,
		"subject_type": hold.SubjectType,
		"subject_id":   hold.SubjectID,
		"reason":       hold.Reason,
		"reference":    hold.Reference,
		"custodian":    hold.Custodian,
		"status":       hold.Status,
		"applied_by":   hold.AppliedBy,
		"applied_at":   hold.AppliedAt,
	}
	if fileID != nil {
		payload["file_id"] = *fileID
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.legal_hold.applied", tenantID, &userID, payload, s.logger)

	return hold, nil
}

// ReleaseHold lifts an active hold. It is idempotent for the API caller:
// releasing an already-released (or unknown) hold returns NOT_FOUND. On success
// it emits the release event.
func (s *LegalHoldService) ReleaseHold(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.ReleaseLegalHoldRequest) (*model.LegalHold, error) {
	req.Normalize()

	existing, err := s.holds.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("legal hold not found")
		}
		return nil, internalError("load legal hold", err)
	}
	if existing.Status != model.LegalHoldStatusActive {
		return nil, conflictError("legal hold is not active")
	}

	now := s.now().UTC()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start legal hold release transaction", err)
	}
	defer tx.Rollback(ctx)

	if err := s.holds.Release(ctx, tx, tenantID, id, userID, now, req.ReleaseNote); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Lost a race: another release committed first.
			return nil, conflictError("legal hold is not active")
		}
		return nil, internalError("release legal hold", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit legal hold release", err)
	}

	s.recordHoldMetric(existing.SubjectType, "released")

	released, err := s.holds.Get(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("reload legal hold", err)
	}

	// FILE-SERVICE HOOK POINT: when the File service exposes a retain/release
	// API, lift the underlying object's preservation here using the subject's
	// file id before returning.
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.legal_hold.released", tenantID, &userID, map[string]any{
		"id":           released.ID,
		"subject_type": released.SubjectType,
		"subject_id":   released.SubjectID,
		"reference":    released.Reference,
		"status":       released.Status,
		"released_by":  userID,
		"released_at":  now,
		"release_note": released.ReleaseNote,
	}, s.logger)

	return released, nil
}

// ListHolds returns a tenant-scoped, filtered, paginated listing.
func (s *LegalHoldService) ListHolds(ctx context.Context, tenantID uuid.UUID, filters model.LegalHoldListFilters) ([]model.LegalHold, int, error) {
	items, total, err := s.holds.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list legal holds", err)
	}
	return items, total, nil
}

// Get returns a single hold by id.
func (s *LegalHoldService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalHold, error) {
	hold, err := s.holds.Get(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notFoundError("legal hold not found")
		}
		return nil, internalError("load legal hold", err)
	}
	return hold, nil
}

// GetActiveHoldsForSubject returns the active holds (if any) on a subject.
func (s *LegalHoldService) GetActiveHoldsForSubject(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) ([]model.LegalHold, error) {
	if !subjectType.Valid() {
		return nil, validationError("invalid subject_type", map[string]string{"subject_type": "invalid"})
	}
	items, err := s.holds.ListActiveForSubject(ctx, tenantID, subjectType, subjectID)
	if err != nil {
		return nil, internalError("list active legal holds", err)
	}
	return items, nil
}

// IsSubjectHeld reports whether a subject currently has an active hold. This is
// the primitive the enforcement guard and other services use.
func (s *LegalHoldService) IsSubjectHeld(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (bool, error) {
	held, err := s.holds.IsSubjectHeld(ctx, s.db, tenantID, subjectType, subjectID)
	if err != nil {
		return false, internalError("check legal hold", err)
	}
	return held, nil
}

// EnsureSubjectMutable returns a LEGAL_HOLD_ACTIVE conflict error when the
// subject is under an active hold, and nil otherwise. Destructive lex service
// paths (delete/archive/cancel/terminate) call this BEFORE mutating so a held
// subject cannot be removed or altered away (the legal requirement).
func (s *LegalHoldService) EnsureSubjectMutable(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) error {
	held, err := s.IsSubjectHeld(ctx, tenantID, subjectType, subjectID)
	if err != nil {
		return err
	}
	if held {
		return legalHoldEnforcementError(subjectType, subjectID)
	}
	return nil
}

// LegalHoldGuard is the narrow capability other lex services depend on to
// enforce holds without taking a dependency on the full service. *LegalHoldService
// satisfies it. A nil guard means "no hold enforcement configured" and callers
// treat that as always-mutable (backward compatible).
type LegalHoldGuard interface {
	EnsureSubjectMutable(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) error
}

// ensureMutable is a nil-safe helper for callers holding a LegalHoldGuard.
func ensureMutable(ctx context.Context, guard LegalHoldGuard, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) error {
	if guard == nil {
		return nil
	}
	return guard.EnsureSubjectMutable(ctx, tenantID, subjectType, subjectID)
}

// resolveSubjectFileID loads the subject to confirm it exists in the tenant and
// returns the underlying File-service object id when the subject has one (used
// for the file-service preservation hook + emitted in the event). A missing
// subject yields a 404.
func (s *LegalHoldService) resolveSubjectFileID(ctx context.Context, tenantID uuid.UUID, subjectType model.LegalHoldSubjectType, subjectID uuid.UUID) (*uuid.UUID, error) {
	switch subjectType {
	case model.LegalHoldSubjectContract:
		contract, err := s.contracts.Get(ctx, tenantID, subjectID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, notFoundError("contract not found")
			}
			return nil, internalError("load contract", err)
		}
		return contract.DocumentFileID, nil
	case model.LegalHoldSubjectMatter:
		if _, err := s.matters.Get(ctx, tenantID, subjectID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, notFoundError("matter not found")
			}
			return nil, internalError("load matter", err)
		}
		return nil, nil
	case model.LegalHoldSubjectDocument:
		document, err := s.documents.Get(ctx, tenantID, subjectID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, notFoundError("document not found")
			}
			return nil, internalError("load document", err)
		}
		return document.FileID, nil
	default:
		return nil, validationError("invalid subject_type", map[string]string{"subject_type": "invalid"})
	}
}

func (s *LegalHoldService) recordHoldMetric(subjectType model.LegalHoldSubjectType, action string) {
	if s.metrics == nil {
		return
	}
	s.metrics.RecordLegalHoldAction(string(subjectType), action)
}

func validateApplyLegalHold(req dto.ApplyLegalHoldRequest) error {
	fields := map[string]string{}
	if !req.SubjectType.Valid() {
		fields["subject_type"] = "must be one of contract, matter, document"
	}
	if req.SubjectID == uuid.Nil {
		fields["subject_id"] = "required"
	}
	if req.Reason == "" {
		fields["reason"] = "required"
	}
	if len(fields) > 0 {
		return validationError("invalid legal hold request", fields)
	}
	return nil
}
