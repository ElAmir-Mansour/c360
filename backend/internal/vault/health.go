package vault

import (
	"context"
	"errors"

	"github.com/clario360/platform/internal/observability/health"
)

// vaultHealthChecker adapts a Client into health.HealthChecker.
type vaultHealthChecker struct {
	client     Client
	addr       string
	authMethod string
}

// NewHealthChecker wraps a Vault Client so it can be registered with the
// platform's CompositeHealthChecker. Name() returns "vault_transit".
func NewHealthChecker(client Client, cfg Config) health.HealthChecker {
	cfg = cfg.WithDefaults()
	return &vaultHealthChecker{
		client:     client,
		addr:       cfg.Addr,
		authMethod: cfg.AuthMethod,
	}
}

func (h *vaultHealthChecker) Name() string { return "vault_transit" }

func (h *vaultHealthChecker) Check(ctx context.Context) health.HealthResult {
	details := map[string]interface{}{
		"addr":        h.addr,
		"auth_method": h.authMethod,
	}
	err := h.client.Health(ctx)
	if err == nil {
		details["sealed"] = false
		details["standby"] = false
		return health.HealthResult{
			Status:  "healthy",
			Details: details,
		}
	}
	switch {
	case errors.Is(err, ErrVaultSealed):
		details["sealed"] = true
		return health.HealthResult{
			Status:  "unhealthy",
			Error:   err.Error(),
			Details: details,
		}
	case errors.Is(err, ErrStandby):
		details["standby"] = true
		return health.HealthResult{
			Status:  "degraded",
			Error:   err.Error(),
			Details: details,
		}
	default:
		return health.HealthResult{
			Status:  "unhealthy",
			Error:   err.Error(),
			Details: details,
		}
	}
}
