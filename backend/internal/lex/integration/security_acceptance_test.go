//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

func init() {
	auth.RolePermissions["watheeq_lex_write_only"] = []string{auth.PermLexWrite}
}

func TestWatheeqSecurityAcceptancePermissionGuardsAndAlias(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	readOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "viewer"))
	writeOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "watheeq_lex_write_only"))
	noLexAccess := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "no_lex_access"))

	expectStatus(t, readOnly.doJSON(t, http.MethodGet, "/api/v1/lex/contracts", nil), http.StatusOK)
	expectStatus(t, readOnly.doJSON(t, http.MethodGet, "/api/v1/watheeq/contracts", nil), http.StatusOK)

	createReq := h.baseContractRequest("Watheeq Guarded Contract", model.ContractTypeServiceAgreement, 100000, lifecycleContractText())
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, "/api/v1/lex/contracts", createReq), http.StatusForbidden)
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, "/api/v1/watheeq/contracts", createReq), http.StatusForbidden)

	expectStatus(t, noLexAccess.doJSON(t, http.MethodGet, "/api/v1/lex/contracts", nil), http.StatusForbidden)
	expectStatus(t, noLexAccess.doJSON(t, http.MethodGet, "/api/v1/watheeq/contracts", nil), http.StatusForbidden)
	expectStatus(t, noLexAccess.doJSON(t, http.MethodPost, "/api/v1/lex/contracts", createReq), http.StatusForbidden)
	expectStatus(t, noLexAccess.doJSON(t, http.MethodPost, "/api/v1/watheeq/contracts", createReq), http.StatusForbidden)

	expectStatus(t, writeOnly.doJSON(t, http.MethodGet, "/api/v1/lex/contracts", nil), http.StatusForbidden)
	created := mustData[model.Contract](t, writeOnly.doJSON(t, http.MethodPost, "/api/v1/watheeq/contracts", createReq), http.StatusCreated)
	detail := mustData[model.ContractDetail](t, readOnly.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", created.ID), nil), http.StatusOK)
	if detail.Contract.ID != created.ID {
		t.Fatalf("read-only contract detail id = %s, want %s", detail.Contract.ID, created.ID)
	}
}

func TestWatheeqSecurityAcceptanceTenantIsolation(t *testing.T) {
	t.Parallel()

	tenantA := newLexHarness(t)
	tenantB := newLexHarness(t)
	contract := tenantA.createContractWithText(t, "Tenant A Confidential Contract", model.ContractTypeVendor, 250000, lifecycleContractText())

	expectStatus(t, tenantB.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusNotFound)
	expectStatus(t, tenantB.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/watheeq/contracts/%s", contract.ID), nil), http.StatusNotFound)

	tenantBList := mustPaginated[model.Contract](t, tenantB.doJSON(t, http.MethodGet, "/api/v1/watheeq/contracts?page=1&per_page=100", nil), http.StatusOK)
	for _, item := range tenantBList.Data {
		if item.ID == contract.ID {
			t.Fatalf("tenant B list exposed tenant A contract %s", contract.ID)
		}
	}
}

func (h *lexHarness) withToken(token string) *lexHarness {
	clone := *h
	clone.token = token
	return &clone
}

func expectStatus(t *testing.T, resp *http.Response, wantStatus int) {
	t.Helper()
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("response status = %d, want %d, body=%s", resp.StatusCode, wantStatus, readBody(t, resp.Body))
	}
}
