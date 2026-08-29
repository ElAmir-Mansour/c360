package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

type countOnlyTaskService struct {
	taskService
	counts map[string]int
}

func (s *countOnlyTaskService) CountTasks(
	_ context.Context,
	_, _ string,
	_ []string,
) (map[string]int, error) {
	return s.counts, nil
}

func TestCountTasksDoesNotMixTenantCreatedHistoryWithUserPendingCount(t *testing.T) {
	service := &countOnlyTaskService{counts: map[string]int{
		"pending":   3,
		"completed": 8,
	}}
	handler := NewTaskHandler(service, nil, nil, zerolog.Nop())

	req := httptest.NewRequest(http.MethodGet, "/count", nil)
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "user-1",
		TenantID: "tenant-1",
		Roles:    []string{"reviewer"},
	}))
	recorder := httptest.NewRecorder()

	handler.CountTasks(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got := body["pending"]; got != float64(3) {
		t.Fatalf("pending = %v, want 3", got)
	}
	if _, exists := body["history"]; exists {
		t.Fatal("history must be omitted until a user-scoped pending snapshot series exists")
	}
}

func TestCanViewTaskLateJustificationIsRestricted(t *testing.T) {
	manager := "legal-cases-manager"
	if !canViewTaskLateJustification([]string{"legal-director"}, &manager) {
		t.Fatal("Legal Director must be able to view the justification")
	}
	if !canViewTaskLateJustification([]string{"LEGAL_CASES_MANAGER"}, &manager) {
		t.Fatal("corresponding manager role must be normalized and allowed")
	}
	for _, roles := range [][]string{{"admin"}, {"legal-auditor"}, {"legal-contracts-manager"}, {"legal-associate"}} {
		if canViewTaskLateJustification(roles, &manager) {
			t.Fatalf("roles %v must not view the private justification", roles)
		}
	}
}
