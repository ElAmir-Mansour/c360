package recover

import (
	"context"
	"errors"

	"github.com/clario360/platform/internal/gateway/entitlement"
)

// ErrEntitlementUnavailable is returned when the entitlement resolver cannot
// reach the licensing engine. Callers map it to 503 so a licensing outage is
// never silently treated as "entitled".
var ErrEntitlementUnavailable = errors.New("recover: entitlement service unavailable")

// EntitlementResolver answers, per tenant, whether a Recover entitlement key is
// active. It is the seam onto the EXISTING entitlement engine: the production
// implementation wraps gateway/entitlement.Checker, which forwards the caller's
// bearer token to the licensing service. This package never builds a second
// entitlement system — it composes this one.
type EntitlementResolver interface {
	// Resolve returns whether key is active for the tenant identified by the
	// validated bearer token (authorization), and the denial reason when not.
	// A clean "not licensed" answer returns (false, reason, nil); only an
	// inability to decide returns a non-nil error.
	Resolve(ctx context.Context, tenantID, authorization, key string) (active bool, reason string, err error)
}

// CheckerResolver adapts the existing gateway entitlement.Checker (the same
// resolver the gateway uses to gate suite routes) to EntitlementResolver. No
// new resolution logic lives here: it delegates every decision to the licensing
// engine behind the Checker.
type CheckerResolver struct {
	checker  entitlement.Checker
	failOpen bool
}

// NewCheckerResolver wraps an entitlement.Checker. The checker must be non-nil;
// a nil checker means entitlement resolution is not wired and is a programming
// error the caller must surface at construction. failOpen controls behaviour
// when the licensing engine is unreachable: false (production) fails closed
// (ErrEntitlementUnavailable → 503); true (dev) treats an outage as entitled.
func NewCheckerResolver(checker entitlement.Checker, failOpen bool) (*CheckerResolver, error) {
	if checker == nil {
		return nil, errors.New("recover: entitlement checker is required")
	}
	return &CheckerResolver{checker: checker, failOpen: failOpen}, nil
}

// Resolve delegates to the underlying licensing checker. A transport/decode
// failure from the checker is wrapped as ErrEntitlementUnavailable so the
// caller fails closed rather than guessing — unless failOpen is set, in which
// case the outage resolves to entitled with a reason recording the fail-open.
func (r *CheckerResolver) Resolve(ctx context.Context, tenantID, authorization, key string) (bool, string, error) {
	decision, err := r.checker.Check(ctx, tenantID, authorization, key)
	if err != nil {
		if r.failOpen {
			return true, "entitlement service unavailable (fail-open)", nil
		}
		return false, "", errors.Join(ErrEntitlementUnavailable, err)
	}
	reason := decision.Reason
	if decision.Allowed {
		reason = ""
	}
	return decision.Allowed, reason, nil
}

var _ EntitlementResolver = (*CheckerResolver)(nil)
