package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
)

// BulkApply applies one action across many consultations (CORE #4). Each id is
// processed independently via the EXISTING per-id service method (so the FSM, RBAC
// hold-guard, audit row, event emission, and SLA side-effects all run exactly as
// for a single op) and in its own transaction — one failure never rolls back the
// rest. The result collects per-id succeeded/failed so the caller (and frontend)
// can show partial outcomes. The action-level RBAC (lex:write, +org:close for
// delete) is enforced at the route layer; this method assumes the caller is
// authorised for the action.
func (s *ConsultationService) BulkApply(ctx context.Context, tenantID, userID uuid.UUID, req dto.BulkConsultationRequest) (*dto.BulkConsultationResult, error) {
	req.Normalize()
	if err := validateBulkConsultationRequest(req); err != nil {
		return nil, err
	}

	result := &dto.BulkConsultationResult{
		Succeeded: make([]uuid.UUID, 0, len(req.IDs)),
		Failed:    make([]dto.BulkConsultationFailure, 0),
	}
	seen := make(map[uuid.UUID]struct{}, len(req.IDs))
	for _, id := range req.IDs {
		if id == uuid.Nil {
			continue
		}
		if _, dup := seen[id]; dup {
			continue // de-dup ids so a repeat doesn't double-apply
		}
		seen[id] = struct{}{}

		if err := s.applyBulkOne(ctx, tenantID, userID, id, req); err != nil {
			result.Failed = append(result.Failed, dto.BulkConsultationFailure{
				ID:    id,
				Error: bulkErrorMessage(err),
			})
			continue
		}
		result.Succeeded = append(result.Succeeded, id)
	}
	return result, nil
}

// applyBulkOne dispatches a single id to the matching per-id service method.
func (s *ConsultationService) applyBulkOne(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.BulkConsultationRequest) error {
	switch req.Action {
	case dto.BulkConsultationActionArchive:
		_, err := s.Archive(ctx, tenantID, userID, id, dto.ArchiveConsultationRequest{Reason: req.Reason})
		return err
	case dto.BulkConsultationActionDelete:
		return s.Delete(ctx, tenantID, id)
	case dto.BulkConsultationActionClassify:
		_, err := s.Classify(ctx, tenantID, userID, id, dto.ClassifyConsultationRequest{
			Type:     req.Type,
			Priority: req.Priority,
			Notes:    req.Notes,
		})
		return err
	case dto.BulkConsultationActionRoute:
		_, err := s.Route(ctx, tenantID, userID, id, dto.RouteConsultationRequest{
			AdvisorID:   *req.AdvisorID,
			AdvisorName: req.AdvisorName,
			Notes:       req.Notes,
		})
		return err
	case dto.BulkConsultationActionTag:
		return s.applyBulkTag(ctx, tenantID, userID, id, req)
	default:
		return validationError("unsupported bulk action", map[string]string{"action": "invalid"})
	}
}

// applyBulkTag adds or replaces tags on a single consultation in its own tx, with a
// governance audit row, mirroring the per-id mutation pattern of the other actions.
func (s *ConsultationService) applyBulkTag(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.BulkConsultationRequest) error {
	c, err := s.consultations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("consultation not found")
		}
		return internalError("load consultation", err)
	}
	var finalTags []string
	if req.TagMode == "replace" {
		finalTags = dto.NormalizeTags(req.Tags)
	} else {
		finalTags = dto.NormalizeTags(append(append([]string{}, c.Tags...), req.Tags...))
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return internalError("start consultation tag transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.consultations.UpdateTags(ctx, tx, tenantID, id, finalTags); err != nil {
		return s.mapMutationError("tag consultation", err)
	}
	if err := s.appendAudit(ctx, tx, c, userID, "consultation.tagged", nil, nil, map[string]any{
		"tag_mode": req.TagMode,
		"tags":     finalTags,
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError("commit consultation tag", err)
	}
	c.Tags = finalTags
	s.emitLedger(ctx, c, userID, "consultation.tagged", "info", nil, map[string]any{
		"tag_mode": req.TagMode,
	})
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.consultation.tagged", tenantID, &userID, map[string]any{
		"id":   id,
		"tags": finalTags,
	}, s.logger)
	return nil
}

func validateBulkConsultationRequest(req dto.BulkConsultationRequest) error {
	if len(req.IDs) == 0 {
		return validationError("ids is required", map[string]string{"ids": "required"})
	}
	if len(req.IDs) > bulkConsultationMaxIDs {
		return validationError(
			fmt.Sprintf("too many ids (max %d)", bulkConsultationMaxIDs),
			map[string]string{"ids": "too_many"},
		)
	}
	switch req.Action {
	case dto.BulkConsultationActionArchive, dto.BulkConsultationActionDelete:
		// no extra params
	case dto.BulkConsultationActionClassify:
		if !req.Type.Valid() {
			return validationError("invalid consultation type", map[string]string{"type": "invalid"})
		}
		if req.Priority != nil {
			if _, ok := allowedLegalPriorities[*req.Priority]; !ok {
				return validationError("invalid priority", map[string]string{"priority": "invalid"})
			}
		}
	case dto.BulkConsultationActionRoute:
		if req.AdvisorID == nil || *req.AdvisorID == uuid.Nil {
			return validationError("advisor_id is required", map[string]string{"advisor_id": "required"})
		}
	case dto.BulkConsultationActionTag:
		if len(req.Tags) == 0 {
			return validationError("tags is required", map[string]string{"tags": "required"})
		}
		if req.TagMode != "add" && req.TagMode != "replace" {
			return validationError("tag_mode must be add or replace", map[string]string{"tag_mode": "invalid"})
		}
	default:
		return validationError("unsupported bulk action", map[string]string{"action": "invalid"})
	}
	return nil
}

// bulkConsultationMaxIDs caps a single bulk batch so a runaway request cannot tie up
// the server processing thousands of per-id transactions.
const bulkConsultationMaxIDs = 200

// bulkErrorMessage extracts a human-readable per-id failure message from a service
// error without leaking internal-error wrapping detail (the AppError.Message, not
// the wrapped cause).
func bulkErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	var appErr *apperrors.AppError
	if errors.As(err, &appErr) {
		return appErr.Message
	}
	return err.Error()
}
