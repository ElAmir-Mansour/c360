package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// recordingDBTX is the handle the fake runner passes into the promote tx. The
// in-memory store ignores it, so the only Exec it ever receives is the
// outbox.Write INSERT into event_outbox — which is exactly what we assert on.
type recordingDBTX struct {
	execSQLs []string
	execErr  error
}

func (d *recordingDBTX) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	d.execSQLs = append(d.execSQLs, sql)
	if d.execErr != nil {
		return pgconn.CommandTag{}, d.execErr
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (d *recordingDBTX) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("promotion test: Query not expected on recordingDBTX")
}

func (d *recordingDBTX) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("promotion test: QueryRow not expected on recordingDBTX")
}

func (d *recordingDBTX) outboxWrites() int {
	n := 0
	for _, s := range d.execSQLs {
		if strings.Contains(s, "INSERT INTO event_outbox") {
			n++
		}
	}
	return n
}

// fakeRunner hands the shared recordingDBTX to fn so the staged event is
// observable, and can force a commit-time failure to test rollback semantics.
type fakeRunner struct {
	db     *recordingDBTX
	txErr  error // returned instead of running fn (simulates begin failure)
	commit error // returned after fn succeeds (simulates commit failure)
}

func (r *fakeRunner) RunInTx(ctx context.Context, fn func(db repository.PromotionDBTX) error) error {
	if r.txErr != nil {
		return r.txErr
	}
	if err := fn(r.db); err != nil {
		return err // rolled back
	}
	return r.commit
}

func (r *fakeRunner) Pool() repository.PromotionDBTX { return r.db }

// memStore is an in-memory promotionStore keyed by definition id. It enforces
// the same RETURNING/ErrNotFound semantics the real repo exposes so the service
// FSM is exercised faithfully.
type memStore struct {
	byID   map[string]*repository.PromotionRecord
	setErr error // optional forced error on the first mutation
}

func newMemStore(records ...*repository.PromotionRecord) *memStore {
	m := &memStore{byID: make(map[string]*repository.PromotionRecord)}
	for _, r := range records {
		cp := *r
		m.byID[r.ID] = &cp
	}
	return m
}

func (m *memStore) GetByID(_ context.Context, _ repository.PromotionDBTX, tenantID, id string) (*repository.PromotionRecord, error) {
	rec, ok := m.byID[id]
	if !ok || rec.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	cp := *rec
	return &cp, nil
}

func (m *memStore) GetLineageKey(_ context.Context, _ repository.PromotionDBTX, tenantID, id string) (string, error) {
	rec, ok := m.byID[id]
	if !ok || rec.TenantID != tenantID {
		return "", model.ErrNotFound
	}
	return rec.DefinitionKey, nil
}

func (m *memStore) SetStage(_ context.Context, _ repository.PromotionDBTX, tenantID, id, stage string) error {
	if m.setErr != nil {
		return m.setErr
	}
	rec, ok := m.byID[id]
	if !ok || rec.TenantID != tenantID {
		return model.ErrNotFound
	}
	rec.Stage = stage
	return nil
}

func (m *memStore) SetImmutable(_ context.Context, _ repository.PromotionDBTX, tenantID, id string, immutable bool) error {
	rec, ok := m.byID[id]
	if !ok || rec.TenantID != tenantID {
		return model.ErrNotFound
	}
	rec.Immutable = immutable
	return nil
}

func (m *memStore) StampPromotion(_ context.Context, _ repository.PromotionDBTX, tenantID, id, promotedBy string, promotedAt time.Time) error {
	rec, ok := m.byID[id]
	if !ok || rec.TenantID != tenantID {
		return model.ErrNotFound
	}
	at := promotedAt
	rec.PromotedAt = &at
	rec.PromotedBy = promotedBy
	return nil
}

func (m *memStore) ListByLineage(_ context.Context, _ repository.PromotionDBTX, tenantID, key string) ([]*repository.PromotionRecord, error) {
	var out []*repository.PromotionRecord
	for _, rec := range m.byID {
		if rec.TenantID == tenantID && rec.DefinitionKey == key {
			cp := *rec
			out = append(out, &cp)
		}
	}
	if out == nil {
		out = []*repository.PromotionRecord{}
	}
	return out, nil
}

// CountProdActiveSiblings mirrors the real repo: how many OTHER live versions of
// the lineage are stage=prod AND status=active (excluding excludeID).
func (m *memStore) CountProdActiveSiblings(_ context.Context, _ repository.PromotionDBTX, tenantID, key, excludeID string) (int, error) {
	n := 0
	for _, rec := range m.byID {
		if rec.TenantID == tenantID && rec.DefinitionKey == key && rec.ID != excludeID &&
			rec.Stage == repository.StageProd && rec.Status == model.DefinitionStatusActive {
			n++
		}
	}
	return n, nil
}

const (
	svcTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	svcKey    = "cccccccc-0000-0000-0000-000000000003"
)

func draftRecord(id string, version int) *repository.PromotionRecord {
	return &repository.PromotionRecord{
		ID:            id,
		TenantID:      svcTenant,
		Name:          "Onboarding",
		Version:       version,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: svcKey,
		Stage:         repository.StageDev,
		Immutable:     false,
	}
}

func newPromotionSvc(store *memStore) (*PromotionService, *recordingDBTX, *fakeRunner) {
	db := &recordingDBTX{}
	runner := &fakeRunner{db: db}
	svc := NewPromotionService(store, runner, zerolog.Nop())
	return svc, db, runner
}

// ---------------------------------------------------------------------------
// Promote FSM
// ---------------------------------------------------------------------------

func TestPromoteDefinition_DevToStagingToProd(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1))
	svc, db, _ := newPromotionSvc(store)
	ctx := context.Background()

	// dev -> staging
	rec, err := svc.PromoteDefinition(ctx, svcTenant, "def-1", repository.StageStaging)
	if err != nil {
		t.Fatalf("dev->staging: unexpected error: %v", err)
	}
	if rec.Stage != repository.StageStaging {
		t.Fatalf("dev->staging: stage = %q, want staging", rec.Stage)
	}
	if !rec.Immutable {
		t.Fatalf("dev->staging: expected immutable=true at staging")
	}
	if rec.PromotedAt == nil {
		t.Fatalf("dev->staging: promoted_at not stamped")
	}
	if got := db.outboxWrites(); got != 1 {
		t.Fatalf("dev->staging: outbox writes = %d, want 1", got)
	}

	// staging -> prod
	rec, err = svc.PromoteDefinition(ctx, svcTenant, "def-1", repository.StageProd)
	if err != nil {
		t.Fatalf("staging->prod: unexpected error: %v", err)
	}
	if rec.Stage != repository.StageProd {
		t.Fatalf("staging->prod: stage = %q, want prod", rec.Stage)
	}
	if !rec.Immutable {
		t.Fatalf("staging->prod: expected immutable=true at prod")
	}
	if got := db.outboxWrites(); got != 2 {
		t.Fatalf("staging->prod: cumulative outbox writes = %d, want 2", got)
	}
}

func TestPromoteDefinition_SkipRejected(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1)) // stage=dev
	svc, db, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageProd)
	if err == nil {
		t.Fatal("expected error for dev->prod skip, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("dev->prod skip: error = %v, want ErrConflict", err)
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("dev->prod skip: error should also be model.ErrConflict, got %v", err)
	}
	// No event may be staged on a rejected promote.
	if got := db.outboxWrites(); got != 0 {
		t.Fatalf("dev->prod skip: outbox writes = %d, want 0", got)
	}
	// Stage must be untouched.
	if store.byID["def-1"].Stage != repository.StageDev {
		t.Fatalf("dev->prod skip: stage mutated to %q", store.byID["def-1"].Stage)
	}
}

func TestPromoteDefinition_BackwardsRejected(t *testing.T) {
	t.Parallel()
	rec := draftRecord("def-1", 1)
	rec.Stage = repository.StageStaging
	rec.Immutable = true
	store := newMemStore(rec)
	svc, db, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageDev)
	if err == nil {
		t.Fatal("expected error for staging->dev backwards move, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("staging->dev: error = %v, want ErrConflict", err)
	}
	if got := db.outboxWrites(); got != 0 {
		t.Fatalf("staging->dev: outbox writes = %d, want 0", got)
	}
}

func TestPromoteDefinition_NoOpRejected(t *testing.T) {
	t.Parallel()
	rec := draftRecord("def-1", 1)
	rec.Stage = repository.StageStaging
	store := newMemStore(rec)
	svc, _, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageStaging)
	if err == nil {
		t.Fatal("expected error for staging->staging no-op, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("staging->staging: error = %v, want ErrConflict", err)
	}
}

func TestPromoteDefinition_FromProdTerminalRejected(t *testing.T) {
	t.Parallel()
	rec := draftRecord("def-1", 1)
	rec.Stage = repository.StageProd
	rec.Immutable = true
	store := newMemStore(rec)
	svc, _, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageProd)
	if err == nil {
		t.Fatal("expected error promoting from terminal prod stage, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("prod terminal: error = %v, want ErrConflict", err)
	}
}

func TestPromoteDefinition_InvalidTargetStage(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", "production")
	if err == nil {
		t.Fatal("expected error for invalid target stage, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("invalid stage: error = %v, want ErrConflict", err)
	}
}

func TestPromoteDefinition_NotFound(t *testing.T) {
	t.Parallel()
	store := newMemStore() // empty
	svc, _, _ := newPromotionSvc(store)

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "missing", repository.StageStaging)
	if err == nil {
		t.Fatal("expected ErrNotFound, got nil")
	}
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("not found: error = %v, want model.ErrNotFound", err)
	}
}

func TestPromoteDefinition_OutboxFailureRollsBack(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1))
	db := &recordingDBTX{execErr: errors.New("outbox down")}
	runner := &fakeRunner{db: db}
	svc := NewPromotionService(store, runner, zerolog.Nop())

	_, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageStaging)
	if err == nil {
		t.Fatal("expected error when outbox staging fails, got nil")
	}
	if !strings.Contains(err.Error(), "staging promotion event") {
		t.Fatalf("expected staging-event error, got %v", err)
	}
}

func TestPromoteDefinition_ImmutableSetAtStaging(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store)

	rec, err := svc.PromoteDefinition(context.Background(), svcTenant, "def-1", repository.StageStaging)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !rec.Immutable {
		t.Fatal("immutable must be true once promoted to staging")
	}
	if !store.byID["def-1"].Immutable {
		t.Fatal("store record immutable flag not persisted at staging")
	}
}

// ---------------------------------------------------------------------------
// ImmutableGuard
// ---------------------------------------------------------------------------

func TestImmutableGuard_ConflictOnImmutable(t *testing.T) {
	t.Parallel()
	rec := draftRecord("def-1", 2)
	rec.Stage = repository.StageProd
	rec.Immutable = true
	store := newMemStore(rec)
	svc, _, _ := newPromotionSvc(store)

	err := svc.ImmutableGuard(context.Background(), svcTenant, "def-1")
	if err == nil {
		t.Fatal("expected ErrConflict on immutable definition, got nil")
	}
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("immutable guard: error = %v, want ErrConflict", err)
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("immutable guard: error should also be model.ErrConflict, got %v", err)
	}
}

func TestImmutableGuard_NilOnDraft(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1)) // mutable draft
	svc, _, _ := newPromotionSvc(store)

	if err := svc.ImmutableGuard(context.Background(), svcTenant, "def-1"); err != nil {
		t.Fatalf("expected nil for mutable draft, got %v", err)
	}
}

func TestImmutableGuard_NotFound(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	svc, _, _ := newPromotionSvc(store)

	err := svc.ImmutableGuard(context.Background(), svcTenant, "missing")
	if err == nil {
		t.Fatal("expected error for missing definition, got nil")
	}
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("immutable guard not found: error = %v, want model.ErrNotFound", err)
	}
	// A missing definition must NOT be treated as a 409 conflict.
	if errors.Is(err, ErrConflict) {
		t.Fatalf("missing definition must not be ErrConflict, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

func TestGetLineage_ListsAllVersionsAndStages(t *testing.T) {
	t.Parallel()
	v1 := draftRecord("def-1", 1)
	v1.Stage = repository.StageProd
	v1.Immutable = true
	v2 := draftRecord("def-2", 2)
	v2.Stage = repository.StageStaging
	v2.Immutable = true
	v3 := draftRecord("def-3", 3) // dev draft
	// A different-lineage record that must NOT appear.
	other := draftRecord("def-x", 1)
	other.DefinitionKey = "dddddddd-0000-0000-0000-000000000009"

	store := newMemStore(v1, v2, v3, other)
	svc, _, _ := newPromotionSvc(store)

	recs, err := svc.GetLineage(context.Background(), svcTenant, svcKey)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(recs) != 3 {
		t.Fatalf("lineage size = %d, want 3", len(recs))
	}

	stages := map[string]string{}
	for _, r := range recs {
		if r.DefinitionKey != svcKey {
			t.Fatalf("lineage leaked foreign key %s", r.DefinitionKey)
		}
		stages[r.ID] = r.Stage
	}
	if stages["def-1"] != repository.StageProd ||
		stages["def-2"] != repository.StageStaging ||
		stages["def-3"] != repository.StageDev {
		t.Fatalf("unexpected stage map: %v", stages)
	}
}

func TestGetLineage_EmptyKey(t *testing.T) {
	t.Parallel()
	svc, _, _ := newPromotionSvc(newMemStore())
	if _, err := svc.GetLineage(context.Background(), svcTenant, ""); err == nil {
		t.Fatal("expected error for empty definition key, got nil")
	}
}

func TestLineageOf(t *testing.T) {
	t.Parallel()
	store := newMemStore(draftRecord("def-1", 1))
	svc, _, _ := newPromotionSvc(store)

	key, err := svc.LineageOf(context.Background(), svcTenant, "def-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key != svcKey {
		t.Fatalf("lineage key = %q, want %q", key, svcKey)
	}
}

// nextStage is the FSM core; assert its table directly.
func TestNextStage(t *testing.T) {
	t.Parallel()
	cases := []struct {
		current string
		want    string
		ok      bool
	}{
		{repository.StageDev, repository.StageStaging, true},
		{repository.StageStaging, repository.StageProd, true},
		{repository.StageProd, "", false},
		{"bogus", "", false},
		{"", "", false},
	}
	for _, c := range cases {
		got, ok := nextStage(c.current)
		if got != c.want || ok != c.ok {
			t.Fatalf("nextStage(%q) = (%q,%v), want (%q,%v)", c.current, got, ok, c.want, c.ok)
		}
	}
}
