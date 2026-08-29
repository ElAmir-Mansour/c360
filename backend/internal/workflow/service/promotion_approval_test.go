package service

import (
	"context"
	"errors"
	"testing"

	"github.com/clario360/platform/internal/workflow/repository"
)

// stagingRecord builds a record already at staging (immutable) so a single
// staging→prod promote can be exercised in isolation.
func stagingRecord(id string, version int) *repository.PromotionRecord {
	rec := draftRecord(id, version)
	rec.Stage = repository.StageStaging
	rec.Immutable = true
	return rec
}

// TestPromoteWithApproval_StampsRealActor proves the governed path records the
// acting user as promoted_by (the historical bug stamped "").
func TestPromoteWithApproval_StampsRealActor(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1)) // dev
	svc, _, _ := newPromotionSvc(store)

	// dev→staging carries no approval requirement; the actor must still be stamped.
	_, err := svc.PromoteDefinitionWithApproval(context.Background(), svcTenant, "def-1", repository.StageStaging, "user-maker", nil)
	if err != nil {
		t.Fatalf("dev->staging with actor: unexpected error: %v", err)
	}
	if got := store.byID["def-1"].PromotedBy; got != "user-maker" {
		t.Fatalf("promoted_by = %q, want user-maker", got)
	}
}

// TestPromoteWithApproval_GateBlocksProdWithoutApprover proves the enabled gate
// rejects a staging→prod promote that carries no distinct approver.
func TestPromoteWithApproval_GateBlocksProdWithoutApprover(t *testing.T) {
	t.Parallel()
	store := newMemStore(stagingRecord("def-1", 1))
	svc, db, _ := newPromotionSvc(store)
	svc.WithProdApprovalGate(true)

	_, err := svc.PromoteDefinitionWithApproval(context.Background(), svcTenant, "def-1", repository.StageProd, "user-maker", nil)
	if err == nil {
		t.Fatal("expected staging->prod without approver to be rejected")
	}
	if !errors.Is(err, ErrPromotionApprovalRequired) {
		t.Fatalf("error = %v, want ErrPromotionApprovalRequired", err)
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("error should also wrap ErrConflict, got %v", err)
	}
	// A blocked promote must not touch state or stage an event.
	if store.byID["def-1"].Stage != repository.StageStaging {
		t.Fatalf("stage mutated to %q on a blocked promote", store.byID["def-1"].Stage)
	}
	if got := db.outboxWrites(); got != 0 {
		t.Fatalf("outbox writes = %d, want 0 on a blocked promote", got)
	}
}

// TestPromoteWithApproval_GateRejectsSelfApproval proves separation of duties:
// the approver may not be the requester.
func TestPromoteWithApproval_GateRejectsSelfApproval(t *testing.T) {
	t.Parallel()
	store := newMemStore(stagingRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store)
	svc.WithProdApprovalGate(true)

	_, err := svc.PromoteDefinitionWithApproval(context.Background(), svcTenant, "def-1", repository.StageProd,
		"user-maker", &ProdApproval{ApprovedBy: "user-maker"})
	if err == nil {
		t.Fatal("expected self-approval to be rejected")
	}
	if !errors.Is(err, ErrProdApprovalSelf) {
		t.Fatalf("error = %v, want ErrProdApprovalSelf", err)
	}
}

// TestPromoteWithApproval_GateAllowsDistinctApprover proves a valid distinct
// approver promotes to prod, stamps the actor, and stages the audit event.
func TestPromoteWithApproval_GateAllowsDistinctApprover(t *testing.T) {
	t.Parallel()
	store := newMemStore(stagingRecord("def-1", 1))
	svc, db, _ := newPromotionSvc(store)
	svc.WithProdApprovalGate(true)

	rec, err := svc.PromoteDefinitionWithApproval(context.Background(), svcTenant, "def-1", repository.StageProd,
		"user-maker", &ProdApproval{ApprovedBy: "user-checker", Reason: "prod release approved"})
	if err != nil {
		t.Fatalf("distinct-approver promote: unexpected error: %v", err)
	}
	if rec.Stage != repository.StageProd {
		t.Fatalf("stage = %q, want prod", rec.Stage)
	}
	if store.byID["def-1"].PromotedBy != "user-maker" {
		t.Fatalf("promoted_by = %q, want user-maker", store.byID["def-1"].PromotedBy)
	}
	if got := db.outboxWrites(); got != 1 {
		t.Fatalf("outbox writes = %d, want 1 (audit event staged)", got)
	}
}

// TestPromoteLegacy_GateBlocksUnapprovedProd proves the legacy PromoteDefinition
// path (no approval) is rejected for staging→prod when the gate is enabled, so an
// unapproved single transition cannot slip through the old entry point.
func TestPromoteLegacy_GateBlocksUnapprovedProd(t *testing.T) {
	t.Parallel()
	store := newMemStore(stagingRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store)
	svc.WithProdApprovalGate(true)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageProd)
	if !errors.Is(err, ErrPromotionApprovalRequired) {
		t.Fatalf("legacy staging->prod with gate on: error = %v, want ErrPromotionApprovalRequired", err)
	}
}

// TestPromoteWithApproval_GateOffProdUnchanged proves that with the gate OFF the
// governed path still promotes staging→prod without any approver (backward
// compatible), only now stamping the actor.
func TestPromoteWithApproval_GateOffProdUnchanged(t *testing.T) {
	t.Parallel()
	store := newMemStore(stagingRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store) // gate OFF (default)

	rec, err := svc.PromoteDefinitionWithApproval(context.Background(), svcTenant, "def-1", repository.StageProd, "user-maker", nil)
	if err != nil {
		t.Fatalf("gate-off staging->prod: unexpected error: %v", err)
	}
	if rec.Stage != repository.StageProd {
		t.Fatalf("stage = %q, want prod", rec.Stage)
	}
}
