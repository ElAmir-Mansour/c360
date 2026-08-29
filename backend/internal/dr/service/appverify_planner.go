package service

import (
	"context"
	"net/url"
	"strconv"
	"strings"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/model"
)

// RecoveryTargetAppPlanner maps recovery_target.recovery_endpoint metadata into
// appverify plans. It is opt-in: a target participates only when its
// recovery_endpoint query contains appverify_kind=<workload kind>. This keeps
// existing health-only targets compatible while giving production wiring a
// load-bearing app verification path.
//
// Example:
//
//	https://recovered.example.com?appverify_kind=generic_http&health_path=/ready&marker_path=/marker
type RecoveryTargetAppPlanner struct{}

// NewRecoveryTargetAppPlanner constructs the default app-verification planner
// for recovery targets.
func NewRecoveryTargetAppPlanner() RecoveryTargetAppPlanner {
	return RecoveryTargetAppPlanner{}
}

// PlanAppVerification implements AppVerificationPlanner.
func (RecoveryTargetAppPlanner) PlanAppVerification(_ context.Context, run *model.FailoverRun, target *model.RecoveryTarget) (appverify.CheckPlan, bool, error) {
	if target == nil || target.RecoveryEndpoint == nil || strings.TrimSpace(*target.RecoveryEndpoint) == "" {
		return appverify.CheckPlan{}, false, nil
	}
	parsed, err := url.Parse(*target.RecoveryEndpoint)
	if err != nil {
		return appverify.CheckPlan{}, false, err
	}
	q := parsed.Query()
	kind := firstQuery(q, "appverify_kind", "app_kind")
	if kind == "" {
		return appverify.CheckPlan{}, false, nil
	}

	attrs := map[string]string{}
	for key, values := range q {
		if len(values) == 0 {
			continue
		}
		switch key {
		case "appverify_kind", "app_kind", "appverify_include", "appverify_require", "appverify_optional",
			"rto_seconds", "rpo_seconds", "max_lag_seconds", "endpoint_url", "endpoint_address":
			continue
		}
		if strings.HasPrefix(key, "appverify_param_") {
			attrs[strings.TrimPrefix(key, "appverify_param_")] = values[0]
			continue
		}
		attrs[key] = values[0]
	}

	endpoint := appverify.WorkloadEndpoint{
		Name:    target.SiteID,
		Type:    "recovery",
		URL:     firstQuery(q, "endpoint_url"),
		Address: firstQuery(q, "endpoint_address"),
	}
	if endpoint.URL == "" && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		endpoint.URL = parsed.Scheme + "://" + parsed.Host
		if attrs["health_path"] == "" && parsed.Path != "" {
			attrs["health_path"] = parsed.Path
		}
	}
	if endpoint.Address == "" && endpoint.URL == "" && parsed.Host != "" {
		endpoint.Address = parsed.Host
	}

	pointID := ""
	if run != nil && run.RecoveryPointID != nil {
		pointID = *run.RecoveryPointID
	}
	metadata := appverify.WorkloadMetadata{
		ID:              target.SiteID,
		Name:            target.SiteID,
		Kind:            appverify.WorkloadKind(kind),
		Endpoints:       []appverify.WorkloadEndpoint{endpoint},
		Database:        firstQuery(q, "database"),
		Namespace:       firstQuery(q, "namespace"),
		Domain:          firstQuery(q, "domain"),
		RecoveryPointID: pointID,
		Attributes:      attrs,
	}
	objectives := appverify.RecoveryObjectives{
		RTOSeconds:            parsePositiveInt(firstQuery(q, "rto_seconds")),
		RPOSeconds:            parsePositiveInt(firstQuery(q, "rpo_seconds")),
		MaxLagSeconds:         parsePositiveInt(firstQuery(q, "max_lag_seconds")),
		IncludeOptionalChecks: parseBool(firstQuery(q, "appverify_optional")),
		IncludeCheckIDs:       splitCSV(firstQuery(q, "appverify_include")),
		RequireCheckIDs:       splitCSV(firstQuery(q, "appverify_require")),
	}
	plan, err := appverify.PlanChecks(metadata, objectives)
	if err != nil {
		return appverify.CheckPlan{}, false, err
	}
	return plan, true, nil
}

func firstQuery(values url.Values, keys ...string) string {
	for _, key := range keys {
		if v := strings.TrimSpace(values.Get(key)); v != "" {
			return v
		}
	}
	return ""
}

func parsePositiveInt(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
