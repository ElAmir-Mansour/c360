package attestledger

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// stubAPI implements the router's API surface for handler-level tests.
type stubAPI struct {
	entries    []*Entry
	verifyRes  VerifyResult
	checkpoint *Checkpoint
	proof      *InclusionProof
	err        error

	gotTenant uuid.UUID
	gotFilter ListFilter
	gotSeq    int64
}

func (s *stubAPI) ListEntries(_ context.Context, tenantID uuid.UUID, f ListFilter) ([]*Entry, error) {
	s.gotTenant = tenantID
	s.gotFilter = f
	return s.entries, s.err
}
func (s *stubAPI) Verify(_ context.Context, tenantID uuid.UUID) (VerifyResult, error) {
	s.gotTenant = tenantID
	return s.verifyRes, s.err
}
func (s *stubAPI) Anchor(_ context.Context, tenantID uuid.UUID) (*Checkpoint, error) {
	s.gotTenant = tenantID
	return s.checkpoint, s.err
}
func (s *stubAPI) BuildInclusionProofFor(_ context.Context, tenantID uuid.UUID, seq int64) (*InclusionProof, error) {
	s.gotTenant = tenantID
	s.gotSeq = seq
	return s.proof, s.err
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_ListEntries_Filters(t *testing.T) {
	t.Parallel()
	api := &stubAPI{entries: []*Entry{{Seq: 1, EntryType: EntryTypeCleanroomVerdict}}}
	router := NewHandler(api, zerolog.Nop()).Routes()
	tenant := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/attestation-ledger?type=cleanroom_verdict&subject=abc&limit=10", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenant, "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if api.gotFilter.EntryType != "cleanroom_verdict" || api.gotFilter.SubjectID != "abc" || api.gotFilter.Limit != 10 {
		t.Fatalf("filter not parsed: %+v", api.gotFilter)
	}
	if api.gotTenant != tenant {
		t.Fatalf("tenant = %s, want %s", api.gotTenant, tenant)
	}
}

func TestRouter_Verify_IntactAndBroken(t *testing.T) {
	t.Parallel()
	api := &stubAPI{verifyRes: VerifyResult{Intact: false, FirstBrokenSeq: 4, Reason: "x", EntriesChecked: 6}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/attestation-ledger/verify", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data VerifyResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Intact || body.Data.FirstBrokenSeq != 4 {
		t.Fatalf("verify body = %+v", body.Data)
	}
}

func TestRouter_Anchor_RequiresAdmin(t *testing.T) {
	t.Parallel()
	api := &stubAPI{checkpoint: &Checkpoint{FromSeq: 1, ToSeq: 5, MerkleRoot: "root"}}
	router := NewHandler(api, zerolog.Nop()).Routes()

	// viewer (dr:read only) is forbidden from anchoring.
	req := httptest.NewRequest(http.MethodPost, "/attestation-ledger/anchor", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "viewer"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer anchor status = %d, want 403", rec.Code)
	}

	// tenant_admin (dr:admin) succeeds with 201.
	req = httptest.NewRequest(http.MethodPost, "/attestation-ledger/anchor", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin anchor status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_Anchor_NothingToAnchorIsConflict(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: ErrInvalid}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/attestation-ledger/anchor", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestRouter_Proof_ValidAndBadSeq(t *testing.T) {
	t.Parallel()
	api := &stubAPI{proof: &InclusionProof{Seq: 3, LeafHash: "h", Root: "r"}}
	router := NewHandler(api, zerolog.Nop()).Routes()
	tenant := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/attestation-ledger/3/proof", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenant, "analyst"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	if api.gotSeq != 3 {
		t.Fatalf("seq = %d, want 3", api.gotSeq)
	}

	// Non-numeric seq → 400.
	req = httptest.NewRequest(http.MethodGet, "/attestation-ledger/abc/proof", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenant, "analyst"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad seq status = %d, want 400", rec.Code)
	}
}

func TestRouter_Proof_NotFound(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: ErrNotFound}
	router := NewHandler(api, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/attestation-ledger/9/proof", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestRouter_NoTenantContext(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	router := NewHandler(api, zerolog.Nop()).Routes()
	// Authenticated (so RequirePermission passes) but no tenant in context.
	req := httptest.NewRequest(http.MethodGet, "/attestation-ledger/verify", nil)
	user := &auth.ContextUser{ID: uuid.NewString(), Roles: []string{"tenant_admin"}}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req.WithContext(auth.WithUser(req.Context(), user)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
