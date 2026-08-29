package opensearch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/clario360/platform/internal/observability/health"
)

// ClusterHealth probes /_cluster/health and returns the parsed payload.
// The probe is bounded by the parent context; the wrapper does not impose a
// fresh timeout.
func (c *client) ClusterHealth(ctx context.Context) (Health, error) {
	status, body, err := c.do(ctx, http.MethodGet,
		"/_cluster/health?wait_for_status="+c.cfg.HealthMinStatus+"&timeout=2s", nil, nil)
	if err != nil {
		return Health{}, fmt.Errorf("opensearch: cluster health: %w", err)
	}
	if status != http.StatusOK && status != http.StatusRequestTimeout {
		return Health{}, fmt.Errorf("opensearch: cluster health: %w", classifyStatus(status, body))
	}
	var h Health
	if err := json.Unmarshal(body, &h); err != nil {
		return Health{}, fmt.Errorf("opensearch: parse health: %w", err)
	}
	if c.m != nil {
		// Reset all status labels then pin the current one.
		c.m.HealthStatus.WithLabelValues("green").Set(0)
		c.m.HealthStatus.WithLabelValues("yellow").Set(0)
		c.m.HealthStatus.WithLabelValues("red").Set(0)
		if h.Status != "" {
			c.m.HealthStatus.WithLabelValues(h.Status).Set(1)
		}
	}
	if h.Status == "red" {
		return h, fmt.Errorf("opensearch: %w", ErrClusterRed)
	}
	return h, nil
}

// HealthCheckerAdapter adapts a Client into the platform health.HealthChecker.
type HealthCheckerAdapter struct {
	client Client
	addr   string
}

// Name implements health.HealthChecker.
func (h *HealthCheckerAdapter) Name() string { return "opensearch" }

// Check implements health.HealthChecker.
func (h *HealthCheckerAdapter) Check(ctx context.Context) health.HealthResult {
	details := map[string]interface{}{"addr": h.addr}
	res, err := h.client.ClusterHealth(ctx)
	if err != nil {
		return health.HealthResult{
			Status:  "unhealthy",
			Error:   err.Error(),
			Details: details,
		}
	}
	details["cluster_status"] = res.Status
	details["nodes"] = res.NumberOfNodes
	details["active_primary_shards"] = res.ActivePrimaryShards
	switch res.Status {
	case "green":
		return health.HealthResult{Status: "healthy", Details: details}
	case "yellow":
		return health.HealthResult{Status: "degraded", Details: details}
	default:
		return health.HealthResult{Status: "unhealthy", Details: details, Error: "cluster status " + res.Status}
	}
}
