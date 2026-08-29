package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestCanPrepareContractReview_AddOnlyRequesterIsLimitedToOwnedDraft(t *testing.T) {
	actorID := uuid.MustParse("44444444-0000-0000-0000-00000000000a")
	otherID := uuid.MustParse("44444444-0000-0000-0000-00000000000b")
	roles := []string{"legal-requester"}

	if !canPrepareContractReview(context.Background(), roles, actorID, &model.Contract{
		CreatedBy: actorID,
		Status:    model.ContractStatusDraft,
	}) {
		t.Fatal("add-only requester should prepare their own draft")
	}
	if canPrepareContractReview(context.Background(), roles, actorID, &model.Contract{
		CreatedBy: otherID,
		Status:    model.ContractStatusDraft,
	}) {
		t.Fatal("add-only requester must not prepare another actor's draft")
	}
	if canPrepareContractReview(context.Background(), roles, actorID, &model.Contract{
		CreatedBy: actorID,
		Status:    model.ContractStatusInternalReview,
	}) {
		t.Fatal("add-only requester must not mutate a contract after draft")
	}
}

func TestCanPrepareContractReview_EditorsAndCoarseWriteRetainAccess(t *testing.T) {
	actorID := uuid.MustParse("44444444-0000-0000-0000-00000000000a")
	contract := &model.Contract{
		CreatedBy: uuid.MustParse("44444444-0000-0000-0000-00000000000b"),
		Status:    model.ContractStatusInternalReview,
	}

	if !canPrepareContractReview(context.Background(), []string{"legal-contracts-manager"}, actorID, contract) {
		t.Fatal("contract editor should retain cross-record preparation access")
	}
	if !canPrepareContractReview(context.Background(), []string{"tenant_admin"}, actorID, contract) {
		t.Fatal("coarse-write compatibility role should retain preparation access")
	}
	if canPrepareContractReview(context.Background(), []string{"legal-auditor"}, actorID, contract) {
		t.Fatal("read-only role must not prepare contract review attachments")
	}
}
