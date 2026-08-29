//go:build integration

package migrate

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeDRBridge is an in-memory DR engine stand-in for the integration test. It
// records every CreateRunbook call (so structure/order are asserted) and assigns
// a real UUID per runbook, exactly as the live DR engine would, so the binding
// persistence path stores real ids. It is a TEST DOUBLE for the cross-service
// boundary only — the generation + persistence logic under test is the real code.
type fakeDRBridge struct {
	mu        sync.Mutex
	created   []CreateDRRunbookRequest
	runbooks  map[uuid.UUID]*DRRunbook
	runByBook map[uuid.UUID]uuid.UUID
}

func newFakeDRBridge() *fakeDRBridge {
	return &fakeDRBridge{runbooks: map[uuid.UUID]*DRRunbook{}, runByBook: map[uuid.UUID]uuid.UUID{}}
}

func (f *fakeDRBridge) CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.created = append(f.created, in)
	id := uuid.New()
	rb := &DRRunbook{ID: id, Name: in.Name, Description: in.Description, Status: "draft", Source: "registry"}
	for _, st := range in.ImportSteps {
		rb.Tasks = append(rb.Tasks, DRTask{
			ID: uuid.New(), TaskKey: st.Key, Name: st.Name, TaskType: st.TaskType,
			PlannedDurationSeconds: st.PlannedDurationSeconds,
		})
	}
	f.runbooks[id] = rb
	return rb, nil
}

func (f *fakeDRBridge) GetRunbook(ctx context.Context, tenantID, runbookID uuid.UUID) (*DRRunbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rb, ok := f.runbooks[runbookID]
	if !ok {
		return nil, ErrDRBridgeRejected
	}
	return rb, nil
}

func (f *fakeDRBridge) StartRun(ctx context.Context, tenantID, runbookID uuid.UUID, mode string) (*DRRunLiveState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	runID := uuid.New()
	f.runByBook[runbookID] = runID
	return &DRRunLiveState{RunID: runID, RunbookID: runbookID, Status: "running", Mode: "live"}, nil
}

func (f *fakeDRBridge) GetRun(ctx context.Context, tenantID, runID uuid.UUID) (*DRRunLiveState, error) {
	return &DRRunLiveState{RunID: runID, Status: "running", Mode: "live"}, nil
}

func (f *fakeDRBridge) ActOnTask(ctx context.Context, tenantID, runID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool) (*DRRunLiveState, error) {
	return &DRRunLiveState{RunID: runID, Status: "running", Mode: "live"}, nil
}

func (f *fakeDRBridge) GetTopology(ctx context.Context, tenantID, groupID uuid.UUID) (*DRTopology, error) {
	return &DRTopology{GroupID: groupID.String()}, nil
}

var _ DRBridge = (*fakeDRBridge)(nil)

// TestIntegrationGenerateWaveRunbookPersistsBinding proves the end-to-end Wave-2
// realization: GenerateWaveRunbook calls the DR engine, then persists the returned
// runbook ids into migrate_runbook_binding (parent + one child per move group) and
// links migrate_wave.dr_runbook_id — making the previously-inert columns real.
func TestIntegrationGenerateWaveRunbookPersistsBinding(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newFakeDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	_, waveID, _ := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	out, err := svc.GenerateWaveRunbook(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("generate wave runbook: %v", err)
	}

	// The DR engine was called once for the parent + once per move group (1 here).
	if len(bridge.created) != 2 {
		t.Fatalf("DR CreateRunbook calls = %d, want 2 (parent + 1 move group)", len(bridge.created))
	}
	// The first call is the parent (a milestone per move group).
	parentReq := bridge.created[0]
	if len(parentReq.ImportSteps) != 1 || parentReq.ImportSteps[0].TaskType != "milestone" {
		t.Fatalf("parent request = %#v, want one milestone step", parentReq.ImportSteps)
	}
	// The child request carries one task per workload (api, db) in dependency order.
	childReq := bridge.created[1]
	if len(childReq.ImportSteps) != 2 {
		t.Fatalf("child steps = %d, want 2 (api, db)", len(childReq.ImportSteps))
	}
	if childReq.ImportSteps[0].Key != "wl-api" || childReq.ImportSteps[1].Key != "wl-db" {
		t.Fatalf("child task order = [%s,%s], want [wl-api, wl-db]",
			childReq.ImportSteps[0].Key, childReq.ImportSteps[1].Key)
	}

	// The parent binding stores the DR-assigned runbook id (no longer inert).
	if out.Parent.DRRunbookID == uuid.Nil {
		t.Fatal("parent binding dr_runbook_id is nil")
	}
	if out.Parent.Role != BindingRoleParent || out.Parent.Status != BindingStatusGenerated {
		t.Fatalf("parent binding role/status = %s/%s", out.Parent.Role, out.Parent.Status)
	}
	if len(out.Children) != 1 {
		t.Fatalf("child bindings = %d, want 1", len(out.Children))
	}
	if out.Children[0].ParentBindingID == nil || *out.Children[0].ParentBindingID != out.Parent.ID {
		t.Fatalf("child binding parent link = %v, want %s", out.Children[0].ParentBindingID, out.Parent.ID)
	}

	// The wave row now links to the generated parent runbook.
	wave, err := svc.GetWave(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("get wave: %v", err)
	}
	if wave.DRRunbookID == nil || *wave.DRRunbookID != out.Parent.DRRunbookID {
		t.Fatalf("wave dr_runbook_id = %v, want %s", wave.DRRunbookID, out.Parent.DRRunbookID)
	}
	if wave.RunbookGeneratedAt == nil {
		t.Fatal("wave runbook_generated_at not stamped")
	}

	// GetWaveRunbook reads the persisted binding back and hydrates the live runbook.
	fetched, err := svc.GetWaveRunbook(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("get wave runbook: %v", err)
	}
	if fetched.Parent.DRRunbookID != out.Parent.DRRunbookID {
		t.Fatalf("fetched parent runbook id = %s, want %s", fetched.Parent.DRRunbookID, out.Parent.DRRunbookID)
	}
	if fetched.Runbook == nil || fetched.Runbook.ID != out.Parent.DRRunbookID {
		t.Fatalf("fetched live runbook = %v, want hydrated %s", fetched.Runbook, out.Parent.DRRunbookID)
	}
}

// TestIntegrationGenerateWaveRunbookRegenerationSupersedes proves regeneration
// preserves prior bindings (audit history) by superseding them and producing a
// fresh current set with a new dr_runbook_id.
func TestIntegrationGenerateWaveRunbookRegenerationSupersedes(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newFakeDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	_, waveID, _ := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	first, err := svc.GenerateWaveRunbook(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("first generate: %v", err)
	}
	second, err := svc.GenerateWaveRunbook(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("second generate: %v", err)
	}
	if second.Parent.DRRunbookID == first.Parent.DRRunbookID {
		t.Fatal("regeneration must produce a new dr_runbook_id")
	}

	// The current set returned by GetWaveRunbook is the SECOND generation only.
	cur, err := svc.GetWaveRunbook(ctx, tenantID, waveID, actor)
	if err != nil {
		t.Fatalf("get wave runbook: %v", err)
	}
	if cur.Parent.DRRunbookID != second.Parent.DRRunbookID {
		t.Fatalf("current parent = %s, want second generation %s", cur.Parent.DRRunbookID, second.Parent.DRRunbookID)
	}

	// The prior (superseded) binding still exists in the table for audit history.
	var superseded int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM migrate_runbook_binding
WHERE tenant_id = $1 AND wave_id = $2 AND status = 'superseded' AND dr_runbook_id = $3`,
		tenantID, waveID, first.Parent.DRRunbookID).Scan(&superseded); err != nil {
		t.Fatalf("count superseded: %v", err)
	}
	if superseded != 1 {
		t.Fatalf("superseded prior parent binding count = %d, want 1", superseded)
	}
}

// TestIntegrationGenerateWaveRunbookRequiresBridge proves the endpoint fails
// closed (not a stub) when no DR engine is wired.
func TestIntegrationGenerateWaveRunbookRequiresBridge(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}) // no bridge
	tenantID := uuid.New()
	actor := fullActor()
	_, waveID, _ := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	if _, err := svc.GenerateWaveRunbook(ctx, tenantID, waveID, actor); err == nil {
		t.Fatal("generate without a DR bridge must fail closed")
	}
}
