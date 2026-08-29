package journal

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// stubAPI is a hand-written API double recording calls and returning canned
// values, so the router is tested without a service/DB.
type stubAPI struct {
	timeline   *Timeline
	resolution *Resolution
	bookmark   *Bookmark
	bookmarks  []Bookmark
	err        error

	lastResolve ResolveRequest
	deleted     uuid.UUID
}

func (s *stubAPI) Timeline(context.Context, uuid.UUID, uuid.UUID) (*Timeline, error) {
	return s.timeline, s.err
}

func (s *stubAPI) CreateBookmark(_ context.Context, _, _ uuid.UUID, _ *uuid.UUID, _ CreateBookmarkInput) (*Bookmark, error) {
	return s.bookmark, s.err
}

func (s *stubAPI) ListBookmarks(context.Context, uuid.UUID, uuid.UUID) ([]Bookmark, error) {
	return s.bookmarks, s.err
}

func (s *stubAPI) DeleteBookmark(_ context.Context, _, _, id uuid.UUID) error {
	s.deleted = id
	return s.err
}

func (s *stubAPI) Resolve(_ context.Context, _, _ uuid.UUID, req ResolveRequest) (*Resolution, error) {
	s.lastResolve = req
	return s.resolution, s.err
}

// mount builds a router with the auth/tenant context injected so the handler's
// suiteapi.TenantID/UserID and RequirePermission middleware pass.
func mount(api API) http.Handler {
	h := NewHandler(api, zerolog.Nop())
	root := chi.NewRouter()
	root.Use(injectContext)
	root.Mount("/", h.Routes())
	return root
}

// injectContext sets a tenant + super-admin user on the request context (the
// shape suiteapi + RequirePermission read), so route RBAC is satisfied.
func injectContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := auth.WithTenantID(r.Context(), testTenant)
		ctx = auth.WithUser(ctx, &auth.ContextUser{
			ID:       "cccccccc-0000-0000-0000-000000000003",
			TenantID: testTenant,
			Roles:    []string{"super_admin"},
		})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func doReq(t *testing.T, h http.Handler, method, target string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, target, nil)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRouter_Timeline(t *testing.T) {
	t.Parallel()
	api := &stubAPI{timeline: &Timeline{StreamID: testStream, Recoverable: true, EarliestSeq: 1, LatestSeq: 400}}
	h := mount(api)

	rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/timeline", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data Timeline `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !resp.Data.Recoverable || resp.Data.LatestSeq != 400 {
		t.Fatalf("unexpected timeline body: %+v", resp.Data)
	}
}

func TestRouter_Resolve_ParsesTargets(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name     string
		query    string
		wantKind string
		check    func(t *testing.T, req ResolveRequest)
	}{
		{
			name:     "by timestamp",
			query:    "at=" + now.Format(time.RFC3339),
			wantKind: "timestamp",
			check: func(t *testing.T, req ResolveRequest) {
				if req.At == nil || !req.At.Equal(now) {
					t.Fatalf("At = %v, want %v", req.At, now)
				}
			},
		},
		{
			name:     "by lsn",
			query:    "lsn=0/16B6248",
			wantKind: "lsn",
			check: func(t *testing.T, req ResolveRequest) {
				if req.LSN != "0/16B6248" {
					t.Fatalf("LSN = %q", req.LSN)
				}
			},
		},
		{
			name:     "by seq",
			query:    "seq=250",
			wantKind: "seq",
			check: func(t *testing.T, req ResolveRequest) {
				if req.Seq == nil || *req.Seq != 250 {
					t.Fatalf("Seq = %v", req.Seq)
				}
			},
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			api := &stubAPI{resolution: &Resolution{StreamID: testStream, CutSeq: 250}}
			h := mount(api)
			rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve?"+tt.query, "")
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			tt.check(t, api.lastResolve)
		})
	}
}

func TestRouter_Resolve_RejectsBadTargets(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	h := mount(api)

	// No target.
	if rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("no-target status = %d, want 400", rec.Code)
	}
	// Two targets.
	if rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve?seq=5&lsn=0/1", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("two-target status = %d, want 400", rec.Code)
	}
	// Bad timestamp.
	if rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve?at=notatime", ""); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad-ts status = %d, want 400", rec.Code)
	}
}

func TestRouter_Resolve_PrunedIsGone(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: ErrPruned}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve?seq=5", "")
	if rec.Code != http.StatusGone {
		t.Fatalf("status = %d, want 410 Gone for pruned target", rec.Code)
	}
}

func TestRouter_Resolve_NoCoverageIsNotFound(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: ErrNoCoverage}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/resolve?seq=5", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for no coverage", rec.Code)
	}
}

func TestRouter_CreateBookmark(t *testing.T) {
	t.Parallel()
	api := &stubAPI{bookmark: &Bookmark{ID: "bm-1", Name: "drill-1", Kind: BookmarkDrill, AtSeq: 100}}
	h := mount(api)

	rec := doReq(t, h, http.MethodPost, "/streams/"+testStream+"/journal/bookmarks",
		`{"name":"drill-1","kind":"drill","at_seq":100}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouter_CreateBookmark_Conflict(t *testing.T) {
	t.Parallel()
	api := &stubAPI{err: ErrAlreadyExists}
	h := mount(api)
	rec := doReq(t, h, http.MethodPost, "/streams/"+testStream+"/journal/bookmarks", `{"name":"dup","at_seq":1}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestRouter_DeleteBookmark(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	h := mount(api)
	bmID := uuid.New()
	rec := doReq(t, h, http.MethodDelete, "/streams/"+testStream+"/journal/bookmarks/"+bmID.String(), "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if api.deleted != bmID {
		t.Fatalf("deleted = %s, want %s", api.deleted, bmID)
	}
}

func TestRouter_ListBookmarks_NeverNull(t *testing.T) {
	t.Parallel()
	api := &stubAPI{bookmarks: nil}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/streams/"+testStream+"/journal/bookmarks", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Data []Bookmark `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data == nil {
		t.Fatal("bookmarks data should serialize as [] not null")
	}
}

func TestRouter_BadStreamID(t *testing.T) {
	t.Parallel()
	api := &stubAPI{}
	h := mount(api)
	rec := doReq(t, h, http.MethodGet, "/streams/not-a-uuid/journal/timeline", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for bad stream id", rec.Code)
	}
}
