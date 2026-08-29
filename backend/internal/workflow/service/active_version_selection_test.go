package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// This file pins the STAGE-AWARE, DETERMINISTIC, UNIQUE runtime-active version
// selection: the single version an event/lineage start resolves to is the
// prod-promoted active one, tie-broken by version DESC, never by name; and the
// promote FSM cross-checks that a lineage cannot end up with two prod-active
// versions.

// TestRuntimeActiveLess_StageRankThenVersion proves the total order the
// deterministic selection uses: higher stage rank wins first (prod>staging>dev),
// then higher version — never name.
func TestRuntimeActiveLess_StageRankThenVersion(t *testing.T) {
	t.Parallel()

	// prod outranks staging even at a LOWER version — a prod-promoted v2 is the
	// runtime version, not a staging-active v3.
	if !model.RuntimeActiveLess(model.StageStaging, 3, model.StageProd, 2) {
		t.Fatalf("staging v3 should rank BELOW prod v2 (prod wins on stage rank)")
	}
	if model.RuntimeActiveLess(model.StageProd, 2, model.StageStaging, 3) {
		t.Fatalf("prod v2 should NOT rank below staging v3")
	}

	// same stage rank -> higher version wins.
	if !model.RuntimeActiveLess(model.StageProd, 4, model.StageProd, 5) {
		t.Fatalf("prod v4 should rank below prod v5")
	}
	if model.RuntimeActiveLess(model.StageProd, 5, model.StageProd, 4) {
		t.Fatalf("prod v5 should NOT rank below prod v4")
	}

	// empty/unknown stage is treated as dev (rank 1), below any staging/prod.
	if !model.RuntimeActiveLess("", 9, model.StageStaging, 1) {
		t.Fatalf("empty-stage v9 should rank below staging v1 (empty == dev)")
	}
	if model.StageRank("") != model.StageRank(model.StageDev) {
		t.Fatalf("empty stage rank = %d, want dev rank %d", model.StageRank(""), model.StageRank(model.StageDev))
	}
}

// pickRuntimeActive is the in-memory mirror of the repository's DISTINCT ON /
// ORDER BY selection: among active rows of one lineage, pick the one no other
// row outranks (prod>staging>dev, then version DESC). It lets the test assert the
// deterministic winner WITHOUT a database, using the exact same ordering the SQL
// applies via model.RuntimeActiveLess.
func pickRuntimeActive(defs []*model.WorkflowDefinition) *model.WorkflowDefinition {
	var best *model.WorkflowDefinition
	for _, d := range defs {
		if d.Status != model.DefinitionStatusActive {
			continue
		}
		if best == nil || model.RuntimeActiveLess(best.Stage, best.Version, d.Stage, d.Version) {
			best = d
		}
	}
	return best
}

// TestRuntimeActiveSelection_PicksProdActiveNotHighestName proves the selection
// is deterministic and stage-aware: with a staging-active v3 alongside a
// prod-promoted active v2, the runtime-selected version is the PROD one — the old
// "highest version" / "ORDER BY name" heuristic would have picked wrongly.
func TestRuntimeActiveSelection_PicksProdActiveNotHighestName(t *testing.T) {
	t.Parallel()

	key := "lineage-1"
	defs := []*model.WorkflowDefinition{
		{ID: "zzz-name-would-win", Name: "Zeta", Version: 1, Status: model.DefinitionStatusActive, Stage: model.StageDev, DefinitionKey: key},
		{ID: "prod-v2", Name: "Beta", Version: 2, Status: model.DefinitionStatusActive, Stage: model.StageProd, DefinitionKey: key},
		{ID: "staging-v3", Name: "Alpha", Version: 3, Status: model.DefinitionStatusActive, Stage: model.StageStaging, DefinitionKey: key},
	}

	got := pickRuntimeActive(defs)
	if got == nil {
		t.Fatal("expected a runtime-active winner, got nil")
	}
	if got.ID != "prod-v2" {
		t.Fatalf("runtime-active winner = %q (stage %q v%d), want prod-v2", got.ID, got.Stage, got.Version)
	}
}

// TestRuntimeActiveSelection_TieBreaksByVersionDesc proves that when two versions
// share the top stage rank, the higher version wins (never name).
func TestRuntimeActiveSelection_TieBreaksByVersionDesc(t *testing.T) {
	t.Parallel()

	key := "lineage-2"
	defs := []*model.WorkflowDefinition{
		{ID: "prod-v5", Name: "AAA", Version: 5, Status: model.DefinitionStatusActive, Stage: model.StageProd, DefinitionKey: key},
		{ID: "prod-v7", Name: "ZZZ", Version: 7, Status: model.DefinitionStatusActive, Stage: model.StageProd, DefinitionKey: key},
	}
	got := pickRuntimeActive(defs)
	if got == nil || got.ID != "prod-v7" {
		t.Fatalf("runtime-active winner = %v, want prod-v7 (higher version at same stage rank)", got)
	}
}

// prodActiveRecord builds a stage=prod, status=active promotion record for a
// lineage — the incumbent prod-active version the cross-check must protect.
func prodActiveRecord(id string, version int) *repository.PromotionRecord {
	rec := draftRecord(id, version)
	rec.Stage = repository.StageProd
	rec.Status = model.DefinitionStatusActive
	rec.Immutable = true
	return rec
}

// stagingActiveRecord builds a stage=staging, status=active record ready to be
// promoted to prod.
func stagingActiveRecord(id string, version int) *repository.PromotionRecord {
	rec := draftRecord(id, version)
	rec.Stage = repository.StageStaging
	rec.Status = model.DefinitionStatusActive
	rec.Immutable = true
	return rec
}

// TestPromote_RejectsSecondProdActiveVersion proves the stage/status
// reconciliation: promoting a second version of a lineage into prod while another
// version is ALREADY prod-active is rejected fail-closed (ErrConflict), so a
// lineage never has two prod-active versions (the invariant the deterministic
// runtime selection relies on).
func TestPromote_RejectsSecondProdActiveVersion(t *testing.T) {
	t.Parallel()

	// v1 is already prod-active; v2 sits at staging-active, about to be promoted.
	store := newMemStore(prodActiveRecord("def-v1", 1), stagingActiveRecord("def-v2", 2))
	svc, db, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-v2", repository.StageProd)
	if err == nil {
		t.Fatal("expected rejection promoting a SECOND version to prod, got nil")
	}
	if !errors.Is(err, ErrProdActiveConflict) {
		t.Fatalf("error = %v, want ErrProdActiveConflict", err)
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("error should also wrap model.ErrConflict, got %v", err)
	}
	// Fail-closed: the row must NOT have moved and no event may be staged.
	if got := store.byID["def-v2"].Stage; got != repository.StageStaging {
		t.Fatalf("def-v2 stage after rejected promote = %q, want unchanged staging", got)
	}
	if got := db.outboxWrites(); got != 0 {
		t.Fatalf("outbox writes on rejected promote = %d, want 0", got)
	}
}

// TestPromote_FirstProdActiveVersionAllowed proves the cross-check does NOT block
// the first prod promotion of a lineage (no incumbent prod-active sibling).
func TestPromote_FirstProdActiveVersionAllowed(t *testing.T) {
	t.Parallel()

	store := newMemStore(stagingActiveRecord("def-only", 1))
	svc, _, _ := newPromotionSvc(store)

	rec, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-only", repository.StageProd)
	if err != nil {
		t.Fatalf("first prod promotion should succeed, got %v", err)
	}
	if rec.Stage != repository.StageProd {
		t.Fatalf("stage after promote = %q, want prod", rec.Stage)
	}
}

// TestStartInstance_ByDefinitionKeyResolvesProdActive proves StartInstance is
// deterministic when started by LINEAGE (definition_key): it resolves the single
// runtime-active (prod-promoted) version, not the highest-version one.
func TestStartInstance_ByDefinitionKeyResolvesProdActive(t *testing.T) {
	t.Parallel()

	const key = "lineage-start"
	prodV2 := &model.WorkflowDefinition{
		ID: "prod-v2", TenantID: cprTenant, Name: "Onboarding", Version: 2,
		Status: model.DefinitionStatusActive, Stage: model.StageProd, DefinitionKey: key,
		Steps: defaultPublishableSteps(),
	}
	defRepo := newCompDefRepo()
	defRepo.add(prodV2)

	instRepo := newStatefulInstanceRepo()
	engine := NewEngineService(instRepo, defRepo, newRecordingTaskRepo(), &parkingHumanTaskExecutor{}, nil, zerolog.Nop())

	inst, err := engine.StartInstance(context.Background(), cprTenant, cprUser, dto.StartInstanceRequest{
		DefinitionKey: key,
	})
	if err != nil {
		t.Fatalf("StartInstance(by key) error = %v", err)
	}
	if inst.DefinitionID != "prod-v2" || inst.DefinitionVer != 2 {
		t.Fatalf("started instance pinned to %s v%d, want prod-v2 v2", inst.DefinitionID, inst.DefinitionVer)
	}
	if inst.Status != model.InstanceStatusRunning {
		t.Fatalf("instance status = %q, want running (parked on first step)", inst.Status)
	}
}
