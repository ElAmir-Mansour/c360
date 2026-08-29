package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/pricing/engine"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
)

// The quote governance tests run WITHOUT a database: the service's runInTx seam
// is replaced with an in-memory runner that invokes fn with a no-op tx (the
// fakeTx below satisfies pgx.Tx; only its Exec is ever called, by the outbox
// staging, and the in-memory quote repo ignores the DBTX argument entirely).
// This lets us prove the load-bearing invariants — server recompute, the
// below-floor gate, and the override requirement — with no test container.

// fakeTx is a pgx.Tx whose Exec is a no-op (it captures staged outbox writes so
// tests can assert an audit event was staged). Every other pgx.Tx method panics
// because the code under test never calls it.
type fakeTx struct {
	execs int
	// stagedEvents captures the normalized event_type of every staged outbox
	// write (arg[3] of the outbox INSERT), so tests can assert exactly which
	// domain events were staged in the transaction.
	stagedEvents []string
	// stagedPayloads captures the raw JSON payload (arg[4]) parallel to
	// stagedEvents, so tests can assert the hand-off payload contents.
	stagedPayloads [][]byte
}

func (t *fakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.execs++
	// The outbox INSERT is (event_id, tenant_id, topic, event_type, payload).
	if len(args) >= 5 {
		if et, ok := args[3].(string); ok {
			t.stagedEvents = append(t.stagedEvents, et)
		} else {
			t.stagedEvents = append(t.stagedEvents, "")
		}
		if p, ok := args[4].([]byte); ok {
			t.stagedPayloads = append(t.stagedPayloads, p)
		} else {
			t.stagedPayloads = append(t.stagedPayloads, nil)
		}
	}
	return pgconn.CommandTag{}, nil
}
func (t *fakeTx) Begin(ctx context.Context) (pgx.Tx, error) { panic("unused") }
func (t *fakeTx) Commit(ctx context.Context) error          { return nil }
func (t *fakeTx) Rollback(ctx context.Context) error        { return nil }
func (t *fakeTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("unused")
}
func (t *fakeTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { panic("unused") }
func (t *fakeTx) LargeObjects() pgx.LargeObjects                         { panic("unused") }
func (t *fakeTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("unused")
}
func (t *fakeTx) Query(context.Context, string, ...any) (pgx.Rows, error) { panic("unused") }
func (t *fakeTx) QueryRow(context.Context, string, ...any) pgx.Row        { panic("unused") }
func (t *fakeTx) Conn() *pgx.Conn                                         { panic("unused") }

// inMemQuoteRepo is a QuoteRepo backed by a map. It also satisfies service.Repo
// (for GetActive) so a single fake serves the whole service.
type inMemQuoteRepo struct {
	active   *model.PricingConfig
	seq      int64
	byID     map[string]*model.StoredQuote
	inserted []*model.StoredQuote
}

func newInMem(active *model.PricingConfig) *inMemQuoteRepo {
	return &inMemQuoteRepo{active: active, byID: map[string]*model.StoredQuote{}}
}

// --- service.Repo (config side) ---
func (m *inMemQuoteRepo) GetActive(ctx context.Context, db repository.DBTX) (*model.PricingConfig, error) {
	if m.active == nil {
		return nil, model.ErrNoActive
	}
	return m.active, nil
}
func (m *inMemQuoteRepo) GetByVersion(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	if m.active != nil && m.active.Version == v {
		return m.active, nil
	}
	return nil, model.ErrNotFound
}
func (m *inMemQuoteRepo) List(ctx context.Context, db repository.DBTX) ([]*model.PricingConfig, error) {
	return nil, nil
}
func (m *inMemQuoteRepo) MaxVersion(ctx context.Context, db repository.DBTX) (int, error) {
	return 1, nil
}
func (m *inMemQuoteRepo) CreateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (m *inMemQuoteRepo) UpdateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (m *inMemQuoteRepo) ArchiveActive(ctx context.Context, db repository.DBTX) error { return nil }
func (m *inMemQuoteRepo) Activate(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}
func (m *inMemQuoteRepo) ArchiveVersion(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}

// --- QuoteRepo (quote side) ---
func (m *inMemQuoteRepo) NextQuoteNumberSeq(ctx context.Context, db repository.DBTX) (int64, error) {
	m.seq++
	return m.seq, nil
}
func (m *inMemQuoteRepo) InsertQuote(ctx context.Context, db repository.DBTX, q *model.StoredQuote) (*model.StoredQuote, error) {
	cp := *q
	if cp.ID == "" {
		cp.ID = "quote-" + cp.QuoteNumber
	}
	m.byID[cp.ID] = &cp
	m.inserted = append(m.inserted, &cp)
	return &cp, nil
}
func (m *inMemQuoteRepo) GetQuoteByID(ctx context.Context, db repository.DBTX, id string) (*model.StoredQuote, error) {
	if q, ok := m.byID[id]; ok {
		cp := *q
		return &cp, nil
	}
	return nil, model.ErrNotFound
}
func (m *inMemQuoteRepo) ListQuotes(ctx context.Context, db repository.DBTX, f repository.QuoteFilter) ([]*model.StoredQuote, int, error) {
	var out []*model.StoredQuote
	for _, q := range m.inserted {
		if f.Status != "" && q.Status != f.Status {
			continue
		}
		if f.Model != "" && string(q.Model) != f.Model {
			continue
		}
		out = append(out, q)
	}
	return out, len(out), nil
}
func (m *inMemQuoteRepo) UpdateQuoteStatus(ctx context.Context, db repository.DBTX, id, status string) (*model.StoredQuote, error) {
	q, ok := m.byID[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	q.Status = status
	cp := *q
	return &cp, nil
}
func (m *inMemQuoteRepo) RecordFloorOverride(ctx context.Context, db repository.DBTX, id, by string) (*model.StoredQuote, error) {
	q, ok := m.byID[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	b := by
	q.FloorOverrideBy = &b
	cp := *q
	return &cp, nil
}

// newQuoteService wires a service over the in-memory repo with the runInTx seam
// replaced by an in-process runner (no database).
func newQuoteService(m *inMemQuoteRepo) (*Service, *fakeTx) {
	s := &Service{repo: m, logger: zerolog.Nop(), now: fixedNow, tierPlans: DefaultTierPlanMap()}
	tx := &fakeTx{}
	s.runInTx = func(ctx context.Context, fn func(tx pgx.Tx) error) error { return fn(tx) }
	s.SetQuoteRepo(m)
	return s, tx
}

func fixedNow() time.Time {
	return time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC)
}

func tierPtr(t model.Tier) *model.Tier { return &t }

func activeDefaultConfig() *model.PricingConfig {
	return &model.PricingConfig{ID: "cfg-1", Version: 1, Status: model.ConfigStatusActive, Rates: model.DefaultConfig()}
}

func belowFloorConfig() *model.PricingConfig {
	r := model.DefaultConfig()
	r.MarkupMultiplier = 1.05 // thin markup -> below the 0.10 margin floor
	return &model.PricingConfig{ID: "cfg-bf", Version: 2, Status: model.ConfigStatusActive, Rates: r}
}

func stdInputs() model.Inputs {
	return model.Inputs{Model: model.ModelPerUser, Deployment: model.DeploymentSaaS, TermMonths: 12, Users: 1, HotStorageGB: 2, ColdStorageGB: 5}
}

// TestCreateQuote_RecomputesServerSide_IgnoresClientNumbers is the load-bearing
// invariant: the persisted computed_tiers equal a FRESH engine.Compute of the
// resolved config + inputs — the client cannot supply tier numbers (the input
// struct has no field for them; the service recomputes regardless), and the
// priced-against version is stamped immutably.
func TestCreateQuote_RecomputesServerSide_IgnoresClientNumbers(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, tx := newQuoteService(m)

	in := stdInputs()
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{Inputs: in, AccountName: "Acme", CreatedBy: "u1"})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}

	// The stored tiers must be byte-for-byte what a fresh engine.Compute yields
	// against the ACTIVE config version — not any client-supplied value.
	want := engine.Compute(model.DefaultConfig(), in, 1)
	if len(q.ComputedTiers) != len(want.Tiers) {
		t.Fatalf("computed tiers: got %d, want %d", len(q.ComputedTiers), len(want.Tiers))
	}
	for i := range want.Tiers {
		if q.ComputedTiers[i] != want.Tiers[i] {
			t.Errorf("tier %d differs from fresh engine.Compute:\n got=%+v\nwant=%+v", i, q.ComputedTiers[i], want.Tiers[i])
		}
	}
	if q.PricingVersion != 1 || q.PricingConfigID != "cfg-1" {
		t.Errorf("priced-against stamp wrong: version=%d id=%s", q.PricingVersion, q.PricingConfigID)
	}
	if q.Status != model.QuoteStatusDraft {
		t.Errorf("new quote status: got %q, want draft", q.Status)
	}
	if q.QuoteNumber != "Q-2026-000001" {
		t.Errorf("quote_number: got %q, want Q-2026-000001", q.QuoteNumber)
	}
	if tx.execs == 0 {
		t.Errorf("expected a staged outbox event (pricing.quote_created)")
	}
}

// TestCreateQuote_BelowFloorDerivedServerSide: creating a quote whose SELECTED
// tier is below the margin floor sets below_floor=true from the server-side
// guardrail, regardless of any client claim.
func TestCreateQuote_BelowFloorDerivedServerSide(t *testing.T) {
	m := newInMem(belowFloorConfig())
	s, _ := newQuoteService(m)

	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       withSalesDiscount(stdInputs(), 0.20),
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if !q.BelowFloor {
		t.Fatalf("expected below_floor=true for the crafted low-margin config")
	}
}

func withSalesDiscount(in model.Inputs, d float64) model.Inputs {
	in.SalesDiscount = &d
	return in
}

// TestSendQuote_BlockedUntilOverride: a below-floor quote cannot be sent or
// accepted until a floor override is recorded; after the override it advances.
func TestSendQuote_BlockedUntilOverride(t *testing.T) {
	m := newInMem(belowFloorConfig())
	s, _ := newQuoteService(m)

	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       withSalesDiscount(stdInputs(), 0.20),
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if !q.BelowFloor {
		t.Fatalf("precondition: quote must be below floor")
	}

	// Send is blocked.
	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); !errors.Is(err, model.ErrBelowFloorBlocked) {
		t.Fatalf("SendQuote should be blocked below floor, got %v", err)
	}

	// Record the override (pricing:admin approver — the route gates the verb).
	if _, err := s.OverrideFloor(context.Background(), q.ID, "admin-1"); err != nil {
		t.Fatalf("OverrideFloor: %v", err)
	}

	// Now send + accept succeed.
	sent, err := s.SendQuote(context.Background(), q.ID, "u1")
	if err != nil {
		t.Fatalf("SendQuote after override: %v", err)
	}
	if sent.Status != model.QuoteStatusSent {
		t.Errorf("status after send: got %q, want sent", sent.Status)
	}
	acc, err := s.AcceptQuote(context.Background(), q.ID, "u1")
	if err != nil {
		t.Fatalf("AcceptQuote after override: %v", err)
	}
	if acc.Status != model.QuoteStatusAccepted {
		t.Errorf("status after accept: got %q, want accepted", acc.Status)
	}
}

// TestOverrideFloor_RequiresBelowFloor: overriding a healthy quote is rejected
// (an override is only meaningful — and only audited — where it is required).
func TestOverrideFloor_RequiresBelowFloor(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{
		Inputs:       stdInputs(),
		SelectedTier: tierPtr(model.TierStandard),
		CreatedBy:    "u1",
	})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if q.BelowFloor {
		t.Fatalf("default config quote should be OK, not below floor")
	}
	if _, err := s.OverrideFloor(context.Background(), q.ID, "admin-1"); !errors.Is(err, model.ErrInvalidQuote) {
		t.Fatalf("override of a healthy quote should be rejected, got %v", err)
	}
}

// TestSendQuote_HealthyPath: a not-below-floor quote sends and accepts freely.
func TestSendQuote_HealthyPath(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{Inputs: stdInputs(), SelectedTier: tierPtr(model.TierStandard), CreatedBy: "u1"})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}

	if _, err := s.SendQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("SendQuote: %v", err)
	}
	if _, err := s.AcceptQuote(context.Background(), q.ID, "u1"); err != nil {
		t.Fatalf("AcceptQuote: %v", err)
	}
}

// TestTransition_InvalidFromStatus: accept requires sent; accepting a draft is a
// 409-mapped invalid transition.
func TestTransition_InvalidFromStatus(t *testing.T) {
	m := newInMem(activeDefaultConfig())
	s, _ := newQuoteService(m)
	q, err := s.CreateQuote(context.Background(), CreateQuoteInput{Inputs: stdInputs(), SelectedTier: tierPtr(model.TierStandard), CreatedBy: "u1"})
	if err != nil {
		t.Fatalf("CreateQuote: %v", err)
	}
	if _, err := s.AcceptQuote(context.Background(), q.ID, "u1"); !errors.Is(err, model.ErrInvalidTransition) {
		t.Fatalf("accepting a draft should be an invalid transition, got %v", err)
	}
}
