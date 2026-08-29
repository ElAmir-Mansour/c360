package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// ContractFinalVersionService owns the review-desk final-version ceremony
// (CAP-117) WITHOUT touching the existing contract or review-desk services. It
// references contracts/recommendations by id and, in one transaction:
//
//  1. asserts the latest review-desk recommendation for the contract is
//     "approved" (else 409 — the final version may only be uploaded after the
//     desk has approved the file);
//  2. writes the new current contract_versions row (prior versions are superseded
//     by the version ordering — the newest IS the current/active one, matching the
//     contracts.current_version model);
//  3. stamps contracts.final_uploaded_at (the column added by migration 000074);
//  4. transitions the contract draft -> active.
//
// LegalHold preservation is enforced up front via ensureMutable, mirroring the
// review-desk destructive mutations. A CloudEvent is emitted after commit.
type ContractFinalVersionService struct {
	db              *pgxpool.Pool
	contracts       *repository.ContractRepository
	recommendations *repository.ContractRecommendationRepository
	publisher       Publisher
	topic           string
	logger          zerolog.Logger
	now             func() time.Time
	legalHolds      LegalHoldGuard
}

func NewContractFinalVersionService(
	db *pgxpool.Pool,
	contracts *repository.ContractRepository,
	recommendations *repository.ContractRecommendationRepository,
	publisher Publisher,
	topic string,
	logger zerolog.Logger,
) *ContractFinalVersionService {
	return &ContractFinalVersionService{
		db:              db,
		contracts:       contracts,
		recommendations: recommendations,
		publisher:       publisherOrNoop(publisher),
		topic:           topic,
		logger:          logger.With().Str("service", "lex-contract-final-version").Logger(),
		now:             time.Now,
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard. Returns the receiver
// for chaining, mirroring ContractReviewDeskService.WithLegalHoldGuard.
func (s *ContractFinalVersionService) WithLegalHoldGuard(guard LegalHoldGuard) *ContractFinalVersionService {
	s.legalHolds = guard
	return s
}

// UploadFinalVersion executes the CAP-117 final-version ceremony. The contract
// must exist, must not be under an active legal hold, and its latest review-desk
// recommendation must be "approved".
func (s *ContractFinalVersionService) UploadFinalVersion(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.UploadContractFinalVersionRequest) (*model.ContractFinalVersionResult, error) {
	req.Normalize()
	if req.FileID == uuid.Nil || req.FileName == "" || req.ContentHash == "" {
		return nil, validationError("file_id, file_name, and content_hash are required", map[string]string{
			"file_id":      "required",
			"file_name":    "required",
			"content_hash": "required",
		})
	}

	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load contract", err)
	}

	// Preservation: a contract under an active legal hold cannot have its final
	// version uploaded / status advanced.
	if err := ensureMutable(ctx, s.legalHolds, tenantID, model.LegalHoldSubjectContract, contractID); err != nil {
		return nil, err
	}

	// Approval gate (CAP-117): the latest (non-superseded) review-desk
	// recommendation must be approved.
	rec, err := s.recommendations.GetActive(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, conflictError("an approved review-desk recommendation is required before uploading the final version")
		}
		return nil, internalError("load active recommendation", err)
	}
	if rec.Outcome != model.ContractRecommendationOutcomeApproved {
		return nil, conflictError("the latest review-desk recommendation must be approved before uploading the final version")
	}

	now := s.now().UTC()
	previousStatus := contract.Status

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start final-version transaction", err)
	}
	defer tx.Rollback(ctx)

	// (b)+(c): write the new current version. Prior versions are superseded by the
	// version ordering (the newest IS the current/active one), matching the
	// existing contracts.current_version model.
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
		return nil, internalError("insert final contract version", err)
	}
	if err := s.contracts.UpdateDocument(ctx, tx, tenantID, contract.ID, req.FileID, req.ExtractedText, version.Version); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("update current contract document", err)
	}

	// (c): stamp contracts.final_uploaded_at (migration 000074). No repo method
	// exists for this single new column, so it is set directly on the same tx.
	if _, err := tx.Exec(ctx, `
		UPDATE contracts
		SET final_uploaded_at = $3,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, contract.ID, now,
	); err != nil {
		return nil, internalError("stamp final upload time", err)
	}

	// (d): transition the contract draft -> active.
	newStatus := model.ContractStatusActive
	if err := s.contracts.UpdateStatus(ctx, tx, tenantID, contract.ID, &previousStatus, newStatus, &userID, now, nil); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("activate contract", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit final-version ceremony", err)
	}

	uid := userID
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.contract.final_version_uploaded", tenantID, &uid, map[string]any{
		"id":                contract.ID,
		"contract_id":       contract.ID,
		"version":           version.Version,
		"file_id":           req.FileID,
		"content_hash":      req.ContentHash,
		"recommendation_id": rec.ID,
		"previous_status":   previousStatus,
		"status":            newStatus,
		"final_uploaded_at": now,
	}, s.logger)

	return &model.ContractFinalVersionResult{
		ContractID:      contract.ID,
		Version:         version,
		PreviousStatus:  previousStatus,
		Status:          newStatus,
		FinalUploadedAt: now,
	}, nil
}
