package health

import (
	"context"

	drconfig "github.com/clario360/platform/internal/dr/config"
	obshealth "github.com/clario360/platform/internal/observability/health"
)

// RuntimeConfigHealthChecker exposes the static DR deployment-profile
// validation result through readiness/health responses. Regulated failures are
// unhealthy; standard-profile gaps are degraded at most and do not block local
// development readiness.
type RuntimeConfigHealthChecker struct {
	result drconfig.ValidationResult
}

func NewRuntimeConfigHealthChecker(result drconfig.ValidationResult) *RuntimeConfigHealthChecker {
	return &RuntimeConfigHealthChecker{result: result}
}

func (h *RuntimeConfigHealthChecker) Name() string { return "dr_runtime_config" }

func (h *RuntimeConfigHealthChecker) Check(context.Context) obshealth.HealthResult {
	status := "healthy"
	if !h.result.Valid {
		if h.result.Regulated {
			status = "unhealthy"
		} else {
			status = "degraded"
		}
	}
	details := map[string]interface{}{
		"profile":   h.result.Profile,
		"regulated": h.result.Regulated,
		"valid":     h.result.Valid,
		"checks":    h.result.Checks,
	}
	if err := h.result.Error(); err != "" {
		return obshealth.HealthResult{Status: status, Error: err, Details: details}
	}
	return obshealth.HealthResult{Status: status, Details: details}
}
