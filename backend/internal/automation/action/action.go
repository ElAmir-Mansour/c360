// Package action implements the Automation engine's action surface: the five
// real ActionExecutor targets the orchestrator (internal/automation/service,
// WP-11) drives a runbook through (DESIGN_Workflow_Forms_Automation.md §4.6).
//
// Each executor implements service.ActionExecutor for exactly one
// model.ActionRef.Kind and reaches its target ONLY via the public API or the
// event bus (FR-XC-004) — never another engine's database:
//
//	start_workflow → POST /api/v1/workflows/instances        (start_workflow.go)
//	integration    → publish a domain event → IntegrationConsumer (integration.go)
//	notification   → publish a domain event → NotificationConsumer (notification.go)
//	dr_runbook     → POST /api/v1/dr/studio/runs/{id}/tasks/{taskID}:{verb} (dr_runbook.go)
//	http_call      → generic gateway HTTP with bounded retry        (http_call.go)
//
// The Dispatcher (dispatcher.go) routes a RunStep by its action Kind to the
// matching executor and records the target's response in the run's append-only
// execution log (§4.7) for audit and replay.
//
// CRITICAL execution-context contract: these executors perform REAL external
// I/O (HTTP, Kafka publish) and are deliberately called OUTSIDE the
// orchestrator's advance transaction (the orchestrator's integrate phase invokes
// Execute with no DB handle on the context). They therefore hold NO *pgxpool /
// pgx.Tx; everything they need (the gateway base URL, an HTTP client, a token
// minter, an event publisher) is injected at construction. They MUST be safe to
// call twice for the same logical (run, step) because a transient-error
// re-attempt re-invokes Execute (§4.6 idempotency).
package action

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// TokenMinter mints the per-tenant Clario system bearer token an executor sends
// to a downstream service behind the gateway. It is the SAME contract the
// integration delivery path uses (ClarioAPIClient.MintSystemToken,
// delivery_service.go:202): a short-lived RS256 JWT scoped to the tenant with a
// system identity. Taking the minter as an interface keeps the executors free of
// any IAM/DB dependency and trivially fakeable in tests.
type TokenMinter interface {
	// MintSystemToken returns a bearer access token scoped to tenantID.
	MintSystemToken(tenantID string) (string, error)
}

// TokenMinterFunc adapts a function to TokenMinter.
type TokenMinterFunc func(tenantID string) (string, error)

// MintSystemToken calls the wrapped function.
func (f TokenMinterFunc) MintSystemToken(tenantID string) (string, error) { return f(tenantID) }

// Publisher publishes a domain event to a bus topic. *events.Producer satisfies
// it directly (its Publish has this exact signature). The integration and
// notification executors publish through it so the existing IntegrationConsumer /
// NotificationConsumer fan the event out — neither executor touches the
// integration or notification config database (FR-XC-004).
//
// Publish runs outside any DB transaction (the executor has no DB handle), which
// is why the executors use the live Producer rather than the transactional
// outbox: the outbox writer requires the caller's open tx, which by contract the
// integrate phase does not provide.
type Publisher interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

// ErrTargetUnavailable marks a failure where the action TARGET could not be
// reached or refused with a transient/availability status (network error,
// 5xx, 429, request timeout). The Dispatcher maps it to the orchestrator's
// retry path so the step is re-attempted up to the run's MaxAttempts rather than
// failing the run on a blip. Permanent failures (4xx other than 429, malformed
// config) are returned as plain errors and fail the step.
var ErrTargetUnavailable = errors.New("automation action: target unavailable")

// ErrInvalidActionConfig marks a permanently-bad action configuration (missing
// required field, wrong type). It is NOT retryable — re-running with the same
// recorded inputs would fail identically — so the Dispatcher lets it fail the
// step immediately.
var ErrInvalidActionConfig = errors.New("automation action: invalid config")

// invalidConfig formats an ErrInvalidActionConfig with context.
func invalidConfig(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidActionConfig, fmt.Sprintf(format, args...))
}

// unavailable wraps a cause as a retryable target-unavailable error.
func unavailable(cause error, format string, args ...any) error {
	prefix := fmt.Sprintf(format, args...)
	if cause != nil {
		return fmt.Errorf("%w: %s: %v", ErrTargetUnavailable, prefix, cause)
	}
	return fmt.Errorf("%w: %s", ErrTargetUnavailable, prefix)
}

// IsRetryable reports whether err should drive the orchestrator's retry path.
func IsRetryable(err error) bool { return errors.Is(err, ErrTargetUnavailable) }

// statusIsRetryable reports whether an HTTP status code is a transient
// availability failure worth retrying: 429 (rate limited) and any 5xx. All other
// >=400 codes are permanent client errors that should fail the step.
func statusIsRetryable(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

// ---- config extraction helpers (ActionRef.Config is map[string]any) ---------

// cfgString reads a required string field from an action config map.
func cfgString(cfg map[string]any, key string) (string, error) {
	v, ok := cfg[key]
	if !ok {
		return "", invalidConfig("missing required field %q", key)
	}
	s, ok := v.(string)
	if !ok {
		return "", invalidConfig("field %q must be a string, got %T", key, v)
	}
	if strings.TrimSpace(s) == "" {
		return "", invalidConfig("field %q must not be empty", key)
	}
	return s, nil
}

// cfgStringOpt reads an optional string field, returning def when absent.
func cfgStringOpt(cfg map[string]any, key, def string) (string, error) {
	v, ok := cfg[key]
	if !ok || v == nil {
		return def, nil
	}
	s, ok := v.(string)
	if !ok {
		return "", invalidConfig("field %q must be a string, got %T", key, v)
	}
	return s, nil
}

// cfgMap reads an optional object field as map[string]any.
func cfgMap(cfg map[string]any, key string) (map[string]any, error) {
	v, ok := cfg[key]
	if !ok || v == nil {
		return nil, nil
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, invalidConfig("field %q must be an object, got %T", key, v)
	}
	return m, nil
}

// cfgStringMap reads an optional object field whose values must all be strings
// (e.g. HTTP headers). Non-string values are an invalid-config error.
func cfgStringMap(cfg map[string]any, key string) (map[string]string, error) {
	raw, err := cfgMap(cfg, key)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		s, ok := v.(string)
		if !ok {
			return nil, invalidConfig("field %q.%q must be a string, got %T", key, k, v)
		}
		out[k] = s
	}
	return out, nil
}

// cfgBool reads an optional boolean field, returning def when absent.
func cfgBool(cfg map[string]any, key string, def bool) (bool, error) {
	v, ok := cfg[key]
	if !ok || v == nil {
		return def, nil
	}
	b, ok := v.(bool)
	if !ok {
		return false, invalidConfig("field %q must be a boolean, got %T", key, v)
	}
	return b, nil
}

// tenantFromContext resolves the run's tenant from the context. The orchestrator
// drives a claimed run on a context carrying its tenant (auth.WithTenantID); the
// executors send it downstream as the X-Tenant-ID header and as the subject of
// the per-tenant system token. A missing tenant is a wiring error, not a target
// blip, so it is returned as an invalid-config (non-retryable) failure.
func tenantFromContext(ctx context.Context) (string, error) {
	tid := auth.TenantFromContext(ctx)
	if strings.TrimSpace(tid) == "" {
		return "", invalidConfig("no tenant on execution context")
	}
	return tid, nil
}

// stepConfig returns the action config map for a run step, validating that the
// step actually carries an action of the expected kind.
func stepConfig(step *model.RunStep, wantKind string) (map[string]any, error) {
	if step == nil {
		return nil, invalidConfig("run step is nil")
	}
	if step.Action.Kind != wantKind {
		return nil, invalidConfig("step %d has action kind %q, executor handles %q", step.Index, step.Action.Kind, wantKind)
	}
	cfg := step.Action.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	return cfg, nil
}

// defaultHTTPClient returns an HTTP client with a sane per-call timeout for an
// executor when the caller does not supply one.
func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}
