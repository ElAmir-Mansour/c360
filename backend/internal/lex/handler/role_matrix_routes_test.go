package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	lexmw "github.com/clario360/platform/internal/lex/middleware"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

// Certifies the EXACT gating chain routes.go mounts on role-matrix activation:
// RequirePermission(lex:role:manage) → RequireDistinctActor(version author).
//   - a Legal Director (lex:write holder, lex:role:view only) must be 403'd by
//     the RBAC tier (role administration is the System Administrator's);
//   - the System Administrator who AUTHORED the version must be 403'd by the
//     dynamic-SoD guard (four-eyes);
//   - a second System Administrator passes.
func TestRoleMatrixActivationGatingChain(t *testing.T) {
	authorID := uuid.New()
	versionID := uuid.New()
	tenantID := uuid.New()

	resolver := lexmw.ActorRecordResolver(func(_ context.Context, gotTenant, recordID uuid.UUID) (lexmw.ActorRecord, bool, error) {
		if gotTenant != tenantID || recordID != versionID {
			return lexmw.ActorRecord{}, false, nil
		}
		return lexmw.ActorRecord{CreatedBy: authorID}, true, nil
	})

	router := chi.NewRouter()
	tier := router.With(
		sharedmw.RequirePermission(auth.PermLexRoleManage),
		lexmw.RequireDistinctActor(resolver, "id"),
	)
	tier.Post("/role-matrix/versions/{id}/activate", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	invoke := func(userID uuid.UUID, roles []string) int {
		req := httptest.NewRequest(http.MethodPost, "/role-matrix/versions/"+versionID.String()+"/activate", nil)
		ctx := auth.WithUser(req.Context(), &auth.ContextUser{
			ID:       userID.String(),
			TenantID: tenantID.String(),
			Roles:    roles,
		})
		ctx = auth.WithTenantID(ctx, tenantID.String())
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req.WithContext(ctx))
		return rec.Code
	}

	// The Legal Director holds lex:write + lex:role:view — NOT lex:role:manage.
	if code := invoke(uuid.New(), []string{"legal-director"}); code != http.StatusForbidden {
		t.Fatalf("director must be denied by the RBAC tier; got %d", code)
	}
	// The importing System Administrator is blocked by dynamic SoD (four-eyes).
	if code := invoke(authorID, []string{"legal-system-admin"}); code != http.StatusForbidden {
		t.Fatalf("the version author must be denied by the distinct-actor guard; got %d", code)
	}
	// A DIFFERENT System Administrator activates.
	if code := invoke(uuid.New(), []string{"legal-system-admin"}); code != http.StatusOK {
		t.Fatalf("a second system administrator must pass; got %d", code)
	}
	// No authenticated user → 401.
	req := httptest.NewRequest(http.MethodPost, "/role-matrix/versions/"+versionID.String()+"/activate", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated must be 401; got %d", rec.Code)
	}
}
