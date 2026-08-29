//go:build integration

package integration

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/database"
)

func TestWorkforceRejectsEntityFromAnotherDirectorSubtree(t *testing.T) {
	h := newLexHarness(t)
	callerID := h.userID
	otherDirectorID := uuid.New()
	callerRootID := uuid.New()
	callerChildID := uuid.New()
	otherRootID := uuid.New()
	otherChildID := uuid.New()

	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		err := database.RunWithTenant(ctx, h.env.db, h.tenantID, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `
				DELETE FROM legal_org_entities
				WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
				h.tenantID, []uuid.UUID{callerChildID, otherChildID}); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `
				DELETE FROM legal_org_entities
				WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
				h.tenantID, []uuid.UUID{callerRootID, otherRootID})
			return err
		})
		if err != nil {
			t.Errorf("cleanup workforce scope fixture: %v", err)
		}
	})

	err := database.RunWithTenant(t.Context(), h.env.db, h.tenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(t.Context(), `
			INSERT INTO legal_org_entities
			    (id, tenant_id, entity_type, code, name, created_by)
			VALUES
			    ($1, $2, 'department', $3, '{"en":"Caller legal"}'::jsonb, $4),
			    ($5, $2, 'department', $6, '{"en":"Other legal"}'::jsonb, $4)`,
			callerRootID, h.tenantID, "WF-CALLER-"+callerRootID.String(), callerID,
			otherRootID, "WF-OTHER-"+otherRootID.String()); err != nil {
			return err
		}
		if _, err := tx.Exec(t.Context(), `
			INSERT INTO legal_org_entities
			    (id, tenant_id, parent_id, entity_type, code, name, created_by)
			VALUES
			    ($1, $2, $3, 'section', $4, '{"en":"Caller child"}'::jsonb, $5),
			    ($6, $2, $7, 'section', $8, '{"en":"Other child"}'::jsonb, $5)`,
			callerChildID, h.tenantID, callerRootID, "WF-CALLER-CHILD-"+callerChildID.String(), callerID,
			otherChildID, otherRootID, "WF-OTHER-CHILD-"+otherChildID.String()); err != nil {
			return err
		}
		if _, err := tx.Exec(t.Context(), `
			INSERT INTO legal_org_roles
			    (tenant_id, entity_id, role_key, user_id, label, created_by)
			VALUES
			    ($1, $2, 'legal_director', $3, '{}'::jsonb, $3),
			    ($1, $4, 'legal_director', $5, '{}'::jsonb, $3)`,
			h.tenantID, callerRootID, callerID, otherRootID, otherDirectorID); err != nil {
			return err
		}
		_, err := tx.Exec(t.Context(), `
			INSERT INTO legal_org_memberships
			    (tenant_id, entity_id, user_id, employee_code, title, created_by)
			VALUES
			    ($1, $2, $3, 'WF-CALLER', '{"en":"Counsel"}'::jsonb, $3),
			    ($1, $4, $5, 'WF-OTHER', '{"en":"Counsel"}'::jsonb, $3)`,
			h.tenantID, callerChildID, callerID, otherChildID, otherDirectorID)
		return err
	})
	if err != nil {
		t.Fatalf("seed workforce director trees: %v", err)
	}

	h.token = h.env.mustToken(t, h.tenantID, callerID, "legal-director")
	allowedPath := "/api/v1/lex/reports/workforce?scope=org&domain=contracts&entity_id=" + callerChildID.String()
	expectStatus(t, h.doJSON(t, http.MethodGet, allowedPath, nil), http.StatusOK)
	auditBackedDomainsPath := "/api/v1/lex/reports/workforce?scope=org&domain=cases,contract_intakes&entity_id=" + callerChildID.String()
	expectStatus(t, h.doJSON(t, http.MethodGet, auditBackedDomainsPath, nil), http.StatusOK)
	overRangePath := "/api/v1/lex/reports/workforce?scope=org&domain=contracts&from=2024-01-01&to=2025-01-01&entity_id=" + callerChildID.String()
	mustError(t, h.doJSON(t, http.MethodGet, overRangePath, nil), http.StatusBadRequest)

	deniedPath := "/api/v1/lex/reports/workforce?scope=org&domain=contracts&entity_id=" + otherChildID.String()
	got := mustError(t, h.doJSON(t, http.MethodGet, deniedPath, nil), http.StatusForbidden)
	if got.Error.Code != "FORBIDDEN" {
		t.Fatalf("outside-subtree error code = %q, want FORBIDDEN", got.Error.Code)
	}
}
