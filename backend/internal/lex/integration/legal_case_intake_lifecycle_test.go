//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestCaseIntakeReadBeforeStartReturnsNull(t *testing.T) {
	h := newLexHarness(t)
	legalCase := h.createLegalCase(t, "Case intake empty state", model.CaseCompanyStatusPlaintiff)

	intake := mustData[*model.CaseIntake](t,
		h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/intake", legalCase.ID), nil),
		http.StatusOK,
	)
	if intake != nil {
		t.Fatalf("intake = %#v, want nil before phase-1 start", intake)
	}
}

func TestCaseIntakeReadForMissingCaseReturnsNotFound(t *testing.T) {
	h := newLexHarness(t)
	missingCaseID := uuid.New()

	env := mustError(t,
		h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-cases/%s/intake", missingCaseID), nil),
		http.StatusNotFound,
	)
	if env.Error.Code != "NOT_FOUND" {
		t.Fatalf("error code = %q, want NOT_FOUND", env.Error.Code)
	}
}
