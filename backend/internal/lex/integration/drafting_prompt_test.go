//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestDraftingPromptLibraryCRUDAcceptance exercises the AID-09 prompt library
// end-to-end over HTTP against the real lex_db schema (migration 000013):
// create/get/list/update/delete, missing-variable rejection (422), and the
// fail-closed run path (503 when the LLM provider is not configured in tests).
func TestDraftingPromptLibraryCRUDAcceptance(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	created := mustData[model.PromptTemplate](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/drafting/prompts", dto.CreatePromptTemplateRequest{
		Name:         "NDA intro",
		Category:     "nda",
		Description:  "Standard NDA opening",
		SystemPrompt: "You are a contracts assistant.",
		UserPrompt:   "Draft an NDA introduction between {{party_a}} and {{party_b}}.",
		Variables:    []string{"party_a", "party_b"},
	}), http.StatusCreated)
	if created.ID == uuid.Nil || created.Name != "NDA intro" || len(created.Variables) != 2 {
		t.Fatalf("unexpected created template: %+v", created)
	}

	got := mustData[model.PromptTemplate](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s", created.ID), nil), http.StatusOK)
	if got.ID != created.ID || got.UserPrompt != created.UserPrompt {
		t.Fatalf("get mismatch: %+v", got)
	}

	listed := mustPaginated[model.PromptTemplate](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/drafting/prompts?page=1&per_page=20", nil), http.StatusOK)
	if !promptListContains(listed.Data, created.ID) {
		t.Fatalf("created template missing from list: %+v", listed.Data)
	}

	updated := mustData[model.PromptTemplate](t, h.doJSON(t, http.MethodPut, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s", created.ID), dto.UpdatePromptTemplateRequest{
		Name:       "NDA intro v2",
		Category:   "nda",
		UserPrompt: "Draft a short NDA intro for {{party_a}}.",
		Variables:  []string{"party_a"},
	}), http.StatusOK)
	if updated.Name != "NDA intro v2" || len(updated.Variables) != 1 {
		t.Fatalf("update did not apply: %+v", updated)
	}

	// Run with a declared variable missing -> 422 (never emits unfilled placeholders).
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s/run", created.ID), dto.RunPromptRequest{
		Variables: map[string]any{},
	}), http.StatusUnprocessableEntity)

	// Run with all variables supplied but LLM disabled in tests -> fail closed 503.
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s/run", created.ID), dto.RunPromptRequest{
		Variables: map[string]any{"party_a": "Acme LLC"},
	}), http.StatusServiceUnavailable)

	mustData[map[string]any](t, h.doJSON(t, http.MethodDelete, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s", created.ID), nil), http.StatusOK)
	mustError(t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/drafting/prompts/%s", created.ID), nil), http.StatusNotFound)
}

func promptListContains(items []model.PromptTemplate, id uuid.UUID) bool {
	for _, it := range items {
		if it.ID == id {
			return true
		}
	}
	return false
}
