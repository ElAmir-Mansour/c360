package copilot

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// stubChatService records calls and returns canned results.
type stubChatService struct {
	chatCalled bool
	chatInput  ChatInput
	chatResult *ChatResult
	chatErr    error

	getResult *SessionTranscript
	getErr    error
}

func (s *stubChatService) Chat(_ context.Context, in ChatInput) (*ChatResult, error) {
	s.chatCalled = true
	s.chatInput = in
	return s.chatResult, s.chatErr
}

func (s *stubChatService) GetSession(_ context.Context, _ uuid.UUID, _ uuid.UUID) (*SessionTranscript, error) {
	return s.getResult, s.getErr
}

// withUser attaches an authenticated user + tenant context with the dr:read
// permission the copilot routes require (super-admin has "*").
func withUser(req *http.Request, tenantID, userID uuid.UUID) *http.Request {
	user := &auth.ContextUser{ID: userID.String(), TenantID: tenantID.String(), Roles: []string{"tenant_admin"}}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestHandler_ChatRoutesToService(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	userID := uuid.New()
	stub := &stubChatService{
		chatResult: &ChatResult{
			SessionID: uuid.NewString(),
			MessageID: uuid.NewString(),
			Answer:    "all good",
			Provider:  "fake",
			Model:     "fake-model",
		},
	}
	router := NewHandler(stub, zerolog.Nop()).Routes()

	body, _ := json.Marshal(chatRequest{Message: "How is DR?"})
	req := httptest.NewRequest(http.MethodPost, "/copilot/chat", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, userID))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !stub.chatCalled {
		t.Fatal("expected Chat to be called")
	}
	if stub.chatInput.TenantID != tenantID || stub.chatInput.UserID != userID {
		t.Fatalf("tenant/user not propagated: %+v", stub.chatInput)
	}
	if stub.chatInput.Message != "How is DR?" {
		t.Fatalf("message not propagated: %q", stub.chatInput.Message)
	}
}

func TestHandler_ChatContinuesSession(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	userID := uuid.New()
	sessionID := uuid.New()
	stub := &stubChatService{chatResult: &ChatResult{SessionID: sessionID.String(), Answer: "ok"}}
	router := NewHandler(stub, zerolog.Nop()).Routes()

	sidStr := sessionID.String()
	body, _ := json.Marshal(chatRequest{SessionID: &sidStr, Message: "follow up"})
	req := httptest.NewRequest(http.MethodPost, "/copilot/chat", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, userID))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if stub.chatInput.SessionID == nil || *stub.chatInput.SessionID != sessionID {
		t.Fatalf("session id not propagated: %+v", stub.chatInput.SessionID)
	}
}

func TestHandler_ChatEmptyMessageReturns400(t *testing.T) {
	t.Parallel()
	stub := &stubChatService{chatErr: ErrEmptyMessage}
	router := NewHandler(stub, zerolog.Nop()).Routes()
	body, _ := json.Marshal(chatRequest{Message: ""})
	req := httptest.NewRequest(http.MethodPost, "/copilot/chat", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New()))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_ChatProviderUnavailableReturns503(t *testing.T) {
	t.Parallel()
	stub := &stubChatService{chatErr: ErrProviderUnavailable}
	router := NewHandler(stub, zerolog.Nop()).Routes()
	body, _ := json.Marshal(chatRequest{Message: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/copilot/chat", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New()))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_GetSessionReturnsTranscript(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	userID := uuid.New()
	sessionID := uuid.New()
	stub := &stubChatService{getResult: &SessionTranscript{
		Session:  Session{ID: sessionID.String(), TenantID: tenantID.String()},
		Messages: []Message{{Role: RoleUser, Content: "q"}, {Role: RoleAssistant, Content: "a"}},
	}}
	router := NewHandler(stub, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/copilot/sessions/"+sessionID.String(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, tenantID, userID))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_GetSessionNotFoundReturns404(t *testing.T) {
	t.Parallel()
	stub := &stubChatService{getErr: ErrNotFound}
	router := NewHandler(stub, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/copilot/sessions/"+uuid.NewString(), nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandler_ChatRequiresAuth(t *testing.T) {
	t.Parallel()
	stub := &stubChatService{}
	router := NewHandler(stub, zerolog.Nop()).Routes()
	body, _ := json.Marshal(chatRequest{Message: "hi"})
	req := httptest.NewRequest(http.MethodPost, "/copilot/chat", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req) // no auth context
	if rec.Code == http.StatusOK {
		t.Fatalf("expected non-200 without auth, got %d", rec.Code)
	}
	if stub.chatCalled {
		t.Fatal("Chat must not be called when unauthenticated")
	}
}
