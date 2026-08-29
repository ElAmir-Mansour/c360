package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// stubService records what the handler passed down and replays a canned result.
type stubService struct {
	chatIn      ChatInput
	listLimit   int
	sessionID   uuid.UUID
	chatErr     error
	listErr     error
	sessionErr  error
	chatCalled  bool
	listCalled  bool
	getSessionC bool
}

func (s *stubService) Chat(_ context.Context, in ChatInput) (*ChatResult, error) {
	s.chatCalled = true
	s.chatIn = in
	if s.chatErr != nil {
		return nil, s.chatErr
	}
	return &ChatResult{SessionID: uuid.New(), MessageID: uuid.New(), Answer: "grounded", Provider: "anthropic", Model: DefaultModel}, nil
}

func (s *stubService) ListSessions(_ context.Context, _, _ uuid.UUID, limit int) (*SessionList, error) {
	s.listCalled = true
	s.listLimit = limit
	if s.listErr != nil {
		return nil, s.listErr
	}
	return &SessionList{Sessions: []Session{}}, nil
}

func (s *stubService) GetSession(_ context.Context, _, _, sessionID uuid.UUID) (*SessionTranscript, error) {
	s.getSessionC = true
	s.sessionID = sessionID
	if s.sessionErr != nil {
		return nil, s.sessionErr
	}
	return &SessionTranscript{Session: Session{ID: sessionID}, Messages: []Message{}}, nil
}

// authed attaches the tenant + user context the suiteapi extractors read.
func authed(req *http.Request, roles []string) *http.Request {
	ctx := auth.WithTenantID(req.Context(), testTenantID.String())
	ctx = auth.WithUser(ctx, &auth.ContextUser{
		ID:       testUserID.String(),
		TenantID: testTenantID.String(),
		Roles:    roles,
	})
	return req.WithContext(ctx)
}

func newHandlerRouter(svc ChatService) chi.Router {
	h := NewHandler(svc, zerolog.Nop())
	r := chi.NewRouter()
	r.Post("/ai/chat", h.Chat)
	r.Get("/ai/sessions", h.ListSessions)
	r.Get("/ai/sessions/{sessionID}", h.GetSession)
	return r
}

func TestChatHandlerHappyPath(t *testing.T) {
	svc := &stubService{}
	r := newHandlerRouter(svc)
	sessionID := uuid.New()
	body := strings.NewReader(`{"session_id":"` + sessionID.String() + `","message":"How is the portfolio?"}`)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, authed(httptest.NewRequest(http.MethodPost, "/ai/chat", body), []string{"legal-director"}))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if svc.chatIn.TenantID != testTenantID || svc.chatIn.UserID != testUserID {
		t.Errorf("tenant/user = %s/%s, want %s/%s", svc.chatIn.TenantID, svc.chatIn.UserID, testTenantID, testUserID)
	}
	if svc.chatIn.SessionID == nil || *svc.chatIn.SessionID != sessionID {
		t.Errorf("session id = %v, want %s", svc.chatIn.SessionID, sessionID)
	}
	if svc.chatIn.Message != "How is the portfolio?" {
		t.Errorf("message = %q", svc.chatIn.Message)
	}
	var envelope struct {
		Data ChatResult `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rec.Body.String())
	}
	if envelope.Data.Answer != "grounded" {
		t.Errorf("answer = %q, want %q", envelope.Data.Answer, "grounded")
	}
}

// Every service sentinel maps to its own HTTP status. A refused answer is a
// content outcome (422), an unconfigured provider is 503, and neither is a 500.
func TestChatHandlerErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{name: "not found", err: ErrNotFound, wantStatus: http.StatusNotFound, wantCode: "NOT_FOUND"},
		{name: "empty message", err: ErrEmptyMessage, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_ERROR"},
		{name: "message too long", err: ErrMessageTooLong, wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_ERROR"},
		{name: "no grounding access", err: ErrNoGroundingAccess, wantStatus: http.StatusForbidden, wantCode: "FORBIDDEN"},
		{name: "refused", err: ErrAnswerRefused, wantStatus: http.StatusUnprocessableEntity, wantCode: "AI_REFUSED"},
		{name: "provider unavailable", err: ErrProviderUnavailable, wantStatus: http.StatusServiceUnavailable, wantCode: "AI_UNAVAILABLE"},
		{name: "unexpected", err: errors.New("boom"), wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newHandlerRouter(&stubService{chatErr: tc.err})
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/ai/chat", strings.NewReader(`{"message":"hi"}`))
			r.ServeHTTP(rec, authed(req, []string{"legal-director"}))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			var envelope struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode error envelope: %v (%s)", err, rec.Body.String())
			}
			if envelope.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", envelope.Code, tc.wantCode)
			}
		})
	}
}

func TestChatHandlerRejectsBadRequests(t *testing.T) {
	cases := []struct {
		name       string
		body       string
		authorise  bool
		wantStatus int
	}{
		{name: "malformed json", body: `{"message":`, authorise: true, wantStatus: http.StatusBadRequest},
		{name: "non-uuid session id", body: `{"session_id":"not-a-uuid","message":"hi"}`, authorise: true, wantStatus: http.StatusBadRequest},
		{name: "unauthenticated", body: `{"message":"hi"}`, wantStatus: http.StatusUnauthorized},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &stubService{}
			r := newHandlerRouter(svc)
			req := httptest.NewRequest(http.MethodPost, "/ai/chat", strings.NewReader(tc.body))
			if tc.authorise {
				req = authed(req, []string{"legal-director"})
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if svc.chatCalled {
				t.Error("service was called for an invalid request")
			}
		})
	}
}

func TestListSessionsHandler(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantLimit  int
	}{
		{name: "no limit defers to the service default", query: "", wantStatus: http.StatusOK, wantLimit: 0},
		{name: "explicit limit is forwarded", query: "?limit=5", wantStatus: http.StatusOK, wantLimit: 5},
		{name: "zero limit is rejected", query: "?limit=0", wantStatus: http.StatusBadRequest},
		{name: "non-numeric limit is rejected", query: "?limit=abc", wantStatus: http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &stubService{}
			r := newHandlerRouter(svc)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, authed(httptest.NewRequest(http.MethodGet, "/ai/sessions"+tc.query, nil), []string{"legal-director"}))

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if tc.wantStatus == http.StatusOK && svc.listLimit != tc.wantLimit {
				t.Errorf("limit = %d, want %d", svc.listLimit, tc.wantLimit)
			}
			if tc.wantStatus != http.StatusOK && svc.listCalled {
				t.Error("service was called for an invalid limit")
			}
		})
	}
}

func TestGetSessionHandler(t *testing.T) {
	sessionID := uuid.New()
	svc := &stubService{}
	r := newHandlerRouter(svc)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, authed(httptest.NewRequest(http.MethodGet, "/ai/sessions/"+sessionID.String(), nil), []string{"legal-director"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if svc.sessionID != sessionID {
		t.Errorf("session id = %s, want %s", svc.sessionID, sessionID)
	}

	svc = &stubService{}
	r = newHandlerRouter(svc)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, authed(httptest.NewRequest(http.MethodGet, "/ai/sessions/not-a-uuid", nil), []string{"legal-director"}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if svc.getSessionC {
		t.Error("service was called for a malformed session id")
	}
}

// The caller's legal-domain grants are resolved from the SAME permission keys
// that gate the REST surfaces, so lex:ai:use grants access to the assistant and
// never to data.
func TestGrantsFromRequest(t *testing.T) {
	cases := []struct {
		name  string
		roles []string
		want  Grants
	}{
		{
			name:  "legal director holds every domain plus workforce",
			roles: []string{"legal-director"},
			want:  Grants{Contracts: true, Cases: true, Consultations: true, Requests: true, Workforce: true},
		},
		{
			name:  "unknown role holds nothing",
			roles: []string{"not-a-real-role"},
			want:  Grants{},
		},
		{
			name:  "no roles holds nothing",
			roles: nil,
			want:  Grants{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := authed(httptest.NewRequest(http.MethodPost, "/ai/chat", nil), tc.roles)
			if got := GrantsFromRequest(req); got != tc.want {
				t.Errorf("GrantsFromRequest = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestGrantsAny(t *testing.T) {
	if (Grants{}).Any() {
		t.Error("empty grants reported Any() = true")
	}
	for _, g := range []Grants{{Contracts: true}, {Cases: true}, {Consultations: true}, {Requests: true}, {Workforce: true}} {
		if !g.Any() {
			t.Errorf("%+v reported Any() = false", g)
		}
	}
}

// serveAIRoute mirrors the /ai/* tier wiring in RegisterRoutes: a single
// dedicated lex:ai:use gate, NOT lex:read.
func serveAIRoute(method, path string, roles []string) (status int, handlerRan bool) {
	r := chi.NewRouter()
	aiUse := r.With(sharedmw.RequirePermission(auth.PermLexAIUse))
	handler := func(w http.ResponseWriter, _ *http.Request) {
		handlerRan = true
		w.WriteHeader(http.StatusOK)
	}
	aiUse.Post("/ai/chat", handler)
	aiUse.Get("/ai/sessions", handler)
	aiUse.Get("/ai/sessions/{sessionID}", handler)

	req := authed(httptest.NewRequest(method, path, nil), roles)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec.Code, handlerRan
}

// lex:ai:use is a DEDICATED switch. A Legal Director — who holds lex:read,
// lex:write and every granular legal verb — must still be 403'd until the
// permission is explicitly granted. This is the regression lock for "do not
// gate the AI surface on lex:read".
func TestAIRoutesRequireDedicatedPermission(t *testing.T) {
	routes := []struct{ method, path string }{
		{http.MethodPost, "/ai/chat"},
		{http.MethodGet, "/ai/sessions"},
		{http.MethodGet, "/ai/sessions/" + uuid.NewString()},
	}
	for _, route := range routes {
		if status, ran := serveAIRoute(route.method, route.path, []string{"legal-director"}); status != http.StatusForbidden || ran {
			t.Errorf("legal-director %s %s = status %d handlerRan=%v, want 403/false", route.method, route.path, status, ran)
		}
		if status, ran := serveAIRoute(route.method, route.path, []string{"legal-auditor"}); status != http.StatusForbidden || ran {
			t.Errorf("legal-auditor %s %s = status %d handlerRan=%v, want 403/false", route.method, route.path, status, ran)
		}
	}
}

// No built-in role may carry lex:ai:use: the feature ships off until product
// enables it per tenant (role-matrix import or an explicit grant).
func TestLexAIUseIsNotGrantedToAnyBuiltInRole(t *testing.T) {
	for role, perms := range auth.RolePermissions {
		for _, perm := range perms {
			if perm == auth.PermLexAIUse {
				t.Errorf("role %q carries %s by default; the AI surface must ship ungranted", role, auth.PermLexAIUse)
			}
		}
	}
}
