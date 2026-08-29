package respond

import (
	"context"
	"errors"

	"github.com/clario360/platform/internal/gateway/entitlement"
)

var ErrEntitlementUnavailable = errors.New("respond: entitlement service unavailable")

type EntitlementResolver interface {
	Resolve(ctx context.Context, tenantID, authorization, key string) (active bool, reason string, err error)
}

type CheckerResolver struct {
	checker  entitlement.Checker
	failOpen bool
}

func NewCheckerResolver(checker entitlement.Checker, failOpen bool) (*CheckerResolver, error) {
	if checker == nil {
		return nil, errors.New("respond: entitlement checker is required")
	}
	return &CheckerResolver{checker: checker, failOpen: failOpen}, nil
}

func (r *CheckerResolver) Resolve(ctx context.Context, tenantID, authorization, key string) (bool, string, error) {
	decision, err := r.checker.Check(ctx, tenantID, authorization, key)
	if err != nil {
		if r.failOpen {
			return true, "entitlement service unavailable (fail-open)", nil
		}
		return false, "", errors.Join(ErrEntitlementUnavailable, err)
	}
	if decision.Allowed {
		return true, "", nil
	}
	return false, decision.Reason, nil
}

var _ EntitlementResolver = (*CheckerResolver)(nil)
