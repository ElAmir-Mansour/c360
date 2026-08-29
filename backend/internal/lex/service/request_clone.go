package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// RequestCloner spawns a fresh legal request from an existing one (CAP-026):
// when the Execution engine auto-closes a request after the configured number of
// returned review rounds, the clone is treated as a BRAND-NEW request under a
// fresh SLA. It coordinates only through the shared LegalRequestService — it owns
// no tables and never reaches into the SLA package.
type RequestCloner struct {
	requests *LegalRequestService
	logger   zerolog.Logger
}

// ErrReexecutionCloneLimit is returned when a request is already a re-execution
// clone. CAP-026 allows one fresh clone after the original request auto-closes;
// clones themselves auto-close terminally so the engine cannot create an
// infinite chain.
var ErrReexecutionCloneLimit = errors.New("re-execution clone limit reached")

func NewRequestCloner(requests *LegalRequestService, logger zerolog.Logger) *RequestCloner {
	return &RequestCloner{
		requests: requests,
		logger:   logger.With().Str("service", "lex-request-clone").Logger(),
	}
}

// CloneForReexecution loads the source request and creates a new draft request
// carrying the same intake attributes, linked back to the source via metadata so
// the lineage is auditable. The clone starts at draft with a fresh request
// number (auto-generated) and a fresh SLA clock (no execution state yet).
func (c *RequestCloner) CloneForReexecution(ctx context.Context, tenantID, userID, sourceRequestID uuid.UUID, reason string) (*model.LegalRequest, error) {
	source, err := c.requests.Get(ctx, tenantID, sourceRequestID)
	if err != nil {
		return nil, err
	}
	if !requestAllowsReexecutionClone(source) {
		return nil, ErrReexecutionCloneLimit
	}

	metadata := cloneMetadata(source.Metadata)
	metadata["cloned_from_request_id"] = sourceRequestID.String()
	metadata["cloned_from_request_number"] = source.RequestNumber
	metadata["clone_reason"] = reason
	metadata["clone_generation"] = cloneGeneration(source.Metadata) + 1

	req := dto.CreateLegalRequestRequest{
		RequestType:           source.RequestType,
		ServiceID:             source.ServiceID,
		Title:                 source.Title,
		Description:           source.Description,
		RequesterUserID:       &source.RequesterUserID,
		RequesterName:         source.RequesterName,
		BeneficiaryEntityID:   source.BeneficiaryEntityID,
		Department:            source.Department,
		Priority:              source.Priority,
		UrgencyJustification:  source.UrgencyJustification,
		RequesterApprovalReqd: source.RequesterApprovalReqd,
		ProviderApprovalReqd:  source.ProviderApprovalReqd,
		SubjectType:           source.SubjectType,
		SubjectID:             source.SubjectID,
		Metadata:              metadata,
	}

	clone, err := c.requests.Create(ctx, tenantID, userID, req)
	if err != nil {
		return nil, fmt.Errorf("create clone request: %w", err)
	}
	c.logger.Info().
		Str("source_request_id", sourceRequestID.String()).
		Str("clone_request_id", clone.ID.String()).
		Msg("spawned re-execution clone after auto-close")
	return clone, nil
}

func cloneMetadata(source map[string]any) map[string]any {
	out := make(map[string]any, len(source)+4)
	for key, value := range source {
		// Drop prior clone-linkage keys so each generation carries only its own.
		switch key {
		case "cloned_from_request_id", "cloned_from_request_number", "clone_reason", "clone_generation":
			continue
		}
		out[key] = value
	}
	return out
}

func cloneGeneration(source map[string]any) int {
	if source == nil {
		return 0
	}
	switch v := source["clone_generation"].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case jsonNumber:
		n, _ := strconv.Atoi(v.String())
		return n
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(v))
		return n
	default:
		return 0
	}
}

func requestAllowsReexecutionClone(request *model.LegalRequest) bool {
	if request == nil {
		return false
	}
	if cloneGeneration(request.Metadata) > 0 {
		return false
	}
	return clonedFromRequestIDFromMetadata(request.Metadata) == nil
}

func clonedFromRequestIDFromMetadata(metadata map[string]any) *uuid.UUID {
	if metadata == nil {
		return nil
	}
	switch v := metadata["cloned_from_request_id"].(type) {
	case uuid.UUID:
		if v == uuid.Nil {
			return nil
		}
		return &v
	case string:
		parsed, err := uuid.Parse(strings.TrimSpace(v))
		if err != nil || parsed == uuid.Nil {
			return nil
		}
		return &parsed
	default:
		return nil
	}
}

type jsonNumber interface {
	String() string
}
