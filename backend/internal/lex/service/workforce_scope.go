package service

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type workforceScopeStore interface {
	ResolveDirectorScope(ctx context.Context, tenantID, callerID uuid.UUID, targetEntityID *uuid.UUID) (repository.WorkforceScopeData, error)
	ResolveTenantScope(ctx context.Context, tenantID uuid.UUID) (repository.WorkforceScopeData, error)
	ResolveSelfScope(ctx context.Context, tenantID, callerID uuid.UUID) (repository.WorkforceScopeData, error)
}

type WorkforceScopeRequest struct {
	Mode               model.ScopeMode
	EntityID           *uuid.UUID
	HasWorkforceAccess bool
	HasExecutiveRole   bool
}

type ResolvedWorkforceScope struct {
	Envelope    model.ScopeEnvelope
	Members     []repository.WorkforceScopeMember
	IncludeAll  bool
	MemberByID  map[uuid.UUID]repository.WorkforceScopeMember
	RequestedBy uuid.UUID
}

type WorkforceScopeResolver struct {
	store workforceScopeStore
}

func NewWorkforceScopeResolver(store workforceScopeStore) *WorkforceScopeResolver {
	return &WorkforceScopeResolver{store: store}
}

func (r *WorkforceScopeResolver) Resolve(ctx context.Context, tenantID, callerID uuid.UUID, req WorkforceScopeRequest) (ResolvedWorkforceScope, error) {
	mode := req.Mode
	if mode == "" {
		mode = model.ScopeModeOrg
	}
	if req.EntityID != nil && mode != model.ScopeModeOrg {
		return ResolvedWorkforceScope{}, validationError("entity_id is only valid with org scope", map[string]string{"entity_id": "not valid for requested scope"})
	}
	if mode != model.ScopeModeSelf && !req.HasWorkforceAccess {
		return ResolvedWorkforceScope{}, forbiddenError("workforce reporting requires lex:workforce:read")
	}

	var data repository.WorkforceScopeData
	var err error
	switch mode {
	case model.ScopeModeSelf:
		data, err = r.store.ResolveSelfScope(ctx, tenantID, callerID)
		if err == nil {
			data.Members = ensureSelfWorkforceMember(data.Members, callerID)
		}
	case model.ScopeModeTenant:
		if !req.HasExecutiveRole {
			return ResolvedWorkforceScope{}, forbiddenError("tenant workforce scope requires an executive legal role")
		}
		data, err = r.store.ResolveTenantScope(ctx, tenantID)
	case model.ScopeModeOrg:
		data, err = r.store.ResolveDirectorScope(ctx, tenantID, callerID, req.EntityID)
	default:
		return ResolvedWorkforceScope{}, validationError("scope must be org, self, or tenant", map[string]string{"scope": "invalid"})
	}
	if errors.Is(err, repository.ErrWorkforceEntityOutsideScope) {
		return ResolvedWorkforceScope{}, forbiddenError("entity_id is outside the caller's legal organization subtree")
	}
	if err != nil {
		return ResolvedWorkforceScope{}, internalError("resolve workforce scope", err)
	}

	envelope := model.ScopeEnvelope{
		Mode:        mode,
		EntityIDs:   nonNilWorkforceUUIDs(data.EntityIDs),
		UserIDs:     make([]uuid.UUID, 0, len(data.Members)),
		MemberCount: len(data.Members),
	}
	includeAll := false
	if mode == model.ScopeModeOrg && !data.HasOrgRole {
		envelope.Mode = model.ScopeModeUnscoped
		envelope.Reason = "no_org_role"
		includeAll = true
	} else if mode != model.ScopeModeSelf && !data.RosterConfigured && len(data.Members) == 0 {
		envelope.Mode = model.ScopeModeUnscoped
		envelope.Reason = "roster_not_configured"
		includeAll = true
	}

	memberByID := make(map[uuid.UUID]repository.WorkforceScopeMember, len(data.Members))
	for _, member := range data.Members {
		if member.UserID == uuid.Nil {
			continue
		}
		if _, exists := memberByID[member.UserID]; exists {
			continue
		}
		member.Title = compactWorkforceTitle(member.Title)
		memberByID[member.UserID] = member
		envelope.UserIDs = append(envelope.UserIDs, member.UserID)
	}
	envelope.MemberCount = len(envelope.UserIDs)
	return ResolvedWorkforceScope{
		Envelope: envelope, Members: data.Members, IncludeAll: includeAll,
		MemberByID: memberByID, RequestedBy: callerID,
	}, nil
}

func ensureSelfWorkforceMember(members []repository.WorkforceScopeMember, callerID uuid.UUID) []repository.WorkforceScopeMember {
	for _, member := range members {
		if member.UserID == callerID {
			return members
		}
	}
	return append(members, repository.WorkforceScopeMember{UserID: callerID})
}

func compactWorkforceTitle(title map[string]string) map[string]string {
	out := make(map[string]string, len(title))
	for key, value := range title {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			out[key] = trimmed
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func nonNilWorkforceUUIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}
