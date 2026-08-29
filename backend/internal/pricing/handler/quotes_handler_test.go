package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
	"github.com/clario360/platform/internal/pricing/service"
)

// The quote handler tests exercise the API end-to-end over an in-memory quote
// store (no database): the service's transaction seam is replaced so the
// governance paths run in-process. They assert the two hard invariants at the
// HTTP boundary: (1) GET is masked vs internal by role, and (2) a below-floor
// quote is blocked with 409 on send until a pricing:admin records an override.

// --- in-memory repo (config + quote) -----------------------------------------

type memRepo struct {
	active *model.PricingConfig
	seq    int64
	byID   map[string]*model.StoredQuote
	order  []string
}

func newMemRepo(active *model.PricingConfig) *memRepo {
	return &memRepo{active: active, byID: map[string]*model.StoredQuote{}}
}

// service.Repo
func (m *memRepo) GetActive(ctx context.Context, db repository.DBTX) (*model.PricingConfig, error) {
	if m.active == nil {
		return nil, model.ErrNoActive
	}
	return m.active, nil
}
func (m *memRepo) GetByVersion(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	if m.active != nil && m.active.Version == v {
		return m.active, nil
	}
	return nil, model.ErrNotFound
}
func (m *memRepo) List(ctx context.Context, db repository.DBTX) ([]*model.PricingConfig, error) {
	return nil, nil
}
func (m *memRepo) MaxVersion(ctx context.Context, db repository.DBTX) (int, error) { return 1, nil }
func (m *memRepo) CreateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (m *memRepo) UpdateDraft(ctx context.Context, db repository.DBTX, c *model.PricingConfig) (*model.PricingConfig, error) {
	return c, nil
}
func (m *memRepo) ArchiveActive(ctx context.Context, db repository.DBTX) error { return nil }
func (m *memRepo) Activate(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}
func (m *memRepo) ArchiveVersion(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}

// service.QuoteRepo
func (m *memRepo) NextQuoteNumberSeq(ctx context.Context, db repository.DBTX) (int64, error) {
	m.seq++
	return m.seq, nil
}
func (m *memRepo) InsertQuote(ctx context.Context, db repository.DBTX, q *model.StoredQuote) (*model.StoredQuote, error) {
	cp := *q
	if cp.ID == "" {
		cp.ID = "quote-" + cp.QuoteNumber
	}
	m.byID[cp.ID] = &cp
	m.order = append(m.order, cp.ID)
	out := cp
	return &out, nil
}
func (m *memRepo) GetQuoteByID(ctx context.Context, db repository.DBTX, id string) (*model.StoredQuote, error) {
	if q, ok := m.byID[id]; ok {
		cp := *q
		return &cp, nil
	}
	return nil, model.ErrNotFound
}
func (m *memRepo) ListQuotes(ctx context.Context, db repository.DBTX, f repository.QuoteFilter) ([]*model.StoredQuote, int, error) {
	var out []*model.StoredQuote
	for _, id := range m.order {
		q := m.byID[id]
		if f.Status != "" && q.Status != f.Status {
			continue
		}
		cp := *q
		out = append(out, &cp)
	}
	return out, len(out), nil
}
func (m *memRepo) UpdateQuoteStatus(ctx context.Context, db repository.DBTX, id, status string) (*model.StoredQuote, error) {
	q, ok := m.byID[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	q.Status = status
	cp := *q
	return &cp, nil
}
func (m *memRepo) RecordFloorOverride(ctx context.Context, db repository.DBTX, id, by string) (*model.StoredQuote, error) {
	q, ok := m.byID[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	b := by
	q.FloorOverrideBy = &b
	cp := *q
	return &cp, nil
}

// noopTx is a pgx.Tx whose Exec is a no-op (the outbox staging is the only caller).
type noopTx struct{}

func (noopTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (noopTx) Begin(ctx context.Context) (pgx.Tx, error) { panic("unused") }
func (noopTx) Commit(ctx context.Context) error          { return nil }
func (noopTx) Rollback(ctx context.Context) error        { return nil }
func (noopTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("unused")
}
func (noopTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { panic("unused") }
func (noopTx) LargeObjects() pgx.LargeObjects                         { panic("unused") }
func (noopTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("unused")
}
func (noopTx) Query(context.Context, string, ...any) (pgx.Rows, error) { panic("unused") }
func (noopTx) QueryRow(context.Context, string, ...any) pgx.Row        { panic("unused") }
func (noopTx) Conn() *pgx.Conn                                         { panic("unused") }

func newQuoteHandler(active *model.PricingConfig) (*Handler, *memRepo) {
	repo := newMemRepo(active)
	svc := service.New(nil, repo, zerolog.Nop())
	svc.SetQuoteRepo(repo)
	svc.SetTxRunner(func(ctx context.Context, run func(tx pgx.Tx) error) error {
		return run(noopTx{})
	})
	return New(svc, zerolog.Nop()), repo
}

func defaultActive() *model.PricingConfig {
	return &model.PricingConfig{ID: "cfg-1", Version: 1, Status: model.ConfigStatusActive, Rates: model.DefaultConfig()}
}

func belowFloorActive() *model.PricingConfig {
	r := model.DefaultConfig()
	r.MarkupMultiplier = 1.05
	return &model.PricingConfig{ID: "cfg-bf", Version: 2, Status: model.ConfigStatusActive, Rates: r}
}

func do(t *testing.T, h *Handler, roles []string, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *bytes.Reader
	if body == "" {
		rdr = bytes.NewReader(nil)
	} else {
		rdr = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "11111111-1111-1111-1111-111111111111",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, req.WithContext(ctx))
	return rec
}

const createBody = `{"model":"per_user","deployment":1,"term_months":12,"users":10,"hot_storage_gb":2,"cold_storage_gb":5,"account_name":"Acme","selected_tier":"standard"}`

// createQuote is a helper that POSTs a quote as pricing_operator and returns its id.
func createQuote(t *testing.T, h *Handler, body string) string {
	t.Helper()
	rec := do(t, h, []string{"pricing_operator"}, http.MethodPost, "/quotes", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create quote: status %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if resp.Data.ID == "" {
		t.Fatalf("create quote: no id in body=%s", rec.Body.String())
	}
	return resp.Data.ID
}

var quoteInternalTokens = []string{"internal_cost", "gross_profit", "realized_margin", "guardrail", "\"internal\"", "below_floor", "floor_override"}

// TestCreateQuote_ServerRecomputes: the created quote is server-recomputed; the
// client never supplies tier numbers (the body has no field for them), and the
// stored/returned tiers match a fresh engine compute (verified via the admin
// internal view total_monthly).
func TestCreateQuote_ServerRecomputes(t *testing.T) {
	h, repo := newQuoteHandler(defaultActive())
	id := createQuote(t, h, createBody)

	stored := repo.byID[id]
	if stored == nil {
		t.Fatal("quote not stored")
	}
	if stored.PricingVersion != 1 || stored.PricingConfigID != "cfg-1" {
		t.Errorf("priced-against stamp wrong: v=%d id=%s", stored.PricingVersion, stored.PricingConfigID)
	}
	// The stored computed tiers are the full internal set (this row is internal).
	if len(stored.ComputedTiers) != 4 {
		t.Fatalf("stored computed tiers: got %d, want 4", len(stored.ComputedTiers))
	}
}

// TestGetQuote_MaskedVsInternalByRole: pricing:read gets the masked view (no
// internal tokens); pricing:admin gets the internal StoredQuote (with them).
func TestGetQuote_MaskedVsInternalByRole(t *testing.T) {
	h, _ := newQuoteHandler(defaultActive())
	id := createQuote(t, h, createBody)

	// Masked (pricing_analyst has read+write, NOT admin).
	rec := do(t, h, []string{"pricing_analyst"}, http.MethodGet, "/quotes/"+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("masked GET: status %d body=%s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, tok := range quoteInternalTokens {
		if strings.Contains(body, tok) {
			t.Errorf("masked GET leaked internal token %q\nbody=%s", tok, body)
		}
	}
	for _, want := range []string{"quote_number", "total_monthly", "contract_value", "tiers"} {
		if !strings.Contains(body, want) {
			t.Errorf("masked GET missing client field %q", want)
		}
	}

	// Internal (pricing_operator holds pricing:admin).
	rec = do(t, h, []string{"pricing_operator"}, http.MethodGet, "/quotes/"+id, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("internal GET: status %d body=%s", rec.Code, rec.Body.String())
	}
	body = rec.Body.String()
	for _, tok := range []string{"internal_cost", "gross_profit", "realized_margin", "guardrail"} {
		if !strings.Contains(body, tok) {
			t.Errorf("internal GET missing %q\nbody=%s", tok, body)
		}
	}
}

// TestBelowFloor_BlockedOnSendUntilOverride is the load-bearing governance test:
// a below-floor quote returns 409 on send, and only after a pricing:admin
// override does it advance.
func TestBelowFloor_BlockedOnSendUntilOverride(t *testing.T) {
	h, _ := newQuoteHandler(belowFloorActive())
	// term<12 to skip the annual discount is not needed; sales discount pushes
	// the crafted config below floor as in the engine test.
	body := `{"model":"per_user","deployment":1,"term_months":12,"users":10,"hot_storage_gb":2,"cold_storage_gb":5,"sales_discount":0.20,"account_name":"Thin","selected_tier":"standard"}`
	id := createQuote(t, h, body)

	// Send is blocked with 409.
	rec := do(t, h, []string{"pricing_operator"}, http.MethodPost, "/quotes/"+id+"/send", "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("below-floor send: expected 409, got %d body=%s", rec.Code, rec.Body.String())
	}

	// Override by a NON-admin is 403 (pricing_analyst lacks pricing:admin).
	rec = do(t, h, []string{"pricing_analyst"}, http.MethodPost, "/quotes/"+id+"/override-floor", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("override by non-admin: expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}

	// Override by a pricing:admin succeeds.
	rec = do(t, h, []string{"pricing_operator"}, http.MethodPost, "/quotes/"+id+"/override-floor", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("override by admin: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	// Now send succeeds.
	rec = do(t, h, []string{"pricing_operator"}, http.MethodPost, "/quotes/"+id+"/send", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("send after override: expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestExportMasked_NoInternalTokens: the export bytes (xlsx) contain the client
// totals but never the internal tokens — for BOTH an admin and a read caller
// (the exporter is always client-facing by construction).
func TestExportMasked_NoInternalTokens(t *testing.T) {
	h, _ := newQuoteHandler(defaultActive())
	id := createQuote(t, h, createBody)

	for _, role := range []string{"pricing_analyst", "pricing_operator"} {
		rec := do(t, h, []string{role}, http.MethodGet, "/quotes/"+id+"/export?format=xlsx", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s export: status %d body=%s", role, rec.Code, rec.Body.String())
		}
		raw := rec.Body.String()
		for _, tok := range []string{"internal_cost", "gross_profit", "realized_margin", "markup"} {
			if strings.Contains(raw, tok) {
				t.Errorf("%s export leaked internal token %q", role, tok)
			}
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "spreadsheetml") {
			t.Errorf("%s export content-type = %q, want xlsx", role, ct)
		}
	}
}

// TestCreateQuote_ForbiddenWithoutWrite: pricing:read alone cannot create quotes.
func TestCreateQuote_ForbiddenWithoutWrite(t *testing.T) {
	h, _ := newQuoteHandler(defaultActive())
	rec := do(t, h, []string{"role_read_only"}, http.MethodPost, "/quotes", createBody)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("create without pricing:write: expected 403, got %d", rec.Code)
	}
}
