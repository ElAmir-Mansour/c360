package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/pricing/model"
	"github.com/clario360/platform/internal/pricing/repository"
	"github.com/clario360/platform/internal/pricing/service"
)

// The handler tests exercise the STRUCTURAL MASKING contract end-to-end: they
// build a real *service.Service backed by an in-memory active config (the
// compute path opens no transaction, so a nil pool is safe), route a request
// through chi with a synthetic auth context, and assert on the raw JSON body.

// newHandler wires a handler over a service whose active config is the default
// rate set (version 1). No database is touched.
func newHandler() *Handler {
	repo := &computeRepo{}
	svc := service.New(nil, repo, zerolog.Nop())
	return New(svc, zerolog.Nop())
}

func requestAs(t *testing.T, roles []string, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := newHandler()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
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

const computeBody = `{"model":"per_user","deployment":1,"term_months":12,"users":1,"hot_storage_gb":2,"cold_storage_gb":5}`

// internalTokens are the strings that must NEVER appear in a client-facing
// (non-admin) response body. Checking the raw bytes proves masking is by shape,
// not merely absent from a struct we forgot to populate.
var internalTokens = []string{"internal_cost", "gross_profit", "realized_margin", "guardrail", "\"internal\""}

// TestMasking_ClientPathNeverContainsInternal is the load-bearing masking test.
// A pricing:read (non-admin) caller must receive tiers with the internal margin
// block PHYSICALLY ABSENT, even if they ask for include_internal.
func TestMasking_ClientPathNeverContainsInternal(t *testing.T) {
	for _, path := range []string{"/compute", "/compute?include_internal=true"} {
		rec := requestAs(t, []string{"pricing_analyst"}, path, computeBody)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d body=%s", path, rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		for _, tok := range internalTokens {
			if strings.Contains(body, tok) {
				t.Errorf("%s: client-facing body leaked internal token %q\nbody=%s", path, tok, body)
			}
		}
		// It must still contain the client-facing figures.
		for _, tok := range []string{"total_monthly", "contract_value", "sub_total", "line_items"} {
			if !strings.Contains(body, tok) {
				t.Errorf("%s: client body missing expected field %q", path, tok)
			}
		}
	}
}

// TestMasking_AdminSeesInternalOnlyWithFlag: an admin gets masked tiers by
// default, and the internal block only when include_internal=true is set. Runs
// for both super_admin (admin:* wildcard) and the granular pricing_operator
// (holds pricing:admin without admin:*) to prove the granular verb is enough.
func TestMasking_AdminSeesInternalOnlyWithFlag(t *testing.T) {
	for _, role := range []string{"super_admin", "pricing_operator"} {
		// Default (no flag): even an admin gets the masked view.
		rec := requestAs(t, []string{role}, "/compute", computeBody)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s default: status %d body=%s", role, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "realized_margin") {
			t.Errorf("%s without flag should get masked tiers, got internal block: %s", role, rec.Body.String())
		}

		// With the flag: admin gets the internal block.
		rec = requestAs(t, []string{role}, "/compute?include_internal=true", computeBody)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s internal: status %d body=%s", role, rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		for _, tok := range []string{"internal_cost", "gross_profit", "realized_margin", "guardrail"} {
			if !strings.Contains(body, tok) {
				t.Errorf("%s internal view missing %q\nbody=%s", role, tok, body)
			}
		}
	}
}

// TestCompute_ForbiddenWithoutPricingVerb: a caller with no pricing verb is 403.
func TestCompute_ForbiddenWithoutPricingVerb(t *testing.T) {
	rec := requestAs(t, []string{"role_with_nothing"}, "/compute", computeBody)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestCompute_AdminMarginMatchesGolden double-checks the admin internal view's
// realized margin is the golden ~0.145299 (parity assurance through the API).
func TestCompute_AdminMarginMatchesGolden(t *testing.T) {
	rec := requestAs(t, []string{"super_admin"}, "/compute?include_internal=true", computeBody)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var resp struct {
		Data struct {
			Tiers []struct {
				Tier     string `json:"tier"`
				Internal struct {
					RealizedMargin float64 `json:"realized_margin"`
					Guardrail      string  `json:"guardrail"`
				} `json:"internal"`
			} `json:"tiers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Data.Tiers) != 4 {
		t.Fatalf("expected 4 tiers, got %d", len(resp.Data.Tiers))
	}
	for _, ti := range resp.Data.Tiers {
		if ti.Tier == "standard" {
			if diff := ti.Internal.RealizedMargin - 0.145299; diff > 0.0001 || diff < -0.0001 {
				t.Errorf("standard realized_margin: got %.6f, want ~0.145299", ti.Internal.RealizedMargin)
			}
			if ti.Internal.Guardrail != "OK" {
				t.Errorf("standard guardrail: got %q, want OK", ti.Internal.Guardrail)
			}
		}
	}
}

// --- test repo (compute path only; no DB) ------------------------------------

// computeRepo satisfies service.Repo for the compute path (no transaction, so
// the nil pool in the service is never dereferenced).
type computeRepo struct{}

func activeCfg() *model.PricingConfig {
	return &model.PricingConfig{Version: 1, Status: model.ConfigStatusActive, Rates: model.DefaultConfig()}
}

func (c *computeRepo) GetActive(ctx context.Context, db repository.DBTX) (*model.PricingConfig, error) {
	return activeCfg(), nil
}
func (c *computeRepo) GetByVersion(ctx context.Context, db repository.DBTX, version int) (*model.PricingConfig, error) {
	if version == 1 {
		return activeCfg(), nil
	}
	return nil, model.ErrNotFound
}
func (c *computeRepo) List(ctx context.Context, db repository.DBTX) ([]*model.PricingConfig, error) {
	return nil, nil
}
func (c *computeRepo) MaxVersion(ctx context.Context, db repository.DBTX) (int, error) { return 1, nil }
func (c *computeRepo) CreateDraft(ctx context.Context, db repository.DBTX, x *model.PricingConfig) (*model.PricingConfig, error) {
	return x, nil
}
func (c *computeRepo) UpdateDraft(ctx context.Context, db repository.DBTX, x *model.PricingConfig) (*model.PricingConfig, error) {
	return x, nil
}
func (c *computeRepo) ArchiveActive(ctx context.Context, db repository.DBTX) error { return nil }
func (c *computeRepo) Activate(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}
func (c *computeRepo) ArchiveVersion(ctx context.Context, db repository.DBTX, v int) (*model.PricingConfig, error) {
	return nil, nil
}
