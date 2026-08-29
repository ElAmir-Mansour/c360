package service

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateBulkConsultationRequest(t *testing.T) {
	advisor := uuid.New()
	id := uuid.New()
	priorityBad := model.LegalPriority("nope")
	tests := []struct {
		name    string
		req     dto.BulkConsultationRequest
		wantErr bool
	}{
		{
			name:    "empty ids rejected",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionArchive},
			wantErr: true,
		},
		{
			name:    "archive ok",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionArchive, IDs: []uuid.UUID{id}},
			wantErr: false,
		},
		{
			name:    "delete ok",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionDelete, IDs: []uuid.UUID{id}},
			wantErr: false,
		},
		{
			name:    "classify needs valid type",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionClassify, IDs: []uuid.UUID{id}, Type: model.ConsultationType("bogus")},
			wantErr: true,
		},
		{
			name:    "classify ok",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionClassify, IDs: []uuid.UUID{id}, Type: model.ConsultationTypeLabor},
			wantErr: false,
		},
		{
			name:    "classify bad priority",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionClassify, IDs: []uuid.UUID{id}, Type: model.ConsultationTypeLabor, Priority: &priorityBad},
			wantErr: true,
		},
		{
			name:    "route needs advisor",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionRoute, IDs: []uuid.UUID{id}},
			wantErr: true,
		},
		{
			name:    "route ok",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionRoute, IDs: []uuid.UUID{id}, AdvisorID: &advisor},
			wantErr: false,
		},
		{
			name:    "tag needs tags",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationActionTag, IDs: []uuid.UUID{id}, TagMode: "add"},
			wantErr: true,
		},
		{
			name:    "unsupported action",
			req:     dto.BulkConsultationRequest{Action: dto.BulkConsultationAction("frobnicate"), IDs: []uuid.UUID{id}},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.req.Normalize()
			err := validateBulkConsultationRequest(tt.req)
			if tt.wantErr != (err != nil) {
				t.Fatalf("validateBulkConsultationRequest() err = %v, wantErr = %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateBulkConsultationRequestTooManyIDs(t *testing.T) {
	ids := make([]uuid.UUID, bulkConsultationMaxIDs+1)
	for i := range ids {
		ids[i] = uuid.New()
	}
	req := dto.BulkConsultationRequest{Action: dto.BulkConsultationActionArchive, IDs: ids}
	req.Normalize()
	if err := validateBulkConsultationRequest(req); err == nil {
		t.Fatalf("expected error for %d ids (max %d)", len(ids), bulkConsultationMaxIDs)
	}
}

func TestBulkConsultationRequestNormalizeTagModeDefault(t *testing.T) {
	req := dto.BulkConsultationRequest{Action: dto.BulkConsultationActionTag, Tags: []string{"  URGENT  ", "urgent", ""}}
	req.Normalize()
	if req.TagMode != "add" {
		t.Fatalf("TagMode = %q, want add (default)", req.TagMode)
	}
	// normalizeTags lower-cases, trims, and de-dups.
	if len(req.Tags) != 1 || req.Tags[0] != "urgent" {
		t.Fatalf("Tags = %v, want [urgent]", req.Tags)
	}
}

func TestBulkErrorMessageUnwrapsAppError(t *testing.T) {
	appErr := apperrors.NewConflict("CONFLICT", "illegal consultation transition routed -> archived")
	if got := bulkErrorMessage(appErr); got != "illegal consultation transition routed -> archived" {
		t.Fatalf("bulkErrorMessage(appErr) = %q, want the clean message", got)
	}
	plain := errors.New("raw error")
	if got := bulkErrorMessage(plain); got != "raw error" {
		t.Fatalf("bulkErrorMessage(plain) = %q, want raw error", got)
	}
	if got := bulkErrorMessage(nil); got != "" {
		t.Fatalf("bulkErrorMessage(nil) = %q, want empty", got)
	}
}
