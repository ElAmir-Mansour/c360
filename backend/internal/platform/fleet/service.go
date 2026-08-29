package fleet

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"
)

// Status values for a fleet member and the overall fleet.
const (
	StatusHealthy   = "healthy"
	StatusDegraded  = "degraded"
	StatusUnhealthy = "unhealthy"
	StatusUnknown   = "unknown"
)

// Endpoints reports the scrape targets for a service. Admin is empty when the
// service has no admin port (notification, workflow).
type Endpoints struct {
	HTTP  string `json:"http"`
	Admin string `json:"admin,omitempty"`
}

// Metrics is an OPTIONAL block. P0 ships liveness+readiness+checks only, so all
// fields are pointers and omitted when not scraped (renders "—" not "0" in UI).
type Metrics struct {
	RPS          *float64 `json:"rps,omitempty"`
	ErrorRatePct *float64 `json:"error_rate_pct,omitempty"`
	P50          *float64 `json:"p50,omitempty"`
	P95          *float64 `json:"p95,omitempty"`
	P99          *float64 `json:"p99,omitempty"`
	Active       *int     `json:"active,omitempty"`
	DBPoolPct    *float64 `json:"db_pool_pct,omitempty"`
	CPUPct       *float64 `json:"cpu_pct,omitempty"`
	MemMB        *float64 `json:"mem_mb,omitempty"`
}

// ServiceHealth is one row of the G1 response.
type ServiceHealth struct {
	Name           string            `json:"name"`
	Suite          string            `json:"suite,omitempty"`
	Role           Role              `json:"role"`
	Version        string            `json:"version,omitempty"`
	Uptime         string            `json:"uptime,omitempty"`
	Status         string            `json:"status"`           // healthy|degraded|unhealthy|unknown
	Liveness       string            `json:"liveness"`         // healthy|unhealthy|unknown
	Readiness      string            `json:"readiness"`        // healthy|degraded|unhealthy|unknown
	Checks         map[string]string `json:"checks,omitempty"` // dependency -> status (postgres/redis/kafka/...)
	CircuitBreaker string            `json:"circuit_breaker,omitempty"`
	Endpoints      Endpoints         `json:"endpoints"`
	Metrics        *Metrics          `json:"metrics,omitempty"`
	LastScrapedAt  time.Time         `json:"last_scraped_at"`
	ScrapeError    string            `json:"scrape_error,omitempty"`
}

// Summary is the counts block shared by /fleet/health and /fleet/summary.
type Summary struct {
	Total     int `json:"total"`
	Healthy   int `json:"healthy"`
	Degraded  int `json:"degraded"`
	Unhealthy int `json:"unhealthy"`
	Unknown   int `json:"unknown"`
}

// FleetHealth is the full G1 response.
type FleetHealth struct {
	GeneratedAt   time.Time       `json:"generated_at"`
	OverallStatus string          `json:"overall_status"`
	Summary       Summary         `json:"summary"`
	Services      []ServiceHealth `json:"services"`
}

// FleetSummary is the G1b response: the summary block + a flat unhealthy int
// (used by the sidebar badge endpoint).
type FleetSummary struct {
	Summary   Summary `json:"summary"`
	Unhealthy int     `json:"unhealthy"`
}

// Config configures the aggregator.
type Config struct {
	// BaseHost is the host all services are reachable on (default 127.0.0.1, or
	// PLATFORM_FLEET_BASE_HOST). Hostnames beyond this are never hard-coded.
	BaseHost string
	// Registry is the static service table. Defaults to DefaultRegistry().
	Registry []ServiceDescriptor
	// ScrapeTimeout is the per-service timeout (default 2s).
	ScrapeTimeout time.Duration
	// CacheTTL caches the aggregate result to absorb badge polling (default 10s).
	CacheTTL time.Duration
}

// Service aggregates fleet health by fanning out to each member concurrently.
type Service struct {
	baseHost      string
	registry      []ServiceDescriptor
	scrapeTimeout time.Duration
	cacheTTL      time.Duration
	client        *http.Client
	logger        zerolog.Logger

	cache    *FleetHealth
	cachedAt time.Time
	mu       chan struct{} // 1-slot mutex (avoids importing sync just for this)
}

// New constructs the aggregator. All fields are optional; sane defaults apply.
func New(cfg Config, logger zerolog.Logger) *Service {
	reg := cfg.Registry
	if len(reg) == 0 {
		reg = DefaultRegistry()
	}
	timeout := cfg.ScrapeTimeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	cacheTTL := cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 10 * time.Second
	}
	s := &Service{
		baseHost:      resolveBaseHost(cfg.BaseHost),
		registry:      reg,
		scrapeTimeout: timeout,
		cacheTTL:      cacheTTL,
		client:        &http.Client{Timeout: timeout},
		logger:        logger,
		mu:            make(chan struct{}, 1),
	}
	s.mu <- struct{}{} // make the slot available
	return s
}

// Health returns the full fleet health, served from a short server-side cache
// when fresh (to absorb badge polling — §H).
func (s *Service) Health(ctx context.Context) FleetHealth {
	<-s.mu
	if s.cache != nil && time.Since(s.cachedAt) < s.cacheTTL {
		cached := *s.cache
		s.mu <- struct{}{}
		return cached
	}
	s.mu <- struct{}{}

	fh := s.scrapeAll(ctx)

	<-s.mu
	cp := fh
	s.cache = &cp
	s.cachedAt = time.Now()
	s.mu <- struct{}{}
	return fh
}

// SummaryOf collapses a FleetHealth into the G1b summary response.
func SummaryOf(fh FleetHealth) FleetSummary {
	return FleetSummary{Summary: fh.Summary, Unhealthy: fh.Summary.Unhealthy}
}

// scrapeAll fans out concurrently to every registered service.
func (s *Service) scrapeAll(ctx context.Context) FleetHealth {
	results := make([]ServiceHealth, len(s.registry))

	g, gctx := errgroup.WithContext(ctx)
	for i := range s.registry {
		i, desc := i, s.registry[i]
		g.Go(func() error {
			results[i] = s.scrapeOne(gctx, desc)
			return nil // never fail the group; a slow service must not blank the dashboard
		})
	}
	_ = g.Wait()

	summary := Summary{Total: len(results)}
	for _, r := range results {
		switch r.Status {
		case StatusHealthy:
			summary.Healthy++
		case StatusDegraded:
			summary.Degraded++
		case StatusUnhealthy:
			summary.Unhealthy++
		default:
			summary.Unknown++
		}
	}

	return FleetHealth{
		GeneratedAt:   time.Now(),
		OverallStatus: overallStatus(summary),
		Summary:       summary,
		Services:      results,
	}
}

// overallStatus rolls per-service statuses into a fleet status.
func overallStatus(s Summary) string {
	if s.Total == 0 {
		return StatusUnknown
	}
	if s.Unhealthy == s.Total {
		return StatusUnhealthy
	}
	if s.Unhealthy > 0 || s.Degraded > 0 {
		return StatusDegraded
	}
	if s.Healthy == s.Total {
		return StatusHealthy
	}
	// Some unknowns mixed with healthy.
	return StatusDegraded
}

// scrapeOne probes a single service's /health (and /readyz) within the per-service
// timeout. It NEVER returns an error: failures are captured as status + scrape_error.
func (s *Service) scrapeOne(ctx context.Context, d ServiceDescriptor) ServiceHealth {
	sh := ServiceHealth{
		Name:          d.Name,
		Suite:         d.Suite,
		Role:          d.Role,
		Status:        StatusUnknown,
		Liveness:      StatusUnknown,
		Readiness:     StatusUnknown,
		Endpoints:     Endpoints{HTTP: d.httpEndpoint(s.baseHost), Admin: d.adminEndpoint(s.baseHost)},
		LastScrapedAt: time.Now(),
	}

	cctx, cancel := context.WithTimeout(ctx, s.scrapeTimeout)
	defer cancel()

	// /health: always-200 detailed liveness+readiness rollup (matches
	// observability handler.Health()).
	healthBody, healthCode, err := s.get(cctx, d.healthURL(s.baseHost))
	if err != nil {
		sh.Status = StatusUnhealthy
		sh.Liveness = StatusUnhealthy
		sh.Readiness = StatusUnknown
		sh.ScrapeError = err.Error()
		sh.LastScrapedAt = time.Now()
		return sh
	}
	if healthCode == http.StatusOK {
		sh.Liveness = StatusHealthy
	}

	// Parse the detailed health payload (best-effort; shape from
	// observability/health.Handler.Health()).
	var hp healthPayload
	if jsonErr := json.Unmarshal(healthBody, &hp); jsonErr == nil {
		if hp.Version != "" {
			sh.Version = hp.Version
		}
		if hp.Uptime != "" {
			sh.Uptime = hp.Uptime
		}
		if len(hp.Checks) > 0 {
			sh.Checks = make(map[string]string, len(hp.Checks))
			for name, c := range hp.Checks {
				sh.Checks[name] = c.Status
			}
		}
		// Prefer the payload's own rolled-up status when present.
		if hp.Status != "" {
			sh.Readiness = normalizeStatus(hp.Status)
		}
	}

	// /readyz: authoritative readiness (200 healthy/degraded, 503 unhealthy).
	if _, readyCode, rErr := s.get(cctx, d.readyURL(s.baseHost)); rErr == nil {
		switch {
		case readyCode == http.StatusOK && sh.Readiness == StatusUnknown:
			sh.Readiness = StatusHealthy
		case readyCode == http.StatusServiceUnavailable:
			sh.Readiness = StatusUnhealthy
		}
	}

	sh.Status = rollupServiceStatus(sh.Liveness, sh.Readiness)
	sh.LastScrapedAt = time.Now()
	return sh
}

// rollupServiceStatus combines liveness + readiness into a single status.
func rollupServiceStatus(liveness, readiness string) string {
	if liveness == StatusUnhealthy {
		return StatusUnhealthy
	}
	switch readiness {
	case StatusHealthy:
		return StatusHealthy
	case StatusDegraded:
		return StatusDegraded
	case StatusUnhealthy:
		return StatusUnhealthy
	}
	// Alive but readiness unknown.
	if liveness == StatusHealthy {
		return StatusDegraded
	}
	return StatusUnknown
}

// normalizeStatus maps arbitrary upstream status strings to our vocabulary.
func normalizeStatus(s string) string {
	switch s {
	case StatusHealthy, StatusDegraded, StatusUnhealthy:
		return s
	case "alive", "ok", "up":
		return StatusHealthy
	default:
		return StatusUnknown
	}
}

// get performs a GET and returns body + status code. Body is read with a small cap.
func (s *Service) get(ctx context.Context, url string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB cap
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

// healthPayload mirrors the shape emitted by
// internal/observability/health.Handler.Health().
type healthPayload struct {
	Status  string                       `json:"status"`
	Version string                       `json:"version"`
	Uptime  string                       `json:"uptime"`
	Checks  map[string]healthCheckResult `json:"checks"`
}

type healthCheckResult struct {
	Status string `json:"status"`
}
