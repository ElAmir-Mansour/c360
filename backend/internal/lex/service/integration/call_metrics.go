package integration

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Observability feature #16 — per-connector call metrics + SLOs.
//
// The registry calls CallMetricsRecorder.Record after EVERY dispatched
// TestConnection / SyncNow / Invoke with {op, latency_ms, ok}. The recorder
// appends one bounded, tenant-scoped, secret-free row to
// lex_integration_call_metrics (no payload — only an operation label + timing).
// Aggregate / Overview roll the rows up over a rolling window using Postgres
// percentile_cont for p50/p95 latency, plus error_rate and sync_throughput from
// the sync ledger, and derive the SLO breach verdict from the connector's
// configured slo_target_pct. A nil recorder is a safe no-op so the registry
// never fails a dispatch just because metrics are unwired.
// =============================================================================

// SLOTargetPctKey is the per-endpoint, NON-SECRET config field (a number,
// default 100-DefaultSLOTargetGap = 99) holding the success-rate SLO target as a
// percentage. The connector is SLO-breached when its windowed error_rate exceeds
// (100 - slo_target_pct). It is appended to every kind's schema (schema.go).
const SLOTargetPctKey = "slo_target_pct"

// DefaultSLOTargetPct is the default success-rate SLO when an endpoint does not
// set slo_target_pct (99% success → breach above 1% error rate).
const DefaultSLOTargetPct = 99.0

// MetricsCallOps are the canonical operation labels the registry records, so the
// per-op breakdown and the dashboard share a stable vocabulary. Invoke records
// the actual invoked operation name instead of a fixed label.
const (
	MetricsOpTest = "test"
	MetricsOpSync = "sync"
)

// MetricsRetentionWindow is the longest dashboard window the recorder supports;
// the retention sweep (PruneOlderThan) prunes rows older than this so the
// call-metrics table stays bounded.
const MetricsRetentionWindow = 90 * 24 * time.Hour

// OpMetric is the per-operation breakdown entry in ConnectorMetrics.ByOp.
type OpMetric struct {
	Op        string  `json:"op"`
	Calls     int64   `json:"calls"`
	ErrorRate float64 `json:"error_rate"`
	P95Ms     float64 `json:"p95_ms"`
}

// ConnectorMetrics is the pinned per-connector metrics response
// (GET /integrations/{id}/metrics?window=). All counts/rates are windowed and
// secret-free.
type ConnectorMetrics struct {
	Calls          int64      `json:"calls"`
	Errors         int64      `json:"errors"`
	ErrorRate      float64    `json:"error_rate"`
	LatencyP50Ms   float64    `json:"latency_p50_ms"`
	LatencyP95Ms   float64    `json:"latency_p95_ms"`
	SyncThroughput int64      `json:"sync_throughput"`
	Window         string     `json:"window"`
	SLOTargetPct   float64    `json:"slo_target_pct"`
	SLOBreached    bool       `json:"slo_breached"`
	ByOp           []OpMetric `json:"by_op"`
}

// OverviewMetric is one row of the tenant rollup
// (GET /integrations/metrics). One per endpoint with at least one call in the
// window.
type OverviewMetric struct {
	EndpointID   uuid.UUID             `json:"endpoint_id"`
	Kind         model.IntegrationKind `json:"kind"`
	Name         string                `json:"name"`
	Calls        int64                 `json:"calls"`
	ErrorRate    float64               `json:"error_rate"`
	LatencyP95Ms float64               `json:"latency_p95_ms"`
	SLOBreached  bool                  `json:"slo_breached"`
}

// EndpointMetricLookup resolves an endpoint's identity (name, kind, config) for
// the overview rollup + SLO derivation. The registry supplies it (over the
// FieldCrypto repo) so this package needs no service-layer dependency.
type EndpointMetricLookup func(ctx context.Context, tenantID, endpointID uuid.UUID) (name string, kind model.IntegrationKind, config map[string]any, ok bool)

// SyncThroughputLookup returns the count of sync-run rows in the window for an
// endpoint (the sync_throughput metric). The registry backs it with the sync
// ledger so this package does not re-query it.
type SyncThroughputLookup func(ctx context.Context, tenantID, endpointID uuid.UUID, since time.Time) (int64, error)

// CallMetricsRecorder records per-dispatch call metrics and aggregates them into
// ConnectorMetrics / the tenant overview. It is a thin service over
// IntegrationMetricsRepository plus an endpoint lookup (for identity + the
// slo_target_pct config) and an optional sync-throughput lookup (from the
// ledger). A nil repo makes Record a safe no-op and the aggregates return zero
// results.
type CallMetricsRecorder struct {
	repo           *repository.IntegrationMetricsRepository
	endpointLookup EndpointMetricLookup
	throughput     SyncThroughputLookup
	logger         zerolog.Logger
	now            func() time.Time
}

// NewCallMetricsRecorder builds the recorder over the repository. The endpoint +
// sync-throughput lookups are wired separately via WithLookups (they live on the
// registry, which holds the recorder — a construction cycle resolved by the
// setter). now defaults to time.Now (UTC).
func NewCallMetricsRecorder(repo *repository.IntegrationMetricsRepository, logger zerolog.Logger) *CallMetricsRecorder {
	return &CallMetricsRecorder{
		repo:   repo,
		logger: logger.With().Str("component", "lex-integration-metrics").Logger(),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// WithLookups wires the endpoint-identity + sync-throughput resolvers after the
// registry is constructed. Returns the receiver for chaining.
func (s *CallMetricsRecorder) WithLookups(endpoint EndpointMetricLookup, throughput SyncThroughputLookup) *CallMetricsRecorder {
	if s != nil {
		s.endpointLookup = endpoint
		s.throughput = throughput
	}
	return s
}

// Record appends one call-metrics row for a dispatched operation. Best-effort: a
// nil repo or a write error is logged and swallowed so the registry never fails
// the underlying TestConnection / SyncNow / Invoke just because metrics could not
// be recorded. The op label is the canonical operation (test/sync) or the invoked
// operation name; latency is clamped non-negative.
func (s *CallMetricsRecorder) Record(ctx context.Context, endpoint model.IntegrationEndpoint, op string, latencyMs int64, ok bool) {
	if s == nil || s.repo == nil {
		return
	}
	if latencyMs < 0 {
		latencyMs = 0
	}
	row := &repository.IntegrationCallMetric{
		TenantID:   endpoint.TenantID,
		EndpointID: endpoint.ID,
		Op:         strings.TrimSpace(op),
		LatencyMs:  int(latencyMs),
		OK:         ok,
		OccurredAt: s.now(),
	}
	if err := s.repo.Record(ctx, row); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("record integration call metric")
	}
}

// Aggregate rolls the endpoint's windowed call metrics into ConnectorMetrics: the
// percentile_cont p50/p95 latency, error_rate, the sync_throughput from the sync
// ledger, the per-op breakdown, and the SLO breach verdict (error_rate exceeds
// 100-slo_target_pct). It confirms the endpoint exists via the lookup (the
// registry already 404s before calling, so a missing lookup just yields the
// default SLO target). A nil repo yields a zero-but-shaped ConnectorMetrics.
func (s *CallMetricsRecorder) Aggregate(ctx context.Context, tenantID, endpointID uuid.UUID, window time.Duration) (ConnectorMetrics, error) {
	out := ConnectorMetrics{
		Window:       formatWindow(window),
		SLOTargetPct: DefaultSLOTargetPct,
		ByOp:         []OpMetric{},
	}
	// SLO target rides the endpoint's non-secret config.
	if s.endpointLookup != nil {
		if _, _, config, ok := s.endpointLookup(ctx, tenantID, endpointID); ok {
			out.SLOTargetPct = SLOTargetPct(config)
		}
	}
	if s == nil || s.repo == nil {
		return out, nil
	}
	since := s.now().Add(-window)
	agg, err := s.repo.Aggregate(ctx, tenantID, endpointID, since)
	if err != nil {
		return out, err
	}
	out.Calls = agg.Calls
	out.Errors = agg.Errors
	out.ErrorRate = errorRate(agg.Calls, agg.Errors)
	out.LatencyP50Ms = round2(agg.LatencyP50Ms)
	out.LatencyP95Ms = round2(agg.LatencyP95Ms)
	out.SLOBreached = sloBreached(out.ErrorRate, out.SLOTargetPct, agg.Calls)

	ops, err := s.repo.AggregateByOp(ctx, tenantID, endpointID, since)
	if err != nil {
		return out, err
	}
	for _, o := range ops {
		out.ByOp = append(out.ByOp, OpMetric{
			Op:        o.Op,
			Calls:     o.Calls,
			ErrorRate: errorRate(o.Calls, o.Errors),
			P95Ms:     round2(o.LatencyP95Ms),
		})
	}
	// sync_throughput is the count of sync-run rows in the window (from the ledger).
	if s.throughput != nil {
		if n, terr := s.throughput(ctx, tenantID, endpointID, since); terr == nil {
			out.SyncThroughput = n
		} else {
			s.logger.Warn().Err(terr).Str("endpoint_id", endpointID.String()).Msg("sync throughput lookup")
		}
	}
	return out, nil
}

// Overview rolls every endpoint's windowed call metrics into the tenant overview
// (one row per endpoint with at least one call). Each row's identity (name/kind)
// + SLO target is resolved via the endpoint lookup; an endpoint that has since
// been deleted is skipped. A nil repo yields an empty slice.
func (s *CallMetricsRecorder) Overview(ctx context.Context, tenantID uuid.UUID, window time.Duration) ([]OverviewMetric, error) {
	if s == nil || s.repo == nil {
		return []OverviewMetric{}, nil
	}
	since := s.now().Add(-window)
	rows, err := s.repo.AggregateByEndpoint(ctx, tenantID, since)
	if err != nil {
		return nil, err
	}
	out := make([]OverviewMetric, 0, len(rows))
	for _, e := range rows {
		name := ""
		var kind model.IntegrationKind
		target := DefaultSLOTargetPct
		if s.endpointLookup != nil {
			n, k, config, ok := s.endpointLookup(ctx, tenantID, e.EndpointID)
			if !ok {
				continue // endpoint deleted; drop its orphaned metric rows from the rollup
			}
			name, kind, target = n, k, SLOTargetPct(config)
		}
		rate := errorRate(e.Calls, e.Errors)
		out = append(out, OverviewMetric{
			EndpointID:   e.EndpointID,
			Kind:         kind,
			Name:         name,
			Calls:        e.Calls,
			ErrorRate:    rate,
			LatencyP95Ms: round2(e.LatencyP95Ms),
			SLOBreached:  sloBreached(rate, target, e.Calls),
		})
	}
	return out, nil
}

// Prune deletes call-metrics rows older than the retention window for a tenant
// (the bounded-table sweep). Best-effort; returns the deleted-row count.
func (s *CallMetricsRecorder) Prune(ctx context.Context, tenantID uuid.UUID) (int64, error) {
	if s == nil || s.repo == nil {
		return 0, nil
	}
	return s.repo.PruneOlderThan(ctx, tenantID, s.now().Add(-MetricsRetentionWindow))
}

// SLOTargetPct extracts the success-rate SLO target (percent) from an endpoint
// config, tolerating int / float / string encodings (the config round-trips
// through JSON / masked-config echo). It clamps to (0,100] and defaults to
// DefaultSLOTargetPct when absent, blank, or out of range.
func SLOTargetPct(config map[string]any) float64 {
	if config == nil {
		return DefaultSLOTargetPct
	}
	raw, present := config[SLOTargetPctKey]
	if !present || raw == nil {
		return DefaultSLOTargetPct
	}
	pct := DefaultSLOTargetPct
	switch v := raw.(type) {
	case int:
		pct = float64(v)
	case int64:
		pct = float64(v)
	case float64:
		pct = v
	case float32:
		pct = float64(v)
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return DefaultSLOTargetPct
		}
		parsed, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return DefaultSLOTargetPct
		}
		pct = parsed
	default:
		return DefaultSLOTargetPct
	}
	if pct <= 0 || pct > 100 {
		return DefaultSLOTargetPct
	}
	return pct
}

// errorRate returns the error rate as a percentage (0..100) rounded to 2dp; zero
// calls yields a 0 rate.
func errorRate(calls, errors int64) float64 {
	if calls <= 0 {
		return 0
	}
	return round2(float64(errors) / float64(calls) * 100.0)
}

// sloBreached reports whether the windowed error_rate exceeds the breach
// threshold (100 - slo_target_pct). With zero calls there is no signal, so it is
// never breached (a connector with no traffic is not "failing").
func sloBreached(errRate, sloTargetPct float64, calls int64) bool {
	if calls <= 0 {
		return false
	}
	return errRate > (100.0 - sloTargetPct)
}

// ParseWindowLabel renders a duration as a compact dashboard window label (e.g.
// 24h, 7d, 1h), exported so the registry can shape an empty (unwired-recorder)
// ConnectorMetrics with the requested window.
func ParseWindowLabel(d time.Duration) string { return formatWindow(d) }

// formatWindow renders a duration as a compact dashboard window label (e.g. 24h,
// 7d, 1h). It mirrors the accepted ?window= vocabulary.
func formatWindow(d time.Duration) string {
	if d <= 0 {
		return "24h"
	}
	if d%(24*time.Hour) == 0 {
		return strconv.FormatInt(int64(d/(24*time.Hour)), 10) + "d"
	}
	if d%time.Hour == 0 {
		return strconv.FormatInt(int64(d/time.Hour), 10) + "h"
	}
	return d.String()
}

// ParseWindow parses the ?window= query value (e.g. 1h, 24h, 7d, 30d) into a
// duration, defaulting to 24h when empty/invalid and clamping to the retention
// window so a caller cannot request a window the table cannot serve.
func ParseWindow(raw string) time.Duration {
	raw = strings.TrimSpace(strings.ToLower(raw))
	if raw == "" {
		return 24 * time.Hour
	}
	// Day suffix (Go's ParseDuration does not understand 'd').
	if strings.HasSuffix(raw, "d") {
		if n, err := strconv.Atoi(strings.TrimSuffix(raw, "d")); err == nil && n > 0 {
			return clampWindow(time.Duration(n) * 24 * time.Hour)
		}
		return 24 * time.Hour
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return clampWindow(d)
	}
	return 24 * time.Hour
}

func clampWindow(d time.Duration) time.Duration {
	if d > MetricsRetentionWindow {
		return MetricsRetentionWindow
	}
	return d
}

// round2 rounds a float to two decimal places for stable, compact metric output.
func round2(f float64) float64 {
	return float64(int64(f*100+0.5)) / 100
}
