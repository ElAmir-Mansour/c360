package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

func TestLegalRequestAttachmentActorAllowed(t *testing.T) {
	requesterID := uuid.New()
	creatorID := uuid.New()
	reviewerID := uuid.New()
	directorID := uuid.New()
	providerID := uuid.New()
	request := &model.LegalRequest{RequesterUserID: requesterID, CreatedBy: creatorID}

	tests := []struct {
		name      string
		actorID   uuid.UUID
		roles     []string
		canReview bool
		want      bool
	}{
		{name: "requester owns evidence", actorID: requesterID, roles: []string{"legal-requester"}, want: true},
		{name: "creator owns evidence", actorID: creatorID, roles: []string{"legal-requester"}, want: true},
		{name: "current assigned reviewer", actorID: reviewerID, roles: []string{"legal-dept-manager"}, canReview: true, want: true},
		{name: "legal director oversight", actorID: directorID, roles: []string{"legal-director"}, want: true},
		{name: "unrelated provider is denied", actorID: providerID, roles: []string{"legal-officer"}, want: false},
		{name: "unassigned approver is denied", actorID: reviewerID, roles: []string{"legal-dept-manager"}, want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actor := &auth.ContextUser{ID: tc.actorID.String(), Roles: tc.roles}
			if got := legalRequestAttachmentActorAllowed(context.Background(), actor, tc.actorID, request, tc.canReview); got != tc.want {
				t.Fatalf("legalRequestAttachmentActorAllowed() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLegalRequestAttachmentActorAllowedRejectsIdentityMismatch(t *testing.T) {
	requesterID := uuid.New()
	request := &model.LegalRequest{RequesterUserID: requesterID, CreatedBy: uuid.New()}
	actor := &auth.ContextUser{ID: uuid.NewString(), Roles: []string{"legal-director"}}

	if legalRequestAttachmentActorAllowed(context.Background(), actor, requesterID, request, true) {
		t.Fatal("context identity mismatch must deny attachment access")
	}
}

func TestNormalizedRequestFileVersion(t *testing.T) {
	for input, want := range map[int]int{-2: 1, 0: 1, 1: 1, 7: 7} {
		if got := normalizedRequestFileVersion(input); got != want {
			t.Fatalf("normalizedRequestFileVersion(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestValidateLiveRequestAttachmentMetadata(t *testing.T) {
	tenantID := uuid.New()
	uploaderID := uuid.New()
	fileID := uuid.New()
	entityType := legalRequestAttachmentEntityType
	attachment := &model.LegalRequestAttachment{
		FileID: fileID, UploadedBy: uploaderID, OriginalName: "evidence.pdf",
		ContentType: "application/pdf", SizeBytes: 1024,
		ChecksumSHA256: "ABC123", FileVersion: 1,
	}
	metadata := &RequestFileMetadata{
		ID: fileID.String(), TenantID: tenantID.String(), UploadedBy: uploaderID.String(),
		Suite: "lex", EntityType: &entityType, OriginalName: "evidence.pdf",
		ContentType: "application/pdf", SizeBytes: 1024,
		ChecksumSHA256: "abc123", VersionNumber: 1,
	}

	if err := validateLiveRequestAttachmentMetadata(tenantID, attachment, metadata); err != nil {
		t.Fatalf("matching metadata rejected: %v", err)
	}

	changed := *metadata
	changed.EntityType = ptr("contract")
	if err := validateLiveRequestAttachmentMetadata(tenantID, attachment, &changed); err == nil {
		t.Fatal("changed protected entity type must be rejected")
	}

	changed = *metadata
	changed.ChecksumSHA256 = "different"
	if err := validateLiveRequestAttachmentMetadata(tenantID, attachment, &changed); err == nil {
		t.Fatal("changed checksum must be rejected")
	}
}

func ptr(value string) *string { return &value }
