package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

type orgRBACResolverFunc func(context.Context, uuid.UUID, uuid.UUID, []model.OrgRBACVerb) (*model.OrgRBACPrerequisiteResolution, error)

func (f orgRBACResolverFunc) ResolveOrgRBACPrerequisites(
	ctx context.Context,
	tenantID, entityID uuid.UUID,
	verbs []model.OrgRBACVerb,
) (*model.OrgRBACPrerequisiteResolution, error) {
	return f(ctx, tenantID, entityID, verbs)
}

func TestRequireOrgVerb_TenantAdminBypassesEntityBindings(t *testing.T) {
	resolverCalled := false
	resolver := orgRBACResolverFunc(func(
		_ context.Context,
		_, _ uuid.UUID,
		_ []model.OrgRBACVerb,
	) (*model.OrgRBACPrerequisiteResolution, error) {
		resolverCalled = true
		return nil, nil
	})

	r := chi.NewRouter()
	r.With(RequireOrgVerb(resolver, EntityFromURLParam("entityID"), model.OrgRBACVerbApprove)).
		Post("/entities/{entityID}/approve", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

	entityID := uuid.New()
	req := httptest.NewRequest(http.MethodPost, "/entities/"+entityID.String()+"/approve", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       uuid.NewString(),
		TenantID: uuid.NewString(),
		Roles:    []string{"tenant-admin"},
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req.WithContext(ctx))

	if rec.Code != http.StatusOK {
		t.Fatalf("tenant-admin org-scoped approval = %d, want 200", rec.Code)
	}
	if resolverCalled {
		t.Fatal("tenant-admin should bypass per-entity org-RBAC resolution via tenant:write")
	}
}
