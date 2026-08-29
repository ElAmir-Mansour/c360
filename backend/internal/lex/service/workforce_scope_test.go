package service

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type fakeWorkforceScopeStore struct {
	director func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error)
}

func (f fakeWorkforceScopeStore) ResolveDirectorScope(ctx context.Context, tenantID, callerID uuid.UUID, entityID *uuid.UUID) (repository.WorkforceScopeData, error) {
	return f.director(ctx, tenantID, callerID, entityID)
}

func (fakeWorkforceScopeStore) ResolveTenantScope(context.Context, uuid.UUID) (repository.WorkforceScopeData, error) {
	return repository.WorkforceScopeData{}, nil
}

func (fakeWorkforceScopeStore) ResolveSelfScope(context.Context, uuid.UUID, uuid.UUID) (repository.WorkforceScopeData, error) {
	return repository.WorkforceScopeData{}, nil
}

func TestWorkforceScopeRejectsAnotherDirectorsEntity(t *testing.T) {
	tenantID := uuid.New()
	callerID := uuid.New()
	otherDirectorEntityID := uuid.New()
	store := fakeWorkforceScopeStore{director: func(_ context.Context, gotTenant, gotCaller uuid.UUID, target *uuid.UUID) (repository.WorkforceScopeData, error) {
		if gotTenant != tenantID || gotCaller != callerID || target == nil || *target != otherDirectorEntityID {
			t.Fatalf("unexpected resolver arguments tenant=%s caller=%s target=%v", gotTenant, gotCaller, target)
		}
		return repository.WorkforceScopeData{}, repository.ErrWorkforceEntityOutsideScope
	}}

	_, err := NewWorkforceScopeResolver(store).Resolve(context.Background(), tenantID, callerID, WorkforceScopeRequest{
		Mode: model.ScopeModeOrg, EntityID: &otherDirectorEntityID, HasWorkforceAccess: true,
	})
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("Resolve() error = %v, want AppError", err)
	}
	if appErr.Status != http.StatusForbidden {
		t.Fatalf("Resolve() status = %d, want 403", appErr.Status)
	}
}

func TestWorkforceSelfScopeDoesNotRequireWorkforcePermission(t *testing.T) {
	callerID := uuid.New()
	scope, err := NewWorkforceScopeResolver(fakeWorkforceScopeStore{}).Resolve(
		context.Background(), uuid.New(), callerID,
		WorkforceScopeRequest{Mode: model.ScopeModeSelf},
	)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if scope.Envelope.Mode != model.ScopeModeSelf || len(scope.Envelope.UserIDs) != 1 || scope.Envelope.UserIDs[0] != callerID {
		t.Fatalf("Resolve() scope = %+v", scope.Envelope)
	}
}

func TestWorkforceValidEmptyEntityDoesNotWidenConfiguredRoster(t *testing.T) {
	entityID := uuid.New()
	store := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{
			HasOrgRole: true, RosterConfigured: true, EntityIDs: []uuid.UUID{entityID}, Members: []repository.WorkforceScopeMember{},
		}, nil
	}}

	scope, err := NewWorkforceScopeResolver(store).Resolve(context.Background(), uuid.New(), uuid.New(), WorkforceScopeRequest{
		Mode: model.ScopeModeOrg, EntityID: &entityID, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if scope.Envelope.Mode != model.ScopeModeOrg || scope.IncludeAll || scope.Envelope.MemberCount != 0 {
		t.Fatalf("scope = %+v includeAll=%v, valid empty entity must stay narrowly scoped", scope.Envelope, scope.IncludeAll)
	}
}
