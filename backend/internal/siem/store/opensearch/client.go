package opensearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v3"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// Config bundles the runtime configuration for the OpenSearch wrapper.
type Config struct {
	// Addresses is the list of node URLs (e.g. ["http://localhost:9210"]).
	Addresses []string
	// Username/Password for HTTP basic auth. Empty in dev.
	Username string
	Password string
	// InsecureTLS skips TLS verification. Must be false in prod (enforced by
	// the SIEM config loader, not here).
	InsecureTLS bool
	// HealthMinStatus is the minimum acceptable colour ("yellow" or "green").
	HealthMinStatus string
	// MaxBulkBytes is the soft cap on a single _bulk HTTP body (default 5 MiB).
	MaxBulkBytes int
	// RolloverMaxAge / MaxPrimaryShardSize control RolloverHot conditions.
	RolloverMaxAge              string
	RolloverMaxPrimaryShardSize string
	// EventPublisher is optional; when non-nil, RolloverHot and FreezeWarm
	// emit CloudEvents to it.
	EventPublisher EventPublisher
}

// EventPublisher is the minimal contract for emitting CloudEvents. The
// store package wires this up so that consumers (SIEM-05) can subscribe to
// lifecycle changes without coupling to internal/events.
type EventPublisher interface {
	Publish(ctx context.Context, eventType string, subject string, data any) error
}

// Client is the SIEM-02 OpenSearch facade.
type Client interface {
	EnsureIndexTemplate(ctx context.Context, tenantID uuid.UUID) error
	BulkIndex(ctx context.Context, tenantID uuid.UUID, docs []storetypes.Document) (BulkResult, error)
	Search(ctx context.Context, tenantID uuid.UUID, dsl json.RawMessage) (SearchResult, error)
	RolloverHot(ctx context.Context, tenantID uuid.UUID) (RolloverResult, error)
	FreezeWarm(ctx context.Context, tenantID uuid.UUID, indexName string) error
	ClusterHealth(ctx context.Context) (Health, error)
	HealthChecker() *HealthCheckerAdapter
	Close() error
}

// BulkResult summarises a BulkIndex response.
type BulkResult struct {
	Succeeded int         `json:"succeeded"`
	Failed    []FailedDoc `json:"failed,omitempty"`
}

// FailedDoc describes a single document that the cluster rejected.
type FailedDoc struct {
	Index  int    `json:"index"`
	Status int    `json:"status"`
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

// SearchResult is the trimmed-down /search response.
type SearchResult struct {
	Hits     []storetypes.Document `json:"hits"`
	Total    int                   `json:"total"`
	ScrollID string                `json:"scroll_id,omitempty"`
}

// RolloverResult mirrors the upstream rollover response.
type RolloverResult struct {
	OldIndex   string `json:"old_index"`
	NewIndex   string `json:"new_index"`
	RolledOver bool   `json:"rolled_over"`
}

// Health is the trimmed-down _cluster/health response.
type Health struct {
	Status              string `json:"status"`
	NumberOfNodes       int    `json:"number_of_nodes"`
	ActivePrimaryShards int    `json:"active_primary_shards"`
	RelocatingShards    int    `json:"relocating_shards"`
	UnassignedShards    int    `json:"unassigned_shards"`
	TimedOut            bool   `json:"timed_out"`
}

// client implements Client.
type client struct {
	cfg    Config
	api    *opensearch.Client
	log    *zerolog.Logger
	tracer trace.Tracer
	m      *Metrics
}

// NewClient builds a client from cfg. Returns error on misconfiguration.
func NewClient(ctx context.Context, cfg Config, log *zerolog.Logger, reg prometheus.Registerer) (Client, error) {
	if len(cfg.Addresses) == 0 {
		return nil, fmt.Errorf("opensearch: no addresses configured")
	}
	if cfg.HealthMinStatus == "" {
		cfg.HealthMinStatus = "yellow"
	}
	if cfg.MaxBulkBytes <= 0 {
		cfg.MaxBulkBytes = 5 * 1024 * 1024
	}
	if cfg.RolloverMaxAge == "" {
		cfg.RolloverMaxAge = "24h"
	}
	if cfg.RolloverMaxPrimaryShardSize == "" {
		cfg.RolloverMaxPrimaryShardSize = "50gb"
	}

	osCfg := opensearch.Config{
		Addresses: cfg.Addresses,
		Username:  cfg.Username,
		Password:  cfg.Password,
	}
	if cfg.InsecureTLS {
		osCfg.Transport = insecureTransport()
	}
	api, err := opensearch.NewClient(osCfg)
	if err != nil {
		return nil, fmt.Errorf("opensearch: build client: %w", err)
	}

	return &client{
		cfg:    cfg,
		api:    api,
		log:    log,
		tracer: otel.Tracer("github.com/clario360/platform/internal/siem/store/opensearch"),
		m:      NewMetrics(reg),
	}, nil
}

func (c *client) Close() error { return nil }

func (c *client) HealthChecker() *HealthCheckerAdapter {
	return &HealthCheckerAdapter{client: c, addr: firstAddr(c.cfg.Addresses)}
}

func firstAddr(s []string) string {
	if len(s) == 0 {
		return ""
	}
	return s[0]
}

// do performs an arbitrary HTTP request and returns the raw status + body.
// All API methods route through here so we can centralise error mapping.
func (c *client) do(ctx context.Context, method, path string, body io.Reader, headers http.Header) (int, []byte, error) {
	addr := firstAddr(c.cfg.Addresses)
	if addr == "" {
		return 0, nil, fmt.Errorf("%w: no addresses", ErrClusterUnreachable)
	}
	url := strings.TrimSuffix(addr, "/") + path
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return 0, nil, fmt.Errorf("opensearch: build request: %w", err)
	}
	if c.cfg.Username != "" || c.cfg.Password != "" {
		req.SetBasicAuth(c.cfg.Username, c.cfg.Password)
	}
	if headers != nil {
		for k, vs := range headers {
			for _, v := range vs {
				req.Header.Add(k, v)
			}
		}
	}
	resp, err := c.api.Perform(req)
	if err != nil {
		return 0, nil, fmt.Errorf("%w: %v", ErrClusterUnreachable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("opensearch: read response: %w", err)
	}
	return resp.StatusCode, buf, nil
}

// startSpan opens an OTEL span tagged with operation + tenant.
func (c *client) startSpan(ctx context.Context, op string, tenantID uuid.UUID) (context.Context, trace.Span) {
	return c.tracer.Start(ctx, "opensearch."+op, trace.WithAttributes(
		attribute.String("tenant_id", tenantID.String()),
		attribute.String("index_pattern", storetypes.IndexPattern(tenantID)),
	))
}

// classifyStatus maps non-2xx HTTP statuses to the most specific sentinel.
func classifyStatus(status int, body []byte) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusNotFound:
		return fmt.Errorf("%w (status=%d body=%s)", ErrIndexNotFound, status, snippet(body))
	case status == http.StatusBadRequest && bytes.Contains(bytes.ToLower(body), []byte("mapper")):
		return fmt.Errorf("%w (status=%d body=%s)", ErrMappingConflict, status, snippet(body))
	default:
		return fmt.Errorf("%w (status=%d body=%s)", ErrBadResponse, status, snippet(body))
	}
}

// snippet returns up to the first 256 bytes of a response body for logging.
func snippet(b []byte) string {
	const lim = 256
	if len(b) > lim {
		return string(b[:lim]) + "..."
	}
	return string(b)
}

// insecureTransport returns an *http.Transport that skips TLS verification.
// Used only when Config.InsecureTLS is set (dev only).
func insecureTransport() *http.Transport {
	return &http.Transport{
		TLSClientConfig: tlsInsecureConfig(),
	}
}
